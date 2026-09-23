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
import { neighbors4, tileX, tileY } from '../shared/grid.ts';
import type { GrowthBlocker, TileInfo } from '../shared/types.ts';
import { PlantType, SupplyStatus, Terrain, TileType, Zone } from '../shared/types.ts';
import { policeTaxFactor } from './economy.ts';
import {
  buildingConsumption,
  censusPlants,
  isStation,
  isTileConnected,
  loadProfileFactor,
} from './energy.ts';
import { demandFor, energySystemActive, hasRoadAccess } from './growth.ts';
import { isSupplySource } from './powerGrid.ts';
import { SERVICE_FIRE, SERVICE_POLICE } from './services.ts';
import {
  countPopulationAndJobs,
  pumpedHeadAt,
  riverDropAt,
  slopeAt,
  type SimState,
} from './state.ts';
import { currentSolarFactor, currentWindFactor, riverFlowFactor } from './weather.ts';

/** Generation of one plant tile this tick, and at ideal conditions. */
function plantGeneration(
  state: SimState,
  plant: PlantType,
  index: number,
): { generation: number; peak: number } {
  const e = BALANCE.energy;
  switch (plant) {
    case PlantType.SolarFarm:
      return { generation: e.solarPeakOutput * currentSolarFactor(state), peak: e.solarPeakOutput };
    case PlantType.WindTurbine: {
      const bonus = 1 + BALANCE.terrain.windBonusPerLevel * state.layers.elevation[index];
      return {
        generation: e.windPeakOutput * currentWindFactor(state) * bonus,
        peak: e.windPeakOutput * bonus,
      };
    }
    case PlantType.RunOfRiver: {
      const bonus = 1 + BALANCE.terrain.hydroDropBonus * riverDropAt(state, index);
      return {
        generation: e.hydroPeakOutput * riverFlowFactor(state) * bonus,
        peak: e.hydroPeakOutput * bonus,
      };
    }
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
function plantStorage(
  state: SimState,
  plant: PlantType,
  index: number,
): { stored: number; capacity: number } {
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
      capacity:
        BALANCE.energy.pumpedStorageCapacity *
        (1 + BALANCE.terrain.headBonusPerLevel * pumpedHeadAt(state, index)),
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
    if (density === 2 && (layers.services[index] & SERVICE_FIRE) === 0) {
      blockers.push('noFireCoverage');
    }
    if (energySystemActive(state) && layers.supplied[index] !== SupplyStatus.Supplied) {
      blockers.push(connected ? 'undersupplied' : 'notConnected');
    }
  }
  return blockers;
}

/** Does a power line touch this tile on any side? */
function hasLineAttached(state: SimState, index: number): boolean {
  const { powerLine } = state.layers;
  for (const n of neighbors4(index, state.size)) {
    if (powerLine[n] !== 0) return true;
  }
  return false;
}

/** The ring a tile projects on the map (see TileInfo.ringRadius). */
function ringRadius(state: SimState, index: number, connected: boolean): number {
  const { tileType, plantType, powerLine } = state.layers;
  if (tileType[index] === TileType.Plant) {
    const plant = plantType[index] as PlantType;
    if (plant === PlantType.Park) return BALANCE.happiness.parkRadius;
    if (plant === PlantType.ChargingHub) return BALANCE.vehicles.hubRadius;
    if (plant === PlantType.FireStation) return BALANCE.services.fire.radius;
    if (plant === PlantType.PoliceStation) return BALANCE.services.police.radius;
    if (isSupplySource(plant)) return BALANCE.energy.lineSupplyRadius;
    return 0;
  }
  // A dead line (not reached from any plant) supplies nothing.
  if (powerLine[index] !== 0 && connected) return BALANCE.energy.lineSupplyRadius;
  return 0;
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
  // A supply plant always energises its own ring, so the energized layer
  // says nothing about whether it is tied into the network. For those,
  // "connected" means a power line is attached; every other tile asks
  // whether the network reaches it.
  const connected =
    tileType === TileType.Plant && isSupplySource(plant)
      ? hasLineAttached(state, index)
      : isTileConnected(state, index);

  const isStationPlant = tileType === TileType.Plant && isStation(plant);
  const loadFactor = isBuilding ? loadProfileFactor(zone, time) : 0;
  const consumption = isBuilding
    ? buildingConsumption(zone, density, time)
    : isStationPlant && connected
      ? BALANCE.services.stationConsumption
      : 0;
  const peakConsumption = isBuilding
    ? (BALANCE.energy.consumptionByZoneAndDensity[zone]?.[density] ?? 0)
    : isStationPlant
      ? BALANCE.services.stationConsumption
      : 0;

  const rooftopPeak = isBuilding ? (BALANCE.energy.rooftopSolarPeakByDensity[density] ?? 0) : 0;
  const rooftop = connected ? rooftopPeak * currentSolarFactor(state) : 0;
  const plantOutput =
    tileType === TileType.Plant ? plantGeneration(state, plant, index) : { generation: 0, peak: 0 };
  const storage =
    tileType === TileType.Plant ? plantStorage(state, plant, index) : { stored: 0, capacity: 0 };

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

  const cityPopulation = countPopulationAndJobs(state).population;
  const tileTaxFactor =
    isBuilding && (layers.services[index] & SERVICE_POLICE) === 0
      ? policeTaxFactor(0, cityPopulation)
      : 1;

  const elevation = layers.elevation[index];
  const slope = slopeAt(state, index);
  const terrainBonus =
    tileType === TileType.Plant
      ? plant === PlantType.WindTurbine
        ? 1 + BALANCE.terrain.windBonusPerLevel * elevation
        : plant === PlantType.RunOfRiver
          ? 1 + BALANCE.terrain.hydroDropBonus * riverDropAt(state, index)
          : plant === PlantType.PumpedStorage
            ? 1 + BALANCE.terrain.headBonusPerLevel * pumpedHeadAt(state, index)
            : 1
      : 1;

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
    ringRadius: ringRadius(state, index, connected),
    upkeepPerTick,
    fuelCostPerTick,
    taxPerTick:
      tileTaxFactor *
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
    fireCovered: isBuilding && (layers.services[index] & SERVICE_FIRE) !== 0,
    policeCovered: isBuilding && (layers.services[index] & SERVICE_POLICE) !== 0,
    stationActive: tileType === TileType.Plant && isStation(plant) && connected,
    growthBlockers: growthBlockers(state, index, connected),
    elevation,
    slope,
    terrainBonus,
  };
}
