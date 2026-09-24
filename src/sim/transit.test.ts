import { describe, expect, it } from 'vitest';
import { BALANCE } from '../shared/constants.ts';
import { tileIndex } from '../shared/grid.ts';
import { buildBusStops, countBusStops, isBusStop } from './transit.ts';
import { buildPowerLines } from './powerLines.ts';
import { buildRoads, bulldozeTiles, undoLastAction } from './roads.ts';
import { createSimState, TileType, type SimState } from './state.ts';

export const SIZE = 24;
export const at = (x: number, y: number) => tileIndex(x, y, SIZE);

/** One street y=10 from x=2..20 on flat ground. */
export function street(seed = 1): SimState {
  const state = createSimState(seed, SIZE);
  state.layers.elevation.fill(0);
  buildRoads(
    state,
    Array.from({ length: 19 }, (_, i) => at(i + 2, 10)),
  );
  return state;
}

describe('buildBusStops', () => {
  it('marks stops on road tiles for the stop price and skips the rest', () => {
    const state = street();
    const before = state.money;
    expect(buildBusStops(state, [at(5, 10), at(6, 10), at(5, 11)])).toEqual({});
    expect(isBusStop(state, at(5, 10))).toBe(true);
    expect(isBusStop(state, at(6, 10))).toBe(true);
    expect(isBusStop(state, at(5, 11))).toBe(false);
    expect(state.layers.busStop[at(5, 11)]).toBe(0);
    expect(state.money).toBe(before - 2 * BALANCE.costs.busStop);
    expect(countBusStops(state)).toBe(2);
    expect(state.dirty.has(at(5, 10))).toBe(true);
  });

  it('a fresh stop starts served (age 0)', () => {
    const state = street();
    state.layers.stopAge[at(5, 10)] = 400;
    buildBusStops(state, [at(5, 10)]);
    expect(state.layers.stopAge[at(5, 10)]).toBe(0);
  });

  it('retracing existing stops is silent, a drag off the road is rejected', () => {
    const state = street();
    buildBusStops(state, [at(5, 10)]);
    const before = state.money;
    expect(buildBusStops(state, [at(5, 10)])).toEqual({});
    expect(state.money).toBe(before);
    expect(buildBusStops(state, [at(5, 12)])).toEqual({ rejected: 'needsRoadTile' });
  });

  it('rejects the whole drag when funds are short', () => {
    const state = street();
    state.money = BALANCE.costs.busStop - 1;
    expect(buildBusStops(state, [at(5, 10)])).toEqual({ rejected: 'notEnoughMoney' });
    expect(isBusStop(state, at(5, 10))).toBe(false);
  });

  it('bulldozing removes the stop first and the road on a second pass', () => {
    const state = street();
    buildBusStops(state, [at(5, 10)]);
    bulldozeTiles(state, [at(5, 10)]);
    expect(isBusStop(state, at(5, 10))).toBe(false);
    expect(state.layers.tileType[at(5, 10)]).toBe(TileType.Road);
    bulldozeTiles(state, [at(5, 10)]);
    expect(state.layers.tileType[at(5, 10)]).toBe(TileType.Empty);
  });

  it('a line and a stop on one road tile both go on the first pass', () => {
    const state = street();
    buildBusStops(state, [at(5, 10)]);
    buildPowerLines(state, [at(5, 10)]);
    bulldozeTiles(state, [at(5, 10)]);
    expect(state.layers.busStop[at(5, 10)]).toBe(0);
    expect(state.layers.powerLine[at(5, 10)]).toBe(0);
    expect(state.layers.tileType[at(5, 10)]).toBe(TileType.Road);
  });

  it('undo restores a stop after a bulldoze and refunds a build', () => {
    const state = street();
    const before = state.money;
    buildBusStops(state, [at(5, 10)]);
    undoLastAction(state);
    expect(isBusStop(state, at(5, 10))).toBe(false);
    expect(state.money).toBe(before);
    buildBusStops(state, [at(5, 10)]);
    bulldozeTiles(state, [at(5, 10)]);
    undoLastAction(state);
    expect(isBusStop(state, at(5, 10))).toBe(true);
  });
});
