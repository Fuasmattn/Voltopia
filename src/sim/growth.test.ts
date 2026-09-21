import { describe, expect, it } from 'vitest';
import { BALANCE } from '../shared/constants.ts';
import { tileIndex } from '../shared/grid.ts';
import { computeDemand, growthStep } from './growth.ts';
import { buildRoads } from './roads.ts';
import { createSimState, SupplyStatus, TileType, Zone, type SimState } from './state.ts';
import { paintZones } from './zones.ts';

const SIZE = 16;
const at = (x: number, y: number) => tileIndex(x, y, SIZE);

/** A state with a horizontal road at y=5 and residential zoning above it. */
function cityWithRoad(): SimState {
  const state = createSimState(42, SIZE);
  const road = Array.from({ length: 10 }, (_, x) => at(x + 2, 5));
  buildRoads(state, road);
  return state;
}

function runGrowth(state: SimState, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    growthStep(state, computeDemand(state));
  }
}

function totalDensity(state: SimState, zone: Zone): number {
  let sum = 0;
  for (let i = 0; i < state.layers.zone.length; i++) {
    if (state.layers.zone[i] === zone && state.layers.tileType[i] === TileType.Empty) {
      sum += state.layers.density[i];
    }
  }
  return sum;
}

describe('computeDemand', () => {
  it('an empty city wants residents (pioneer demand)', () => {
    const state = createSimState(1, SIZE);
    const demand = computeDemand(state);
    expect(demand.residential).toBeGreaterThan(0.5);
  });

  it('population without jobs creates commercial demand', () => {
    const state = createSimState(1, SIZE);
    state.layers.zone[at(1, 1)] = Zone.Residential;
    state.layers.density[at(1, 1)] = 3;
    const demand = computeDemand(state);
    expect(demand.commercial).toBeGreaterThan(0.5);
    expect(demand.retail).toBeGreaterThan(0);
  });

  it('a jobs surplus suppresses commercial demand', () => {
    const state = createSimState(1, SIZE);
    state.layers.zone[at(1, 1)] = Zone.Commercial;
    state.layers.density[at(1, 1)] = 3;
    const demand = computeDemand(state);
    expect(demand.commercial).toBeLessThan(0);
    // jobs attract residents
    expect(demand.residential).toBeGreaterThan(0);
  });

  it('demand values stay within -1..1', () => {
    const state = createSimState(1, SIZE);
    for (let i = 0; i < 20; i++) {
      state.layers.zone[at(i % SIZE, Math.floor(i / SIZE))] = Zone.Commercial;
      state.layers.density[at(i % SIZE, Math.floor(i / SIZE))] = 3;
    }
    const demand = computeDemand(state);
    for (const value of Object.values(demand)) {
      expect(value).toBeGreaterThanOrEqual(-1);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

describe('growthStep', () => {
  it('spawns buildings only on zoned tiles next to roads', () => {
    const state = cityWithRoad();
    // zone next to the road and one far away
    paintZones(state, [at(4, 4), at(5, 4), at(6, 4)], Zone.Residential);
    paintZones(state, [at(12, 12)], Zone.Residential);
    runGrowth(state, 2000);
    expect(totalDensity(state, Zone.Residential)).toBeGreaterThan(0);
    expect(state.layers.density[at(12, 12)]).toBe(0);
  });

  it('never grows without any zones', () => {
    const state = cityWithRoad();
    runGrowth(state, 500);
    expect(totalDensity(state, Zone.Residential)).toBe(0);
    expect(totalDensity(state, Zone.Commercial)).toBe(0);
  });

  it('densifies up to level 3 over time (no energy system yet)', () => {
    const state = cityWithRoad();
    paintZones(state, [at(4, 4)], Zone.Residential);
    runGrowth(state, BALANCE.growth.densifyMinAge * 30);
    expect(state.layers.density[at(4, 4)]).toBe(3);
  });

  it('does not densify young buildings', () => {
    const state = cityWithRoad();
    paintZones(state, [at(4, 4)], Zone.Residential);
    // Run just enough for a spawn but far less than densifyMinAge.
    runGrowth(state, 50);
    expect(state.layers.density[at(4, 4)]).toBeLessThanOrEqual(1);
  });

  it('stops growing when happiness is too low', () => {
    const state = cityWithRoad();
    paintZones(state, [at(4, 4), at(5, 4)], Zone.Residential);
    state.happiness = BALANCE.happiness.growthMinimum - 0.01;
    runGrowth(state, 1000);
    expect(totalDensity(state, Zone.Residential)).toBe(0);
  });

  it('does not spawn on undersupplied tiles', () => {
    const state = cityWithRoad();
    paintZones(state, [at(4, 4)], Zone.Residential);
    state.layers.supplied[at(4, 4)] = SupplyStatus.Undersupplied;
    runGrowth(state, 1000);
    expect(state.layers.density[at(4, 4)]).toBe(0);
  });

  it('is deterministic for the same seed', () => {
    const build = (): SimState => {
      const state = cityWithRoad();
      paintZones(
        state,
        [at(4, 4), at(5, 4), at(6, 4), at(4, 6), at(5, 6)],
        Zone.Residential,
      );
      runGrowth(state, 800);
      return state;
    };
    const a = build();
    const b = build();
    expect([...a.layers.density]).toEqual([...b.layers.density]);
    expect([...a.layers.variant]).toEqual([...b.layers.variant]);
  });

  it('commercial grows once residents exist', () => {
    const state = cityWithRoad();
    paintZones(state, [at(4, 4), at(5, 4), at(6, 4)], Zone.Residential);
    paintZones(state, [at(4, 6), at(5, 6)], Zone.Commercial);
    runGrowth(state, 4000);
    expect(totalDensity(state, Zone.Commercial)).toBeGreaterThan(0);
  });
});
