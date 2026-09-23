/**
 * Per-tile inspector.
 *
 * Collects everything the UI shows when the player clicks a tile with the
 * select tool: money upkeep, tax contribution, energy consumption and
 * generation, demand for the tile's zone, and why it is (not) growing.
 * Recomputed from scratch every tick while a tile is selected, so the
 * numbers track the running simulation.
 */
import { BALANCE, TICKS_PER_DAY } from '../shared/constants.ts';
import { tileX, tileY } from '../shared/grid.ts';
import type { GrowthBlocker, TileInfo } from '../shared/types.ts';
import { PlantType, SupplyStatus, Terrain, TileType, Zone } from '../shared/types.ts';
import { buildingConsumption, censusPlants, isTileConnected, loadProfileFactor } from './energy.ts';
import { demandFor, energySystemActive, hasRoadAccess } from './growth.ts';
import type { SimState } from './state.ts';
import { currentSolarFactor, currentWindFactor, riverFlowFactor } from './weather.ts';

/** Generation of one plant tile this tick, and at ideal conditions. */
function plantGeneration(state: SimState, plant: PlantType): { generation: number; peak: number } {
  const e = BALANCE.energy;
  switch (plant) {
    case PlantType.SolarFarm:
      return { generation: e.solarPeakOutput * currentSolarFactor(state), peak: e.solarPeakOutput };
    case PlantType.WindTurbine:
      return { generation: e.windPeakOutput * currentWindFactor(state), peak: e.windPeakOutput };
    case PlantType.RunOfRiver:
      return { generation: e.hydroPeakOutput * riverFlowFactor(state), peak: e.hydroPeakOutput };
    case PlantType.BiogasPlant: {
      // Biogas is dispatched city-wide; show this plant's equal share.
      const plants = censusPlants(state).biogasPlants;
      return {
        generation: plants > 0 ? state.lastEnergy.biogas / plants : 0,
        peak: e.biogasMaxOutput,
      };
    }
    default:
      return { generation: 0, peak: 0 };
  }
}

/** This plant tile's share of its storage pool. */
function plantStorage(state: SimState, plant: PlantType): { stored: number; capacity: number } {
  const census = censusPlants(state);
  if (plant === PlantType.Battery && census.batteries > 0) {
    return {
      stored: state.storedEnergy / census.batteries,
      capacity: BALANCE.energy.batteryCapacity,
    };
  }
  if (plant === PlantType.PumpedStorage && census.pumpedStoragePlants > 0) {
    return {
      stored: state.pumpedStorageEnergy / census.pumpedStoragePlants,
      capacity: BALANCE.energy.pumpedStorageCapacity,
    };
  }
  return { stored: 0, capacity: 0 };
}

/** Reasons a zoned tile is not spawning or densifying right now. */
function growthBlockers(state: SimState, index: number, connected: boolean): GrowthBlocker[] {
  const { layers } = state;
  const zone = layers.zone[index] as Zone;
  if (zone === Zone.None || layers.tileType[index] !== TileType.Empty) return [];

  const blockers: GrowthBlocker[] = [];
  const density = layers.density[index];
  if (layers.terrain[index] !== Terrain.Land) blockers.push('notLand');
  if (!hasRoadAccess(state, index)) blockers.push('noRoad');
  if (demandFor(state.lastDemand, zone) < BALANCE.growth.growthDemandThreshold) {
    blockers.push('lowDemand');
  }
  if (state.happiness < BALANCE.happiness.growthMinimum) blockers.push('cityUnhappy');
  if (density === 0) {
    if (layers.supplied[index] === SupplyStatus.Undersupplied) blockers.push('undersupplied');
  } else if (density >= 3) {
    blockers.push('maxDensity');
  } else {
    if (layers.buildingAge[index] < BALANCE.growth.densifyMinAge) blockers.push('tooYoung');
    if (energySystemActive(state) && layers.supplied[index] !== SupplyStatus.Supplied) {
      blockers.push(connected ? 'undersupplied' : 'notConnected');
    }
  }
  return blockers;
}

/** Full inspector snapshot for one tile, or null when out of bounds. */
export function inspectTile(state: SimState, index: number): TileInfo | null {
  const { layers } = state;
  if (index < 0 || index >= layers.tileType.length) return null;

  const tileType = layers.tileType[index] as TileType;
  const zone = layers.zone[index] as Zone;
  const plant = layers.plantType[index] as PlantType;
  const density = layers.density[index];
  const time = (state.tick % TICKS_PER_DAY) / TICKS_PER_DAY;
  const isBuilding = tileType === TileType.Empty && density > 0;
  const connected = isTileConnected(state, index);

  const loadFactor = isBuilding ? loadProfileFactor(zone, time) : 0;
  const consumption = isBuilding ? buildingConsumption(zone, density, time) : 0;
  const peakConsumption = isBuilding
    ? (BALANCE.energy.consumptionByZoneAndDensity[zone]?.[density] ?? 0)
    : 0;

  const rooftopPeak = isBuilding ? (BALANCE.energy.rooftopSolarPeakByDensity[density] ?? 0) : 0;
  const rooftop = connected ? rooftopPeak * currentSolarFactor(state) : 0;
  const plantOutput =
    tileType === TileType.Plant ? plantGeneration(state, plant) : { generation: 0, peak: 0 };
  const storage =
    tileType === TileType.Plant ? plantStorage(state, plant) : { stored: 0, capacity: 0 };

  const population =
    isBuilding && zone === Zone.Residential ? BALANCE.growth.populationByDensity[density] : 0;
  const jobs = isBuilding ? (BALANCE.growth.jobsByZoneAndDensity[zone]?.[density] ?? 0) : 0;

  const upkeepPerTick =
    tileType === TileType.Road
      ? BALANCE.upkeepPerTick.roadPerTile
      : tileType === TileType.Plant
        ? (BALANCE.upkeepPerTick.plant[plant] ?? 0)
        : 0;
  const fuelCostPerTick =
    plant === PlantType.BiogasPlant
      ? plantOutput.generation * BALANCE.upkeepPerTick.biogasFuelCostPerEnergyUnit
      : 0;

  return {
    index,
    x: tileX(index, state.size),
    y: tileY(index, state.size),
    tileType,
    terrain: layers.terrain[index] as Terrain,
    zone,
    density,
    plantType: plant,
    supplied: layers.supplied[index] as SupplyStatus,
    connected,
    upkeepPerTick,
    fuelCostPerTick,
    taxPerTick:
      state.taxRate *
      (population * BALANCE.tax.incomePerResident + jobs * BALANCE.tax.incomePerJob),
    consumption,
    peakConsumption,
    loadFactor,
    generation: plantOutput.generation + rooftop,
    peakGeneration: plantOutput.peak + rooftopPeak,
    storedEnergy: storage.stored,
    storageCapacity: storage.capacity,
    population,
    jobs,
    demand: demandFor(state.lastDemand, zone),
    buildingAge: layers.buildingAge[index],
    troubledTicks: layers.troubledTicks[index],
    growthBlockers: growthBlockers(state, index, connected),
  };
}
