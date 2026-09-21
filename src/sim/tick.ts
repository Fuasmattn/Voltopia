import { TICKS_PER_DAY } from '../shared/constants.ts';
import type { GlobalStats } from '../shared/types.ts';
import { economyStep } from './economy.ts';
import { energyStep } from './energy.ts';
import { goalsStep, goalStates } from './goals.ts';
import { computeDemand, decayStep, growthStep } from './growth.ts';
import { happinessStep } from './happiness.ts';
import { chargingDemand, vehiclesStep } from './vehicles.ts';
import { updateWeather } from './weather.ts';
import {
  countPopulationAndJobs,
  TileType,
  totalStorageCapacity,
  Zone,
  type SimState,
} from './state.ts';

/** 0..1, 0 = midnight, 0.5 = noon. */
export function timeOfDay(tick: number): number {
  return (tick % TICKS_PER_DAY) / TICKS_PER_DAY;
}

export function dayNumber(tick: number): number {
  return Math.floor(tick / TICKS_PER_DAY);
}

/** Advance the simulation by exactly one tick. */
export function stepTick(state: SimState): void {
  state.tick++;
  updateWeather(state);
  vehiclesStep(state);
  energyStep(state, { chargingDemand: chargingDemand(state) });
  state.lastDemand = computeDemand(state);
  growthStep(state, state.lastDemand);
  decayStep(state);
  const { population, jobs } = countPopulationAndJobs(state);
  economyStep(state, population, jobs);
  happinessStep(state);
  goalsStep(state);
}

function countTiles(state: SimState): {
  roadTiles: number;
  zonedTiles: number;
  plantTiles: number;
  buildingTiles: number;
} {
  const { tileType, zone, density } = state.layers;
  const counts = { roadTiles: 0, zonedTiles: 0, plantTiles: 0, buildingTiles: 0 };
  for (let i = 0; i < tileType.length; i++) {
    if (tileType[i] === TileType.Road) counts.roadTiles++;
    else if (tileType[i] === TileType.Plant) counts.plantTiles++;
    else {
      if (zone[i] !== Zone.None) counts.zonedTiles++;
      if (density[i] > 0) counts.buildingTiles++;
    }
  }
  return counts;
}

export function buildStats(state: SimState): GlobalStats {
  const { population, jobs } = countPopulationAndJobs(state);
  const e = state.lastEnergy;
  return {
    tick: state.tick,
    money: state.money,
    population,
    jobs,
    happiness: state.happiness,
    demand: { ...state.lastDemand },
    timeOfDay: timeOfDay(state.tick),
    day: dayNumber(state.tick),
    weather: { ...state.weather },
    energy: {
      generation: {
        solar: e.solar,
        wind: e.wind,
        biogas: e.biogas,
        rooftop: e.rooftop,
      },
      consumption: {
        buildings: e.buildingConsumption,
        charging: e.chargingConsumption,
      },
      storedEnergy: state.storedEnergy,
      storageCapacity: totalStorageCapacity(state),
      curtailment: e.curtailment,
      deficit: e.deficit,
      gridImport: e.gridImport,
      gridExport: e.gridExport,
      history: state.energyHistory.slice(),
    },
    taxRate: state.taxRate,
    speed: state.speed,
    smartCharging: state.smartCharging,
    goals: goalStates(state),
    counts: countTiles(state),
  };
}
