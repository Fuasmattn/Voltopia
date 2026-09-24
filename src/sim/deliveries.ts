import { BALANCE, TICKS_PER_DAY } from '../shared/constants.ts';
import { neighbors4, tileX, tileY } from '../shared/grid.ts';
import { DeliveryState, PlantType, Zone } from '../shared/types.ts';
import { roadDistances } from './routing.ts';
import {
  deliveryStateOfAge,
  markDirty,
  TileType,
  VanPhase,
  type SimState,
  type Van,
} from './state.ts';

/** deliveryAge saturates here (Uint16). */
const MAX_AGE = 65535;

/** Ticks a shop stays supplied after a delivery. */
export function supplyWindowTicks(): number {
  return Math.round(BALANCE.deliveries.supplyWindowDays * TICKS_PER_DAY);
}

/** Ticks after which a shop counts as due for a delivery. */
export function dueTicks(): number {
  return Math.round(BALANCE.deliveries.dueAfterDays * TICKS_PER_DAY);
}

/** A retail building: zoned retail with a building on it. */
export function isShop(state: SimState, index: number): boolean {
  const { tileType, zone, density } = state.layers;
  return tileType[index] === TileType.Empty && zone[index] === Zone.Retail && density[index] > 0;
}

/** Delivery bucket of a tile; non-shops are always supplied. */
export function deliveryState(state: SimState, index: number): DeliveryState {
  if (!isShop(state, index)) return DeliveryState.Supplied;
  return deliveryStateOfAge(state.layers.deliveryAge[index]);
}

/** True while the shop had a delivery within the supply window. */
export function isShopSupplied(state: SimState, index: number): boolean {
  return state.layers.deliveryAge[index] <= supplyWindowTicks();
}

/** Tile indices of every logistics depot. */
export function depotTiles(state: SimState): number[] {
  const { tileType, plantType } = state.layers;
  const depots: number[] = [];
  for (let i = 0; i < tileType.length; i++) {
    if (tileType[i] === TileType.Plant && plantType[i] === PlantType.LogisticsDepot) depots.push(i);
  }
  return depots;
}

/** The lowest-index road tile next to a depot, or -1. */
export function depotRoadTile(state: SimState, depot: number): number {
  const { tileType } = state.layers;
  let road = -1;
  for (const n of neighbors4(depot, state.size)) {
    if (tileType[n] === TileType.Road && (road < 0 || n < road)) road = n;
  }
  return road;
}

function isDepot(state: SimState, tile: number): boolean {
  const { tileType, plantType } = state.layers;
  return (
    tile >= 0 && tileType[tile] === TileType.Plant && plantType[tile] === PlantType.LogisticsDepot
  );
}

function createVan(state: SimState, depot: number, depotRoad: number): Van {
  return {
    id: state.nextVehicleId++,
    depot,
    depotRoad,
    x: tileX(depotRoad, state.size) + 0.5,
    y: tileY(depotRoad, state.size) + 0.5,
    angle: 0,
    phase: VanPhase.AtDepot,
    stops: [],
    path: [],
    pathIndex: 0,
    charge: state.rng.nextRange(0.5, 0.9),
    charging: false,
    waitTicks: 0,
    dwellTicks: 0,
  };
}

/**
 * Keep every depot's fleet at vansPerDepot: drop vans whose depot or
 * parking road is gone (a van mid-tour just vanishes, like commuters
 * whose home was bulldozed), spawn the missing ones parked at the depot.
 */
export function syncFleet(state: SimState): void {
  const { tileType } = state.layers;
  state.vans = state.vans.filter(
    (van) => isDepot(state, van.depot) && tileType[van.depotRoad] === TileType.Road,
  );
  const perDepot = new Map<number, number>();
  for (const van of state.vans) perDepot.set(van.depot, (perDepot.get(van.depot) ?? 0) + 1);
  for (const depot of depotTiles(state)) {
    const road = depotRoadTile(state, depot);
    if (road < 0) continue;
    for (let n = perDepot.get(depot) ?? 0; n < BALANCE.deliveries.vansPerDepot; n++) {
      state.vans.push(createVan(state, depot, road));
    }
  }
}

/**
 * Advance every shop's delivery age by one tick (saturating); tiles that
 * are not shops sit at 0. A tile is marked dirty when it crosses into
 * "due" or "unsupplied" so the overlay follows.
 */
export function ageShops(state: SimState): void {
  const { layers } = state;
  const due = dueTicks();
  const window = supplyWindowTicks();
  for (let i = 0; i < layers.tileType.length; i++) {
    const age = layers.deliveryAge[i];
    if (!isShop(state, i)) {
      if (age !== 0) layers.deliveryAge[i] = 0;
      continue;
    }
    if (age >= MAX_AGE) continue;
    const next = age + 1;
    layers.deliveryAge[i] = next;
    if (next === due + 1 || next === window + 1) markDirty(state, i);
  }
}

/** Stops every van is already going to visit (never the depot roads). */
export function claimedStops(state: SimState): Set<number> {
  const claimed = new Set<number>();
  for (const van of state.vans) {
    for (const stop of van.stops) if (stop !== van.depotRoad) claimed.add(stop);
  }
  return claimed;
}

/** Oldest delivery age among the shops next to a road tile, -1 when none. */
function oldestShopAge(state: SimState, road: number): number {
  let age = -1;
  for (const n of neighbors4(road, state.size)) {
    if (isShop(state, n)) age = Math.max(age, state.layers.deliveryAge[n]);
  }
  return age;
}

/**
 * Plan a tour for a van waiting at its depot: up to stopsPerTour road
 * tiles with shops beside them, reachable within maxRouteTiles, oldest
 * first (ties: nearer, then lower index), ordered nearest-neighbour from
 * the depot and closed by the depot road. Only shops at least half-way
 * to due are considered so an idle fleet does not circle. Empty when
 * nothing qualifies.
 */
export function planTour(state: SimState, van: Van, claimed: Set<number>): number[] {
  const { stopsPerTour, maxRouteTiles } = BALANCE.deliveries;
  const distances = roadDistances(state, van.depotRoad, maxRouteTiles);
  const minAge = Math.floor(dueTicks() / 2);
  const candidates: Array<{ tile: number; age: number; distance: number }> = [];
  for (const [tile, distance] of distances) {
    if (tile === van.depotRoad || claimed.has(tile)) continue;
    const age = oldestShopAge(state, tile);
    if (age < minAge) continue;
    candidates.push({ tile, age, distance });
  }
  candidates.sort((a, b) => b.age - a.age || a.distance - b.distance || a.tile - b.tile);
  const remaining = new Set(candidates.slice(0, stopsPerTour).map((c) => c.tile));

  const ordered: number[] = [];
  let current = van.depotRoad;
  while (remaining.size > 0) {
    const from = roadDistances(state, current);
    let best = -1;
    let bestCost = Infinity;
    for (const tile of remaining) {
      const cost = from.get(tile) ?? Infinity;
      if (cost < bestCost || (cost === bestCost && tile < best)) {
        best = tile;
        bestCost = cost;
      }
    }
    if (best < 0) break; // the rest became unreachable: leave them for later
    ordered.push(best);
    remaining.delete(best);
    current = best;
  }
  if (ordered.length === 0) return [];
  ordered.push(van.depotRoad);
  return ordered;
}
