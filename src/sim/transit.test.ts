import { describe, expect, it } from 'vitest';
import { BALANCE, TICKS_PER_DAY } from '../shared/constants.ts';
import { tileIndex } from '../shared/grid.ts';
import { PlantType, StopState } from '../shared/types.ts';
import {
  ageStops,
  buildBusStops,
  busDepotTiles,
  claimedBusStops,
  countBusStops,
  isBusStop,
  planBusTour,
  stopDueTicks,
  stopServiceTicks,
  stopState,
  syncBusFleet,
  updateCoverage,
} from './transit.ts';
import { placePlant } from './energy.ts';
import { buildPowerLines } from './powerLines.ts';
import { buildRoads, bulldozeTiles, undoLastAction } from './roads.ts';
import { BusPhase, createSimState, TileType, type SimState } from './state.ts';

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

/** The street plus a bus depot at (2,9) parking on (2,10) and `stops` stops from x=6 on. */
export function busTown(seed = 1, stops = 4): SimState {
  const state = street(seed);
  placePlant(state, at(2, 9), PlantType.BusDepot);
  buildBusStops(
    state,
    Array.from({ length: stops }, (_, i) => at(6 + i * 3, 10)),
  );
  return state;
}

describe('bus fleet', () => {
  it('a depot fields busesPerDepot buses parked on its road tile', () => {
    const state = busTown();
    syncBusFleet(state);
    expect(busDepotTiles(state)).toEqual([at(2, 9)]);
    expect(state.buses).toHaveLength(BALANCE.transit.busesPerDepot);
    for (const bus of state.buses) {
      expect(bus.depot).toBe(at(2, 9));
      expect(bus.depotRoad).toBe(at(2, 10));
      expect(bus.phase).toBe(BusPhase.AtDepot);
      expect([Math.floor(bus.x), Math.floor(bus.y)]).toEqual([2, 10]);
    }
    syncBusFleet(state);
    expect(state.buses).toHaveLength(BALANCE.transit.busesPerDepot);
  });

  it('a depot without road access fields no buses', () => {
    const state = createSimState(1, SIZE);
    state.layers.tileType[at(15, 2)] = TileType.Plant;
    state.layers.plantType[at(15, 2)] = PlantType.BusDepot;
    syncBusFleet(state);
    expect(state.buses).toHaveLength(0);
  });

  it('bulldozing the depot drops its buses', () => {
    const state = busTown();
    syncBusFleet(state);
    bulldozeTiles(state, [at(2, 9)]);
    syncBusFleet(state);
    expect(state.buses).toHaveLength(0);
  });

  it('buses get unique ids shared with the car counter', () => {
    const state = busTown();
    state.nextVehicleId = 20;
    syncBusFleet(state);
    expect(state.buses.map((b) => b.id)).toEqual([20, 21, 22]);
    expect(state.nextVehicleId).toBe(23);
  });
});

describe('ageStops / stopState', () => {
  it('counts ticks for stops only and saturates', () => {
    const state = busTown();
    for (let t = 0; t < 5; t++) ageStops(state);
    expect(state.layers.stopAge[at(6, 10)]).toBe(5);
    expect(state.layers.stopAge[at(7, 10)]).toBe(0); // road without a stop
    state.layers.stopAge[at(9, 10)] = 65535;
    ageStops(state);
    expect(state.layers.stopAge[at(9, 10)]).toBe(65535);
  });

  it('resets the age of a tile that lost its stop', () => {
    const state = busTown();
    state.layers.stopAge[at(6, 10)] = 40;
    state.layers.busStop[at(6, 10)] = 0;
    ageStops(state);
    expect(state.layers.stopAge[at(6, 10)]).toBe(0);
  });

  it('buckets served, due and unserved and marks the tile dirty on a change', () => {
    const state = busTown();
    expect(stopState(state, at(6, 10))).toBe(StopState.Served);
    expect(stopState(state, at(7, 10))).toBe(StopState.Served); // no stop
    state.layers.stopAge[at(6, 10)] = stopDueTicks();
    state.dirty.clear();
    ageStops(state);
    expect(stopState(state, at(6, 10))).toBe(StopState.Due);
    expect(state.dirty.has(at(6, 10))).toBe(true);
    state.layers.stopAge[at(6, 10)] = stopServiceTicks();
    state.dirty.clear();
    ageStops(state);
    expect(stopState(state, at(6, 10))).toBe(StopState.Unserved);
    expect(state.dirty.has(at(6, 10))).toBe(true);
    state.dirty.clear();
    ageStops(state);
    expect(state.dirty.has(at(6, 10))).toBe(false);
  });

  it('reports how many stops are at least half-way to due', () => {
    const state = busTown(1, 3);
    expect(ageStops(state)).toBe(0);
    state.layers.stopAge[at(6, 10)] = Math.floor(stopDueTicks() / 2);
    expect(ageStops(state)).toBe(1);
  });

  it('window sizes follow BALANCE', () => {
    expect(stopServiceTicks()).toBe(Math.round(BALANCE.transit.serviceWindowDays * TICKS_PER_DAY));
    expect(stopDueTicks()).toBe(Math.round(BALANCE.transit.dueAfterDays * TICKS_PER_DAY));
  });
});

describe('updateCoverage', () => {
  it('covers road tiles within stopRadius of a served stop only', () => {
    const state = busTown(1, 1); // one stop at (6,10)
    buildRoads(state, [at(6, 11), at(6, 12), at(6, 13), at(6, 14), at(6, 15)]);
    const r = BALANCE.transit.stopRadius;
    state.dirty.clear();
    updateCoverage(state);
    expect(state.layers.transitCover[at(6, 10)]).toBe(1);
    expect(state.layers.transitCover[at(6 + r, 10)]).toBe(1);
    expect(state.layers.transitCover[at(6 + r + 1, 10)]).toBe(0);
    expect(state.layers.transitCover[at(6, 10 + r)]).toBe(1);
    expect(state.layers.transitCover[at(6, 10 + r + 1)]).toBe(0);
    expect(state.layers.transitCover[at(6, 9)]).toBe(0); // not a road
    expect(state.dirty.has(at(6 + r, 10))).toBe(true);
    // No change on the second run: nothing is marked dirty.
    state.dirty.clear();
    updateCoverage(state);
    expect(state.dirty.size).toBe(0);
  });

  it('an unserved stop covers nothing and the loss is diffed', () => {
    const state = busTown(1, 1);
    updateCoverage(state);
    state.layers.stopAge[at(6, 10)] = stopServiceTicks() + 1;
    state.dirty.clear();
    updateCoverage(state);
    expect(state.layers.transitCover[at(6, 10)]).toBe(0);
    expect(state.dirty.has(at(6, 10))).toBe(true);
  });
});

describe('planBusTour', () => {
  it('returns nothing while no stop is at least half-way to due', () => {
    const state = busTown();
    syncBusFleet(state);
    expect(planBusTour(state, state.buses[0], new Set())).toEqual([]);
  });

  it('picks the oldest stops first, caps at stopsPerTour and ends at the depot road', () => {
    // busTown asks for stops at x = 6, 9, …, 27; the street ends at x = 20,
    // so buildBusStops silently keeps the five at x = 6, 9, 12, 15, 18.
    const state = busTown(1, 8);
    syncBusFleet(state);
    const onRoad = [6, 9, 12, 15, 18].map((x) => at(x, 10));
    onRoad.forEach((tile, i) => {
      state.layers.stopAge[tile] = stopDueTicks() + i * 10;
    });
    const tour = planBusTour(state, state.buses[0], new Set());
    const expectedStops = Math.min(BALANCE.transit.stopsPerTour, onRoad.length);
    expect(tour).toHaveLength(expectedStops + 1);
    expect(tour[tour.length - 1]).toBe(at(2, 10));
    const stops = tour.slice(0, -1);
    // Nearest-neighbour from the depot: ascending x along the street.
    expect(stops).toEqual([...stops].sort((a, b) => a - b));
  });

  it('leaves the youngest stops for later when there are more than stopsPerTour', () => {
    const state = street();
    placePlant(state, at(2, 9), PlantType.BusDepot);
    const tiles = Array.from({ length: BALANCE.transit.stopsPerTour + 2 }, (_, i) =>
      at(4 + i * 2, 10),
    );
    buildBusStops(state, tiles);
    syncBusFleet(state);
    tiles.forEach((tile, i) => {
      state.layers.stopAge[tile] = stopDueTicks() + i * 10;
    });
    const stops = planBusTour(state, state.buses[0], new Set()).slice(0, -1);
    expect(stops).toHaveLength(BALANCE.transit.stopsPerTour);
    expect(stops).not.toContain(tiles[0]);
    expect(stops).not.toContain(tiles[1]);
  });

  it('never picks a stop claimed by another bus', () => {
    const state = busTown(1, 2); // stops at (6,10) and (9,10)
    syncBusFleet(state);
    state.layers.stopAge[at(6, 10)] = stopDueTicks();
    state.layers.stopAge[at(9, 10)] = stopDueTicks();
    state.buses[1].stops = [at(6, 10), at(2, 10)];
    const claimed = claimedBusStops(state);
    expect(claimed.has(at(6, 10))).toBe(true);
    expect(claimed.has(at(2, 10))).toBe(false);
    expect(planBusTour(state, state.buses[0], claimed)).toEqual([at(9, 10), at(2, 10)]);
  });

  it('ignores stops beyond maxRouteTiles', () => {
    const BIG = 80;
    const big = (x: number, y: number) => tileIndex(x, y, BIG);
    const state = createSimState(1, BIG);
    state.layers.elevation.fill(0);
    buildRoads(
      state,
      Array.from({ length: 75 }, (_, i) => big(i + 2, 10)),
    );
    placePlant(state, big(2, 9), PlantType.BusDepot);
    const near = big(2 + BALANCE.transit.maxRouteTiles - 1, 10);
    const far = big(2 + BALANCE.transit.maxRouteTiles + 5, 10);
    buildBusStops(state, [near, far]);
    state.layers.stopAge[near] = stopDueTicks();
    state.layers.stopAge[far] = stopDueTicks();
    syncBusFleet(state);
    expect(planBusTour(state, state.buses[0], new Set())).toEqual([near, big(2, 10)]);
  });
});
