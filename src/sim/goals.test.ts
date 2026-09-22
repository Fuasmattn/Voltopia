import { describe, expect, it } from 'vitest';
import { TICKS_PER_DAY } from '../shared/constants.ts';
import { tileIndex } from '../shared/grid.ts';
import { PlantType, Terrain, Zone } from '../shared/types.ts';
import { placePlant } from './energy.ts';
import { goalsStep, goalStates } from './goals.ts';
import { createSimState, deserializeState, serializeState } from './state.ts';

const SIZE = 16;
const at = (x: number, y: number) => tileIndex(x, y, SIZE);

describe('goals', () => {
  it('starts with no goals achieved', () => {
    const state = createSimState(1, SIZE);
    goalsStep(state);
    expect(goalStates(state).every((g) => !g.achieved)).toBe(true);
  });

  it('firstPower unlocks with the first plant', () => {
    const state = createSimState(1, SIZE);
    placePlant(state, at(3, 3), PlantType.WindTurbine);
    goalsStep(state);
    expect(state.goalsAchieved.has('firstPower')).toBe(true);
  });

  it('population goals unlock at their thresholds', () => {
    const state = createSimState(1, SIZE);
    // 5 residential buildings at density 3 = 130 population
    for (let i = 0; i < 5; i++) {
      state.layers.zone[at(i, 1)] = Zone.Residential;
      state.layers.density[at(i, 1)] = 3;
    }
    goalsStep(state);
    expect(state.goalsAchieved.has('population100')).toBe(true);
    expect(state.goalsAchieved.has('population500')).toBe(false);
  });

  it('cleanDay needs a full day without deficit or imports', () => {
    const state = createSimState(1, SIZE);
    for (let i = 0; i < 5; i++) {
      state.layers.zone[at(i, 1)] = Zone.Residential;
      state.layers.density[at(i, 1)] = 3;
    }
    for (let t = 0; t < TICKS_PER_DAY - 1; t++) goalsStep(state);
    expect(state.goalsAchieved.has('cleanDay')).toBe(false);
    goalsStep(state);
    expect(state.goalsAchieved.has('cleanDay')).toBe(true);
  });

  it('an import tick resets the clean-day streak', () => {
    const state = createSimState(1, SIZE);
    for (let i = 0; i < 5; i++) {
      state.layers.zone[at(i, 1)] = Zone.Residential;
      state.layers.density[at(i, 1)] = 3;
    }
    for (let t = 0; t < TICKS_PER_DAY / 2; t++) goalsStep(state);
    state.lastEnergy.gridImport = 5;
    goalsStep(state);
    expect(state.goalProgress.cleanDayTicks).toBe(0);
  });

  it('exporter accumulates exported energy', () => {
    const state = createSimState(1, SIZE);
    state.lastEnergy.gridExport = 10_000;
    goalsStep(state);
    expect(state.goalsAchieved.has('exporter')).toBe(false);
    goalsStep(state);
    expect(state.goalsAchieved.has('exporter')).toBe(true);
  });

  it('achieved goals survive a save/load round trip', () => {
    const state = createSimState(1, SIZE);
    placePlant(state, at(3, 3), PlantType.WindTurbine);
    goalsStep(state);
    const restored = deserializeState(serializeState(state));
    expect(restored.goalsAchieved.has('firstPower')).toBe(true);
  });

  it('hydroPower is achieved by the first run-of-river plant', () => {
    const state = createSimState(1, 16);
    goalsStep(state);
    expect(state.goalsAchieved.has('hydroPower')).toBe(false);
    state.layers.terrain[tileIndex(3, 3, 16)] = Terrain.River;
    placePlant(state, tileIndex(3, 3, 16), PlantType.RunOfRiver);
    goalsStep(state);
    expect(state.goalsAchieved.has('hydroPower')).toBe(true);
  });
});
