import { describe, expect, it } from 'vitest';
import { BALANCE } from '../shared/constants.ts';
import { tileIndex } from '../shared/grid.ts';
import { happinessStep } from './happiness.ts';
import { createSimState, SupplyStatus, Zone } from './state.ts';

const SIZE = 16;
const at = (x: number, y: number) => tileIndex(x, y, SIZE);

function suppliedCity() {
  const state = createSimState(1, SIZE);
  for (let i = 0; i < 10; i++) {
    state.layers.zone[at(i, 2)] = Zone.Residential;
    state.layers.density[at(i, 2)] = 1;
    state.layers.supplied[at(i, 2)] = SupplyStatus.Supplied;
  }
  return state;
}

function settle(state: ReturnType<typeof createSimState>, population: number): number {
  for (let i = 0; i < 2000; i++) happinessStep(state, population);
  return state.happiness;
}

describe('police coverage and happiness', () => {
  const { minPopulation, policePenaltyWeight } = BALANCE.services;

  it('has no effect below minPopulation', () => {
    const state = suppliedCity();
    state.lastServices = { fire: 0, police: 0 };
    expect(settle(state, minPopulation - 1)).toBeCloseTo(BALANCE.happiness.base, 2);
  });

  it('applies the full penalty with zero coverage above minPopulation', () => {
    const state = suppliedCity();
    state.lastServices = { fire: 0, police: 0 };
    expect(settle(state, minPopulation)).toBeCloseTo(
      BALANCE.happiness.base - policePenaltyWeight,
      2,
    );
  });

  it('scales the penalty with the uncovered share', () => {
    const state = suppliedCity();
    state.lastServices = { fire: 1, police: 0.75 };
    expect(settle(state, minPopulation)).toBeCloseTo(
      BALANCE.happiness.base - 0.25 * policePenaltyWeight,
      2,
    );
  });
});
