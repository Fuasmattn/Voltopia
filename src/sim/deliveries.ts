import { BALANCE, TICK_RATE, TICKS_PER_DAY } from '../shared/constants.ts';
import { neighbors4, tileX, tileY } from '../shared/grid.ts';
import { DeliveryState, PlantType, Zone } from '../shared/types.ts';
import type { DeliveryStats, DepotInfo } from '../shared/types.ts';
import { isTileConnected } from './energy.ts';
import { findRoadPath, roadDistances } from './routing.ts';
import { advanceAlongPath, surplusAvailable, vehicleTile } from './vehicles.ts';
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
    if (claimed.has(tile)) continue;
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

/** A depot can charge while it is energised and the grid met all demand last tick. */
function depotPowered(state: SimState, depot: number): boolean {
  return isTileConnected(state, depot) && state.lastEnergy.deficit === 0;
}

/** Plugged in? At the depot whenever the battery isn't full and the depot has power; smart charging defers to surplus unless low. */
function decideVanCharging(state: SimState, van: Van, surplus: boolean): boolean {
  if (van.charge >= 1 || !depotPowered(state, van.depot)) return false;
  if (!state.smartCharging) return true;
  return surplus || van.charge < BALANCE.vehicles.smartChargeFloor;
}

/**
 * Route the van to stops[0], skipping stops that became unreachable. A
 * van that cannot even reach its depot is marked lost and removed by the
 * next syncFleet.
 */
function routeToNextStop(state: SimState, van: Van): void {
  const from = vehicleTile(state, van);
  while (van.stops.length > 0) {
    const path = findRoadPath(state, from, van.stops[0]);
    if (path) {
      van.path = path;
      van.pathIndex = 0;
      van.phase = VanPhase.Driving;
      return;
    }
    van.stops.shift();
  }
  van.depot = -1;
  van.path = [];
  van.pathIndex = 0;
}

/** Mark every shop next to the van's road tile as delivered right now. */
function deliver(state: SimState, van: Van): void {
  const { layers } = state;
  for (const n of neighbors4(vehicleTile(state, van), state.size)) {
    if (!isShop(state, n)) continue;
    const before = deliveryStateOfAge(layers.deliveryAge[n]);
    layers.deliveryAge[n] = 0;
    if (before !== DeliveryState.Supplied) markDirty(state, n);
  }
}

function arrive(state: SimState, van: Van): void {
  if (van.stops.length <= 1) {
    // Last stop is always the depot road.
    van.stops = [];
    van.phase = VanPhase.AtDepot;
    van.dwellTicks = BALANCE.deliveries.turnaroundTicks;
    van.x = tileX(van.depotRoad, state.size) + 0.5;
    van.y = tileY(van.depotRoad, state.size) + 0.5;
    return;
  }
  van.phase = VanPhase.Unloading;
  van.dwellTicks = BALANCE.deliveries.unloadTicks;
}

/**
 * Delivery vans: keep the fleets in sync, age the shops, charge at the
 * depot, dispatch tours inside the delivery window, drive on the shared
 * lanes and unload at every stop. Runs after vehiclesStep with its lane
 * occupancy map so cars and vans queue behind each other.
 */
export function deliveriesStep(state: SimState, occupancy: Map<number, number>): void {
  syncFleet(state);
  ageShops(state);
  if (state.vans.length === 0) return;

  const d = BALANCE.deliveries;
  const step = (BALANCE.vehicles.speedTilesPerSecond / TICK_RATE) * d.speedFactor;
  const ticksIntoDay = state.tick % TICKS_PER_DAY;
  const windowStart = Math.floor((d.windowStartHour / 24) * TICKS_PER_DAY);
  const windowEnd = Math.floor((d.windowEndHour / 24) * TICKS_PER_DAY);
  const inWindow = ticksIntoDay >= windowStart && ticksIntoDay < windowEnd;
  const surplus = surplusAvailable(state);
  const claimed = claimedStops(state);

  for (const van of state.vans) {
    van.charging = false;
    switch (van.phase) {
      case VanPhase.AtDepot: {
        if (van.dwellTicks > 0) van.dwellTicks--;
        van.charging = decideVanCharging(state, van, surplus);
        if (van.charging) van.charge = Math.min(1, van.charge + d.chargeRatePerTick);
        if (van.dwellTicks === 0 && inWindow && van.charge >= d.minTripCharge) {
          const stops = planTour(state, van, claimed);
          if (stops.length > 0) {
            for (const stop of stops) if (stop !== van.depotRoad) claimed.add(stop);
            van.stops = stops;
            van.charging = false;
            routeToNextStop(state, van);
          }
        }
        break;
      }
      case VanPhase.Driving: {
        const result = advanceAlongPath(state, van, step, occupancy);
        if (result === 'arrived') arrive(state, van);
        else if (result === 'lost') {
          van.stops.shift();
          routeToNextStop(state, van);
        }
        break;
      }
      case VanPhase.Unloading: {
        van.dwellTicks--;
        if (van.dwellTicks <= 0) {
          deliver(state, van);
          van.stops.shift();
          routeToNextStop(state, van);
        }
        break;
      }
    }
  }
}

/** Vans on the road (parked ones are not rendered). */
export function drivingVans(state: SimState): Van[] {
  return state.vans.filter((v) => v.phase !== VanPhase.AtDepot);
}

export function drivingVanCount(state: SimState): number {
  let count = 0;
  for (const v of state.vans) if (v.phase !== VanPhase.AtDepot) count++;
  return count;
}

/** City-wide delivery figures for stats and the goal. */
export function deliveryStats(state: SimState): DeliveryStats {
  const { tileType, deliveryAge } = state.layers;
  const window = supplyWindowTicks();
  let shops = 0;
  let supplied = 0;
  for (let i = 0; i < tileType.length; i++) {
    if (!isShop(state, i)) continue;
    shops++;
    if (deliveryAge[i] <= window) supplied++;
  }
  return {
    suppliedShare: shops > 0 ? supplied / shops : 1,
    shops,
    driving: drivingVanCount(state),
    depots: depotTiles(state).length,
  };
}

/** Fleet and reach of one depot for the inspector. */
export function depotInfo(state: SimState, depot: number): DepotInfo {
  let vansTotal = 0;
  let vansDriving = 0;
  let vansCharging = 0;
  for (const van of state.vans) {
    if (van.depot !== depot) continue;
    vansTotal++;
    if (van.phase !== VanPhase.AtDepot) vansDriving++;
    if (van.charging) vansCharging++;
  }
  const road = depotRoadTile(state, depot);
  const reached = new Set<number>();
  if (road >= 0) {
    for (const tile of roadDistances(state, road, BALANCE.deliveries.maxRouteTiles).keys()) {
      for (const n of neighbors4(tile, state.size)) if (isShop(state, n)) reached.add(n);
    }
  }
  return { vansTotal, vansDriving, vansCharging, shopsInReach: reached.size };
}
