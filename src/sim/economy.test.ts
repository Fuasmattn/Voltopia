import { describe, expect, it } from 'vitest';
import { BALANCE } from '../shared/constants.ts';
import { tileIndex } from '../shared/grid.ts';
import { economyStep } from './economy.ts';
import { placePlant } from './energy.ts';
import { happinessStep } from './happiness.ts';
import { buildRoads } from './roads.ts';
import {
  createSimState,
  PlantType,
  SupplyStatus,
  Zone,
} from './state.ts';

const SIZE = 16;
const at = (x: number, y: number) => tileIndex(x, y, SIZE);

describe('economyStep', () => {
  it('collects taxes from residents and jobs', () => {
    const state = createSimState(1, SIZE);
    const before = state.money;
    const breakdown = economyStep(state, 100, 50);
    const expected =
      state.taxRate *
      (100 * BALANCE.tax.incomePerResident + 50 * BALANCE.tax.incomePerJob);
    expect(breakdown.taxIncome).toBeCloseTo(expected, 6);
    expect(state.money).toBeCloseTo(before + expected, 6);
  });

  it('higher tax rate collects more', () => {
    const state = createSimState(1, SIZE);
    state.taxRate = 0.2;
    const high = economyStep(state, 100, 50).taxIncome;
    state.taxRate = 0.1;
    const low = economyStep(state, 100, 50).taxIncome;
    expect(high).toBeCloseTo(low * 2, 6);
  });

  it('charges road and plant upkeep', () => {
    const state = createSimState(1, SIZE);
    buildRoads(state, [at(1, 1), at(2, 1), at(3, 1)]);
    placePlant(state, at(5, 5), PlantType.WindTurbine);
    const breakdown = economyStep(state, 0, 0);
    expect(breakdown.roadUpkeep).toBeCloseTo(
      3 * BALANCE.upkeepPerTick.roadPerTile,
      6,
    );
    expect(breakdown.plantUpkeep).toBeCloseTo(
      BALANCE.upkeepPerTick.plant[PlantType.WindTurbine],
      6,
    );
  });

  it('biogas generation costs fuel', () => {
    const state = createSimState(1, SIZE);
    state.lastEnergy.biogas = 20;
    const breakdown = economyStep(state, 0, 0);
    expect(breakdown.biogasFuelCost).toBeCloseTo(
      20 * BALANCE.upkeepPerTick.biogasFuelCostPerEnergyUnit,
      6,
    );
  });

  it('grid imports cost money, exports earn a little', () => {
    const state = createSimState(1, SIZE);
    state.lastEnergy.gridImport = 40;
    state.lastEnergy.gridExport = 50;
    const before = state.money;
    const breakdown = economyStep(state, 0, 0);
    expect(breakdown.gridImportCost).toBeCloseTo(
      40 * BALANCE.market.importCostPerEnergyUnit,
      6,
    );
    expect(breakdown.gridExportRevenue).toBeCloseTo(
      50 * BALANCE.market.exportRevenuePerEnergyUnit,
      6,
    );
    expect(state.money).toBeCloseTo(
      before + breakdown.gridExportRevenue - breakdown.gridImportCost,
      6,
    );
  });
});

describe('happinessStep', () => {
  function withBuildings(supplied: number): ReturnType<typeof createSimState> {
    const state = createSimState(1, SIZE);
    for (let i = 0; i < 10; i++) {
      state.layers.zone[at(i, 2)] = Zone.Residential;
      state.layers.density[at(i, 2)] = 1;
      state.layers.supplied[at(i, 2)] = supplied;
    }
    return state;
  }

  it('converges toward the base level in a healthy city', () => {
    const state = withBuildings(SupplyStatus.Supplied);
    for (let i = 0; i < 2000; i++) happinessStep(state);
    expect(state.happiness).toBeCloseTo(BALANCE.happiness.base, 2);
  });

  it('drops with unpowered buildings', () => {
    const state = withBuildings(SupplyStatus.Undersupplied);
    for (let i = 0; i < 2000; i++) happinessStep(state);
    expect(state.happiness).toBeLessThan(
      BALANCE.happiness.base - BALANCE.happiness.undersupplyPenaltyWeight + 0.05,
    );
  });

  it('drops with taxes above the neutral rate', () => {
    const state = withBuildings(SupplyStatus.Supplied);
    state.taxRate = BALANCE.tax.maxRate;
    for (let i = 0; i < 2000; i++) happinessStep(state);
    expect(state.happiness).toBeLessThan(BALANCE.happiness.base - 0.2);
  });

  it('changes smoothly, not abruptly', () => {
    const state = withBuildings(SupplyStatus.Undersupplied);
    const before = state.happiness;
    happinessStep(state);
    expect(Math.abs(state.happiness - before)).toBeLessThan(0.05);
  });
});
