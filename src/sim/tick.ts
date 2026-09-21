import { TICKS_PER_DAY } from '../shared/constants.ts';
import type { GlobalStats } from '../shared/types.ts';
import { computeDemand, growthStep } from './growth.ts';
import {
  countPopulationAndJobs,
  totalStorageCapacity,
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
  state.lastDemand = computeDemand(state);
  growthStep(state, state.lastDemand);
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
      generation: { solar: e.solar, wind: e.wind, biogas: e.biogas },
      consumption: {
        buildings: e.buildingConsumption,
        charging: e.chargingConsumption,
      },
      storedEnergy: state.storedEnergy,
      storageCapacity: totalStorageCapacity(state),
      curtailment: e.curtailment,
      deficit: e.deficit,
      history: state.energyHistory.slice(),
    },
    taxRate: state.taxRate,
    speed: state.speed,
    smartCharging: state.smartCharging,
  };
}
