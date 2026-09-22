import { BALANCE, TICKS_PER_HISTORY_SAMPLE } from '../shared/constants.ts';
import { PlantType, Zone } from '../shared/types.ts';
import { isSupplySource, recomputeGrid } from './powerGrid.ts';
import type { BuildResult } from './roads.ts';
import {
  BuildIntent,
  buildRejection,
  bumpGridVersion,
  markDirty,
  pushEnergyHistory,
  snapshotTile,
  SupplyStatus,
  TileType,
  type SimState,
  type UndoEntry,
} from './state.ts';
import { timeOfDay } from './tick.ts';
import { currentSolarFactor, currentWindFactor, riverFlowFactor } from './weather.ts';

/** True once any power-related plant exists (parks don't count). */
export function hasPowerInfrastructure(state: SimState): boolean {
  const { tileType, plantType } = state.layers;
  for (let i = 0; i < tileType.length; i++) {
    if (tileType[i] !== TileType.Plant) continue;
    const plant = plantType[i] as PlantType;
    if (isSupplySource(plant) || plant === PlantType.ChargingHub) {
      return true;
    }
  }
  return false;
}

/** Place a plant on an empty tile, charging its construction cost. */
export function placePlant(state: SimState, tile: number, plant: PlantType): BuildResult {
  const { layers } = state;
  if (plant === PlantType.None) return { rejected: 'noPlantSelected' };
  const rejection = buildRejection(state, tile, BuildIntent.Plant, plant);
  if (rejection) return { rejected: rejection };
  const cost = BALANCE.costs.plant[plant];
  if (cost > state.money) {
    return { rejected: 'notEnoughMoney' };
  }

  const undo: UndoEntry = { moneyDelta: cost, tiles: [snapshotTile(state, tile)] };

  state.money -= cost;
  layers.tileType[tile] = TileType.Plant;
  layers.zone[tile] = Zone.None;
  layers.plantType[tile] = plant;
  markDirty(state, tile);
  bumpGridVersion(state);
  state.undoStack.push(undo);
  return {};
}

interface PlantCensus {
  solarFarms: number;
  windTurbines: number;
  batteries: number;
  biogasPlants: number;
  chargingHubs: number;
  parks: number;
  runOfRiverPlants: number;
  pumpedStoragePlants: number;
}

export function censusPlants(state: SimState): PlantCensus {
  const { tileType, plantType } = state.layers;
  const census: PlantCensus = {
    solarFarms: 0,
    windTurbines: 0,
    batteries: 0,
    biogasPlants: 0,
    chargingHubs: 0,
    parks: 0,
    runOfRiverPlants: 0,
    pumpedStoragePlants: 0,
  };
  for (let i = 0; i < tileType.length; i++) {
    if (tileType[i] !== TileType.Plant) continue;
    const plant = plantType[i] as PlantType;
    switch (plant) {
      case PlantType.SolarFarm:
        census.solarFarms++;
        break;
      case PlantType.WindTurbine:
        census.windTurbines++;
        break;
      case PlantType.Battery:
        census.batteries++;
        break;
      case PlantType.BiogasPlant:
        census.biogasPlants++;
        break;
      case PlantType.ChargingHub:
        census.chargingHubs++;
        break;
      case PlantType.Park:
        census.parks++;
        break;
      case PlantType.RunOfRiver:
        census.runOfRiverPlants++;
        break;
      case PlantType.PumpedStorage:
        census.pumpedStoragePlants++;
        break;
      case PlantType.None:
        break;
    }
  }
  return census;
}

/** Interpolated hourly load profile factor for a zone at a time of day. */
export function loadProfileFactor(zone: Zone, time: number): number {
  const profile = BALANCE.energy.loadProfileByZone[zone];
  if (!profile) return 0;
  const hour = (time * 24) % 24;
  const lower = Math.floor(hour) % 24;
  const upper = (lower + 1) % 24;
  const blend = hour - Math.floor(hour);
  return profile[lower] * (1 - blend) + profile[upper] * blend;
}

/** Base consumption of one building tile at a given time of day. */
export function buildingConsumption(zone: Zone, density: number, time: number): number {
  const base = BALANCE.energy.consumptionByZoneAndDensity[zone]?.[density] ?? 0;
  return base * loadProfileFactor(zone, time);
}

export interface EnergyTickInput {
  /** Additional charging consumption (EVs), served after buildings. */
  chargingDemand: number;
}

/** Absorb surplus into a storage pool within its power limit and headroom. */
function chargePool(
  stored: number,
  capacity: number,
  powerLimit: number,
  efficiency: number,
  surplus: number,
): { stored: number; absorbed: number } {
  const headroom = Math.max(0, capacity - stored);
  const absorbed = Math.max(0, Math.min(surplus, powerLimit, headroom / efficiency));
  return { stored: stored + absorbed * efficiency, absorbed };
}

/** Release stored energy toward a shortfall within the power limit. */
function dischargePool(
  stored: number,
  powerLimit: number,
  shortfall: number,
): { stored: number; released: number } {
  const released = Math.max(0, Math.min(shortfall, powerLimit, stored));
  return { stored: stored - released, released };
}

/**
 * One tick of the energy balance:
 * 1. renewable generation (solar + wind + rooftop + hydro) covers
 *    consumption,
 * 2. surplus charges batteries, then pumped storage, anything beyond is
 *    exported over the transmission link or curtailed,
 * 3. deficit discharges batteries, then pumped storage, then dispatches
 *    biogas, then imports over the transmission link,
 * 4. remaining deficit becomes undersupply: a matching share of connected
 *    (energised) buildings is flagged undersupplied (deterministic flicker).
 */
export function energyStep(state: SimState, input: EnergyTickInput): void {
  const { layers } = state;
  recomputeGrid(state);
  const census = censusPlants(state);
  const time = timeOfDay(state.tick);

  const solar = census.solarFarms * BALANCE.energy.solarPeakOutput * currentSolarFactor(state);
  const wind = census.windTurbines * BALANCE.energy.windPeakOutput * currentWindFactor(state);
  const hydro = census.runOfRiverPlants * BALANCE.energy.hydroPeakOutput * riverFlowFactor(state);

  // Consumption of all connected buildings, plus their rooftop PV
  // feed-in (rooftop capacity grows automatically with density).
  const solarFactorNow = currentSolarFactor(state);
  let buildingDemand = 0;
  let rooftop = 0;
  const connectedBuildings: number[] = [];
  for (let i = 0; i < layers.tileType.length; i++) {
    if (layers.tileType[i] !== TileType.Empty || layers.density[i] === 0) continue;
    const connected = layers.energized[i] === 1;
    if (!connected) {
      setSupplied(state, i, SupplyStatus.NotConnected);
      continue;
    }
    connectedBuildings.push(i);
    buildingDemand += buildingConsumption(layers.zone[i] as Zone, layers.density[i], time);
    rooftop += (BALANCE.energy.rooftopSolarPeakByDensity[layers.density[i]] ?? 0) * solarFactorNow;
  }

  const chargingDemand = Math.max(0, input.chargingDemand);
  const totalDemand = buildingDemand + chargingDemand;
  const generation = solar + wind + rooftop + hydro;

  const storageCapacity = census.batteries * BALANCE.energy.batteryCapacity;
  const powerLimit = census.batteries * BALANCE.energy.batteryPowerLimit;
  state.storedEnergy = Math.min(state.storedEnergy, storageCapacity);
  const pumpedCapacity = census.pumpedStoragePlants * BALANCE.energy.pumpedStorageCapacity;
  const pumpedPowerLimit = census.pumpedStoragePlants * BALANCE.energy.pumpedStoragePowerLimit;
  state.pumpedStorageEnergy = Math.min(state.pumpedStorageEnergy, pumpedCapacity);

  let curtailment = 0;
  let biogas = 0;
  let deficit = 0;
  let gridImport = 0;
  let gridExport = 0;

  const net = generation - totalDemand;
  if (net >= 0) {
    const battery = chargePool(
      state.storedEnergy,
      storageCapacity,
      powerLimit,
      BALANCE.energy.batteryChargeEfficiency,
      net,
    );
    state.storedEnergy = battery.stored;
    const pumped = chargePool(
      state.pumpedStorageEnergy,
      pumpedCapacity,
      pumpedPowerLimit,
      BALANCE.energy.pumpedStorageChargeEfficiency,
      net - battery.absorbed,
    );
    state.pumpedStorageEnergy = pumped.stored;
    const remaining = net - battery.absorbed - pumped.absorbed;
    // Sell what storage cannot absorb; curtail beyond the link.
    gridExport = Math.min(remaining, BALANCE.market.exportCapacity);
    curtailment = remaining - gridExport;
  } else {
    let shortfall = -net;
    const battery = dischargePool(state.storedEnergy, powerLimit, shortfall);
    state.storedEnergy = battery.stored;
    shortfall -= battery.released;
    const pumped = dischargePool(state.pumpedStorageEnergy, pumpedPowerLimit, shortfall);
    state.pumpedStorageEnergy = pumped.stored;
    shortfall -= pumped.released;
    biogas = Math.min(shortfall, census.biogasPlants * BALANCE.energy.biogasMaxOutput);
    shortfall -= biogas;
    // Expensive imports over the limited transmission link come last.
    gridImport = Math.min(shortfall, BALANCE.market.importCapacity);
    shortfall -= gridImport;
    deficit = shortfall;
  }

  // Flag a deterministic, tick-varying share of connected buildings as
  // undersupplied so they visibly flicker while the grid is short.
  const deficitShare = totalDemand > 0 ? deficit / totalDemand : 0;
  for (const index of connectedBuildings) {
    const undersupplied = deficitShare > 0 && hashTileTick(index, state.tick) < deficitShare;
    setSupplied(state, index, undersupplied ? SupplyStatus.Undersupplied : SupplyStatus.Supplied);
  }

  state.lastEnergy = {
    solar,
    wind,
    biogas,
    hydro,
    rooftop,
    buildingConsumption: buildingDemand,
    chargingConsumption: chargingDemand,
    curtailment,
    deficit,
    gridImport,
    gridExport,
  };

  if (state.tick % TICKS_PER_HISTORY_SAMPLE === 0) {
    const totalCapacity = storageCapacity + pumpedCapacity;
    pushEnergyHistory(state, {
      generation: generation + biogas,
      consumption: totalDemand,
      stateOfCharge:
        totalCapacity > 0 ? (state.storedEnergy + state.pumpedStorageEnergy) / totalCapacity : 0,
    });
  }
}

/** Deterministic pseudo-random value 0..1 per (tile, tick). */
function hashTileTick(index: number, tick: number): number {
  let h = (index * 2654435761 + tick * 40503) >>> 0;
  h ^= h >>> 13;
  h = (h * 0x5bd1e995) >>> 0;
  return (h >>> 8) / 16777216;
}

function setSupplied(state: SimState, index: number, status: SupplyStatus): void {
  if (state.layers.supplied[index] !== status) {
    state.layers.supplied[index] = status;
    markDirty(state, index);
  }
}
