# Delivery Traffic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A logistics depot whose electric vans tour the shops on real roads; retail that goes without a delivery for 1.5 days stops densifying; a deliveries overlay, inspector section, HUD chip, goal and WebMCP parity make it legible.

**Architecture:** `findRoadPath` moves into a new `src/sim/routing.ts` next to a bounded multi-target `roadDistances`. `vehicles.ts` exposes its movement core (`Mover`, `advanceAlongPath`, `laneOccupancy`) and returns the lane occupancy map instead of folding it into the traffic load itself; `tick.ts` threads that map through the new `src/sim/deliveries.ts` (fleet sync, shop ageing, tour planning, van movement, charging) and then into `updateTrafficLoad`. Supply is a derived `deliveryAge` layer gating retail densification. A depot plant, a `Van` list on the state, stats, a goal, a diff field and overlay mode 5, a van mesh, UI strings and WebMCP tool updates surface it. Save format: one optional counter.

**Tech Stack:** TypeScript strict, Vitest, three.js, React 19, Playwright. Spec: `docs/superpowers/specs/2026-09-24-deliveries-design.md`.

## Global Constraints

- `src/sim/` stays pure: no DOM or three.js imports. Randomness only through `state.rng` (van start charge); everything else deterministic with ties broken by tile index.
- Every tuning value lives in `BALANCE`; no magic numbers in sim code. Spec values: `costs.plant[LogisticsDepot]` 1000, `upkeepPerTick.plant[LogisticsDepot]` 0.03, `deliveries.vansPerDepot` 3, `stopsPerTour` 5, `maxRouteTiles` 60, `windowStartHour` 7, `windowEndHour` 19, `turnaroundTicks` 20, `unloadTicks` 8, `speedFactor` 0.8, `minTripCharge` 0.3, `chargingEnergyPerVan` 3, `chargeRatePerTick` 0.0012, `supplyWindowDays` 1.5, `dueAfterDays` 1, `goalSuppliedShare` 0.95, `goalMinShops` 20.
- `SAVE_VERSION` unchanged: `wellStockedTicks` is optional; `deliveryAge` and `vans` are derived and never serialised (a load starts every shop at age 0 and respawns the fleets).
- `PlantType.LogisticsDepot = 11`. Adding a `PlantType` member breaks every `Record<PlantType, …>` literal: `src/ui/TileInspector.tsx` (`PLANT_LABEL`), `src/ui/BudgetPanel.tsx` (`PLANT_LABEL`); the `as Record<PlantType, number>` casts in `constants.ts` need the new key too. `emptyPlantMap()` iterates `PlantType` values and needs nothing.
- All user-visible strings go through `src/ui/i18n.tsx`, English AND German, each key exactly once per block. Goal keys are looked up as `` `goal.${id}.title` `` / `.body`, so a new goal id needs both keys in both languages or the UI throws.
- Slope surcharge: `placePlant` already multiplies plant prices by `slopeCostMultiplier`; nothing to do for the depot.
- Coverage ≥ 90 % on `src/sim` and `src/shared` (`pnpm coverage`).
- New `InstancedMesh` needs `frustumCulled = false` (the van mesh in Task 6 is new).
- `TileDiff` gains a required field (`deliveryState`); the literal in `src/agent/tileMirror.test.ts` must gain it or typecheck fails.
- Run `pnpm format` after edits; the pre-commit hook runs `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test`. Never `--no-verify`.
- Commit messages: imperative summary + short body, one task per commit, ending with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- The Linux sandbox has no WebGL: e2e and `node scripts/smoke.mjs` run on the Mac or in CI.
- Hotkey letters already taken: digits, `b p h u l f c v` plus `q e w a s d` (rotate/pan). The depot uses `g`.

## File map

| File                                                                                                                                            | Change                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/sim/routing.ts` (new)                                                                                                                      | `tileCost`, `findRoadPath` (moved), `roadDistances`                                                                                                                                                                                                  |
| `src/sim/vehicles.ts`                                                                                                                           | import path from routing; `Mover`, `vehicleTile`, `vehicleLane`, `advanceAlongPath`, `laneOccupancy`, `surplusAvailable` exported; `vehiclesStep` returns the occupancy map; `chargingDemand` counts vans                                            |
| `src/sim/tick.ts`                                                                                                                               | `vehiclesStep → deliveriesStep → updateTrafficLoad`; `lastDeliveries`; `stats.deliveries`; `counts.depots`                                                                                                                                           |
| `src/sim/deliveries.ts` (new)                                                                                                                   | `isShop`, `deliveryState`, `isShopSupplied`, `depotTiles`, `planTour`, `deliveriesStep`, `deliveryStats`, `depotInfo`, `drivingVans`                                                                                                                 |
| `src/shared/types.ts`                                                                                                                           | `PlantType.LogisticsDepot`, `DeliveryState`, `VehicleKind`, `VehicleState.kind`, `TileDiff.deliveryState`, `OverlayMode.Deliveries`, `GlobalStats.deliveries`, `TileCounts.depots`, `TileInfo` fields, `SaveGame.wellStockedTicks?`, `GrowthBlocker` |
| `src/shared/constants.ts`                                                                                                                       | depot cost/upkeep, `deliveries` block                                                                                                                                                                                                                |
| `src/sim/state.ts`                                                                                                                              | `VanPhase`, `Van`, `vans`, `deliveryAge` layer, `lastDeliveries`, `goalProgress.wellStockedTicks`, `deliveryStateOfAge`, diff field, depot road rule, save round-trip                                                                                |
| `src/sim/energy.ts`                                                                                                                             | census counts depots                                                                                                                                                                                                                                 |
| `src/sim/growth.ts`, `src/sim/inspect.ts`, `src/sim/goals.ts`, `src/sim/engine.ts`                                                              | retail gate, inspector fields + blocker, `wellStocked`, vans in `collectVehicles`                                                                                                                                                                    |
| `src/storage/serialization.ts`                                                                                                                  | `wellStockedTicks`                                                                                                                                                                                                                                   |
| `src/render/vehiclesMesh.ts`, `plantsMesh.ts`, `minimapLayer.ts`, `overlays.ts`                                                                 | van mesh, depot parts, minimap colour, deliveries overlay                                                                                                                                                                                            |
| `src/ui/useTools.ts`, `BuildBar.tsx`, `OverlayToggle.tsx`, `CityVitals.tsx`, `TileInspector.tsx`, `BudgetPanel.tsx`, `HelpPage.tsx`, `i18n.tsx` | depot tool, overlay button, chip, inspector sections, labels, help, strings                                                                                                                                                                          |
| `src/agent/tools.ts`, `docs/agent-tools.md`                                                                                                     | `logistics_depot`, `deliveries` in the overview, inspector fields                                                                                                                                                                                    |
| `e2e/game.spec.ts`, `README.md`, `docs/idea.md`                                                                                                 | assertions, docs                                                                                                                                                                                                                                     |

---

### Task 1: Routing module, movement core, occupancy hand-off

**Files:**

- Create: `src/sim/routing.ts`, `src/sim/routing.test.ts`
- Modify: `src/sim/vehicles.ts` (lines 1–64 routing, 100–132 helpers, 141–279 `vehiclesStep`, 318–385 `driveAlongPath`)
- Modify: `src/sim/tick.ts` (line 13 import, line 45 call)
- Modify: `src/sim/vehicles.test.ts` (imports, every `vehiclesStep(` call)
- Modify: `src/sim/inspect.ts` only if it imports `findRoadPath` (it does not today)

**Interfaces:**

- Produces (`routing.ts`): `findRoadPath(state, from, to): number[] | null` (unchanged behaviour), `roadDistances(state, from, maxCost?): Map<number, number>`.
- Produces (`vehicles.ts`): `interface Mover { x; y; angle; path: number[]; pathIndex; charge; waitTicks }`, `vehicleTile(state, mover)`, `vehicleLane(state, mover)`, `advanceAlongPath(state, mover, step, occupancy): MoveResult` with `type MoveResult = 'moving' | 'waiting' | 'arrived' | 'lost'`, `laneOccupancy(state)`, `surplusAvailable(state)`, `vehiclesStep(state): Map<number, number>`.
- `tick.ts` now owns the `updateTrafficLoad` call.

- [x] **Step 1: Write the failing routing test**

Create `src/sim/routing.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { tileIndex } from '../shared/grid.ts';
import { findRoadPath, roadDistances } from './routing.ts';
import { buildRoads } from './roads.ts';
import { createSimState } from './state.ts';

const SIZE = 24;
const at = (x: number, y: number) => tileIndex(x, y, SIZE);

/** One straight street from (2,10) to (20,10) plus a stub going south at x=10. */
function town() {
  const state = createSimState(1, SIZE);
  buildRoads(
    state,
    Array.from({ length: 19 }, (_, i) => at(i + 2, 10)),
  );
  buildRoads(state, [at(10, 11), at(10, 12), at(10, 13)]);
  return state;
}

describe('roadDistances', () => {
  it('matches path lengths on an unloaded street map', () => {
    const state = town();
    const distances = roadDistances(state, at(2, 10));
    expect(distances.get(at(2, 10))).toBe(0);
    expect(distances.get(at(20, 10))).toBe(18);
    expect(distances.get(at(10, 13))).toBe(findRoadPath(state, at(2, 10), at(10, 13))!.length - 1);
  });

  it('omits tiles beyond maxCost and non-road tiles', () => {
    const state = town();
    const distances = roadDistances(state, at(2, 10), 5);
    expect(distances.has(at(7, 10))).toBe(true);
    expect(distances.has(at(8, 10))).toBe(false);
    expect(distances.has(at(2, 9))).toBe(false);
  });

  it('is empty from a non-road tile', () => {
    const state = town();
    expect(roadDistances(state, at(0, 0)).size).toBe(0);
  });

  it('is deterministic', () => {
    const a = [...roadDistances(town(), at(2, 10)).entries()];
    const b = [...roadDistances(town(), at(2, 10)).entries()];
    expect(a).toEqual(b);
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/sim/routing.test.ts`
Expected: FAIL — cannot resolve `./routing.ts`.

- [x] **Step 3: Create `src/sim/routing.ts`**

Move `tileCost` and `findRoadPath` out of `vehicles.ts` verbatim and add `roadDistances`:

```ts
import { BALANCE } from '../shared/constants.ts';
import { neighbors4 } from '../shared/grid.ts';
import { MinHeap } from '../shared/heap.ts';
import { RoadClass } from '../shared/types.ts';
import { TileType, type SimState } from './state.ts';

/** Cost of driving onto a road tile: avenues are cheaper, loaded tiles dearer. */
export function tileCost(state: SimState, tile: number): number {
  const { roadClass, trafficLoad } = state.layers;
  const base = roadClass[tile] === RoadClass.Avenue ? 1 / BALANCE.vehicles.avenueSpeedFactor : 1;
  return base * (1 + BALANCE.vehicles.routeLoadPenalty * (trafficLoad[tile] / 255));
}

/**
 * Cheapest route over road tiles from `from` to `to` (both included), or
 * null when they are not connected. Dijkstra with per-tile costs from
 * road class and traffic load; ties break by tile index, so the result
 * is deterministic.
 */
export function findRoadPath(state: SimState, from: number, to: number): number[] | null {
  // … body exactly as it was in vehicles.ts lines 27–64 …
}

/**
 * Route cost from one road tile to every road tile reachable within
 * `maxCost` (same tile costs as findRoadPath, so on empty streets the
 * cost is the tile count). Empty when `from` is not a road.
 */
export function roadDistances(
  state: SimState,
  from: number,
  maxCost: number = Infinity,
): Map<number, number> {
  const { tileType } = state.layers;
  const result = new Map<number, number>();
  if (tileType[from] !== TileType.Road) return result;
  const tiles = state.size * state.size;
  const distance = new Float64Array(tiles).fill(Infinity);
  const settled = new Uint8Array(tiles);
  const heap = new MinHeap();
  distance[from] = 0;
  heap.push(0, from);
  while (heap.size > 0) {
    const tile = heap.pop()!;
    if (settled[tile]) continue;
    settled[tile] = 1;
    result.set(tile, distance[tile]);
    for (const neighbor of neighbors4(tile, state.size)) {
      if (tileType[neighbor] !== TileType.Road || settled[neighbor]) continue;
      const next = distance[tile] + tileCost(state, neighbor);
      if (next > maxCost || next >= distance[neighbor]) continue;
      distance[neighbor] = next;
      heap.push(next, neighbor);
    }
  }
  return result;
}
```

In `vehicles.ts` delete `tileCost`, `findRoadPath` and the now-unused `MinHeap` / `RoadClass`-for-routing imports (keep `RoadClass`, it is still used in `driveAlongPath` / `startTripClock`), and add `import { findRoadPath } from './routing.ts';`.

- [x] **Step 4: Expose the movement core in `vehicles.ts`**

Replace the private helpers `parkAt`, `vehicleTile`, `vehicleLane` and the function `driveAlongPath` with this (keep `headingOf` as is):

```ts
/** Anything that drives along a road path: commuter cars and delivery vans. */
export interface Mover {
  x: number;
  y: number;
  angle: number;
  /** Road tiles of the current trip (empty while parked). */
  path: number[];
  pathIndex: number;
  /** Battery state of charge, 0..1. Drains while driving. */
  charge: number;
  /** Consecutive ticks spent waiting behind a full lane (gridlock breaker). */
  waitTicks: number;
}

export type MoveResult = 'moving' | 'waiting' | 'arrived' | 'lost';

function parkAt(state: SimState, mover: Mover, tile: number): void {
  mover.x = tileX(tile, state.size) + 0.5;
  mover.y = tileY(tile, state.size) + 0.5;
  mover.path = [];
  mover.pathIndex = 0;
}

/** The road tile under a mover. */
export function vehicleTile(state: SimState, mover: Mover): number {
  return tileIndex(Math.floor(mover.x), Math.floor(mover.y), state.size);
}

/**
 * The lane a driving mover currently occupies: its tile plus the
 * heading toward its next path tile (or the one after, while it is still
 * approaching the centre of its own tile).
 */
export function vehicleLane(state: SimState, mover: Mover): number {
  const tile = vehicleTile(state, mover);
  let target = mover.path[mover.pathIndex];
  if (target === tile) target = mover.path[mover.pathIndex + 1];
  const heading = target === undefined ? 0 : headingOf(tile, target, state.size);
  return laneKey(tile, heading);
}

/**
 * Move one tick along the path at `step` tiles per tick (avenue tiles
 * are faster). Enforces lane capacity with the gridlock breaker, keeps
 * the occupancy map current, drains the battery. 'lost' when the next
 * path tile is no longer a road; 'arrived' after the last tile, with the
 * path cleared and the lane released.
 */
export function advanceAlongPath(
  state: SimState,
  mover: Mover,
  step: number,
  occupancy: Map<number, number>,
): MoveResult {
  const target = mover.path[mover.pathIndex];
  if (target === undefined || state.layers.tileType[target] !== TileType.Road) return 'lost';

  const targetX = tileX(target, state.size) + 0.5;
  const targetY = tileY(target, state.size) + 0.5;
  const dx = targetX - mover.x;
  const dy = targetY - mover.y;
  const distance = Math.hypot(dx, dy);

  // Congestion: entering a lane that is full means waiting — unless the
  // wait has gone on so long that this is a gridlock, in which case the
  // mover squeezes past so traffic never freezes for good.
  const currentTile = vehicleTile(state, mover);
  const stride =
    state.layers.roadClass[currentTile] === RoadClass.Avenue
      ? step * BALANCE.vehicles.avenueSpeedFactor
      : step;
  const move = Math.min(stride, distance);
  const nextX = distance <= stride ? targetX : mover.x + (dx / distance) * move;
  const nextY = distance <= stride ? targetY : mover.y + (dy / distance) * move;
  const nextTile = tileIndex(Math.floor(nextX), Math.floor(nextY), state.size);
  if (nextTile !== currentTile) {
    const heading = headingOf(currentTile, nextTile, state.size);
    const nextLane = laneKey(nextTile, heading);
    const full = (occupancy.get(nextLane) ?? 0) >= laneCapacity(state, nextTile);
    if (full && mover.waitTicks < BALANCE.vehicles.maxWaitTicks) {
      mover.waitTicks++;
      return 'waiting';
    }
    const currentLane = vehicleLane(state, mover);
    occupancy.set(currentLane, Math.max(0, (occupancy.get(currentLane) ?? 1) - 1));
    occupancy.set(nextLane, (occupancy.get(nextLane) ?? 0) + 1);
  }
  mover.waitTicks = 0;

  mover.x = nextX;
  mover.y = nextY;
  if (move > 1e-9) {
    mover.angle = Math.atan2(dy, dx);
    mover.charge = Math.max(0, mover.charge - move * BALANCE.vehicles.batteryDrainPerTile);
  }

  if (distance <= stride) {
    mover.pathIndex++;
    if (mover.pathIndex >= mover.path.length) {
      const lane = vehicleLane(state, mover);
      occupancy.set(lane, Math.max(0, (occupancy.get(lane) ?? 1) - 1));
      mover.path = [];
      mover.pathIndex = 0;
      return 'arrived';
    }
  }
  return 'moving';
}

/** Commuter wrapper: park again when the route is gone, record the trip on arrival. */
function driveAlongPath(
  state: SimState,
  vehicle: Vehicle,
  step: number,
  occupancy: Map<number, number>,
): void {
  const result = advanceAlongPath(state, vehicle, step, occupancy);
  if (result === 'lost') {
    // A bulldozed tile on the route: abort the trip and re-plan next tick.
    const parked = vehicle.phase === VehiclePhase.ToWork ? vehicle.homeRoad : vehicle.workRoad;
    vehicle.phase =
      vehicle.phase === VehiclePhase.ToWork ? VehiclePhase.ParkedHome : VehiclePhase.ParkedWork;
    parkAt(state, vehicle, parked);
    return;
  }
  if (result === 'arrived') {
    vehicle.phase =
      vehicle.phase === VehiclePhase.ToWork ? VehiclePhase.ParkedWork : VehiclePhase.ParkedHome;
    recordCommute(state, vehicle);
  }
}
```

Note the original cleared `path` after `recordCommute`; `recordCommute` reads only `tripTicks`/`tripFreeFlowTicks`, so the order change is safe.

- [x] **Step 5: Extract `laneOccupancy` and `surplusAvailable`, return the map**

In `vehiclesStep`:

- Change the signature to `export function vehiclesStep(state: SimState): Map<number, number>`.
- Replace the early return block with:

```ts
if (homeRoads.length === 0) {
  state.vehicles.length = 0;
  return laneOccupancy(state);
}
```

- Replace the inline occupancy block (the `const occupancy = new Map…` loop) with `const occupancy = laneOccupancy(state);`.
- Replace the inline `const surplusAvailable = …` expression with `const surplus = surplusAvailable(state);` and pass `surplus` to `decideCharging`.
- Replace the final `updateTrafficLoad(state, occupancy);` with `return occupancy;` and drop `updateTrafficLoad` from the `./traffic.ts` import (keep `laneCapacity`, `laneKey`).

Add these exported helpers above `vehiclesStep`:

```ts
/**
 * How many driving movers occupy each lane (road tile and heading) at
 * the start of the tick. Oncoming traffic uses the other lane, so it
 * never blocks; only movers going the same way queue up.
 */
export function laneOccupancy(state: SimState): Map<number, number> {
  const occupancy = new Map<number, number>();
  for (const vehicle of state.vehicles) {
    if (vehicle.phase === VehiclePhase.ToWork || vehicle.phase === VehiclePhase.ToHome) {
      const lane = vehicleLane(state, vehicle);
      occupancy.set(lane, (occupancy.get(lane) ?? 0) + 1);
    }
  }
  return occupancy;
}

/**
 * Smart charging gate: was there renewable surplus last tick? Compared
 * against buildings plus heating and cooling load (not charging itself,
 * or the gate would feed back on its own dispatch decision).
 */
export function surplusAvailable(state: SimState): boolean {
  const e = state.lastEnergy;
  return (
    e.solar + e.wind + e.rooftop + e.hydro >
    e.buildingConsumption + e.heatingConsumption + e.coolingConsumption
  );
}
```

- [x] **Step 6: Wire `tick.ts`**

```ts
import { updateTrafficLoad } from './traffic.ts';
// …
updateWeather(state);
updateTrafficLoad(state, vehiclesStep(state));
energyStep(state, { chargingDemand: chargingDemand(state) });
```

- [x] **Step 7: Update `vehicles.test.ts`**

Change the import line to:

```ts
import { findRoadPath } from './routing.ts';
import { updateTrafficLoad } from './traffic.ts';
import { chargingDemand, drivingVehicles, vehiclesStep } from './vehicles.ts';
```

Add after `runHours`:

```ts
/** One tick of commuting plus the traffic-load fold that tick.ts performs. */
function stepVehicles(state: SimState): void {
  updateTrafficLoad(state, vehiclesStep(state));
}
```

Then replace every call (not the import): `sed -i 's/\bvehiclesStep(\([A-Za-z]*\))/stepVehicles(\1)/g' src/sim/vehicles.test.ts`. Check with `grep -n 'vehiclesStep' src/sim/vehicles.test.ts` that only the import and the helper remain.

- [x] **Step 8: Run tests, typecheck, format**

Run: `pnpm typecheck && pnpm vitest run src/sim && pnpm format`
Expected: all green, including the moved `findRoadPath` tests and the "stale traffic load still decays" test.

- [x] **Step 9: Commit**

```bash
git add src/sim/routing.ts src/sim/routing.test.ts src/sim/vehicles.ts src/sim/vehicles.test.ts src/sim/tick.ts
git commit -m "refactor(sim): routing module and a shared movement core for road users

findRoadPath moves to routing.ts next to a bounded multi-target
roadDistances. vehicles.ts exposes Mover, advanceAlongPath and the lane
occupancy map so delivery vans can share lanes with commuters; the
traffic-load fold moves to tick.ts.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Depot plant, balance, van state, layer, persistence, tool

**Files:**

- Modify: `src/shared/types.ts` (`PlantType` line 38, `OverlayMode`-adjacent area for `DeliveryState`, `SaveGame` ~line 406)
- Modify: `src/shared/constants.ts` (`costs.plant` ~line 42, `upkeepPerTick.plant` ~line 60, new `deliveries` block before `traffic`)
- Modify: `src/sim/state.ts` (`VehiclePhase` area, `TileLayers`, `SimState`, `createTileLayers`, `createSimState`, `buildRejection`, `serializeState`, `deserializeState`)
- Modify: `src/sim/energy.ts` (`PlantCensus`, `censusPlants`)
- Modify: `src/storage/serialization.ts` (three `freeFlowTicks` spots)
- Modify: `src/ui/useTools.ts`, `src/ui/BuildBar.tsx`, `src/ui/TileInspector.tsx` (`PLANT_LABEL`), `src/ui/BudgetPanel.tsx` (`PLANT_LABEL`), `src/ui/i18n.tsx`
- Modify: `src/render/plantsMesh.ts` (`COLORS`, `plantBoxParts`), `src/render/minimapLayer.ts`
- Test: `src/sim/state.test.ts`, `src/storage/serialization.test.ts`

**Interfaces:**

- Produces: `PlantType.LogisticsDepot = 11`; `DeliveryState = { Supplied: 0, Due: 1, Unsupplied: 2 }` (shared); `VanPhase = { AtDepot: 0, Driving: 1, Unloading: 2 }`; `interface Van` (below); `state.vans: Van[]`; `layers.deliveryAge: Uint16Array`; `state.goalProgress.wellStockedTicks`; `deliveryStateOfAge(age): DeliveryState` (state.ts); `SaveGame.wellStockedTicks?`; `BALANCE.deliveries`; tool id `plant-depot`.

- [x] **Step 1: Write the failing state tests**

Append to `src/sim/state.test.ts` (inside the existing `buildRejection` describe and the save describe respectively; reuse the file's `SIZE`/`at` helpers, `createSimState`, `buildRoads`):

```ts
it('a logistics depot needs a road next to it, like the stations', () => {
  const state = createSimState(1, SIZE);
  expect(buildRejection(state, at(5, 5), BuildIntent.Plant, PlantType.LogisticsDepot)).toBe(
    'needsRoad',
  );
  buildRoads(state, [at(5, 6)]);
  expect(buildRejection(state, at(5, 5), BuildIntent.Plant, PlantType.LogisticsDepot)).toBeNull();
});
```

```ts
it('persists the well-stocked streak and starts fresh shops at delivery age 0', () => {
  const state = createSimState(1, SIZE);
  state.goalProgress.wellStockedTicks = 77;
  state.layers.deliveryAge[at(1, 1)] = 500;
  const restored = deserializeState(serializeState(state));
  expect(restored.goalProgress.wellStockedTicks).toBe(77);
  expect(restored.layers.deliveryAge[at(1, 1)]).toBe(0);
  expect(restored.vans).toEqual([]);
});

it('deliveryStateOfAge buckets by the due and supply windows', () => {
  const day = TICKS_PER_DAY;
  expect(deliveryStateOfAge(0)).toBe(DeliveryState.Supplied);
  expect(deliveryStateOfAge(BALANCE.deliveries.dueAfterDays * day)).toBe(DeliveryState.Supplied);
  expect(deliveryStateOfAge(BALANCE.deliveries.dueAfterDays * day + 1)).toBe(DeliveryState.Due);
  expect(deliveryStateOfAge(BALANCE.deliveries.supplyWindowDays * day + 1)).toBe(
    DeliveryState.Unsupplied,
  );
});
```

Append to `src/storage/serialization.test.ts` next to the `freeFlowTicks` case (line ~156):

```ts
it('round-trips wellStockedTicks and leaves it undefined when absent', () => {
  const save = makeSave();
  save.wellStockedTicks = 321;
  expect(saveFromJson(saveToJson(save)).wellStockedTicks).toBe(321);
  expect(saveFromJson(saveToJson(makeSave())).wellStockedTicks).toBeUndefined();
});
```

- [x] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run src/sim/state.test.ts src/storage/serialization.test.ts`
Expected: FAIL — `LogisticsDepot`, `deliveryStateOfAge`, `DeliveryState`, `wellStockedTicks` missing.

- [x] **Step 3: Shared types and balance**

`src/shared/types.ts`:

```ts
export const PlantType = {
  // … existing …
  PoliceStation: 10,
  LogisticsDepot: 11,
} as const;

/** Delivery status of a retail building (TileDiff.deliveryState, overlay). */
export const DeliveryState = { Supplied: 0, Due: 1, Unsupplied: 2 } as const;
export type DeliveryState = (typeof DeliveryState)[keyof typeof DeliveryState];
```

`SaveGame` after `freeFlowTicks?`:

```ts
  /** Consecutive well-stocked ticks so far (absent in older saves → 0). */
  wellStockedTicks?: number;
```

`src/shared/constants.ts`: add `[PlantType.LogisticsDepot]: 1_000,` to `costs.plant` and `[PlantType.LogisticsDepot]: 0.03,` to `upkeepPerTick.plant`; add before the `traffic:` block:

```ts
  deliveries: {
    /** Vans stationed at one depot. */
    vansPerDepot: 3,
    /** Shops one tour visits at most. */
    stopsPerTour: 5,
    /** Route cost from the depot a stop must be within (tiles on empty streets). */
    maxRouteTiles: 60,
    /** Hours of the in-game day in which tours may start. */
    windowStartHour: 7,
    windowEndHour: 19,
    /** Ticks a van spends at the depot between tours. */
    turnaroundTicks: 20,
    /** Ticks a van unloads at a stop. */
    unloadTicks: 8,
    /** Vans drive this fraction of the car speed (streets and avenues alike). */
    speedFactor: 0.8,
    /** A van needs at least this state of charge to start a tour. */
    minTripCharge: 0.3,
    /** Energy drawn per tick by one charging van. */
    chargingEnergyPerVan: 3,
    /** State of charge gained per tick while charging (0..1). */
    chargeRatePerTick: 0.0012,
    /** A shop counts as supplied for this long after a delivery. */
    supplyWindowDays: 1.5,
    /** The overlay and inspector call a shop "due" after this long. */
    dueAfterDays: 1,
    /** Share of shops that must be supplied for the well-stocked goal. */
    goalSuppliedShare: 0.95,
    /** Retail buildings the well-stocked goal requires. */
    goalMinShops: 20,
  },
```

- [x] **Step 4: State**

`src/sim/state.ts` — after `Vehicle`:

```ts
/** Tour phases of a delivery van. */
export const VanPhase = { AtDepot: 0, Driving: 1, Unloading: 2 } as const;
export type VanPhase = (typeof VanPhase)[keyof typeof VanPhase];

/** One delivery van. Satisfies vehicles.ts' Mover. Not persisted. */
export interface Van {
  /** Stable id (shares nextVehicleId with cars). */
  id: number;
  /** Depot plant tile; -1 once the van is lost and awaits removal. */
  depot: number;
  /** Road tile next to the depot the van parks on. */
  depotRoad: number;
  x: number;
  y: number;
  angle: number;
  phase: VanPhase;
  /** Remaining stops of the tour (road tiles); the last one is depotRoad. */
  stops: number[];
  /** Road tiles from the current position to stops[0]. */
  path: number[];
  pathIndex: number;
  /** Battery state of charge, 0..1. */
  charge: number;
  /** True while plugged in at the depot this tick. */
  charging: boolean;
  /** Consecutive ticks spent waiting behind a full lane (gridlock breaker). */
  waitTicks: number;
  /** Remaining unload / turnaround ticks. */
  dwellTicks: number;
}
```

`TileLayers`: add `/** Ticks since the last delivery per retail building, saturating. Derived, not persisted. */ deliveryAge: Uint16Array;` and `deliveryAge: new Uint16Array(tiles),` in `createTileLayers`.

`SimState`: add `vans: Van[];` after `vehicles`, `wellStockedTicks: number;` in `goalProgress`; in `createSimState` add `vans: [],` and `wellStockedTicks: 0,`.

Add after `slopeCostMultiplier`:

```ts
/** Delivery bucket of a shop given its ticks since the last delivery. */
export function deliveryStateOfAge(age: number): DeliveryState {
  const { supplyWindowDays, dueAfterDays } = BALANCE.deliveries;
  if (age > supplyWindowDays * TICKS_PER_DAY) return DeliveryState.Unsupplied;
  if (age > dueAfterDays * TICKS_PER_DAY) return DeliveryState.Due;
  return DeliveryState.Supplied;
}
```

(import `DeliveryState` from `../shared/types.ts` as a value.)

`buildRejection`: extend the station road rule to the depot:

```ts
if (
  intent === BuildIntent.Plant &&
  (plant === PlantType.FireStation ||
    plant === PlantType.PoliceStation ||
    plant === PlantType.LogisticsDepot) &&
  !neighbors4(index, state.size).some((n) => layers.tileType[n] === TileType.Road)
) {
  return 'needsRoad';
}
```

`serializeState`: `wellStockedTicks: state.goalProgress.wellStockedTicks,` after `freeFlowTicks`. `deserializeState`: `state.goalProgress.wellStockedTicks = save.wellStockedTicks ?? 0;`.

`src/storage/serialization.ts`: add `wellStockedTicks?: number;` to the JSON interface and the two spread lines mirroring `freeFlowTicks` (`save.wellStockedTicks !== undefined` / `typeof parsed.wellStockedTicks === 'number'`).

`src/sim/energy.ts`: add `logisticsDepots: number;` to `PlantCensus`, initialise `logisticsDepots: 0`, and `case PlantType.LogisticsDepot: census.logisticsDepots++; break;`.

- [x] **Step 5: Tool, labels, strings, meshes**

`src/ui/useTools.ts`: add `| 'plant-depot'` to `ToolId`, `g: 'plant-depot',` to `TOOL_HOTKEYS`, `'plant-depot': PlantType.LogisticsDepot,` to `PLANT_BY_TOOL`.

`src/ui/BuildBar.tsx` services category, after the police button:

```ts
      { id: 'plant-depot', icon: '🚚', cost: BALANCE.costs.plant[PlantType.LogisticsDepot] },
```

`src/ui/TileInspector.tsx` and `src/ui/BudgetPanel.tsx` `PLANT_LABEL`: `[PlantType.LogisticsDepot]: 'tool.plant-depot',`.

`src/ui/i18n.tsx` — English, after `'tool.plant-police'`: `'tool.plant-depot': 'Logistics depot',`; after `'tool.plant-police.desc'`:

```ts
  'tool.plant-depot.desc':
    'Sends electric vans to the shops. Shops without deliveries stop growing. Needs a road and power to charge.',
```

German: `'tool.plant-depot': 'Logistikdepot',` and

```ts
  'tool.plant-depot.desc':
    'Schickt E-Lieferwagen zu den Läden. Läden ohne Lieferung wachsen nicht weiter. Braucht Straße und Strom zum Laden.',
```

`src/render/plantsMesh.ts` `COLORS`: add `depotHall: 0x8d99a6, depotRoof: 0xe4e7ea, depotDoor: 0x3a4048, depotRamp: 0x6f7a86,`. In `plantBoxParts` before `default:`:

```ts
    case PlantType.LogisticsDepot:
      return [
        // Flat warehouse with a pale roof, a dark roller door and a loading ramp.
        { sx: 0.84, sy: 0.3, sz: 0.62, ox: 0, oy: 0, oz: 0.06, color: COLORS.depotHall },
        { sx: 0.88, sy: 0.04, sz: 0.66, ox: 0, oy: 0.3, oz: 0.06, color: COLORS.depotRoof },
        { sx: 0.3, sy: 0.22, sz: 0.03, ox: -0.15, oy: 0, oz: -0.26, color: COLORS.depotDoor },
        { sx: 0.5, sy: 0.06, sz: 0.2, ox: 0, oy: 0, oz: -0.36, color: COLORS.depotRamp },
      ];
```

`src/render/minimapLayer.ts` plant colours: `[PlantType.LogisticsDepot]: '#8d99a6',`.

- [x] **Step 6: Run tests, typecheck, format**

Run: `pnpm typecheck && pnpm vitest run src/sim/state.test.ts src/storage src/sim/energy.test.ts && pnpm format`
Expected: PASS. If typecheck lists another `Record<PlantType, …>` literal, add the depot entry there too.

- [x] **Step 7: Commit**

```bash
git add src/shared src/sim/state.ts src/sim/state.test.ts src/sim/energy.ts src/storage src/ui src/render
git commit -m "feat(sim+ui): logistics depot plant, van state and delivery balance

Adds PlantType.LogisticsDepot (needs a road like the stations), the
BALANCE.deliveries block, the van list and deliveryAge layer on the
state, the optional wellStockedTicks save field, the depot tool with
strings, and its mesh and minimap colour.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Deliveries core — fleet, shop ageing, tour planning

**Files:**

- Create: `src/sim/deliveries.ts`, `src/sim/deliveries.test.ts`

**Interfaces:**

- Consumes: `roadDistances`, `findRoadPath` (Task 1); `Van`, `VanPhase`, `deliveryStateOfAge` (Task 2).
- Produces: `isShop(state, index)`, `deliveryState(state, index)`, `isShopSupplied(state, index)`, `supplyWindowTicks()`, `dueTicks()`, `depotTiles(state)`, `depotRoadTile(state, depot)`, `syncFleet(state)`, `ageShops(state)`, `planTour(state, van, claimed)`, `claimedStops(state)`.

- [x] **Step 1: Write the failing tests**

Create `src/sim/deliveries.test.ts`:

```ts
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
```

- [x] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run src/sim/deliveries.test.ts`
Expected: FAIL — cannot resolve `./deliveries.ts`.

- [x] **Step 3: Create `src/sim/deliveries.ts` (first half)**

```ts
import { BALANCE, TICK_RATE, TICKS_PER_DAY } from '../shared/constants.ts';
import { neighbors4, tileX, tileY } from '../shared/grid.ts';
import { DeliveryState, PlantType, Zone } from '../shared/types.ts';
import { isTileConnected } from './energy.ts';
import { findRoadPath, roadDistances } from './routing.ts';
import {
  deliveryStateOfAge,
  markDirty,
  TileType,
  VanPhase,
  type SimState,
  type Van,
} from './state.ts';
import { advanceAlongPath, surplusAvailable, vehicleTile } from './vehicles.ts';

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
```

The unused imports (`TICK_RATE`, `isTileConnected`, `findRoadPath`, `advanceAlongPath`, `surplusAvailable`, `vehicleTile`) are used by Task 4; oxlint flags unused imports, so either add them in Task 4 or keep them and accept a lint failure only until Task 4 — do the former: import only what Step 3 uses and extend the import lines in Task 4.

- [x] **Step 4: Run the tests**

Run: `pnpm vitest run src/sim/deliveries.test.ts && pnpm typecheck && pnpm lint && pnpm format`
Expected: PASS (the sort-order test relies on candidate distances ascending with x on the straight street).

- [x] **Step 5: Commit**

```bash
git add src/sim/deliveries.ts src/sim/deliveries.test.ts
git commit -m "feat(sim): delivery fleet, shop ageing and tour planning

A depot fields vansPerDepot vans on its road tile; every retail building
ages a deliveryAge counter that buckets into supplied, due and
unsupplied; planTour picks the oldest reachable shops nearest-neighbour
from the depot without double-booking stops.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Van tours, unloading, charging, tick wiring

**Files:**

- Modify: `src/sim/deliveries.ts` (second half), `src/sim/deliveries.test.ts`
- Modify: `src/sim/vehicles.ts` (`laneOccupancy`, `chargingDemand`)
- Modify: `src/sim/tick.ts` (`stepTick`)
- Test: `src/sim/vehicles.test.ts`

**Interfaces:**

- Produces: `deliveriesStep(state, occupancy: Map<number, number>): void`, `drivingVans(state): Van[]`, `drivingVanCount(state): number`. `laneOccupancy` counts driving vans; `chargingDemand` includes vans.
- Tick order: `const occupancy = vehiclesStep(state); deliveriesStep(state, occupancy); updateTrafficLoad(state, occupancy);`.

- [x] **Step 1: Write the failing tests**

Append to `src/sim/deliveries.test.ts` (extend the imports with `deliveriesStep`, `drivingVans`, and `chargingDemand`, `laneOccupancy`, `vehiclesStep` from `./vehicles.ts`; the `shopTown` helper and `setHour` below are shared):

```ts
function setHour(state: SimState, hour: number): void {
  state.tick =
    Math.floor(state.tick / TICKS_PER_DAY) * TICKS_PER_DAY +
    Math.round((hour / 24) * TICKS_PER_DAY);
}

/** Power the depot: a wind turbine's ring energises it. */
function powerDepot(state: SimState): void {
  placePlant(state, at(3, 9), PlantType.WindTurbine);
}

/** One tick of cars + vans exactly as tick.ts runs them. */
function stepAll(state: SimState): void {
  const occupancy = vehiclesStep(state);
  deliveriesStep(state, occupancy);
  state.tick++;
}

describe('deliveriesStep', () => {
  it('a van tours due shops inside the window and resets their age', () => {
    const state = shopTown(1, 3);
    powerDepot(state);
    setHour(state, 8);
    for (let i = 0; i < 3; i++) state.layers.deliveryAge[at(6 + i, 11)] = dueTicks();
    let delivered = false;
    for (let t = 0; t < 400 && !delivered; t++) {
      stepAll(state);
      delivered = state.layers.deliveryAge[at(6, 11)] < 50;
    }
    expect(delivered).toBe(true);
    expect(state.vans.some((v) => v.phase !== VanPhase.AtDepot)).toBe(true);
    // Eventually every shop is served and the van is back at the depot.
    for (let t = 0; t < 600; t++) stepAll(state);
    for (let i = 0; i < 3; i++) expect(state.layers.deliveryAge[at(6 + i, 11)]).toBeLessThan(700);
    expect(state.vans.every((v) => v.phase === VanPhase.AtDepot)).toBe(true);
  });

  it('driving vans stay on road tiles and move slower than cars', () => {
    const state = shopTown(1, 3);
    powerDepot(state);
    setHour(state, 8);
    state.layers.deliveryAge[at(8, 11)] = dueTicks();
    let ticksDriving = 0;
    for (let t = 0; t < 200; t++) {
      stepAll(state);
      for (const van of drivingVans(state)) {
        expect(state.layers.tileType[tileIndex(Math.floor(van.x), Math.floor(van.y), SIZE)]).toBe(
          TileType.Road,
        );
      }
      if (state.vans[0].phase === VanPhase.Driving) ticksDriving++;
    }
    // 6 tiles out and 6 back at 0.8 × 1.6 tiles/s (4 ticks/s) ≈ 38 ticks, plus unloading.
    expect(ticksDriving).toBeGreaterThan(30);
  });

  it('no tour starts outside the delivery window', () => {
    const state = shopTown(1, 3);
    powerDepot(state);
    setHour(state, 3);
    for (let i = 0; i < 3; i++) state.layers.deliveryAge[at(6 + i, 11)] = dueTicks();
    for (let t = 0; t < 60; t++) stepAll(state);
    expect(state.vans.every((v) => v.phase === VanPhase.AtDepot)).toBe(true);
  });

  it('no tour starts below minTripCharge', () => {
    const state = shopTown(1, 3);
    setHour(state, 8);
    for (let i = 0; i < 3; i++) state.layers.deliveryAge[at(6 + i, 11)] = dueTicks();
    stepAll(state); // spawn the fleet
    for (const van of state.vans) van.charge = 0.1;
    for (let t = 0; t < 60; t++) stepAll(state);
    expect(state.vans.every((v) => v.phase === VanPhase.AtDepot)).toBe(true);
  });

  it('vans charge only at a powered depot, and driving drains them', () => {
    const dark = shopTown(1, 3);
    setHour(dark, 3);
    stepAll(dark);
    for (const van of dark.vans) van.charge = 0.5;
    for (let t = 0; t < 20; t++) stepAll(dark);
    expect(dark.vans[0].charge).toBe(0.5);
    expect(dark.vans[0].charging).toBe(false);

    const lit = shopTown(1, 3);
    powerDepot(lit);
    setHour(lit, 3);
    stepAll(lit);
    for (const van of lit.vans) van.charge = 0.5;
    for (let t = 0; t < 20; t++) stepAll(lit);
    expect(lit.vans[0].charge).toBeCloseTo(0.5 + 20 * BALANCE.deliveries.chargeRatePerTick, 6);
    expect(lit.vans[0].charging).toBe(true);

    setHour(lit, 8);
    lit.layers.deliveryAge[at(11, 11)] = dueTicks();
    const before = lit.vans[0].charge;
    for (let t = 0; t < 30; t++) stepAll(lit);
    expect(lit.vans[0].charge).toBeLessThan(before);
  });

  it('a city-wide deficit stops depot charging', () => {
    const state = shopTown(1, 3);
    powerDepot(state);
    setHour(state, 3);
    stepAll(state);
    for (const van of state.vans) van.charge = 0.5;
    state.lastEnergy.deficit = 5;
    for (let t = 0; t < 10; t++) stepAll(state);
    expect(state.vans[0].charge).toBe(0.5);
  });

  it('smart charging holds off without surplus unless the van is below the floor', () => {
    const state = shopTown(1, 3);
    powerDepot(state);
    state.smartCharging = true;
    setHour(state, 3);
    stepAll(state);
    state.vans[0].charge = 0.5;
    state.vans[1].charge = BALANCE.vehicles.smartChargeFloor - 0.05;
    for (let t = 0; t < 10; t++) stepAll(state);
    expect(state.vans[0].charge).toBe(0.5);
    expect(state.vans[1].charge).toBeGreaterThan(BALANCE.vehicles.smartChargeFloor - 0.05);
    state.lastEnergy.solar = 1000; // surplus
    for (let t = 0; t < 10; t++) stepAll(state);
    expect(state.vans[0].charge).toBeGreaterThan(0.5);
  });

  it('driving vans count in the lane occupancy and the charging load counts vans', () => {
    const state = shopTown(1, 3);
    powerDepot(state);
    setHour(state, 8);
    state.layers.deliveryAge[at(12, 11)] = dueTicks();
    for (let t = 0; t < 12; t++) stepAll(state);
    expect(drivingVans(state).length).toBeGreaterThan(0);
    let total = 0;
    for (const count of laneOccupancy(state).values()) total += count;
    expect(total).toBe(drivingVans(state).length);

    for (const van of state.vans) van.charging = false;
    state.vans[0].charging = true;
    expect(chargingDemand(state)).toBe(BALANCE.deliveries.chargingEnergyPerVan);
  });

  it('a van whose route is bulldozed skips the stop and comes home', () => {
    const state = shopTown(1, 3);
    powerDepot(state);
    setHour(state, 8);
    state.layers.deliveryAge[at(12, 11)] = dueTicks();
    for (let t = 0; t < 8; t++) stepAll(state);
    expect(state.vans[0].phase).toBe(VanPhase.Driving);
    bulldozeTiles(state, [at(9, 10)]);
    for (let t = 0; t < 200; t++) stepAll(state);
    expect(state.layers.deliveryAge[at(12, 11)]).toBeGreaterThan(dueTicks());
    expect(state.vans.every((v) => v.phase === VanPhase.AtDepot)).toBe(true);
  });

  it('is deterministic for the same seed', () => {
    const run = () => {
      const state = shopTown(7, 6);
      powerDepot(state);
      setHour(state, 7);
      for (let i = 0; i < 6; i++) state.layers.deliveryAge[at(6 + i, 11)] = dueTicks() + i;
      for (let t = 0; t < TICKS_PER_DAY / 2; t++) stepAll(state);
      return state.vans.map((v) => [v.id, v.x, v.y, v.phase, v.charge]);
    };
    expect(run()).toEqual(run());
  });
});
```

Append to `src/sim/vehicles.test.ts` (import `VanPhase` from `./state.ts`):

```ts
describe('vans in the commuter step', () => {
  it('a driving van occupies a lane the cars must respect', () => {
    const state = commuterTown();
    state.vans.push({
      id: 999,
      depot: -1,
      depotRoad: at(5, 10),
      x: 5.5,
      y: 10.5,
      angle: 0,
      phase: VanPhase.Driving,
      stops: [at(8, 10)],
      path: [at(5, 10), at(6, 10), at(7, 10), at(8, 10)],
      pathIndex: 1,
      charge: 0.8,
      charging: false,
      waitTicks: 0,
      dwellTicks: 0,
    });
    const occupancy = vehiclesStep(state);
    let total = 0;
    for (const count of occupancy.values()) total += count;
    expect(total).toBe(1);
  });
});
```

- [x] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run src/sim/deliveries.test.ts src/sim/vehicles.test.ts`
Expected: FAIL — `deliveriesStep`/`drivingVans` not exported; the occupancy test sees 0.

- [x] **Step 3: Vans in `laneOccupancy` and `chargingDemand` (`vehicles.ts`)**

```ts
export function laneOccupancy(state: SimState): Map<number, number> {
  const occupancy = new Map<number, number>();
  for (const vehicle of state.vehicles) {
    if (vehicle.phase === VehiclePhase.ToWork || vehicle.phase === VehiclePhase.ToHome) {
      const lane = vehicleLane(state, vehicle);
      occupancy.set(lane, (occupancy.get(lane) ?? 0) + 1);
    }
  }
  for (const van of state.vans) {
    if (van.phase === VanPhase.Driving) {
      const lane = vehicleLane(state, van);
      occupancy.set(lane, (occupancy.get(lane) ?? 0) + 1);
    }
  }
  return occupancy;
}

/**
 * Charging demand for this tick: cars plugged in at home or a hub plus
 * vans plugged in at their depot, each times its charger power.
 */
export function chargingDemand(state: SimState): number {
  let cars = 0;
  for (const vehicle of state.vehicles) if (vehicle.charging) cars++;
  let vans = 0;
  for (const van of state.vans) if (van.charging) vans++;
  return (
    cars * BALANCE.vehicles.chargingEnergyPerVehicle +
    vans * BALANCE.deliveries.chargingEnergyPerVan
  );
}
```

(import `VanPhase` from `./state.ts`.)

- [x] **Step 4: Second half of `deliveries.ts`**

Extend the imports to those listed in Task 3 Step 3 and append:

```ts
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
```

Edge: when a `Driving` van is lost because its _last_ stop (the depot road) vanished, `routeToNextStop` empties `stops` and marks the van lost; `syncFleet` drops it next tick and spawns a replacement once the depot has a road again.

- [x] **Step 5: Wire `tick.ts`**

```ts
import { deliveriesStep } from './deliveries.ts';
// …
updateWeather(state);
const occupancy = vehiclesStep(state);
deliveriesStep(state, occupancy);
updateTrafficLoad(state, occupancy);
energyStep(state, { chargingDemand: chargingDemand(state) });
```

- [x] **Step 6: Run tests, typecheck, lint, format**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run src/sim && pnpm format`
Expected: PASS. If the "tours due shops" test times out on the first delivery, print `state.vans[0]` after 20 ticks: a van that never leaves `AtDepot` usually means `depotPowered` is false (check the wind turbine sits at (3,9), inside `lineSupplyRadius` of the depot) or `inWindow` is false.

- [x] **Step 7: Commit**

```bash
git add src/sim/deliveries.ts src/sim/deliveries.test.ts src/sim/vehicles.ts src/sim/vehicles.test.ts src/sim/tick.ts
git commit -m "feat(sim): vans tour the shops, unload, charge at the depot

Vans dispatch inside the delivery window, drive the shared lanes at
0.8x car speed, unload at every stop and reset the shops' delivery
age; they charge at an energised depot (smart charging applies) and
count in the charging load and lane occupancy.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Retail growth gate, inspector fields, stats, well-stocked goal

**Files:**

- Modify: `src/sim/growth.ts` (`canDensify` ~line 129)
- Modify: `src/sim/inspect.ts` (`growthBlockers` ~line 110, `inspectTile` return)
- Modify: `src/sim/deliveries.ts` (`deliveryStats`, `depotInfo`)
- Modify: `src/sim/goals.ts`, `src/sim/tick.ts` (`stepTick`, `countTiles`, `buildStats`), `src/sim/state.ts` (`lastDeliveries`)
- Modify: `src/shared/types.ts` (`GrowthBlocker`, `TileInfo`, `TileCounts`, `GlobalStats`)
- Modify: `src/ui/i18n.tsx` (goal strings, blocker string — required for typecheck of `BLOCKER_LABEL`), `src/ui/TileInspector.tsx` (`BLOCKER_LABEL`)
- Test: `src/sim/growth.test.ts`, `src/sim/inspect.test.ts`, `src/sim/goals.test.ts`, `src/sim/engine.test.ts`

**Interfaces:**

- Produces: `GrowthBlocker` gains `'noDeliveries'`; `TileInfo.deliveryState: DeliveryState`, `TileInfo.deliveryAgeTicks: number`, `TileInfo.depot: DepotInfo | null` with `interface DepotInfo { vansTotal; vansDriving; vansCharging; shopsInReach }`; `GlobalStats.deliveries: DeliveryStats` with `interface DeliveryStats { suppliedShare; shops; driving; depots }`; `TileCounts.depots`; `state.lastDeliveries: DeliveryStats`; `deliveryStats(state)`, `depotInfo(state, depot)`; goal id `'wellStocked'`, `goalProgress.wellStockedTicks`.

- [x] **Step 1: Write the failing tests**

`src/sim/growth.test.ts` — append (imports: `growthStep`, `createSimState`, `buildRoads`, `Zone`, `BALANCE`, `TICKS_PER_DAY`, `tileIndex`; reuse the file's `SIZE`/`at` if present, else declare `const SIZE = 24`):

```ts
describe('delivery gate', () => {
  const demand = { residential: 1, commercial: 1, retail: 1 };
  function shop(age: number) {
    const state = createSimState(3, SIZE);
    buildRoads(state, [at(5, 5), at(6, 5)]);
    state.layers.zone[at(5, 6)] = Zone.Retail;
    state.layers.density[at(5, 6)] = 1;
    state.layers.buildingAge[at(5, 6)] = BALANCE.growth.densifyMinAge;
    state.layers.deliveryAge[at(5, 6)] = age;
    for (let t = 0; t < 4000; t++) growthStep(state, demand);
    return state.layers.density[at(5, 6)];
  }

  it('a shop past the supply window does not densify', () => {
    expect(shop(BALANCE.deliveries.supplyWindowDays * TICKS_PER_DAY + 1)).toBe(1);
  });

  it('a supplied shop densifies', () => {
    expect(shop(0)).toBeGreaterThan(1);
  });
});
```

`src/sim/inspect.test.ts` — append (imports: `inspectTile`, `placePlant`, `buildRoads`, `syncFleet` from `./deliveries.ts`, `PlantType`, `Zone`, `DeliveryState`, `BALANCE`, `TICKS_PER_DAY`):

```ts
describe('deliveries in the inspector', () => {
  it('reports the delivery state and age of a shop and the noDeliveries blocker', () => {
    const state = createSimState(1, SIZE);
    buildRoads(state, [at(5, 5)]);
    state.layers.zone[at(5, 6)] = Zone.Retail;
    state.layers.density[at(5, 6)] = 1;
    state.layers.buildingAge[at(5, 6)] = BALANCE.growth.densifyMinAge;
    expect(inspectTile(state, at(5, 6))!.growthBlockers).not.toContain('noDeliveries');
    state.layers.deliveryAge[at(5, 6)] = BALANCE.deliveries.supplyWindowDays * TICKS_PER_DAY + 1;
    const info = inspectTile(state, at(5, 6))!;
    expect(info.deliveryState).toBe(DeliveryState.Unsupplied);
    expect(info.deliveryAgeTicks).toBe(BALANCE.deliveries.supplyWindowDays * TICKS_PER_DAY + 1);
    expect(info.growthBlockers).toContain('noDeliveries');
    expect(info.depot).toBeNull();
  });

  it("reports a depot's fleet and the shops in reach", () => {
    const state = createSimState(1, SIZE);
    buildRoads(
      state,
      Array.from({ length: 10 }, (_, i) => at(i + 2, 10)),
    );
    placePlant(state, at(2, 9), PlantType.LogisticsDepot);
    state.layers.zone[at(6, 11)] = Zone.Retail;
    state.layers.density[at(6, 11)] = 1;
    syncFleet(state);
    state.vans[0].charging = true;
    const info = inspectTile(state, at(2, 9))!;
    expect(info.depot).toEqual({
      vansTotal: BALANCE.deliveries.vansPerDepot,
      vansDriving: 0,
      vansCharging: 1,
      shopsInReach: 1,
    });
    expect(info.upkeepPerTick).toBe(BALANCE.upkeepPerTick.plant[PlantType.LogisticsDepot]);
  });
});
```

`src/sim/goals.test.ts` — append (the file's `bigCity()` helper and `createSimState`/`goalsStep` imports exist):

```ts
describe('wellStocked', () => {
  it('needs enough shops supplied for a whole day', () => {
    const state = bigCity();
    state.lastDeliveries = {
      suppliedShare: 1,
      shops: BALANCE.deliveries.goalMinShops,
      driving: 0,
      depots: 1,
    };
    for (let t = 0; t < TICKS_PER_DAY - 1; t++) goalsStep(state);
    expect(state.goalsAchieved.has('wellStocked')).toBe(false);
    goalsStep(state);
    expect(state.goalsAchieved.has('wellStocked')).toBe(true);
  });

  it('too few shops or a bad share resets the streak', () => {
    const state = bigCity();
    state.lastDeliveries = {
      suppliedShare: 1,
      shops: BALANCE.deliveries.goalMinShops,
      driving: 0,
      depots: 1,
    };
    for (let t = 0; t < 50; t++) goalsStep(state);
    expect(state.goalProgress.wellStockedTicks).toBe(50);
    state.lastDeliveries.suppliedShare = BALANCE.deliveries.goalSuppliedShare - 0.01;
    goalsStep(state);
    expect(state.goalProgress.wellStockedTicks).toBe(0);
    state.lastDeliveries = {
      suppliedShare: 1,
      shops: BALANCE.deliveries.goalMinShops - 1,
      driving: 0,
      depots: 1,
    };
    goalsStep(state);
    expect(state.goalProgress.wellStockedTicks).toBe(0);
  });
});
```

`src/sim/engine.test.ts` — in the stats test near line 193 add:

```ts
expect(first.stats.deliveries).toEqual({ suppliedShare: 1, shops: 0, driving: 0, depots: 0 });
expect(first.stats.counts.depots).toBe(0);
```

- [x] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run src/sim/growth.test.ts src/sim/inspect.test.ts src/sim/goals.test.ts src/sim/engine.test.ts`
Expected: FAIL (typecheck errors on the new fields, `shop(...)` densifies regardless).

- [x] **Step 3: Shared types**

`src/shared/types.ts`:

```ts
export type GrowthBlocker =
  | 'noRoad'
  // … existing …
  | 'noFireCoverage'
  | 'noDeliveries';

/** Fleet figures of one logistics depot (inspector). */
export interface DepotInfo {
  vansTotal: number;
  vansDriving: number;
  vansCharging: number;
  /** Retail buildings a tour from this depot can reach. */
  shopsInReach: number;
}

/** City-wide delivery figures. */
export interface DeliveryStats {
  /** Supplied shops over all shops, 0..1 (1 when there are none). */
  suppliedShare: number;
  /** Retail buildings. */
  shops: number;
  /** Vans on the road. */
  driving: number;
  depots: number;
}
```

`TileInfo` after `laneCapacity`:

```ts
/** Delivery bucket of a retail building (Supplied elsewhere). */
deliveryState: DeliveryState;
/** Ticks since the last delivery (0 off retail). */
deliveryAgeTicks: number;
/** Fleet figures when this tile is a logistics depot. */
depot: DepotInfo | null;
```

`TileCounts`: `depots: number;`. `GlobalStats` after `traffic`: `deliveries: DeliveryStats;`.

- [x] **Step 4: Sim**

`src/sim/state.ts`: `lastDeliveries: DeliveryStats;` on `SimState` (doc: "Figures from the last deliveriesStep; transient.") and `lastDeliveries: { suppliedShare: 1, shops: 0, driving: 0, depots: 0 },` in `createSimState`.

`src/sim/deliveries.ts` — append:

```ts
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
```

(import `type DeliveryStats, type DepotInfo` from `../shared/types.ts`.)

`src/sim/growth.ts` `canDensify`, after the fire check:

```ts
// Shops need a recent delivery to grow.
if (layers.zone[index] === Zone.Retail && !isShopSupplied(state, index)) return false;
```

(import `isShopSupplied` from `./deliveries.ts`; `Zone` is already imported.)

`src/sim/inspect.ts` `growthBlockers`, in the densify branch after the fire check:

```ts
if (zone === Zone.Retail && !isShopSupplied(state, index)) blockers.push('noDeliveries');
```

and in the `inspectTile` return after `laneCapacity`:

```ts
    deliveryState: deliveryState(state, index),
    deliveryAgeTicks: isBuilding && zone === Zone.Retail ? layers.deliveryAge[index] : 0,
    depot:
      tileType === TileType.Plant && plant === PlantType.LogisticsDepot
        ? depotInfo(state, index)
        : null,
```

(import `deliveryState`, `depotInfo`, `isShopSupplied` from `./deliveries.ts`.)

`src/sim/tick.ts`: after `deliveriesStep(state, occupancy);` add `state.lastDeliveries = deliveryStats(state);`. In `countTiles` add `depots: number` to the return type and `depots: 0` to the literal, and `if (plantType[i] === PlantType.LogisticsDepot) counts.depots++;` inside the plant branch (destructure `plantType`, import `PlantType`). In `buildStats` after `traffic`: `deliveries: { ...state.lastDeliveries },`.

`src/sim/goals.ts`: add `'wellStocked'` to `GOAL_IDS`; in `goalsStep` after the free-flow streak:

```ts
// A whole day with (nearly) every shop supplied, for a real retail scene.
const { goalSuppliedShare, goalMinShops } = BALANCE.deliveries;
const deliveries = state.lastDeliveries;
if (deliveries.shops >= goalMinShops && deliveries.suppliedShare >= goalSuppliedShare) {
  progress.wellStockedTicks++;
} else {
  progress.wellStockedTicks = 0;
}
```

and at the end:

```ts
if (!achieved.has('wellStocked') && progress.wellStockedTicks >= TICKS_PER_DAY) {
  achieved.add('wellStocked');
}
```

- [x] **Step 5: UI strings required by typecheck**

`src/ui/TileInspector.tsx` `BLOCKER_LABEL`: `noDeliveries: 'inspect.blocker.noDeliveries',`.

`src/ui/i18n.tsx` English: after `'inspect.blocker.noFireCoverage'`: `'inspect.blocker.noDeliveries': 'No deliveries — build a logistics depot in reach',`; after `'goal.freeFlow.body'`:

```ts
  'goal.wellStocked.title': 'Well stocked',
  'goal.wellStocked.body': 'A whole day with 95% of shops supplied (20+ shops).',
```

German: `'inspect.blocker.noDeliveries': 'Keine Lieferungen – Logistikdepot in Reichweite bauen',` and

```ts
  'goal.wellStocked.title': 'Gut versorgt',
  'goal.wellStocked.body': 'Einen ganzen Tag lang 95 % der Läden beliefert (ab 20 Läden).',
```

- [x] **Step 6: Run tests, typecheck, format**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm format`
Expected: PASS. The integration tests keep passing because a city without a depot only blocks retail _densification_, not spawning; if `full gameplay integration` asserts a retail density above 1, add a depot next to its road in the test's city builder.

- [x] **Step 7: Commit**

```bash
git add src/shared/types.ts src/sim src/ui/i18n.tsx src/ui/TileInspector.tsx
git commit -m "feat(sim): shops need deliveries to densify; delivery stats and goal

Retail past the supply window reports the noDeliveries blocker and
stops densifying. GlobalStats.deliveries, the depot inspector figures
and the well-stocked goal (a day at 95% supplied with 20+ shops) make
the mechanic visible.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Rendering — vans, deliveries overlay, diff field

**Files:**

- Modify: `src/shared/types.ts` (`VehicleKind`, `VehicleState.kind`, `TileDiff.deliveryState`, `OverlayMode.Deliveries`)
- Modify: `src/sim/state.ts` (`collectDiffs`), `src/sim/engine.ts` (`collectVehicles`)
- Modify: `src/render/vehiclesMesh.ts`, `src/render/overlays.ts`
- Modify: `src/agent/tileMirror.test.ts` (diff literal)
- Test: `src/sim/engine.test.ts`

**Interfaces:**

- Produces: `VehicleKind = { Car: 0, Van: 1 }`; `VehicleState.kind: VehicleKind`; `TileDiff.deliveryState: number`; `OverlayMode.Deliveries = 5`.

- [x] **Step 1: Write the failing tests**

`src/sim/engine.test.ts` — extend the stats test:

```ts
expect(first.diffs[0].deliveryState).toBe(0);
```

and add a test (imports: `SimEngine`, `PlantType`, `VehicleKind`, `Zone`, `tileIndex`, `TICKS_PER_DAY`, `VanPhase`):

```ts
it('driving vans are sent to the renderer with kind Van', () => {
  const engine = new SimEngine(1, 24);
  // stepTick's syncFleet keeps only vans whose depot and parking road exist.
  const depot = tileIndex(2, 2, 24);
  const road = tileIndex(2, 3, 24);
  engine.state.layers.tileType[depot] = TileType.Plant;
  engine.state.layers.plantType[depot] = PlantType.LogisticsDepot;
  engine.state.layers.tileType[road] = TileType.Road;
  engine.state.vans.push({
    id: 5,
    depot,
    depotRoad: road,
    x: 2.5,
    y: 3.5,
    angle: 0,
    phase: VanPhase.Unloading,
    stops: [road],
    path: [],
    pathIndex: 0,
    charge: 1,
    charging: false,
    waitTicks: 0,
    dwellTicks: 50,
  });
  const event = engine.tick();
  if (event.type !== 'tick') throw new Error('expected tick');
  const vans = event.vehicles.filter((v) => v.kind === VehicleKind.Van);
  expect(vans).toEqual([{ id: 5, x: 2.5, y: 3.5, angle: 0, kind: VehicleKind.Van }]);
  // syncFleet topped the fleet up to vansPerDepot; the parked ones are not rendered.
  expect(engine.state.vans).toHaveLength(BALANCE.deliveries.vansPerDepot);
});
```

(The van is `Unloading` with a long dwell so it neither moves nor finishes during the tick; imports: `TileType` from `./state.ts`, `PlantType`, `VehicleKind` from `../shared/types.ts`.)

- [x] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/sim/engine.test.ts`
Expected: FAIL — `VehicleKind` undefined / `deliveryState` undefined.

- [x] **Step 3: Types, diffs, engine**

`src/shared/types.ts`:

```ts
export const OverlayMode = {
  None: 0,
  Supply: 1,
  Demand: 2,
  Services: 3,
  Traffic: 4,
  Deliveries: 5,
} as const;

export const VehicleKind = { Car: 0, Van: 1 } as const;
export type VehicleKind = (typeof VehicleKind)[keyof typeof VehicleKind];

export interface VehicleState {
  id: number;
  x: number;
  y: number;
  angle: number;
  /** Which mesh draws it. */
  kind: VehicleKind;
}
```

`TileDiff` after `services`: `/** DeliveryState of a retail building (0 elsewhere). */ deliveryState: number;`.

`src/sim/state.ts` `collectDiffs`: `deliveryState: deliveryStateOfAge(layers.deliveryAge[index]),` (non-shops sit at age 0 → Supplied).

`src/sim/engine.ts`:

```ts
import { drivingVans } from './deliveries.ts';
import { VehicleKind } from '../shared/types.ts';
// …
  private collectVehicles(): VehicleState[] {
    // Only vehicles on the road are rendered; parked ones stay hidden.
    const cars = drivingVehicles(this.state).map((v) => ({
      id: v.id,
      x: v.x,
      y: v.y,
      angle: v.angle,
      kind: VehicleKind.Car,
    }));
    const vans = drivingVans(this.state).map((v) => ({
      id: v.id,
      x: v.x,
      y: v.y,
      angle: v.angle,
      kind: VehicleKind.Van,
    }));
    return [...cars, ...vans];
  }
```

`src/agent/tileMirror.test.ts`: add `deliveryState: 0,` to the diff literal.

- [x] **Step 4: Van mesh**

`src/render/vehiclesMesh.ts` — add a van geometry and a second instanced mesh; headlights cover both:

```ts
const MAX_VANS = 64;
const VAN_COLOR = 0xf2f2ef;

/** Boxy delivery van: tall cargo body plus a short cab. */
function createVanGeometry(): THREE.BufferGeometry {
  const cargo = new THREE.BoxGeometry(0.24, 0.16, 0.15);
  cargo.translate(-0.05, 0.1, 0);
  const cab = new THREE.BoxGeometry(0.1, 0.11, 0.15);
  cab.translate(0.12, 0.075, 0);
  return mergeGeometries([cargo, cab]);
}
```

In the class: add `private readonly vans: THREE.InstancedMesh;`; in the constructor after the car mesh:

```ts
this.vans = new THREE.InstancedMesh(
  createVanGeometry(),
  new THREE.MeshLambertMaterial({ color: VAN_COLOR }),
  MAX_VANS,
);
// Instance transforms live across the whole grid; the base geometry's
// bounds would wrongly cull the mesh, so culling is disabled.
this.vans.frustumCulled = false;
this.vans.castShadow = true;
this.vans.count = 0;
scene.add(this.vans);
```

Size the headlight mesh `MAX_VEHICLES + MAX_VANS`. Replace `update()` with:

```ts
  update(nowSeconds: number): void {
    const blend = THREE.MathUtils.clamp(
      (nowSeconds - this.lastUpdateSeconds) / this.updateInterval,
      0,
      1,
    );
    let cars = 0;
    let vans = 0;
    let lights = 0;
    for (const target of this.current) {
      const isVan = target.kind === VehicleKind.Van;
      if (isVan ? vans >= MAX_VANS : cars >= MAX_VEHICLES) continue;
      // Match by stable id: vehicles enter/leave the visible set when
      // they start or finish trips, so indices don't line up.
      const source = this.previous.get(target.id) ?? target;
      // Teleports (respawns) should not slide across the map.
      const jump = Math.hypot(target.x - source.x, target.y - source.y) > 2;
      const x = jump ? target.x : source.x + (target.x - source.x) * blend;
      const y = jump ? target.y : source.y + (target.y - source.y) * blend;
      const angle = jump ? target.angle : lerpAngle(source.angle, target.angle, blend);
      this.position.set(x, 0.03 + this.elevation.surfaceY(x, y), y);
      this.quaternion.setFromAxisAngle(this.up, -angle);
      this.matrix.compose(this.position, this.quaternion, this.unitScale);
      if (isVan) this.vans.setMatrixAt(vans++, this.matrix);
      else this.mesh.setMatrixAt(cars++, this.matrix);
      this.headlights.setMatrixAt(lights++, this.matrix);
    }
    this.mesh.count = cars;
    this.vans.count = vans;
    this.headlights.count = lights;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.vans.instanceMatrix.needsUpdate = true;
    this.headlights.instanceMatrix.needsUpdate = true;
  }
```

(import `VehicleKind` as a value from `../shared/types.ts`.)

- [x] **Step 5: Deliveries overlay**

`src/render/overlays.ts`: add `DeliveryState`, `PlantType` to the value imports and

```ts
const DELIVERY_COLORS = {
  [DeliveryState.Supplied]: 0x4cd964,
  [DeliveryState.Due]: 0xffb347,
  [DeliveryState.Unsupplied]: 0xe05263,
  depot: 0x5b9bd5,
} as const;
```

`OverlayTile` gains `deliveryState: number; plantType: PlantType;`. In `applyDiffs` widen the keep-condition and copy the fields:

```ts
if (
  diff.zone !== Zone.None ||
  diff.density > 0 ||
  diff.tileType === TileType.Road ||
  diff.plantType === PlantType.LogisticsDepot
) {
  this.tiles.set(diff.index, {
    zone: diff.zone,
    density: diff.density,
    supplied: diff.supplied,
    tileType: diff.tileType,
    services: diff.services,
    trafficLoad: diff.trafficLoad,
    deliveryState: diff.deliveryState,
    plantType: diff.plantType,
  });
}
```

In `rebuild` after the traffic branch:

```ts
        } else if (this.mode === OverlayMode.Deliveries) {
          if (tile.tileType === TileType.Plant && tile.plantType === PlantType.LogisticsDepot) {
            colorHex = DELIVERY_COLORS.depot;
          } else if (
            tile.tileType === TileType.Empty &&
            tile.zone === Zone.Retail &&
            tile.density > 0
          ) {
            colorHex = DELIVERY_COLORS[tile.deliveryState as DeliveryState] ?? null;
          }
        }
```

Update the class doc comment to mention deliveries.

- [x] **Step 6: Run tests, typecheck, format**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm format`
Expected: PASS (agent tests included).

- [x] **Step 7: Commit**

```bash
git add src/shared/types.ts src/sim/state.ts src/sim/engine.ts src/sim/engine.test.ts src/render src/agent/tileMirror.test.ts
git commit -m "feat(render): delivery vans, deliveries overlay and diff field

Vehicle states carry a kind; vans render as boxy light-grey bodies in
their own instanced mesh with shared headlights. Overlay mode 5 tints
shops by delivery state and depots blue from TileDiff.deliveryState.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: UI — overlay button, deliveries chip, inspector sections, help, e2e, docs

**Files:**

- Modify: `src/ui/OverlayToggle.tsx`, `src/ui/CityVitals.tsx`, `src/ui/TileInspector.tsx`, `src/ui/HelpPage.tsx`, `src/ui/i18n.tsx`
- Modify: `e2e/game.spec.ts` (~lines 166, 250), `README.md` (~line 57–75), `docs/idea.md` (E-Mobility section ~line 125)

**Interfaces:**

- Consumes: `stats.deliveries`, `info.deliveryState`, `info.deliveryAgeTicks`, `info.depot` (Task 5), `OverlayMode.Deliveries` (Task 6).
- Produces: test ids `overlay-deliveries`, `deliveries` (chip), `inspect-deliveries`, `inspect-depot`, `tool-plant-depot` (from Task 2's button, rendered as `tool-${id}` by the build bar).

- [x] **Step 1: Strings (English block, next to the traffic keys; German block likewise)**

English:

```ts
  'hud.deliveries': 'deliveries',
  'hud.deliveries.title': '{supplied} of {shops} shops supplied · {vans} vans on the road',
  'overlay.deliveries': 'Deliveries',
  'overlay.deliveries.title': 'Shops by delivery state: green = supplied, orange = due, red = unsupplied; depots blue',
  'help.deliveries.title': 'Deliveries',
  'help.deliveries.body':
    'Shops need goods. A logistics depot sends three electric vans on tours along the roads; a shop that has not seen a van for a day and a half stops growing. Vans queue in traffic like cars and charge at the depot, so keep it powered and in reach of your retail streets. The deliveries overlay shows who is due.',
  'inspect.section.deliveries': 'Deliveries',
  'inspect.deliveryState': 'Status',
  'inspect.delivery.supplied': 'supplied',
  'inspect.delivery.due': 'due',
  'inspect.delivery.unsupplied': 'not supplied',
  'inspect.lastDelivery': 'Last delivery',
  'inspect.lastDelivery.daysAgo': '{days} days ago',
  'inspect.lastDelivery.never': 'never',
  'inspect.depot.vans': 'Vans',
  'inspect.depot.vansValue': '{driving} on the road · {charging} charging · {total} total',
  'inspect.depot.shopsInReach': 'Shops in reach',
```

German:

```ts
  'hud.deliveries': 'Lieferungen',
  'hud.deliveries.title': '{supplied} von {shops} Läden beliefert · {vans} Lieferwagen unterwegs',
  'overlay.deliveries': 'Lieferungen',
  'overlay.deliveries.title': 'Läden nach Lieferstatus: grün = beliefert, orange = fällig, rot = unversorgt; Depots blau',
  'help.deliveries.title': 'Lieferverkehr',
  'help.deliveries.body':
    'Läden brauchen Waren. Ein Logistikdepot schickt drei E-Lieferwagen auf Touren über die Straßen; ein Laden, den anderthalb Tage kein Wagen erreicht hat, wächst nicht weiter. Lieferwagen stehen im Stau wie Autos und laden im Depot – also Strom anschließen und in Reichweite der Einkaufsstraßen bauen. Das Lieferungen-Overlay zeigt, wer fällig ist.',
  'inspect.section.deliveries': 'Lieferungen',
  'inspect.deliveryState': 'Status',
  'inspect.delivery.supplied': 'beliefert',
  'inspect.delivery.due': 'fällig',
  'inspect.delivery.unsupplied': 'unversorgt',
  'inspect.lastDelivery': 'Letzte Lieferung',
  'inspect.lastDelivery.daysAgo': 'vor {days} Tagen',
  'inspect.lastDelivery.never': 'nie',
  'inspect.depot.vans': 'Lieferwagen',
  'inspect.depot.vansValue': '{driving} unterwegs · {charging} laden · {total} gesamt',
  'inspect.depot.shopsInReach': 'Läden in Reichweite',
```

`src/ui/HelpPage.tsx` `SECTIONS`: insert `{ title: 'help.deliveries.title', body: 'help.deliveries.body' },` after the traffic entry.

- [x] **Step 2: Overlay button and chip**

`src/ui/OverlayToggle.tsx` `MODES`, after traffic:

```ts
  {
    mode: OverlayMode.Deliveries,
    id: 'deliveries',
    label: 'overlay.deliveries',
    title: 'overlay.deliveries.title',
  },
```

`src/ui/CityVitals.tsx` after the traffic chip:

```tsx
{
  stats.deliveries.shops > 0 && (
    <div
      className={`hud-stat ${
        stats.deliveries.suppliedShare < BALANCE.deliveries.goalSuppliedShare ? 'negative' : ''
      }`}
      data-testid="deliveries"
      title={t('hud.deliveries.title', {
        supplied: Math.round(stats.deliveries.suppliedShare * stats.deliveries.shops),
        shops: stats.deliveries.shops,
        vans: stats.deliveries.driving,
      })}
    >
      <span className="hud-stat-value">🚚 {Math.round(stats.deliveries.suppliedShare * 100)}%</span>
      <span className="hud-stat-label">{t('hud.deliveries')}</span>
    </div>
  );
}
```

- [x] **Step 3: Inspector sections**

`src/ui/TileInspector.tsx` — import `DeliveryState` as a value and `TICKS_PER_DAY` (already imported). Add near the other label maps:

```ts
const DELIVERY_LABEL: Record<DeliveryState, TranslationKey> = {
  [DeliveryState.Supplied]: 'inspect.delivery.supplied',
  [DeliveryState.Due]: 'inspect.delivery.due',
  [DeliveryState.Unsupplied]: 'inspect.delivery.unsupplied',
};
```

After the traffic section:

```tsx
{
  isBuilding && info.zone === Zone.Retail && (
    <section data-testid="inspect-deliveries">
      <h3>{t('inspect.section.deliveries')}</h3>
      <Row
        label={t('inspect.deliveryState')}
        value={t(DELIVERY_LABEL[info.deliveryState])}
        tone={
          info.deliveryState === DeliveryState.Supplied
            ? 'positive'
            : info.deliveryState === DeliveryState.Due
              ? undefined
              : 'negative'
        }
        testId="inspect-delivery-state"
      />
      <Row
        label={t('inspect.lastDelivery')}
        value={
          info.deliveryAgeTicks >= 65535
            ? t('inspect.lastDelivery.never')
            : t('inspect.lastDelivery.daysAgo', {
                days: (info.deliveryAgeTicks / TICKS_PER_DAY).toFixed(1),
              })
        }
        tone="muted"
      />
    </section>
  );
}

{
  info.depot && (
    <section data-testid="inspect-depot">
      <h3>{t('inspect.section.deliveries')}</h3>
      <Row
        label={t('inspect.depot.vans')}
        value={t('inspect.depot.vansValue', {
          driving: info.depot.vansDriving,
          charging: info.depot.vansCharging,
          total: info.depot.vansTotal,
        })}
      />
      <Row
        label={t('inspect.depot.shopsInReach')}
        value={String(info.depot.shopsInReach)}
        tone={info.depot.shopsInReach > 0 ? 'positive' : 'negative'}
      />
    </section>
  );
}
```

(`isBuilding`, `Row`, `Zone` exist in the file; check how `Row` names its props — `label`, `value`, `tone`, `testId` as in the traffic section.)

- [x] **Step 4: e2e and docs**

`e2e/game.spec.ts`: in the wide-window test add `await expect(page.getByTestId('tool-plant-depot')).toBeVisible();` after the police line; in the overlay test add before `overlay-off`:

```ts
await page.getByTestId('overlay-deliveries').click();
await expect(page.getByTestId('overlay-deliveries')).toHaveClass(/active/);
```

`README.md`: in the E-mobility bullet append " A logistics depot sends electric vans to the shops; retail without deliveries stops growing." and in the "Beyond the core loop" paragraph add "**delivery traffic** with a depot, vans and a well-stocked goal," before the goals mention. `docs/idea.md` E-Mobility section: add the bullet

```
- Delivery traffic: a logistics depot sends electric vans on tours to the
  retail buildings; a shop without a delivery for 1.5 days stops
  densifying. Vans share lanes and traffic load with commuters and charge
  at the depot (added after the MVP; see the deliveries spec)
```

- [x] **Step 5: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm format && pnpm build`
Expected: PASS. e2e (`pnpm e2e`) needs the Mac or CI; note it in the summary.

- [x] **Step 6: Commit**

```bash
git add src/ui e2e README.md docs/idea.md
git commit -m "feat(ui): deliveries overlay, chip, inspector sections, help and docs

Overlay button, a deliveries chip in the vitals once a shop exists,
delivery state and last delivery on shops, fleet figures on depots,
help text in English and German, e2e checks and doc updates.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: WebMCP tool parity

**Files:**

- Modify: `src/agent/tools.ts` (`PLANT_NAMES` ~line 78, `PLANT_TOOL_KEY` ~117, `PLANT_PLACEMENT` ~128, `get_game_overview` ~400, `place_plant` description ~741, `plantFigures` ~960, `liveFigures` ~980)
- Modify: `docs/agent-tools.md` (conventions ~line 64, overview row ~line 80)
- Test: `src/agent/tools.test.ts`

- [x] **Step 1: Write the failing tests**

Append inside `describe('agent tools: building', …)`:

```ts
it('places a logistics depot next to a road and reports deliveries', async () => {
  const { call, engine } = createHarness();
  const { x, y } = findLand(engine);
  await call('build_road', { from: { x, y }, to: { x: x + 3, y } });
  const depot = await call('place_plant', { plant: 'logistics_depot', x, y: y + 1 });
  expect(depot).toMatchObject({ ok: true });
  expect(engine.state.layers.plantType[tileIndex(x, y + 1, SIZE)]).toBe(PlantType.LogisticsDepot);
  const overview = await call('get_game_overview');
  expect(overview.deliveries).toMatchObject({ shops: 0, depots: 1 });
  const info = await call('inspect_tile', { x, y: y + 1 });
  expect(info).toMatchObject({ ok: true, plant: 'logistics_depot' });
  expect(info.depot).toMatchObject({ vansTotal: BALANCE.deliveries.vansPerDepot });
});
```

(`overview.deliveries.depots` reads the stats after the command; if the harness's stats lag one tick, call `await call('advance_time', { ticks: 1 })` before `get_game_overview`.)

- [x] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/agent/tools.test.ts`
Expected: FAIL — `logistics_depot` is not a valid plant name.

- [x] **Step 3: Implement**

`PLANT_NAMES`: `logistics_depot: PlantType.LogisticsDepot,`. `PLANT_TOOL_KEY`: `logistics_depot: 'tool.plant-depot',`. `PLANT_PLACEMENT`: `logistics_depot: 'an empty land tile with a road as direct (4-)neighbour; vans serve shops within route reach',`. `plantFigures`: `case PlantType.LogisticsDepot: return { vans: BALANCE.deliveries.vansPerDepot, routeReachTiles: BALANCE.deliveries.maxRouteTiles };`. `place_plant` description: append `', logistics_depot'` to the list. `get_game_overview` result after `budgetPerTick`:

```ts
          deliveries: {
            suppliedShare: round(s.deliveries.suppliedShare, 2),
            shops: s.deliveries.shops,
            vansDriving: s.deliveries.driving,
            depots: s.deliveries.depots,
          },
```

`liveFigures`:

```ts
    deliveryState: info.deliveryState,
    deliveryAgeDays: round(info.deliveryAgeTicks / TICKS_PER_DAY, 2),
    depot: info.depot,
```

Also add `noDeliveries` to any blocker documentation string in `tools.ts` if one enumerates the blockers (grep `noFireCoverage`).

`docs/agent-tools.md`: add `logistics_depot` to the plant list in Conventions; extend the `get_game_overview` row with ", deliveries"; extend the `inspect_tile` row with " (incl. delivery state and depot fleet)".

- [x] **Step 4: Verify and commit**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run src/agent && pnpm format`

```bash
git add src/agent docs/agent-tools.md
git commit -m "feat(agent): expose the logistics depot and delivery figures to WebMCP

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Balance probe and tuning

**Files:**

- Create (temporary, delete before the final commit): `src/sim/deliveries.probe.test.ts`
- Modify (allowed values only): `BALANCE.deliveries.*`, `costs.plant[LogisticsDepot]`, `upkeepPerTick.plant[LogisticsDepot]`

- [x] **Step 1: Write the probe**

```ts
import { it } from 'vitest';
import { BALANCE, TICKS_PER_DAY } from '../shared/constants.ts';
import { tileIndex } from '../shared/grid.ts';
import { PlantType, Zone } from '../shared/types.ts';
import { drivingVanCount, dueTicks, supplyWindowTicks, isShop } from './deliveries.ts';
import { SimEngine } from './engine.ts';

const SIZE = 48;
const at = (x: number, y: number) => tileIndex(x, y, SIZE);

function buildCity(engine: SimEngine, shops: number, depots: number): void {
  engine.state.layers.elevation.fill(0);
  const road = Array.from({ length: 30 }, (_, x) => at(x + 8, 20));
  engine.applyCommand({ type: 'buildRoad', tiles: road });
  const res: number[] = [];
  const com: number[] = [];
  const ret: number[] = [];
  for (let x = 8; x < 38; x++) {
    res.push(at(x, 19), at(x, 18));
    (ret.length < shops ? ret : com).push(at(x, 21));
  }
  engine.applyCommand({ type: 'paintZone', tiles: res, zone: Zone.Residential });
  engine.applyCommand({ type: 'paintZone', tiles: com, zone: Zone.Commercial });
  engine.applyCommand({ type: 'paintZone', tiles: ret, zone: Zone.Retail });
  const plants = [
    PlantType.SolarFarm,
    PlantType.SolarFarm,
    PlantType.WindTurbine,
    PlantType.WindTurbine,
    PlantType.Battery,
    PlantType.BiogasPlant,
  ];
  plants.forEach((plant, i) => {
    engine.applyCommand({ type: 'placePlant', tile: at(10 + i * 2, 23), plant });
  });
  engine.applyCommand({ type: 'buildPowerLine', tiles: [at(10, 22), ...road] });
  engine.applyCommand({ type: 'buildRoad', tiles: [at(14, 21)] });
  engine.applyCommand({ type: 'placePlant', tile: at(14, 22), plant: PlantType.FireStation });
  engine.applyCommand({ type: 'placePlant', tile: at(16, 22), plant: PlantType.PoliceStation });
  // Depot(s) at the road's west end (and east end for the second).
  engine.applyCommand({ type: 'buildRoad', tiles: [at(8, 21)] });
  engine.applyCommand({ type: 'placePlant', tile: at(8, 22), plant: PlantType.LogisticsDepot });
  if (depots > 1) {
    engine.applyCommand({ type: 'buildRoad', tiles: [at(37, 21)] });
    engine.applyCommand({ type: 'placePlant', tile: at(37, 22), plant: PlantType.LogisticsDepot });
  }
  engine.state.money = 1_000_000;
}

function run(label: string, shops: number, depots: number, days = 40): void {
  const engine = new SimEngine(1, SIZE);
  buildCity(engine, shops, depots);
  console.log(`\n== ${label}: ${shops} shop lots, ${depots} depot(s)`);
  for (let day = 1; day <= days; day++) {
    let vansNoon = 0;
    let vanCharge = 0;
    let carCharge = 0;
    for (let t = 0; t < TICKS_PER_DAY; t++) {
      engine.tick();
      const s = engine.state;
      if (t === TICKS_PER_DAY / 2) vansNoon = drivingVanCount(s);
      vanCharge +=
        s.vans.filter((v) => v.charging).length * BALANCE.deliveries.chargingEnergyPerVan;
      carCharge +=
        s.vehicles.filter((v) => v.charging).length * BALANCE.vehicles.chargingEnergyPerVehicle;
    }
    const s = engine.state;
    let count = 0;
    let due = 0;
    let unsupplied = 0;
    let ageSum = 0;
    for (let i = 0; i < s.layers.tileType.length; i++) {
      if (!isShop(s, i)) continue;
      count++;
      const age = s.layers.deliveryAge[i];
      ageSum += age;
      if (age > supplyWindowTicks()) unsupplied++;
      else if (age > dueTicks()) due++;
    }
    if (day % 5 === 0 || day <= 3) {
      console.log(
        `day ${day}: shops=${count} supplied=${(count ? (count - unsupplied) / count : 1).toFixed(2)} due=${due} meanAge=${count ? (ageSum / count / TICKS_PER_DAY).toFixed(2) : 0}d vansNoon=${vansNoon} vanCharge/day=${vanCharge.toFixed(0)} carCharge/day=${carCharge.toFixed(0)} congestion=${s.commuteCongestion.toFixed(2)} pop=${s.lastDeliveries.shops}`,
      );
    }
  }
}

it('probe', () => {
  run('one depot, 15 shops', 15, 1);
  run('one depot, 30 shops', 30, 1);
  run('two depots, 30 shops', 30, 2);
});
```

- [x] **Step 2: Run and read**

Run: `pnpm vitest run src/sim/deliveries.probe.test.ts --reporter=verbose 2>&1 | grep -E '^(==|day)'`

Targets from the spec: with one depot and 15 shops the supplied share sits above 0.95 from day 2 on; with 30 shops on one depot the share drops below 0.95 (a second depot is a real decision) and recovers with two depots; van charging is below a quarter of car charging; the congestion ratio moves by less than 0.05 versus a run with `shops = 0`.

- [x] **Step 3: Tune within the allowed values**

If 15 shops are already underserved: raise `stopsPerTour` (6–7) or `vansPerDepot` (4) before touching speed. If 30 shops are still fully served by one depot: lower `stopsPerTour` or shrink `windowEndHour`. If van charging dominates: lower `chargingEnergyPerVan`. Re-run the unit tests after each change (`pnpm vitest run src/sim/deliveries.test.ts`); the tour-length assertions depend on `stopsPerTour` only through `BALANCE`, so they follow.

- [x] **Step 4: Delete the probe and commit the tuning (if any)**

```bash
rm src/sim/deliveries.probe.test.ts
pnpm format
git add src/shared/constants.ts
git commit -m "balance: tune delivery fleet from the headless probe

Body: the probe's supplied share per scenario, van vs car charging per
day, and the congestion delta, plus which values changed and why.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Skip the commit if no value changed; still delete the probe.

---

### Task 10: Coverage gate, plan checkboxes, summary

**Files:**

- Modify: `docs/superpowers/plans/2026-09-24-deliveries.md`

- [x] **Step 1: Coverage**

Run: `pnpm coverage`
Expected: PASS with ≥ 90 % on `src/sim` and `src/shared`. Under-covered branches in `deliveries.ts` (lost vans, unreachable leftovers in `planTour`, `depotInfo` without a road) get a focused unit test in `deliveries.test.ts`; never lower the gate.

- [x] **Step 2: Tick the plan and commit**

Tick every step checkbox `- [ ]` → `- [x]` in the task sections only; leave the header sentence untouched (use `sed -i 's/^- \[ \]/- [x]/'`, which only matches lines starting with the box).

```bash
pnpm format
git add docs/superpowers/plans/2026-09-24-deliveries.md
git commit -m "docs: mark the deliveries plan done

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [x] **Step 3: Summary for the user**

Report: what was built, the probe numbers, changed balance values, the load-behaviour caveat (every shop starts supplied after a load), and that e2e (`tool-plant-depot`, `overlay-deliveries`), the smoke and a visual check of the van mesh, the depot mesh and the deliveries overlay need the Mac or CI.
