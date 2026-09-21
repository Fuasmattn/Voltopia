import { BALANCE, TICKS_PER_HISTORY_SAMPLE } from '../shared/constants.ts';
import { tileX, tileY } from '../shared/grid.ts';
import { PlantType, Zone } from '../shared/types.ts';
import type { BuildResult } from './roads.ts';
import {
  markDirty,
  pushEnergyHistory,
  SupplyStatus,
  TileType,
  type SimState,
  type UndoEntry,
} from './state.ts';
import { timeOfDay } from './tick.ts';
import { currentSolarFactor, currentWindFactor } from './weather.ts';

/** Plants that provide grid connection within the supply radius. */
const SUPPLY_SOURCES: ReadonlySet<PlantType> = new Set<PlantType>([
  PlantType.SolarFarm,
  PlantType.WindTurbine,
  PlantType.Battery,
  PlantType.BiogasPlant,
]);

/** Place a plant on an empty tile, charging its construction cost. */
export function placePlant(state: SimState, tile: number, plant: PlantType): BuildResult {
  const { layers } = state;
  if (plant === PlantType.None) return { rejected: 'noPlantSelected' };
  if (layers.tileType[tile] !== TileType.Empty || layers.density[tile] !== 0) {
    return { rejected: 'tileOccupied' };
  }
  const cost = BALANCE.costs.plant[plant];
  if (cost > state.money) {
    return { rejected: 'notEnoughMoney' };
  }

  const undo: UndoEntry = {
    moneyDelta: cost,
    tiles: [
      {
        index: tile,
        tileType: layers.tileType[tile],
        roadMask: layers.roadMask[tile],
        zone: layers.zone[tile],
        density: layers.density[tile],
        variant: layers.variant[tile],
        plantType: layers.plantType[tile],
      },
    ],
  };

  state.money -= cost;
  layers.tileType[tile] = TileType.Plant;
  layers.zone[tile] = Zone.None;
  layers.plantType[tile] = plant;
  markDirty(state, tile);
  state.undoStack.push(undo);
  return {};
}

interface PlantCensus {
  solarFarms: number;
  windTurbines: number;
  batteries: number;
  biogasPlants: number;
  chargingHubs: number;
  /** Tile indices of plants that provide grid connection. */
  supplySources: number[];
}

export function censusPlants(state: SimState): PlantCensus {
  const { tileType, plantType } = state.layers;
  const census: PlantCensus = {
    solarFarms: 0,
    windTurbines: 0,
    batteries: 0,
    biogasPlants: 0,
    chargingHubs: 0,
    supplySources: [],
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
      case PlantType.None:
        break;
    }
    if (SUPPLY_SOURCES.has(plant)) census.supplySources.push(i);
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

/**
 * Is a tile within the supply radius (Chebyshev distance) of any
 * grid-connected plant?
 */
function isConnected(state: SimState, index: number, supplySources: number[]): boolean {
  const radius = BALANCE.energy.supplyRadius;
  const x = tileX(index, state.size);
  const y = tileY(index, state.size);
  for (const source of supplySources) {
    const dx = Math.abs(x - tileX(source, state.size));
    const dy = Math.abs(y - tileY(source, state.size));
    if (Math.max(dx, dy) <= radius) return true;
  }
  return false;
}

export interface EnergyTickInput {
  /** Additional charging consumption (EVs), served after buildings. */
  chargingDemand: number;
}

/**
 * One tick of the energy balance:
 * 1. renewable generation (solar + wind) covers consumption,
 * 2. surplus charges batteries, anything beyond is curtailed,
 * 3. deficit discharges batteries, then dispatches biogas,
 * 4. remaining deficit becomes undersupply: a matching share of connected
 *    buildings is flagged undersupplied (deterministic flicker).
 */
export function energyStep(state: SimState, input: EnergyTickInput): void {
  const { layers } = state;
  const census = censusPlants(state);
  const time = timeOfDay(state.tick);

  const solar = census.solarFarms * BALANCE.energy.solarPeakOutput * currentSolarFactor(state);
  const wind = census.windTurbines * BALANCE.energy.windPeakOutput * currentWindFactor(state);

  // Consumption of all connected buildings, plus their rooftop PV
  // feed-in (rooftop capacity grows automatically with density).
  const solarFactorNow = currentSolarFactor(state);
  let buildingDemand = 0;
  let rooftop = 0;
  const connectedBuildings: number[] = [];
  for (let i = 0; i < layers.tileType.length; i++) {
    if (layers.tileType[i] !== TileType.Empty || layers.density[i] === 0) continue;
    const connected = isConnected(state, i, census.supplySources);
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
  const generation = solar + wind + rooftop;

  const storageCapacity = census.batteries * BALANCE.energy.batteryCapacity;
  const powerLimit = census.batteries * BALANCE.energy.batteryPowerLimit;
  state.storedEnergy = Math.min(state.storedEnergy, storageCapacity);

  let curtailment = 0;
  let biogas = 0;
  let deficit = 0;
  let gridImport = 0;
  let gridExport = 0;

  const net = generation - totalDemand;
  if (net >= 0) {
    const headroom = storageCapacity - state.storedEnergy;
    const charge = Math.min(net, powerLimit, headroom / BALANCE.energy.batteryChargeEfficiency);
    state.storedEnergy += charge * BALANCE.energy.batteryChargeEfficiency;
    // Sell what the batteries cannot absorb; curtail beyond the link.
    gridExport = Math.min(net - charge, BALANCE.market.exportCapacity);
    curtailment = net - charge - gridExport;
  } else {
    let shortfall = -net;
    const discharge = Math.min(shortfall, powerLimit, state.storedEnergy);
    state.storedEnergy -= discharge;
    shortfall -= discharge;
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
    rooftop,
    buildingConsumption: buildingDemand,
    chargingConsumption: chargingDemand,
    curtailment,
    deficit,
    gridImport,
    gridExport,
  };

  if (state.tick % TICKS_PER_HISTORY_SAMPLE === 0) {
    pushEnergyHistory(state, {
      generation: generation + biogas,
      consumption: totalDemand,
      stateOfCharge: storageCapacity > 0 ? state.storedEnergy / storageCapacity : 0,
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
