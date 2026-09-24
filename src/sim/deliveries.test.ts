import { describe, expect, it } from 'vitest';
import { BALANCE, TICKS_PER_DAY } from '../shared/constants.ts';
import { tileIndex } from '../shared/grid.ts';
import { DeliveryState, PlantType, Zone } from '../shared/types.ts';
import {
  ageShops,
  claimedStops,
  deliveryState,
  dueTicks,
  planTour,
  supplyWindowTicks,
  syncFleet,
} from './deliveries.ts';
import { placePlant } from './energy.ts';
import { bulldozeTiles, buildRoads } from './roads.ts';
import { createSimState, TileType, VanPhase, type SimState } from './state.ts';

const SIZE = 24;
const at = (x: number, y: number) => tileIndex(x, y, SIZE);

/**
 * A shop street: road y=10 from x=2..20, depot at (2,9) parking on (2,10),
 * `shops` retail buildings south of the road from x=6 on.
 */
export function shopTown(seed = 1, shops = 6): SimState {
  const state = createSimState(seed, SIZE);
  buildRoads(
    state,
    Array.from({ length: 19 }, (_, i) => at(i + 2, 10)),
  );
  placePlant(state, at(2, 9), PlantType.LogisticsDepot);
  for (let i = 0; i < shops; i++) {
    state.layers.zone[at(6 + i, 11)] = Zone.Retail;
    state.layers.density[at(6 + i, 11)] = 1;
  }
  return state;
}

describe('fleet', () => {
  it('a depot fields vansPerDepot vans parked on its road tile', () => {
    const state = shopTown();
    syncFleet(state);
    expect(state.vans).toHaveLength(BALANCE.deliveries.vansPerDepot);
    for (const van of state.vans) {
      expect(van.depot).toBe(at(2, 9));
      expect(van.depotRoad).toBe(at(2, 10));
      expect(van.phase).toBe(VanPhase.AtDepot);
      expect([Math.floor(van.x), Math.floor(van.y)]).toEqual([2, 10]);
    }
    syncFleet(state);
    expect(state.vans).toHaveLength(BALANCE.deliveries.vansPerDepot); // idempotent
  });

  it('a depot without road access fields no vans', () => {
    const state = createSimState(1, SIZE);
    state.layers.tileType[at(15, 2)] = TileType.Plant;
    state.layers.plantType[at(15, 2)] = PlantType.LogisticsDepot;
    syncFleet(state);
    expect(state.vans).toHaveLength(0);
  });

  it('bulldozing the depot drops its vans', () => {
    const state = shopTown();
    syncFleet(state);
    bulldozeTiles(state, [at(2, 9)]);
    syncFleet(state);
    expect(state.vans).toHaveLength(0);
  });

  it('vans get unique ids shared with the car counter', () => {
    const state = shopTown();
    state.nextVehicleId = 10;
    syncFleet(state);
    expect(state.vans.map((v) => v.id)).toEqual([10, 11, 12]);
    expect(state.nextVehicleId).toBe(13);
  });
});

describe('ageShops / deliveryState', () => {
  it('counts ticks for shops only and saturates', () => {
    const state = shopTown();
    for (let t = 0; t < 5; t++) ageShops(state);
    expect(state.layers.deliveryAge[at(6, 11)]).toBe(5);
    expect(state.layers.deliveryAge[at(6, 10)]).toBe(0); // road
    state.layers.deliveryAge[at(7, 11)] = 65535;
    ageShops(state);
    expect(state.layers.deliveryAge[at(7, 11)]).toBe(65535);
  });

  it('resets the age of a tile that stops being a shop', () => {
    const state = shopTown();
    state.layers.deliveryAge[at(6, 11)] = 40;
    state.layers.density[at(6, 11)] = 0;
    ageShops(state);
    expect(state.layers.deliveryAge[at(6, 11)]).toBe(0);
  });

  it('buckets supplied, due and unsupplied and marks the tile dirty on a change', () => {
    const state = shopTown();
    expect(deliveryState(state, at(6, 11))).toBe(DeliveryState.Supplied);
    expect(deliveryState(state, at(6, 10))).toBe(DeliveryState.Supplied); // not a shop
    state.layers.deliveryAge[at(6, 11)] = dueTicks();
    state.dirty.clear();
    ageShops(state);
    expect(deliveryState(state, at(6, 11))).toBe(DeliveryState.Due);
    expect(state.dirty.has(at(6, 11))).toBe(true);
    state.layers.deliveryAge[at(6, 11)] = supplyWindowTicks();
    state.dirty.clear();
    ageShops(state);
    expect(deliveryState(state, at(6, 11))).toBe(DeliveryState.Unsupplied);
    expect(state.dirty.has(at(6, 11))).toBe(true);
  });

  it('window sizes follow BALANCE', () => {
    expect(supplyWindowTicks()).toBe(
      Math.round(BALANCE.deliveries.supplyWindowDays * TICKS_PER_DAY),
    );
    expect(dueTicks()).toBe(Math.round(BALANCE.deliveries.dueAfterDays * TICKS_PER_DAY));
  });
});

describe('planTour', () => {
  it('returns nothing while no shop is at least half-way to due', () => {
    const state = shopTown();
    syncFleet(state);
    expect(planTour(state, state.vans[0], new Set())).toEqual([]);
  });

  it('picks the oldest shops first, caps at stopsPerTour and ends at the depot road', () => {
    const state = shopTown(1, 8);
    syncFleet(state);
    for (let i = 0; i < 8; i++) state.layers.deliveryAge[at(6 + i, 11)] = dueTicks() + i * 10;
    const tour = planTour(state, state.vans[0], new Set());
    expect(tour).toHaveLength(BALANCE.deliveries.stopsPerTour + 1);
    expect(tour[tour.length - 1]).toBe(at(2, 10));
    const stops = tour.slice(0, -1);
    // The three youngest shops (x = 6, 7, 8) are left for the next tour.
    expect(stops).not.toContain(at(6, 10));
    expect(stops).not.toContain(at(7, 10));
    expect(stops).not.toContain(at(8, 10));
    // Nearest-neighbour from the depot: ascending x along the street.
    expect(stops).toEqual([...stops].sort((a, b) => a - b));
  });

  it('never picks a stop claimed by another van', () => {
    const state = shopTown(1, 2);
    syncFleet(state);
    state.layers.deliveryAge[at(6, 11)] = dueTicks();
    state.layers.deliveryAge[at(7, 11)] = dueTicks();
    state.vans[1].stops = [at(6, 10), at(2, 10)];
    const claimed = claimedStops(state);
    expect(claimed.has(at(6, 10))).toBe(true);
    expect(claimed.has(at(2, 10))).toBe(false);
    expect(planTour(state, state.vans[0], claimed)).toEqual([at(7, 10), at(2, 10)]);
  });

  it('ignores shops beyond maxRouteTiles', () => {
    const BIG = 80;
    const big = (x: number, y: number) => tileIndex(x, y, BIG);
    const state = createSimState(1, BIG);
    buildRoads(
      state,
      Array.from({ length: 75 }, (_, i) => big(i + 2, 10)),
    );
    placePlant(state, big(2, 9), PlantType.LogisticsDepot);
    const near = big(2 + BALANCE.deliveries.maxRouteTiles - 1, 11);
    const far = big(2 + BALANCE.deliveries.maxRouteTiles + 5, 11);
    for (const shop of [near, far]) {
      state.layers.zone[shop] = Zone.Retail;
      state.layers.density[shop] = 1;
      state.layers.deliveryAge[shop] = dueTicks();
    }
    syncFleet(state);
    const tour = planTour(state, state.vans[0], new Set());
    expect(tour).toEqual([big(2 + BALANCE.deliveries.maxRouteTiles - 1, 10), big(2, 10)]);
  });

  it('one stop serves every shop next to that road tile', () => {
    const state = shopTown(1, 1);
    state.layers.zone[at(6, 9)] = Zone.Retail; // second shop north of the same road tile
    state.layers.density[at(6, 9)] = 1;
    syncFleet(state);
    state.layers.deliveryAge[at(6, 11)] = dueTicks();
    state.layers.deliveryAge[at(6, 9)] = dueTicks();
    expect(planTour(state, state.vans[0], new Set())).toEqual([at(6, 10), at(2, 10)]);
  });
});
