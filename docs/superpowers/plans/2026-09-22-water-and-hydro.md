# Water and Hydro Power Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every map gets a seeded river and lake; roads cross the river as bridges; two new plants (run-of-river, pumped storage) use the water, with river flow driven by rain.

**Architecture:** A persisted, immutable `terrain` layer (land / river / lake) is added to the simulation state; tile type stays empty / road / plant, so a bridge is just a road on a river tile. One `buildRejection` helper in `state.ts` decides buildability for every placement path. Hydro joins the energy balance as non-dispatchable generation plus a second storage pool; river flow is a new smoothed weather quantity. Render layers key off `TileDiff.terrain`.

**Tech Stack:** TypeScript strict, React 19, three.js, Vitest, Playwright, pnpm. Spec: `docs/superpowers/specs/2026-09-22-water-and-hydro-design.md`.

## Global Constraints

- `src/sim/` has no DOM or three.js imports; all randomness through seeded `Rng`.
- No magic numbers in sim code: every tuning value lives in `BALANCE` (`src/shared/constants.ts`).
- Every user-visible string goes through `src/ui/i18n.tsx` in BOTH English and German.
- New `InstancedMesh` → `frustumCulled = false`.
- `SaveGame` stays backward compatible: new fields optional, `SAVE_VERSION` unchanged.
- Run `pnpm format` after edits; pre-commit runs `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test`. Never `--no-verify`.
- Coverage ≥ 90 % on `src/sim` + `src/shared` (`pnpm coverage`).
- Commit messages: imperative summary + short body, end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- If `git commit` fails with "Author identity unknown" (Linux sandbox), commit with `git -c user.name="Thorsten Rinne" -c user.email="thorsten@rinne.info" commit …`.
- If `node_modules` is missing, run `pnpm install` first.

## File Map

| File | Change |
| --- | --- |
| `src/shared/types.ts` | `Terrain` enum, `PlantType.RunOfRiver/PumpedStorage`, `Weather.riverFlow`, `EnergyStats` hydro + pumped fields, `TileDiff.terrain`, `SaveGame` optional fields |
| `src/shared/constants.ts` | `BALANCE.water`, bridge cost, hydro plant costs/upkeep, hydro + pumped energy numbers |
| `src/sim/state.ts` | `terrain` layer, `pumpedStorageEnergy`, `lastEnergy.hydro`, `buildRejection`/`isBuildable`/`isLakeShore`, `totalPumpedStorageCapacity`, save (de)serialization |
| `src/sim/state.test.ts` (new) | buildability matrix, save round trip |
| `src/sim/water.ts` (new) + test | river + lake generation |
| `src/sim/roads.ts`, `zones.ts`, `growth.ts` | use the buildability helper; bridge pricing |
| `src/sim/energy.ts` + test | hydro placement rules, hydro generation, pumped storage pool |
| `src/sim/weather.ts` + test | river flow |
| `src/sim/tick.ts` | stats, lifetime sums |
| `src/sim/engine.ts` | generate water on new-game init |
| `src/sim/goals.ts` | `hydroPower` goal |
| `src/storage/serialization.ts` + test | JSON export/import of new fields |
| `src/render/waterMesh.ts` (new), `renderer.ts`, `scene.ts`, `roadsMesh.ts`, `plantsMesh.ts`, `minimapLayer.ts`, `weatherFx.ts` | water, bridges, hydro plant meshes, minimap, rain threshold |
| `src/ui/useTools.ts`, `Toolbar.tsx`, `EnergyPanel.tsx`, `App.tsx`, `HelpPage.tsx`, `i18n.tsx` | tools, panel rows, help, strings |
| `e2e/game.spec.ts`, `README.md` | hydro row assertion, gameplay bullet |

---

### Task 1: Terrain layer, buildability helper, shared types

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/constants.ts`
- Modify: `src/sim/state.ts`
- Create: `src/sim/state.test.ts`

**Interfaces:**
- Produces: `Terrain` enum (`Land=0, River=1, Lake=2`); `PlantType.RunOfRiver=7`, `PlantType.PumpedStorage=8`; `TileLayers.terrain: Uint8Array`; `BuildIntent` enum; `buildRejection(state, index, intent, plant?) => string | null`; `isBuildable(...) => boolean`; `isLakeShore(state, index) => boolean`; `BALANCE.water`, `BALANCE.costs.bridgePerTile`.

- [ ] **Step 1: Add the shared types**

In `src/shared/types.ts`, after the `TileType` block add:

```ts
/** Immutable ground type per tile, generated once per map. */
export const Terrain = {
  Land: 0,
  River: 1,
  Lake: 2,
} as const;
export type Terrain = (typeof Terrain)[keyof typeof Terrain];
```

Extend `PlantType`:

```ts
  Park: 6,
  RunOfRiver: 7,
  PumpedStorage: 8,
```

Add `terrain: Terrain;` to `TileDiff` (after `plantType`).

- [ ] **Step 2: Add balance constants**

In `src/shared/constants.ts`:

`costs`: add `bridgePerTile: 40,` after `roadPerTile`; add to `costs.plant`:
```ts
      [PlantType.RunOfRiver]: 2_200,
      [PlantType.PumpedStorage]: 4_000,
```
`upkeepPerTick.plant`: add
```ts
      [PlantType.RunOfRiver]: 0.06,
      [PlantType.PumpedStorage]: 0.08,
```
After the `market` block add:
```ts
  water: {
    /** River entry/exit stay this many tiles away from map corners. */
    edgeMargin: 4,
    /** Lateral meander amplitude as a fraction of the map size (two waves). */
    meanderAmplitudes: [0.12, 0.05] as const,
    /** Meander wave counts along the river. */
    meanderPeriods: [1.5, 3.2] as const,
    /** Per-row chance that a two-tile-wide section starts, and its length. */
    wideSectionChance: 0.08,
    wideSectionLength: 4,
    /** Lake diameter range in tiles. */
    lakeDiameter: [5, 9] as const,
    /** The lake sits this far (fraction) along the river. */
    lakePositionRange: [0.2, 0.8] as const,
    /** Evenly spaced lake position candidates within the range. */
    lakeCandidates: 13,
    /** Per-tile radius noise on the lake edge (0 = perfect ellipse). */
    lakeEdgeNoise: 0.3,
    /** Rain falls (and river flow rises) above this cloud cover. */
    rainCloudThreshold: 0.72,
    /** Flow gain per tick at full rain intensity. */
    rainRate: 0.0006,
    /** Per-tick fraction of the distance to the dry baseline recovered. */
    dryRate: 0.001,
    dryBaselineFlow: 0.25,
    initialFlow: 0.5,
    /** Run-of-river output fraction at zero flow. */
    minFlowFactor: 0.4,
  },
```
In `energy` add after `biogasMaxOutput`:
```ts
    /** Run-of-river output per plant per tick at full river flow. */
    hydroPeakOutput: 70,
    /** Pumped storage: one plant's capacity, power limit and efficiency. */
    pumpedStorageCapacity: 12_000,
    pumpedStoragePowerLimit: 200,
    pumpedStorageChargeEfficiency: 0.78,
```

- [ ] **Step 3: Write the failing tests**

Create `src/sim/state.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { tileIndex } from '../shared/grid.ts';
import { Terrain } from '../shared/types.ts';
import {
  BuildIntent,
  buildRejection,
  createSimState,
  isBuildable,
  isLakeShore,
  PlantType,
  TileType,
  type SimState,
} from './state.ts';

const SIZE = 16;
const at = (x: number, y: number) => tileIndex(x, y, SIZE);

function makeState(): SimState {
  const state = createSimState(1, SIZE);
  state.layers.terrain[at(5, 5)] = Terrain.River;
  state.layers.terrain[at(8, 8)] = Terrain.Lake;
  return state;
}

describe('buildRejection', () => {
  it('allows everything on empty land', () => {
    const state = makeState();
    expect(buildRejection(state, at(1, 1), BuildIntent.Road)).toBeNull();
    expect(buildRejection(state, at(1, 1), BuildIntent.Zone)).toBeNull();
    expect(buildRejection(state, at(1, 1), BuildIntent.Plant, PlantType.SolarFarm)).toBeNull();
  });

  it('rejects occupied tiles first', () => {
    const state = makeState();
    state.layers.tileType[at(1, 1)] = TileType.Road;
    expect(buildRejection(state, at(1, 1), BuildIntent.Road)).toBe('tileOccupied');
    state.layers.density[at(2, 2)] = 1;
    expect(buildRejection(state, at(2, 2), BuildIntent.Zone)).toBe('tileOccupied');
  });

  it('allows roads (bridges) and run-of-river plants on river tiles only', () => {
    const state = makeState();
    expect(buildRejection(state, at(5, 5), BuildIntent.Road)).toBeNull();
    expect(buildRejection(state, at(5, 5), BuildIntent.Zone)).toBe('cannotBuildOnWater');
    expect(buildRejection(state, at(5, 5), BuildIntent.Plant, PlantType.SolarFarm)).toBe(
      'cannotBuildOnWater',
    );
    expect(buildRejection(state, at(5, 5), BuildIntent.Plant, PlantType.RunOfRiver)).toBeNull();
    expect(buildRejection(state, at(1, 1), BuildIntent.Plant, PlantType.RunOfRiver)).toBe(
      'needsRiverTile',
    );
  });

  it('rejects everything on lake tiles', () => {
    const state = makeState();
    expect(buildRejection(state, at(8, 8), BuildIntent.Road)).toBe('cannotBuildOnWater');
    expect(buildRejection(state, at(8, 8), BuildIntent.Zone)).toBe('cannotBuildOnWater');
    expect(buildRejection(state, at(8, 8), BuildIntent.Plant, PlantType.RunOfRiver)).toBe(
      'cannotBuildOnWater',
    );
  });

  it('requires a lake shore for pumped storage', () => {
    const state = makeState();
    expect(isLakeShore(state, at(8, 7))).toBe(true);
    expect(isLakeShore(state, at(1, 1))).toBe(false);
    expect(buildRejection(state, at(8, 7), BuildIntent.Plant, PlantType.PumpedStorage)).toBeNull();
    expect(buildRejection(state, at(1, 1), BuildIntent.Plant, PlantType.PumpedStorage)).toBe(
      'needsLakeShore',
    );
    expect(isBuildable(state, at(8, 7), BuildIntent.Plant, PlantType.PumpedStorage)).toBe(true);
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `pnpm vitest run src/sim/state.test.ts`
Expected: FAIL (`buildRejection` is not exported).

- [ ] **Step 5: Implement the layer and helper**

In `src/sim/state.ts`:

Import `Terrain` from `../shared/types.ts` (add to the existing value import line: `import { PlantType, SupplyStatus, Terrain, TileType, Zone } from '../shared/types.ts';`) and import `neighbors4` from `../shared/grid.ts`.

`TileLayers`: add `/** Immutable ground type (land / river / lake), generated per map. */ terrain: Uint8Array;` after `plantType`. In `createTileLayers` add `terrain: new Uint8Array(tiles),`.

`SimState`: add `/** Energy stored in pumped storage plants (separate pool from batteries). */ pumpedStorageEnergy: number;` after `storedEnergy`; set `pumpedStorageEnergy: 0,` in `createSimState`. Add `hydro: number;` to `lastEnergy` type and `hydro: 0,` to its initializer. In `createSimState` set `weather: { cloudCover: 0.3, windSpeed: 0.5, riverFlow: BALANCE.water.initialFlow },`.

`collectDiffs`: add `terrain: layers.terrain[index] as TileDiff['terrain'],`.

After `markAllDirty` add:

```ts
/** What a placement is trying to do; decides which terrain accepts it. */
export const BuildIntent = { Road: 0, Zone: 1, Plant: 2 } as const;
export type BuildIntent = (typeof BuildIntent)[keyof typeof BuildIntent];

/** True when any 4-neighbour is a lake tile. */
export function isLakeShore(state: SimState, index: number): boolean {
  const { terrain } = state.layers;
  return neighbors4(index, state.size).some((n) => terrain[n] === Terrain.Lake);
}

/**
 * Why a tile cannot be built on with the given intent, or null when it
 * can. Land accepts everything (except run-of-river, which needs the
 * river); river tiles accept bridges and run-of-river plants; lakes
 * accept nothing. Pumped storage additionally needs a lake shore.
 */
export function buildRejection(
  state: SimState,
  index: number,
  intent: BuildIntent,
  plant: PlantType = PlantType.None,
): string | null {
  const { layers } = state;
  if (layers.tileType[index] !== TileType.Empty || layers.density[index] !== 0) {
    return 'tileOccupied';
  }
  const terrain = layers.terrain[index] as Terrain;
  const wantsRiver = intent === BuildIntent.Plant && plant === PlantType.RunOfRiver;
  if (terrain === Terrain.Lake) return 'cannotBuildOnWater';
  if (terrain === Terrain.River) {
    if (intent === BuildIntent.Road || wantsRiver) return null;
    return 'cannotBuildOnWater';
  }
  if (wantsRiver) return 'needsRiverTile';
  if (intent === BuildIntent.Plant && plant === PlantType.PumpedStorage && !isLakeShore(state, index)) {
    return 'needsLakeShore';
  }
  return null;
}

export function isBuildable(
  state: SimState,
  index: number,
  intent: BuildIntent,
  plant: PlantType = PlantType.None,
): boolean {
  return buildRejection(state, index, intent, plant) === null;
}
```

After `totalStorageCapacity` add:

```ts
export function totalPumpedStorageCapacity(state: SimState): number {
  return countPlants(state, PlantType.PumpedStorage) * BALANCE.energy.pumpedStorageCapacity;
}
```

Also add `Terrain` to the re-export line at the bottom: `export { SupplyStatus, TileType, Zone, PlantType, Terrain };`.

- [ ] **Step 6: Fix the compile fallout**

`Weather` in `src/shared/types.ts` needs `/** 0 = dry riverbed, 1 = river in full flow. Drives run-of-river output. */ riverFlow: number;`. Run `pnpm typecheck` and fix every place that constructs a `Weather` or `TileDiff` literal (search: `grep -rn "windSpeed:" src --include=*.ts --include=*.tsx | grep -v test` and `grep -rn "plantType:" src --include=*.ts`). Tests that build `Weather` objects get `riverFlow: 0.5`.

- [ ] **Step 7: Run tests and typecheck**

Run: `pnpm typecheck && pnpm vitest run src/sim/state.test.ts`
Expected: PASS.

- [ ] **Step 8: Format and commit**

```bash
pnpm format
git add src/shared/types.ts src/shared/constants.ts src/sim/state.ts src/sim/state.test.ts
git commit -m "feat(sim): terrain layer and buildability helper

Adds an immutable land/river/lake terrain layer, the hydro plant types,
water balance constants and a single buildRejection helper that decides
what each terrain accepts.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Placement goes through the helper; bridges; hydro plant placement

**Files:**
- Modify: `src/sim/roads.ts`, `src/sim/zones.ts`, `src/sim/growth.ts`, `src/sim/energy.ts`
- Test: `src/sim/roads.test.ts`, `src/sim/zones.test.ts`, `src/sim/energy.test.ts`

**Interfaces:**
- Consumes: `buildRejection`, `isBuildable`, `BuildIntent`, `Terrain`, `BALANCE.costs.bridgePerTile`.
- Produces: `placePlant` rejections `needsRiverTile`, `needsLakeShore`, `cannotBuildOnWater`; `PlantCensus.runOfRiverPlants`, `PlantCensus.pumpedStoragePlants`; both hydro plants in `SUPPLY_SOURCES`.

- [ ] **Step 1: Write failing road tests**

Append to `src/sim/roads.test.ts` (inside a new `describe`):

```ts
import { Terrain } from '../shared/types.ts';

describe('bridges', () => {
  it('charges the bridge price on river tiles and keeps the terrain', () => {
    const state = makeState();
    state.layers.terrain[at(5, 5)] = Terrain.River;
    const before = state.money;
    buildRoads(state, [at(4, 5), at(5, 5), at(6, 5)]);
    expect(state.layers.tileType[at(5, 5)]).toBe(TileType.Road);
    expect(state.money).toBe(
      before - 2 * BALANCE.costs.roadPerTile - BALANCE.costs.bridgePerTile,
    );
    expect(state.layers.terrain[at(5, 5)]).toBe(Terrain.River);
  });

  it('never paves lake tiles', () => {
    const state = makeState();
    state.layers.terrain[at(5, 5)] = Terrain.Lake;
    buildRoads(state, [at(5, 5)]);
    expect(state.layers.tileType[at(5, 5)]).toBe(TileType.Empty);
  });

  it('bulldozing a bridge leaves a river tile', () => {
    const state = makeState();
    state.layers.terrain[at(5, 5)] = Terrain.River;
    buildRoads(state, [at(5, 5)]);
    bulldozeTiles(state, [at(5, 5)]);
    expect(state.layers.tileType[at(5, 5)]).toBe(TileType.Empty);
    expect(state.layers.terrain[at(5, 5)]).toBe(Terrain.River);
  });
});
```

(Add the `Terrain` import to the top of the file rather than mid-file.)

- [ ] **Step 2: Write failing zone test**

Append to `src/sim/zones.test.ts`:

```ts
  it('skips water tiles', () => {
    const state = makeState();
    state.layers.terrain[at(3, 3)] = Terrain.River;
    state.layers.terrain[at(4, 4)] = Terrain.Lake;
    const before = state.money;
    paintZones(state, [at(3, 3), at(4, 4), at(5, 5)], Zone.Residential);
    expect(state.layers.zone[at(3, 3)]).toBe(Zone.None);
    expect(state.layers.zone[at(4, 4)]).toBe(Zone.None);
    expect(state.layers.zone[at(5, 5)]).toBe(Zone.Residential);
    expect(state.money).toBe(before - BALANCE.costs.zonePerTile);
  });
```

Check the file's existing helpers (`makeState`, `at`) and imports; add `Terrain` and `BALANCE` imports if missing.

- [ ] **Step 3: Write failing energy placement tests**

Append to `src/sim/energy.test.ts` inside `describe('placePlant')`:

```ts
  it('places run-of-river only on river tiles', () => {
    const state = makeState();
    expect(placePlant(state, at(5, 5), PlantType.RunOfRiver).rejected).toBe('needsRiverTile');
    state.layers.terrain[at(5, 5)] = Terrain.River;
    expect(placePlant(state, at(5, 5), PlantType.RunOfRiver).rejected).toBeUndefined();
    expect(state.layers.plantType[at(5, 5)]).toBe(PlantType.RunOfRiver);
  });

  it('places pumped storage only on the lake shore and never on water', () => {
    const state = makeState();
    state.layers.terrain[at(8, 8)] = Terrain.Lake;
    expect(placePlant(state, at(2, 2), PlantType.PumpedStorage).rejected).toBe('needsLakeShore');
    expect(placePlant(state, at(8, 8), PlantType.PumpedStorage).rejected).toBe(
      'cannotBuildOnWater',
    );
    expect(placePlant(state, at(8, 7), PlantType.PumpedStorage).rejected).toBeUndefined();
    expect(placePlant(state, at(8, 8), PlantType.SolarFarm).rejected).toBe('cannotBuildOnWater');
  });

  it('census counts hydro plants as supply sources', () => {
    const state = makeState();
    state.layers.terrain[at(5, 5)] = Terrain.River;
    state.layers.terrain[at(8, 8)] = Terrain.Lake;
    placePlant(state, at(5, 5), PlantType.RunOfRiver);
    placePlant(state, at(8, 7), PlantType.PumpedStorage);
    const census = censusPlants(state);
    expect(census.runOfRiverPlants).toBe(1);
    expect(census.pumpedStoragePlants).toBe(1);
    expect(census.supplySources).toEqual([at(5, 5), at(8, 7)]);
  });
```

Add `Terrain` to the `./state.ts` import in that file.

- [ ] **Step 4: Run tests to verify they fail**

Run: `pnpm vitest run src/sim/roads.test.ts src/sim/zones.test.ts src/sim/energy.test.ts`
Expected: the new tests FAIL (bridge price not charged; water tiles paved/zoned; rejections `tileOccupied`/undefined instead of the water reasons; census fields undefined).

- [ ] **Step 5: Roads**

In `src/sim/roads.ts` import `BuildIntent`, `isBuildable`, `Terrain` from `./state.ts` (add to the existing import). Replace in `buildRoads`:

```ts
  const buildable = tiles.filter((index) => isBuildable(state, index, BuildIntent.Road));
  if (buildable.length === 0) return {};

  const { roadPerTile, bridgePerTile } = BALANCE.costs;
  const cost = buildable.reduce(
    (sum, index) => sum + (layers.terrain[index] === Terrain.River ? bridgePerTile : roadPerTile),
    0,
  );
```

`bulldozeTiles` needs no change (it only resets tileType/zone/density/variant/plantType).

- [ ] **Step 6: Zones**

In `src/sim/zones.ts` import `BuildIntent`, `isBuildable` and replace the filter:

```ts
  const paintable = tiles.filter(
    (index) => isBuildable(state, index, BuildIntent.Zone) && layers.zone[index] !== zone,
  );
```

- [ ] **Step 7: Growth guard**

In `src/sim/growth.ts` `growthStep`, after `if (layers.tileType[index] !== TileType.Empty) continue;` add:

```ts
    if (layers.terrain[index] !== Terrain.Land) continue;
```

and add `Terrain` to the `./state.ts` import.

- [ ] **Step 8: Plants**

In `src/sim/energy.ts`:

- Add `PlantType.RunOfRiver` and `PlantType.PumpedStorage` to `SUPPLY_SOURCES`.
- Import `BuildIntent`, `buildRejection` from `./state.ts`.
- In `placePlant` replace the occupied check with:

```ts
  const rejection = buildRejection(state, tile, BuildIntent.Plant, plant);
  if (rejection) return { rejected: rejection };
```

- `PlantCensus`: add `runOfRiverPlants: number; pumpedStoragePlants: number;`, initialise both to 0, and add switch cases:

```ts
      case PlantType.RunOfRiver:
        census.runOfRiverPlants++;
        break;
      case PlantType.PumpedStorage:
        census.pumpedStoragePlants++;
        break;
```

- [ ] **Step 9: Run tests**

Run: `pnpm vitest run src/sim`
Expected: PASS (all existing tests still pass — the `tileOccupied` reason is unchanged for land).

- [ ] **Step 10: Format and commit**

```bash
pnpm format
git add src/sim
git commit -m "feat(sim): terrain-aware placement, bridges and hydro plant siting

Roads, zones, plants and growth consult the buildability helper. Roads
over river tiles are bridges at their own price; run-of-river plants
need a river tile and pumped storage a lake shore.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: River and lake generation

**Files:**
- Create: `src/sim/water.ts`, `src/sim/water.test.ts`
- Modify: `src/sim/engine.ts`

**Interfaces:**
- Consumes: `Terrain`, `Rng`, `BALANCE.water`, `markDirty`.
- Produces: `generateWater(state: SimState): void` — fills `state.layers.terrain`, marks water tiles dirty, uses its own `Rng` seeded from `state.seed` (does not touch `state.rng`).

- [ ] **Step 1: Write the failing tests**

Create `src/sim/water.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { neighbors4, tileIndex, tileX, tileY } from '../shared/grid.ts';
import { Terrain } from '../shared/types.ts';
import { MAP_SIZES } from '../ui/newGame.ts';
import { createSimState, type SimState } from './state.ts';
import { generateWater } from './water.ts';

function isWater(state: SimState, index: number): boolean {
  return state.layers.terrain[index] !== Terrain.Land;
}

/** Tiles reachable from `start` through water tiles (4-connectivity). */
function floodWater(state: SimState, start: number): Set<number> {
  const seen = new Set<number>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const index = queue.pop()!;
    for (const n of neighbors4(index, state.size)) {
      if (!seen.has(n) && isWater(state, n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return seen;
}

function edgeWaterTiles(state: SimState): { a: number[]; b: number[] } {
  const { size } = state;
  const north: number[] = [];
  const south: number[] = [];
  const west: number[] = [];
  const east: number[] = [];
  for (let i = 0; i < size; i++) {
    if (isWater(state, tileIndex(i, 0, size))) north.push(tileIndex(i, 0, size));
    if (isWater(state, tileIndex(i, size - 1, size))) south.push(tileIndex(i, size - 1, size));
    if (isWater(state, tileIndex(0, i, size))) west.push(tileIndex(0, i, size));
    if (isWater(state, tileIndex(size - 1, i, size))) east.push(tileIndex(size - 1, i, size));
  }
  return north.length > 0 ? { a: north, b: south } : { a: west, b: east };
}

const SEEDS = Array.from({ length: 25 }, (_, i) => i * 7919 + 1);

describe('generateWater', () => {
  for (const size of MAP_SIZES) {
    describe(`size ${size}`, () => {
      it('river connects two opposite edges', () => {
        for (const seed of SEEDS) {
          const state = createSimState(seed, size);
          generateWater(state);
          const { a, b } = edgeWaterTiles(state);
          expect(a.length, `seed ${seed} entry`).toBeGreaterThan(0);
          expect(b.length, `seed ${seed} exit`).toBeGreaterThan(0);
          const reachable = floodWater(state, a[0]);
          expect(b.some((tile) => reachable.has(tile)), `seed ${seed} connected`).toBe(true);
        }
      });

      it('has one lake that touches the river and stays away from the centre', () => {
        for (const seed of SEEDS) {
          const state = createSimState(seed, size);
          generateWater(state);
          const lake: number[] = [];
          for (let i = 0; i < size * size; i++) {
            if (state.layers.terrain[i] === Terrain.Lake) lake.push(i);
          }
          expect(lake.length, `seed ${seed} lake size`).toBeGreaterThan(12);
          const touchesRiver = lake.some((tile) =>
            neighbors4(tile, size).some((n) => state.layers.terrain[n] === Terrain.River),
          );
          expect(touchesRiver, `seed ${seed} lake on river`).toBe(true);
          const centre = size / 2;
          const clearance = size / 4 - 5;
          for (const tile of lake) {
            const d = Math.max(
              Math.abs(tileX(tile, size) - centre),
              Math.abs(tileY(tile, size) - centre),
            );
            expect(d, `seed ${seed} lake near centre`).toBeGreaterThanOrEqual(clearance);
          }
        }
      });

      it('is deterministic per seed and differs between seeds', () => {
        const a = createSimState(11, size);
        const b = createSimState(11, size);
        const c = createSimState(12, size);
        generateWater(a);
        generateWater(b);
        generateWater(c);
        expect(a.layers.terrain).toEqual(b.layers.terrain);
        expect(a.layers.terrain).not.toEqual(c.layers.terrain);
      });

      it('marks every water tile dirty and leaves the main rng untouched', () => {
        const state = createSimState(3, size);
        const rngBefore = state.rng.getState();
        generateWater(state);
        expect(state.rng.getState()).toBe(rngBefore);
        for (let i = 0; i < size * size; i++) {
          if (isWater(state, i)) expect(state.dirty.has(i)).toBe(true);
        }
      });
    });
  }
});
```

Note: `MAP_SIZES` lives in `src/ui/newGame.ts`, which imports only `../shared/constants.ts` — safe to import from a sim test (no DOM at import time). If `pnpm lint` complains about sim tests importing ui, inline `const MAP_SIZES = [48, 64, 96] as const;` instead.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/sim/water.test.ts`
Expected: FAIL (`./water.ts` not found).

- [ ] **Step 3: Implement generation**

Create `src/sim/water.ts`:

```ts
import { BALANCE } from '../shared/constants.ts';
import { inBounds, tileIndex } from '../shared/grid.ts';
import { Rng } from '../shared/rng.ts';
import { Terrain } from '../shared/types.ts';
import { markDirty, type SimState } from './state.ts';

/** Keeps map generation independent from the gameplay random stream. */
const WATER_SEED_SALT = 0x57a7e3;

interface RiverAxis {
  /** True: the river runs north→south (along = y, lateral = x). */
  vertical: boolean;
  entry: number;
  exit: number;
  phases: number[];
}

/**
 * Generate the map's water: one meandering river from one edge to the
 * opposite edge and one lake on the river. Deterministic per seed and
 * independent of the gameplay RNG. Terrain never changes afterwards.
 */
export function generateWater(state: SimState): void {
  const rng = new Rng((state.seed ^ WATER_SEED_SALT) >>> 0);
  const { size } = state;
  const cfg = BALANCE.water;
  const terrain = state.layers.terrain;
  terrain.fill(Terrain.Land);

  const lateralMin = cfg.edgeMargin;
  const lateralMax = size - 1 - cfg.edgeMargin;
  const axis: RiverAxis = {
    vertical: rng.chance(0.5),
    entry: lateralMin + rng.nextInt(lateralMax - lateralMin + 1),
    exit: lateralMin + rng.nextInt(lateralMax - lateralMin + 1),
    phases: cfg.meanderPeriods.map(() => rng.next() * 2 * Math.PI),
  };

  /** Smooth centre line: linear entry→exit plus two seeded sine meanders. */
  const centreLine = (t: number): number => {
    let lateral = axis.entry + (axis.exit - axis.entry) * t;
    for (let i = 0; i < cfg.meanderPeriods.length; i++) {
      lateral +=
        cfg.meanderAmplitudes[i] *
        size *
        Math.sin(2 * Math.PI * cfg.meanderPeriods[i] * t + axis.phases[i]);
    }
    return Math.min(lateralMax, Math.max(lateralMin, Math.round(lateral)));
  };

  const setTerrain = (along: number, lateral: number, value: Terrain): void => {
    const x = axis.vertical ? lateral : along;
    const y = axis.vertical ? along : lateral;
    if (inBounds(x, y, size)) terrain[tileIndex(x, y, size)] = value;
  };

  // River: rasterise the centre line row by row, filling the lateral span
  // between consecutive rows so the channel stays 4-connected.
  let previous = centreLine(0);
  let wideRemaining = 0;
  for (let along = 0; along < size; along++) {
    const lateral = centreLine(along / (size - 1));
    const lo = Math.min(previous, lateral);
    const hi = Math.max(previous, lateral);
    for (let l = lo; l <= hi; l++) setTerrain(along, l, Terrain.River);
    if (wideRemaining > 0) {
      setTerrain(along, lateral + 1, Terrain.River);
      wideRemaining--;
    } else if (rng.chance(cfg.wideSectionChance)) {
      wideRemaining = cfg.wideSectionLength;
    }
    previous = lateral;
  }

  // Lake: pick a position along the river that keeps the map centre dry.
  const [tMin, tMax] = cfg.lakePositionRange;
  const centre = size / 2;
  const minDistance = size / 4;
  const candidates: number[] = [];
  for (let i = 0; i < cfg.lakeCandidates; i++) {
    const t = tMin + ((tMax - tMin) * i) / (cfg.lakeCandidates - 1);
    const along = Math.round(t * (size - 1));
    const lateral = centreLine(t);
    const distance = Math.max(Math.abs(along - centre), Math.abs(lateral - centre));
    if (distance >= minDistance) candidates.push(i);
  }
  // t = tMin and t = tMax are always far enough along the axis for
  // tMin <= 0.25, so candidates is never empty; guard anyway.
  const pick = candidates.length > 0 ? candidates[rng.nextInt(candidates.length)] : 0;
  const tLake = tMin + ((tMax - tMin) * pick) / (cfg.lakeCandidates - 1);
  const lakeAlong = Math.round(tLake * (size - 1));
  const lakeLateral = centreLine(tLake);
  const [dMin, dMax] = cfg.lakeDiameter;
  const radiusAlong = rng.nextRange(dMin, dMax) / 2;
  const radiusLateral = rng.nextRange(dMin, dMax) / 2;
  const reach = Math.ceil(Math.max(radiusAlong, radiusLateral)) + 1;
  for (let da = -reach; da <= reach; da++) {
    for (let dl = -reach; dl <= reach; dl++) {
      const ellipse = (da * da) / (radiusAlong * radiusAlong) + (dl * dl) / (radiusLateral * radiusLateral);
      const noise = (rng.next() - 0.5) * cfg.lakeEdgeNoise;
      if (ellipse <= 1 + noise) setTerrain(lakeAlong + da, lakeLateral + dl, Terrain.Lake);
    }
  }

  for (let i = 0; i < size * size; i++) {
    if (terrain[i] !== Terrain.Land) markDirty(state, i);
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run src/sim/water.test.ts`
Expected: PASS. If the "lake size > 12" assertion fails for a seed, the noise carved the lake too small — the minimum diameter 5 gives an ellipse of ~20 tiles, so check the ellipse loop bounds before tuning anything.

- [ ] **Step 5: Generate on new-game init**

In `src/sim/engine.ts` import `generateWater` from `./water.ts` and change the `init` case:

```ts
      case 'init':
        if (command.save) {
          this.state = deserializeState(command.save);
        } else {
          this.state = createSimState(command.seed, command.size, command.startingMoney);
          generateWater(this.state);
        }
        return [];
```

Add to `src/sim/engine.test.ts`:

```ts
  it('generates water on a fresh init but not when loading a save', () => {
    const engine = makeEngine(1, 48);
    engine.applyCommand({ type: 'init', seed: 2, size: 48 });
    const water = engine.state.layers.terrain.filter((t) => t !== 0).length;
    expect(water).toBeGreaterThan(40);
    const first = engine.tick();
    if (first.type !== 'tick') throw new Error('expected tick');
    expect(first.diffs.some((d) => d.terrain !== 0)).toBe(true);
  });
```

Run: `pnpm vitest run src/sim/engine.test.ts` → PASS.

- [ ] **Step 6: Format and commit**

```bash
pnpm format
git add src/sim/water.ts src/sim/water.test.ts src/sim/engine.ts src/sim/engine.test.ts
git commit -m "feat(sim): seeded river and lake generation

A meandering river crosses the map edge to edge with a lake on it,
generated from a salted seed so gameplay randomness is unaffected. New
games get water; loaded saves keep their terrain.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: River flow in the weather model

**Files:**
- Modify: `src/sim/weather.ts`, `src/sim/weather.test.ts`

**Interfaces:**
- Produces: `riverFlowFactor(state: SimState): number` (0..1 multiplier for run-of-river output); `updateWeather` advances `state.weather.riverFlow`.

- [ ] **Step 1: Write failing tests**

Append to `src/sim/weather.test.ts`:

```ts
import { BALANCE } from '../shared/constants.ts';
import { riverFlowFactor } from './weather.ts';

describe('river flow', () => {
  function stateWithClouds(cloudCover: number) {
    const state = createSimState(5, 8);
    state.weather.cloudCover = cloudCover;
    return state;
  }

  it('rises under heavy cloud and is capped at 1', () => {
    const state = stateWithClouds(1);
    const start = state.weather.riverFlow;
    for (let i = 0; i < 100; i++) {
      state.tick++;
      updateWeather(state);
      // Pin the clouds: updateWeather drifts them, this test wants rain.
      state.weather.cloudCover = 1;
    }
    expect(state.weather.riverFlow).toBeGreaterThan(start);
    for (let i = 0; i < 20_000; i++) {
      updateWeather(state);
      state.weather.cloudCover = 1;
    }
    expect(state.weather.riverFlow).toBe(1);
  });

  it('decays toward the dry baseline in clear weather', () => {
    const state = stateWithClouds(0);
    state.weather.riverFlow = 1;
    for (let i = 0; i < 10_000; i++) {
      updateWeather(state);
      state.weather.cloudCover = 0;
    }
    expect(state.weather.riverFlow).toBeCloseTo(BALANCE.water.dryBaselineFlow, 2);
    expect(state.weather.riverFlow).toBeGreaterThanOrEqual(BALANCE.water.dryBaselineFlow);
  });

  it('maps flow to an output factor with a floor', () => {
    const state = stateWithClouds(0);
    state.weather.riverFlow = 0;
    expect(riverFlowFactor(state)).toBeCloseTo(BALANCE.water.minFlowFactor, 6);
    state.weather.riverFlow = 1;
    expect(riverFlowFactor(state)).toBeCloseTo(1, 6);
  });

  it('is deterministic', () => {
    const a = createSimState(9, 8);
    const b = createSimState(9, 8);
    for (let i = 0; i < 500; i++) {
      a.tick++;
      b.tick++;
      updateWeather(a);
      updateWeather(b);
    }
    expect(a.weather.riverFlow).toBe(b.weather.riverFlow);
  });
});
```

(Move the two new imports to the file's import block.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/sim/weather.test.ts`
Expected: FAIL (`riverFlowFactor` not exported; flow never changes).

- [ ] **Step 3: Implement**

In `src/sim/weather.ts`, extend `updateWeather`:

```ts
export function updateWeather(state: SimState): void {
  const { cloudDrift, windDrift } = BALANCE.weather;
  const { cloudMean, windMean } = frontMeans(state.seed, state.tick);
  const w = state.weather;
  w.cloudCover = drift(w.cloudCover, state.rng.next(), cloudDrift, cloudMean);
  w.windSpeed = drift(w.windSpeed, state.rng.next(), windDrift, windMean);
  w.riverFlow = nextRiverFlow(w.riverFlow, w.cloudCover);
}

/**
 * River flow rises while it rains (cloud cover above the rain threshold,
 * faster the heavier the overcast) and otherwise relaxes toward a dry
 * baseline, so run-of-river output follows multi-day weather.
 */
function nextRiverFlow(flow: number, cloudCover: number): number {
  const { rainCloudThreshold, rainRate, dryRate, dryBaselineFlow } = BALANCE.water;
  if (cloudCover > rainCloudThreshold) {
    const intensity = (cloudCover - rainCloudThreshold) / (1 - rainCloudThreshold);
    return Math.min(1, flow + rainRate * intensity);
  }
  return flow + (dryBaselineFlow - flow) * dryRate;
}

/** Run-of-river output multiplier: a drought halves output, never stops it. */
export function riverFlowFactor(state: SimState): number {
  const { minFlowFactor } = BALANCE.water;
  return minFlowFactor + (1 - minFlowFactor) * state.weather.riverFlow;
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run src/sim/weather.test.ts`
Expected: PASS.

- [ ] **Step 5: Format and commit**

```bash
pnpm format
git add src/sim/weather.ts src/sim/weather.test.ts
git commit -m "feat(sim): rain-driven river flow

River flow rises under heavy cloud and relaxes toward a dry baseline,
giving run-of-river hydro a multi-day rhythm that complements PV.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Hydro generation and pumped storage in the energy balance

**Files:**
- Modify: `src/sim/energy.ts`, `src/sim/tick.ts`, `src/shared/types.ts`
- Test: `src/sim/energy.test.ts`

**Interfaces:**
- Consumes: `riverFlowFactor`, census fields from Task 2, `state.pumpedStorageEnergy`, `totalPumpedStorageCapacity`.
- Produces: `EnergyStats.generation.hydro`, `EnergyStats.pumpedStoredEnergy`, `EnergyStats.pumpedCapacity`; `state.lastEnergy.hydro`; history `stateOfCharge` = combined pools.

- [ ] **Step 1: Write failing tests**

Append to `src/sim/energy.test.ts`:

```ts
describe('hydro and pumped storage', () => {
  function riverState(): SimState {
    const state = makeState();
    state.tick = 0; // midnight: no solar
    state.weather.cloudCover = 0;
    state.weather.windSpeed = 0;
    state.layers.terrain[at(5, 5)] = Terrain.River;
    state.layers.terrain[at(8, 8)] = Terrain.Lake;
    return state;
  }

  it('run-of-river generates day and night, scaled by river flow', () => {
    const state = riverState();
    placePlant(state, at(5, 5), PlantType.RunOfRiver);
    state.weather.riverFlow = 1;
    energyStep(state, { chargingDemand: 0 });
    expect(state.lastEnergy.hydro).toBeCloseTo(BALANCE.energy.hydroPeakOutput, 6);
    state.weather.riverFlow = 0;
    energyStep(state, { chargingDemand: 0 });
    expect(state.lastEnergy.hydro).toBeCloseTo(
      BALANCE.energy.hydroPeakOutput * BALANCE.water.minFlowFactor,
      6,
    );
  });

  it('charges batteries before pumped storage and exports the rest', () => {
    const state = riverState();
    placePlant(state, at(5, 5), PlantType.RunOfRiver);
    placePlant(state, at(8, 7), PlantType.PumpedStorage);
    placePlant(state, at(2, 2), PlantType.Battery);
    state.weather.riverFlow = 1;
    state.money = 1e9;
    // Batteries take up to their power limit first.
    energyStep(state, { chargingDemand: 0 });
    const hydro = BALANCE.energy.hydroPeakOutput;
    const batteryTake = Math.min(hydro, BALANCE.energy.batteryPowerLimit);
    expect(state.storedEnergy).toBeCloseTo(batteryTake * BALANCE.energy.batteryChargeEfficiency, 6);
    expect(state.pumpedStorageEnergy).toBeCloseTo(
      (hydro - batteryTake) * BALANCE.energy.pumpedStorageChargeEfficiency,
      6,
    );
    // Fill the battery; the pumped pool absorbs the whole surplus next.
    state.storedEnergy = BALANCE.energy.batteryCapacity;
    const pumpedBefore = state.pumpedStorageEnergy;
    energyStep(state, { chargingDemand: 0 });
    expect(state.pumpedStorageEnergy).toBeCloseTo(
      pumpedBefore + hydro * BALANCE.energy.pumpedStorageChargeEfficiency,
      6,
    );
    expect(state.lastEnergy.gridExport).toBe(0);
    expect(state.lastEnergy.curtailment).toBe(0);
  });

  it('discharges batteries before pumped storage before biogas', () => {
    const state = riverState();
    placePlant(state, at(8, 7), PlantType.PumpedStorage);
    placePlant(state, at(2, 2), PlantType.Battery);
    placePlant(state, at(3, 2), PlantType.BiogasPlant);
    addBuilding(state, at(4, 2), Zone.Commercial, 3);
    state.storedEnergy = 10;
    state.pumpedStorageEnergy = 1_000;
    energyStep(state, { chargingDemand: 300 });
    expect(state.storedEnergy).toBe(0);
    expect(state.pumpedStorageEnergy).toBeLessThan(1_000);
    expect(state.pumpedStorageEnergy).toBeGreaterThanOrEqual(
      1_000 - BALANCE.energy.pumpedStoragePowerLimit,
    );
    expect(state.lastEnergy.biogas).toBeGreaterThan(0);
  });

  it('clamps pumped storage to installed capacity', () => {
    const state = riverState();
    placePlant(state, at(8, 7), PlantType.PumpedStorage);
    state.pumpedStorageEnergy = 1e9;
    energyStep(state, { chargingDemand: 0 });
    expect(state.pumpedStorageEnergy).toBeLessThanOrEqual(BALANCE.energy.pumpedStorageCapacity);
    const noPlants = makeState();
    noPlants.pumpedStorageEnergy = 500;
    energyStep(noPlants, { chargingDemand: 0 });
    expect(noPlants.pumpedStorageEnergy).toBe(0);
  });

  it('history state of charge combines both pools', () => {
    const state = riverState();
    placePlant(state, at(8, 7), PlantType.PumpedStorage);
    placePlant(state, at(2, 2), PlantType.Battery);
    state.storedEnergy = BALANCE.energy.batteryCapacity;
    state.pumpedStorageEnergy = 0;
    state.tick = TICKS_PER_DAY; // multiple of the history sample interval, midnight
    energyStep(state, { chargingDemand: 0 });
    const last = state.energyHistory[state.energyHistory.length - 1];
    const combined =
      state.storedEnergy /
      (BALANCE.energy.batteryCapacity + BALANCE.energy.pumpedStorageCapacity);
    expect(last.stateOfCharge).toBeCloseTo(combined, 6);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/sim/energy.test.ts`
Expected: the new tests FAIL (`hydro` undefined, pumped storage never changes).

- [ ] **Step 3: Types**

In `src/shared/types.ts` `EnergyStats`:

```ts
  generation: { solar: number; wind: number; biogas: number; rooftop: number; hydro: number };
  ...
  /** Energy stored in pumped storage plants (second pool). */
  pumpedStoredEnergy: number;
  /** Installed pumped storage capacity. */
  pumpedCapacity: number;
```

Update the `stateOfCharge` doc comment on `EnergyHistoryPoint` to "Combined state of charge of batteries and pumped storage, 0..1".

- [ ] **Step 4: Energy step**

In `src/sim/energy.ts` import `riverFlowFactor` from `./weather.ts`. Add two pool helpers above `energyStep`:

```ts
/** Absorb surplus into a storage pool within its power limit and headroom. */
function chargePool(
  stored: number,
  capacity: number,
  powerLimit: number,
  efficiency: number,
  surplus: number,
): { stored: number; absorbed: number } {
  const headroom = Math.max(0, capacity - stored);
  const absorbed = Math.max(0, Math.min(surplus, powerLimit, headroom / efficiency));
  return { stored: stored + absorbed * efficiency, absorbed };
}

/** Release stored energy toward a shortfall within the power limit. */
function dischargePool(
  stored: number,
  powerLimit: number,
  shortfall: number,
): { stored: number; released: number } {
  const released = Math.max(0, Math.min(shortfall, powerLimit, stored));
  return { stored: stored - released, released };
}
```

Then in `energyStep`:

```ts
  const hydro = census.runOfRiverPlants * BALANCE.energy.hydroPeakOutput * riverFlowFactor(state);
  ...
  const generation = solar + wind + rooftop + hydro;

  const storageCapacity = census.batteries * BALANCE.energy.batteryCapacity;
  const powerLimit = census.batteries * BALANCE.energy.batteryPowerLimit;
  state.storedEnergy = Math.min(state.storedEnergy, storageCapacity);
  const pumpedCapacity = census.pumpedStoragePlants * BALANCE.energy.pumpedStorageCapacity;
  const pumpedPowerLimit = census.pumpedStoragePlants * BALANCE.energy.pumpedStoragePowerLimit;
  state.pumpedStorageEnergy = Math.min(state.pumpedStorageEnergy, pumpedCapacity);
```

Replace the surplus/deficit branches:

```ts
  const net = generation - totalDemand;
  if (net >= 0) {
    const battery = chargePool(
      state.storedEnergy,
      storageCapacity,
      powerLimit,
      BALANCE.energy.batteryChargeEfficiency,
      net,
    );
    state.storedEnergy = battery.stored;
    const pumped = chargePool(
      state.pumpedStorageEnergy,
      pumpedCapacity,
      pumpedPowerLimit,
      BALANCE.energy.pumpedStorageChargeEfficiency,
      net - battery.absorbed,
    );
    state.pumpedStorageEnergy = pumped.stored;
    const remaining = net - battery.absorbed - pumped.absorbed;
    // Sell what storage cannot absorb; curtail beyond the link.
    gridExport = Math.min(remaining, BALANCE.market.exportCapacity);
    curtailment = remaining - gridExport;
  } else {
    let shortfall = -net;
    const battery = dischargePool(state.storedEnergy, powerLimit, shortfall);
    state.storedEnergy = battery.stored;
    shortfall -= battery.released;
    const pumped = dischargePool(state.pumpedStorageEnergy, pumpedPowerLimit, shortfall);
    state.pumpedStorageEnergy = pumped.stored;
    shortfall -= pumped.released;
    biogas = Math.min(shortfall, census.biogasPlants * BALANCE.energy.biogasMaxOutput);
    shortfall -= biogas;
    // Expensive imports over the limited transmission link come last.
    gridImport = Math.min(shortfall, BALANCE.market.importCapacity);
    shortfall -= gridImport;
    deficit = shortfall;
  }
```

Add `hydro,` to the `state.lastEnergy = {...}` literal. History sample:

```ts
  if (state.tick % TICKS_PER_HISTORY_SAMPLE === 0) {
    const totalCapacity = storageCapacity + pumpedCapacity;
    pushEnergyHistory(state, {
      generation: generation + biogas,
      consumption: totalDemand,
      stateOfCharge:
        totalCapacity > 0 ? (state.storedEnergy + state.pumpedStorageEnergy) / totalCapacity : 0,
    });
  }
```

Update the docblock above `energyStep` to list the order: renewables (solar, wind, rooftop, hydro) → batteries → pumped storage → export → curtail; deficit → batteries → pumped storage → biogas → import → undersupply.

- [ ] **Step 5: Stats and lifetime**

In `src/sim/tick.ts`:
- `recordLifetime`: `sums.generation += e.solar + e.wind + e.rooftop + e.hydro + e.biogas;`
- `buildStats`: add `hydro: e.hydro,` to `generation`, and after `storageCapacity`:
```ts
      pumpedStoredEnergy: state.pumpedStorageEnergy,
      pumpedCapacity: totalPumpedStorageCapacity(state),
```
(import `totalPumpedStorageCapacity` from `./state.ts`).

Run `pnpm typecheck`; fix any other `EnergyStats` literal (search `gridExport:` in `src/ui` and tests).

- [ ] **Step 6: Run the whole sim suite**

Run: `pnpm typecheck && pnpm vitest run src/sim`
Expected: PASS. Existing battery tests must still pass — `chargePool` reproduces the old formula exactly.

- [ ] **Step 7: Format and commit**

```bash
pnpm format
git add src/sim src/shared/types.ts
git commit -m "feat(sim): hydro generation and pumped storage pool

Run-of-river plants add steady generation scaled by river flow. Pumped
storage is a second, larger pool charged after batteries and discharged
before biogas; stats and history report both pools.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Save games carry terrain, river flow and pumped storage

**Files:**
- Modify: `src/shared/types.ts`, `src/sim/state.ts`, `src/storage/serialization.ts`
- Test: `src/sim/state.test.ts`, `src/storage/serialization.test.ts`

**Interfaces:**
- Produces: `SaveGame.layers.terrain?: ArrayBuffer`, `SaveGame.riverFlow?: number`, `SaveGame.pumpedStorageEnergy?: number`.

- [ ] **Step 1: Write failing tests**

Append to `src/sim/state.test.ts`:

```ts
import { BALANCE } from '../shared/constants.ts';
import { deserializeState, serializeState } from './state.ts';

describe('save round trip', () => {
  it('persists terrain, river flow and pumped storage', () => {
    const state = makeState();
    state.weather.riverFlow = 0.8;
    state.pumpedStorageEnergy = 1234;
    const save = serializeState(state);
    const restored = deserializeState(save);
    expect(restored.layers.terrain).toEqual(state.layers.terrain);
    expect(restored.weather.riverFlow).toBe(0.8);
    expect(restored.pumpedStorageEnergy).toBe(1234);
  });

  it('loads older saves without the new fields as dry land', () => {
    const state = makeState();
    const save = serializeState(state);
    delete save.layers.terrain;
    delete save.riverFlow;
    delete save.pumpedStorageEnergy;
    const restored = deserializeState(save);
    expect(restored.layers.terrain.every((t) => t === Terrain.Land)).toBe(true);
    expect(restored.weather.riverFlow).toBe(BALANCE.water.dryBaselineFlow);
    expect(restored.pumpedStorageEnergy).toBe(0);
  });
});
```

Append to `src/storage/serialization.test.ts` (look at its existing `makeSave`/fixture helper and reuse it):

```ts
  it('round-trips the optional terrain layer, river flow and pumped storage', () => {
    const save = makeSave();
    save.layers.terrain = new Uint8Array(save.size * save.size).fill(1).buffer as ArrayBuffer;
    save.riverFlow = 0.6;
    save.pumpedStorageEnergy = 42;
    const restored = saveFromJson(saveToJson(save));
    expect(new Uint8Array(restored.layers.terrain!)).toEqual(new Uint8Array(save.layers.terrain));
    expect(restored.riverFlow).toBe(0.6);
    expect(restored.pumpedStorageEnergy).toBe(42);
  });

  it('accepts exports without the terrain layer', () => {
    const save = makeSave();
    const restored = saveFromJson(saveToJson(save));
    expect(restored.layers.terrain).toBeUndefined();
  });
```

If the test file has no `makeSave` helper, add one that builds a `SaveGame` for size 4 with all seven required layers as zero-filled buffers, `version: SAVE_VERSION`, and numeric fields.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/sim/state.test.ts src/storage/serialization.test.ts`
Expected: FAIL (type errors on `terrain`, values not persisted).

- [ ] **Step 3: Types**

In `src/shared/types.ts` `SaveGame`:

```ts
  /** River flow 0..1 (absent in older saves → dry baseline). */
  riverFlow?: number;
  /** Energy stored in pumped storage plants (absent in older saves). */
  pumpedStorageEnergy?: number;
  layers: {
    ...
    plantType: ArrayBuffer;
    /** Terrain layer; absent in older saves (all land). */
    terrain?: ArrayBuffer;
  };
```

- [ ] **Step 4: Sim serialization**

`serializeState`: add `riverFlow: state.weather.riverFlow,`, `pumpedStorageEnergy: state.pumpedStorageEnergy,` and `terrain: copyBuffer(layers.terrain),` in `layers`.

`deserializeState`:

```ts
  state.pumpedStorageEnergy = save.pumpedStorageEnergy ?? 0;
  state.weather.riverFlow = save.riverFlow ?? BALANCE.water.dryBaselineFlow;
  if (save.layers.terrain) state.layers.terrain.set(new Uint8Array(save.layers.terrain));
```

- [ ] **Step 5: JSON export/import**

In `src/storage/serialization.ts`:
- `SaveGameJson`: add `riverFlow?: number; pumpedStorageEnergy?: number;`.
- `saveToJson`: the `Object.entries(save.layers)` loop already exports `terrain` when present; add
  `...(save.riverFlow !== undefined ? { riverFlow: save.riverFlow } : {}),` and the same for `pumpedStorageEnergy`.
- `saveFromJson`: after the required-layer loop add

```ts
  const terrainEncoded = parsed.layers.terrain;
  if (typeof terrainEncoded === 'string') {
    const buffer = base64ToBuffer(terrainEncoded);
    if (buffer.byteLength !== expectedBytes) {
      throw new Error('Layer "terrain" has the wrong size');
    }
    layers.terrain = buffer;
  }
```

and in the returned object

```ts
    ...(typeof parsed.riverFlow === 'number' ? { riverFlow: parsed.riverFlow } : {}),
    ...(typeof parsed.pumpedStorageEnergy === 'number'
      ? { pumpedStorageEnergy: parsed.pumpedStorageEnergy }
      : {}),
```

- [ ] **Step 6: Run tests**

Run: `pnpm typecheck && pnpm vitest run src/sim/state.test.ts src/storage/serialization.test.ts src/sim/engine.test.ts src/sim/integration.test.ts`
Expected: PASS.

- [ ] **Step 7: Format and commit**

```bash
pnpm format
git add src/shared/types.ts src/sim/state.ts src/sim/state.test.ts src/storage
git commit -m "feat(save): persist terrain, river flow and pumped storage

All three are optional so older saves still load (as dry land with the
baseline river flow). SAVE_VERSION is unchanged.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Hydro goal

**Files:**
- Modify: `src/sim/goals.ts`, `src/sim/goals.test.ts`, `src/ui/i18n.tsx`

- [ ] **Step 1: Write failing test**

Append to `src/sim/goals.test.ts` (reuse its helpers; it builds states via `createSimState` and calls `goalsStep`):

```ts
  it('hydroPower is achieved by the first run-of-river plant', () => {
    const state = createSimState(1, 16);
    goalsStep(state);
    expect(state.goalsAchieved.has('hydroPower')).toBe(false);
    state.layers.terrain[tileIndex(3, 3, 16)] = Terrain.River;
    placePlant(state, tileIndex(3, 3, 16), PlantType.RunOfRiver);
    goalsStep(state);
    expect(state.goalsAchieved.has('hydroPower')).toBe(true);
  });
```

Add the needed imports (`tileIndex`, `Terrain`, `placePlant`, `PlantType`).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/sim/goals.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`src/sim/goals.ts`: add `'hydroPower',` to `GOAL_IDS`; import `countPlants, PlantType` from `./state.ts`; in `goalsStep`:

```ts
  if (!achieved.has('hydroPower') && countPlants(state, PlantType.RunOfRiver) > 0) {
    achieved.add('hydroPower');
  }
```

`src/ui/i18n.tsx` — English (after `goal.exporter.body`):
```ts
  'goal.hydroPower.title': 'Blue power',
  'goal.hydroPower.body': 'Build a run-of-river plant on the river.',
```
German:
```ts
  'goal.hydroPower.title': 'Wasserkraft',
  'goal.hydroPower.body': 'Baue ein Laufwasserkraftwerk am Fluss.',
```

- [ ] **Step 4: Run tests, format, commit**

Run: `pnpm typecheck && pnpm vitest run src/sim/goals.test.ts` → PASS.

```bash
pnpm format
git add src/sim/goals.ts src/sim/goals.test.ts src/ui/i18n.tsx
git commit -m "feat: hydro power goal

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Balance probe and tuning

**Files:**
- Create (temporary, deleted before commit): `src/sim/probe-hydro.test.ts`
- Modify: `src/shared/constants.ts` (only if the probe says so)

- [ ] **Step 1: Write the probe**

```ts
import { it } from 'vitest';
import { TICKS_PER_DAY } from '../shared/constants.ts';
import { tileIndex } from '../shared/grid.ts';
import { PlantType, Terrain, Zone } from '../shared/types.ts';
import { SimEngine } from './engine.ts';

const SIZE = 48;
const at = (x: number, y: number) => tileIndex(x, y, SIZE);

function city(engine: SimEngine): void {
  const road = Array.from({ length: 20 }, (_, x) => at(x + 10, 20));
  engine.applyCommand({ type: 'buildRoad', tiles: road });
  const res: number[] = [];
  const com: number[] = [];
  for (let x = 10; x < 30; x++) {
    res.push(at(x, 19), at(x, 18));
    com.push(at(x, 21));
  }
  engine.applyCommand({ type: 'paintZone', tiles: res, zone: Zone.Residential });
  engine.applyCommand({ type: 'paintZone', tiles: com, zone: Zone.Commercial });
}

function run(label: string, place: (engine: SimEngine) => void): void {
  const engine = new SimEngine(4242, SIZE);
  engine.applyCommand({ type: 'init', seed: 4242, size: SIZE });
  const state = engine.state;
  state.money = 1e9;
  city(engine);
  place(engine);
  state.money = 25_000;
  let deficitTicks = 0;
  let hydroSum = 0;
  let pumpedPeak = 0;
  const days = 30;
  for (let i = 0; i < TICKS_PER_DAY * days; i++) {
    engine.tick();
    if (state.lastEnergy.deficit > 0) deficitTicks++;
    hydroSum += state.lastEnergy.hydro;
    pumpedPeak = Math.max(pumpedPeak, state.pumpedStorageEnergy);
  }
  const ticks = TICKS_PER_DAY * days;
  console.log(
    `${label}: deficit ${((100 * deficitTicks) / ticks).toFixed(1)}% | ` +
      `hydro avg ${(hydroSum / ticks).toFixed(1)} | pumped peak ${pumpedPeak.toFixed(0)} | ` +
      `money ${state.money.toFixed(0)} | pop ${engine.tick().type === 'tick' ? 'ok' : ''} | ` +
      `happiness ${state.happiness.toFixed(2)} | flow ${state.weather.riverFlow.toFixed(2)}`,
  );
}

/** First river / lake-shore tiles near the city, for placement. */
function findRiver(state: SimEngine['state']): number {
  for (let i = 0; i < SIZE * SIZE; i++) if (state.layers.terrain[i] === Terrain.River) return i;
  throw new Error('no river');
}
function findShore(state: SimEngine['state']): number {
  for (let i = 0; i < SIZE * SIZE; i++) {
    if (state.layers.terrain[i] !== Terrain.Land) continue;
    const x = i % SIZE;
    const y = Math.floor(i / SIZE);
    const n = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ];
    if (n.some(([nx, ny]) => nx >= 0 && ny >= 0 && nx < SIZE && ny < SIZE && state.layers.terrain[ny * SIZE + nx] === Terrain.Lake)) return i;
  }
  throw new Error('no shore');
}

it('probe', () => {
  run('solar+wind+battery (baseline)', (e) => {
    e.applyCommand({ type: 'placePlant', tile: at(20, 24), plant: PlantType.SolarFarm });
    e.applyCommand({ type: 'placePlant', tile: at(22, 24), plant: PlantType.SolarFarm });
    e.applyCommand({ type: 'placePlant', tile: at(24, 24), plant: PlantType.WindTurbine });
    e.applyCommand({ type: 'placePlant', tile: at(26, 24), plant: PlantType.Battery });
  });
  run('baseline + 1 run-of-river', (e) => {
    e.applyCommand({ type: 'placePlant', tile: at(20, 24), plant: PlantType.SolarFarm });
    e.applyCommand({ type: 'placePlant', tile: at(22, 24), plant: PlantType.SolarFarm });
    e.applyCommand({ type: 'placePlant', tile: at(24, 24), plant: PlantType.WindTurbine });
    e.applyCommand({ type: 'placePlant', tile: at(26, 24), plant: PlantType.Battery });
    e.applyCommand({ type: 'placePlant', tile: findRiver(e.state), plant: PlantType.RunOfRiver });
  });
  run('baseline + pumped storage', (e) => {
    e.applyCommand({ type: 'placePlant', tile: at(20, 24), plant: PlantType.SolarFarm });
    e.applyCommand({ type: 'placePlant', tile: at(22, 24), plant: PlantType.SolarFarm });
    e.applyCommand({ type: 'placePlant', tile: at(24, 24), plant: PlantType.WindTurbine });
    e.applyCommand({ type: 'placePlant', tile: findShore(e.state), plant: PlantType.PumpedStorage });
  });
  run('2 run-of-river only', (e) => {
    const first = findRiver(e.state);
    e.applyCommand({ type: 'placePlant', tile: first, plant: PlantType.RunOfRiver });
    e.applyCommand({ type: 'placePlant', tile: first + SIZE, plant: PlantType.RunOfRiver });
  });
});
```

Note: the river/lake positions vary by seed; if a placed hydro plant is outside the supply radius of the city, the plant still feeds the global balance (supply radius only gates building connection), which is fine for the probe. If `first + SIZE` is not a river tile, scan for the second river tile instead.

- [ ] **Step 2: Run the probe**

Run: `pnpm vitest run src/sim/probe-hydro.test.ts --reporter=verbose 2>&1 | grep -E "deficit|Error"`

Targets:
- One run-of-river should cut the baseline's deficit share noticeably (roughly a third to a half) without erasing it.
- Pumped storage should reach a peak well above one battery's capacity and improve deficits at least as much as a battery does, while the city stays solvent with its upkeep.
- Two run-of-river plants alone must NOT power the city (deficit share stays high), otherwise hydro is a "solve everything" button.

Adjust `hydroPeakOutput`, `pumpedStorageCapacity`, `pumpedStoragePowerLimit`, hydro costs and upkeep in `BALANCE` until these hold. Re-run `pnpm vitest run src/sim` after any change since energy tests assert against `BALANCE` symbolically (they should keep passing).

- [ ] **Step 3: Delete the probe, commit any tuning**

```bash
rm src/sim/probe-hydro.test.ts
pnpm format
git add src/shared/constants.ts
git commit -m "balance: size hydro output and pumped storage from a 30-day probe

<one line per finding, with the before/after numbers>

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Skip the commit if nothing changed, but still delete the probe.

---

### Task 9: Water rendering, minimap and shared rain threshold

**Files:**
- Create: `src/render/waterMesh.ts`
- Modify: `src/render/scene.ts`, `src/render/renderer.ts`, `src/render/minimapLayer.ts`, `src/render/weatherFx.ts`

**Interfaces:**
- Consumes: `TileDiff.terrain`, `Terrain`, `RenderEnvironment.nightFactor`, `DiffLayer`.
- Produces: `WaterMesh implements DiffLayer`.

- [ ] **Step 1: Palette**

In `src/render/scene.ts` `PALETTE` add:

```ts
  river: 0x4d8fc4,
  lake: 0x3f7fb5,
```

- [ ] **Step 2: Water mesh**

Create `src/render/waterMesh.ts`:

```ts
import * as THREE from 'three';
import type { TileDiff } from '../shared/types.ts';
import { Terrain } from '../shared/types.ts';
import { PALETTE } from './scene.ts';
import type { DiffLayer, RenderEnvironment } from './renderer.ts';

/** Just above the ground plane, below roads (0.05) and the build grid. */
const WATER_HEIGHT = 0.015;
const WOBBLE_AMPLITUDE = 0.06;
const WOBBLE_SPEED = 1.3;
const NIGHT_DIM = 0.55;

/**
 * One flat instanced quad per river or lake tile. Water never changes
 * after map generation, so the mesh only rebuilds when terrain diffs
 * arrive (new game / load). A slow brightness wobble keeps it alive.
 */
export class WaterMesh implements DiffLayer {
  private readonly mesh: THREE.InstancedMesh;
  private readonly material: THREE.MeshLambertMaterial;
  private readonly terrain: Uint8Array;
  private readonly gridSize: number;
  private readonly matrix = new THREE.Matrix4();
  private nightFactor = 0;
  private reducedMotion = false;

  constructor(scene: THREE.Scene, gridSize: number) {
    this.gridSize = gridSize;
    this.terrain = new Uint8Array(gridSize * gridSize);
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.rotateX(-Math.PI / 2);
    this.material = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.mesh = new THREE.InstancedMesh(geometry, this.material, gridSize * gridSize);
    // Instance transforms live across the whole grid; the base geometry's
    // bounds would wrongly cull the mesh, so culling is disabled.
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  applyDiffs(diffs: TileDiff[]): void {
    let changed = false;
    for (const diff of diffs) {
      if (this.terrain[diff.index] !== diff.terrain) {
        this.terrain[diff.index] = diff.terrain;
        changed = true;
      }
    }
    if (changed) this.rebuild();
  }

  setEnvironment(environment: RenderEnvironment): void {
    this.nightFactor = environment.nightFactor;
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
  }

  update(_deltaSeconds: number, nowSeconds: number): void {
    const wobble = this.reducedMotion ? 0 : WOBBLE_AMPLITUDE * Math.sin(nowSeconds * WOBBLE_SPEED);
    const brightness = (1 + wobble) * (1 - NIGHT_DIM * this.nightFactor);
    this.material.color.setScalar(brightness);
  }

  private rebuild(): void {
    const color = new THREE.Color();
    let count = 0;
    for (let index = 0; index < this.terrain.length; index++) {
      const terrain = this.terrain[index];
      if (terrain === Terrain.Land) continue;
      const x = (index % this.gridSize) + 0.5;
      const z = Math.floor(index / this.gridSize) + 0.5;
      this.matrix.identity();
      this.matrix.setPosition(x, WATER_HEIGHT, z);
      this.mesh.setMatrixAt(count, this.matrix);
      this.mesh.setColorAt(count, color.setHex(terrain === Terrain.River ? PALETTE.river : PALETTE.lake));
      count++;
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
```

- [ ] **Step 3: Wire it into the renderer**

In `src/render/renderer.ts` import `WaterMesh` and add `this.addDiffLayer(new WaterMesh(scene, gridSize));` as the FIRST diff layer (before `RoadsMesh`) so bridges draw on top.

- [ ] **Step 4: Minimap**

In `src/render/minimapLayer.ts` import `Terrain` and add to `COLORS`: `river: '#4d8fc4', lake: '#3f7fb5',`. In `tileColor`, before the road check:

```ts
    if (diff.tileType === TileType.Empty && diff.terrain !== Terrain.Land) {
      return diff.terrain === Terrain.River ? COLORS.river : COLORS.lake;
    }
```

- [ ] **Step 5: Shared rain threshold**

In `src/render/weatherFx.ts` replace the `RAIN_THRESHOLD` constant with `import { BALANCE } from '../shared/constants.ts';` and use `BALANCE.water.rainCloudThreshold` in `writeRain`.

- [ ] **Step 6: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: clean. On a machine with WebGL, `pnpm dev` and start a new city: a blue river crosses the map, a lake sits on it, the minimap shows both. In the Linux sandbox use `node scripts/smoke.mjs shot.png` and view the screenshot.

- [ ] **Step 7: Format and commit**

```bash
pnpm format
git add src/render
git commit -m "feat(render): water tiles, minimap water, shared rain threshold

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Bridge rendering

**Files:**
- Modify: `src/render/roadsMesh.ts`

- [ ] **Step 1: Track terrain per tile**

Add `private readonly terrain: Uint8Array;` (allocated `new Uint8Array(gridSize * gridSize)` in the constructor) and record it in `applyDiffs`:

```ts
    for (const diff of diffs) {
      const mask = diff.tileType === TileType.Road ? diff.roadMask : -1;
      if (this.terrain[diff.index] !== diff.terrain) {
        this.terrain[diff.index] = diff.terrain;
        changed = true;
      }
      if (this.roadMasks[diff.index] !== mask) {
        this.roadMasks[diff.index] = mask;
        changed = true;
      }
    }
```

Import `Terrain` from `../shared/types.ts` and `DIR_E, DIR_N, DIR_S, DIR_W` from `../shared/grid.ts`.

- [ ] **Step 2: Deck and railing meshes**

Constants:

```ts
const DECK_COLOR = 0x8a9099;
const RAIL_COLOR = 0xd8d8d0;
const DECK_SIZE = 0.96;
const DECK_HEIGHT = 0.04;
const RAIL_THICKNESS = 0.06;
const RAIL_HEIGHT = 0.14;
```

In the constructor, after the lamp meshes:

```ts
    const deckGeometry = new THREE.BoxGeometry(1, 1, 1);
    this.decks = new THREE.InstancedMesh(
      deckGeometry,
      new THREE.MeshLambertMaterial({ color: DECK_COLOR }),
      gridSize * gridSize,
    );
    // Instance transforms live across the whole grid; the base geometry's
    // bounds would wrongly cull the mesh, so culling is disabled.
    this.decks.frustumCulled = false;
    this.decks.count = 0;
    scene.add(this.decks);

    this.rails = new THREE.InstancedMesh(
      deckGeometry,
      new THREE.MeshLambertMaterial({ color: RAIL_COLOR }),
      gridSize * gridSize * 2,
    );
    // Instance transforms live across the whole grid; the base geometry's
    // bounds would wrongly cull the mesh, so culling is disabled.
    this.rails.frustumCulled = false;
    this.rails.count = 0;
    scene.add(this.rails);
```

with fields `private readonly decks: THREE.InstancedMesh; private readonly rails: THREE.InstancedMesh;`.

- [ ] **Step 3: Rebuild bridges**

Call `this.rebuildBridges();` at the end of `rebuild()` and add:

```ts
  /**
   * Roads on river tiles are bridges: a deck slab under the road pad and
   * a railing on each side of the carriageway. Crossings and isolated
   * tiles get the deck only.
   */
  private rebuildBridges(): void {
    let deckCount = 0;
    let railCount = 0;
    for (let index = 0; index < this.roadMasks.length; index++) {
      const mask = this.roadMasks[index];
      if (mask < 0 || this.terrain[index] !== Terrain.River) continue;
      const x = (index % this.gridSize) + 0.5;
      const z = Math.floor(index / this.gridSize) + 0.5;
      this.matrix.makeScale(DECK_SIZE, DECK_HEIGHT, DECK_SIZE);
      this.matrix.setPosition(x, DECK_HEIGHT / 2, z);
      this.decks.setMatrixAt(deckCount++, this.matrix);

      const alongZ = (mask & (DIR_N | DIR_S)) !== 0 && (mask & (DIR_E | DIR_W)) === 0;
      const alongX = (mask & (DIR_E | DIR_W)) !== 0 && (mask & (DIR_N | DIR_S)) === 0;
      if (!alongZ && !alongX) continue;
      const offset = DECK_SIZE / 2 - RAIL_THICKNESS / 2;
      for (const side of [-1, 1]) {
        if (alongZ) {
          this.matrix.makeScale(RAIL_THICKNESS, RAIL_HEIGHT, DECK_SIZE);
          this.matrix.setPosition(x + side * offset, RAIL_HEIGHT / 2, z);
        } else {
          this.matrix.makeScale(DECK_SIZE, RAIL_HEIGHT, RAIL_THICKNESS);
          this.matrix.setPosition(x, RAIL_HEIGHT / 2, z + side * offset);
        }
        this.rails.setMatrixAt(railCount++, this.matrix);
      }
    }
    this.decks.count = deckCount;
    this.rails.count = railCount;
    this.decks.instanceMatrix.needsUpdate = true;
    this.rails.instanceMatrix.needsUpdate = true;
  }
```

- [ ] **Step 4: Verify and commit**

Run: `pnpm typecheck && pnpm lint`. Visual check on a WebGL machine: drag a road across the river; the river tiles under it show a grey deck with light railings, the road pad on top; cars cross at road height.

```bash
pnpm format
git add src/render/roadsMesh.ts
git commit -m "feat(render): bridge decks and railings on river roads

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Hydro plant meshes

**Files:**
- Modify: `src/render/plantsMesh.ts`

- [ ] **Step 1: Track terrain and give parts a placement context**

Add `private readonly terrain: Uint8Array;` (allocated in the constructor) and record `diff.terrain` in `applyDiffs` for every diff (set `changed = true` if it differs — terrain arrives before plants so this is cheap).

Change `plantBoxParts(plant: PlantType)` to `plantBoxParts(plant: PlantType, site: PlantSite)` with:

```ts
/** Where a plant stands: which neighbours are water (for hydro shapes). */
interface PlantSite {
  /** River continues north/south of the tile (else east/west). */
  riverAlongZ: boolean;
  /** Direction to the nearest lake neighbour (0,0 when none). */
  lakeDx: number;
  lakeDz: number;
}
```

Add colours: `weir: 0x9aa3ad, powerhouse: 0x5d6b7a, penstock: 0x7a8593, waterLight: 0x7fb6dd`.

Cases:

```ts
    case PlantType.RunOfRiver: {
      // A weir across the river with a small powerhouse at one bank.
      const across = site.riverAlongZ;
      return [
        {
          sx: across ? 0.96 : 0.3,
          sy: 0.2,
          sz: across ? 0.3 : 0.96,
          ox: 0,
          oy: 0,
          oz: 0,
          color: COLORS.weir,
        },
        {
          sx: across ? 0.9 : 0.08,
          sy: 0.26,
          sz: across ? 0.08 : 0.9,
          ox: 0,
          oy: 0,
          oz: 0,
          color: COLORS.waterLight,
        },
        {
          sx: 0.3,
          sy: 0.34,
          sz: 0.3,
          ox: across ? 0.3 : 0,
          oy: 0,
          oz: across ? 0 : 0.3,
          color: COLORS.powerhouse,
        },
      ];
    }
    case PlantType.PumpedStorage: {
      // Powerhouse with a penstock pipe running toward the lake.
      const alongX = site.lakeDx !== 0;
      return [
        { sx: 0.6, sy: 0.45, sz: 0.5, ox: 0, oy: 0, oz: 0, color: COLORS.powerhouse },
        { sx: 0.66, sy: 0.05, sz: 0.56, ox: 0, oy: 0.45, oz: 0, color: COLORS.batteryFrame },
        {
          sx: alongX ? 0.5 : 0.12,
          sy: 0.1,
          sz: alongX ? 0.12 : 0.5,
          ox: site.lakeDx * 0.3,
          oy: 0.3,
          oz: site.lakeDz * 0.3,
          color: COLORS.penstock,
        },
        {
          sx: alongX ? 0.5 : 0.12,
          sy: 0.1,
          sz: alongX ? 0.12 : 0.5,
          ox: site.lakeDx * 0.3,
          oy: 0.16,
          oz: site.lakeDz * 0.3,
          color: COLORS.penstock,
        },
      ];
    }
```

In `rebuild()`, compute the site per plant before calling `plantBoxParts`:

```ts
      const site = this.siteOf(index);
      for (const part of plantBoxParts(plant, site)) {
```

with

```ts
  private siteOf(index: number): PlantSite {
    const size = this.gridSize;
    const x = index % size;
    const y = Math.floor(index / size);
    const terrainAt = (tx: number, ty: number): number =>
      tx < 0 || ty < 0 || tx >= size || ty >= size ? Terrain.Land : this.terrain[ty * size + tx];
    const riverAlongZ =
      terrainAt(x, y - 1) === Terrain.River || terrainAt(x, y + 1) === Terrain.River;
    let lakeDx = 0;
    let lakeDz = 0;
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      if (terrainAt(x + dx, y + dz) === Terrain.Lake) {
        lakeDx = dx;
        lakeDz = dz;
        break;
      }
    }
    return { riverAlongZ, lakeDx, lakeDz };
  }
```

Import `Terrain` from `../shared/types.ts`. `MAX_BOX_PARTS_PER_PLANT` (8) still covers the new parts (max 4).

- [ ] **Step 2: Verify and commit**

Run: `pnpm typecheck && pnpm lint`. Visual check: run-of-river shows a weir across the river with a small powerhouse; pumped storage sits on the shore with pipes pointing at the lake.

```bash
pnpm format
git add src/render/plantsMesh.ts
git commit -m "feat(render): run-of-river weir and pumped storage meshes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Tools, energy panel, help and strings

**Files:**
- Modify: `src/ui/useTools.ts`, `src/ui/Toolbar.tsx`, `src/ui/EnergyPanel.tsx`, `src/ui/App.tsx`, `src/ui/HelpPage.tsx`, `src/ui/i18n.tsx`

- [ ] **Step 1: Tools**

`src/ui/useTools.ts`:
- `ToolId` union: add `| 'plant-hydro' | 'plant-pumped'` before `'bulldoze'`.
- `TOOL_HOTKEYS`: add `h: 'plant-hydro', u: 'plant-pumped',`.
- `PLANT_BY_TOOL`: add `'plant-hydro': PlantType.RunOfRiver, 'plant-pumped': PlantType.PumpedStorage,`.
- Hover radius: both are supply sources, so the existing `else` branch (supply radius) already applies. No change.

`src/ui/Toolbar.tsx` `TOOLS`, after `plant-park`:

```ts
  { id: 'plant-hydro', icon: '💧', cost: BALANCE.costs.plant[PlantType.RunOfRiver] },
  { id: 'plant-pumped', icon: '🏔', cost: BALANCE.costs.plant[PlantType.PumpedStorage] },
```

- [ ] **Step 2: Energy panel**

`src/ui/EnergyPanel.tsx`: signature `EnergyPanel({ energy, riverFlow }: { energy: EnergyStats; riverFlow: number })`. Include hydro in `totalGeneration`. After the wind row:

```tsx
        <div className="energy-row" data-testid="energy-hydro">
          <span>{t('energy.hydro', { flow: Math.round(riverFlow * 100) })}</span>
          <span>{formatEnergy(energy.generation.hydro)}</span>
        </div>
```

After the battery `soc-block`, a second block shown only when installed:

```tsx
      {energy.pumpedCapacity > 0 && (
        <div className="soc-block" data-testid="energy-pumped-soc">
          <div className="soc-label">
            <span>{t('energy.pumpedStorage')}</span>
            <span>{`${Math.round((energy.pumpedStoredEnergy / energy.pumpedCapacity) * 100)}%`}</span>
          </div>
          <div className="soc-track">
            <div
              className="soc-fill"
              style={{ width: `${(energy.pumpedStoredEnergy / energy.pumpedCapacity) * 100}%` }}
            />
          </div>
        </div>
      )}
```

`src/ui/App.tsx` line ~242: `<EnergyPanel energy={stats.energy} riverFlow={stats.weather.riverFlow} />`.

- [ ] **Step 3: Help**

`src/ui/HelpPage.tsx` `SECTIONS`: insert `{ title: 'help.water.title', body: 'help.water.body' },` after the energy section.

- [ ] **Step 4: Strings**

`src/ui/i18n.tsx` English:

```ts
  'tool.plant-hydro': 'Run-of-river plant',
  'tool.plant-pumped': 'Pumped storage',
  'energy.hydro': '💧 Hydro (flow {flow}%)',
  'energy.pumpedStorage': 'Pumped storage (SoC)',
  'rejection.needsRiverTile': 'Run-of-river plants must stand on a river tile',
  'rejection.needsLakeShore': 'Pumped storage must stand on the lake shore',
  'rejection.cannotBuildOnWater': 'Cannot build on water',
  'help.water.title': 'Water and hydro',
  'help.water.body':
    'Every map has a river and a lake. Roads cross the river as bridges (pricier per tile). A run-of-river plant on the river generates day and night — more after rainy spells, less in a drought. Pumped storage on the lake shore is a large but slower store that fills after your batteries.',
```

German:

```ts
  'tool.plant-hydro': 'Laufwasserkraftwerk',
  'tool.plant-pumped': 'Pumpspeicher',
  'energy.hydro': '💧 Wasserkraft (Abfluss {flow}%)',
  'energy.pumpedStorage': 'Pumpspeicher (Ladestand)',
  'rejection.needsRiverTile': 'Laufwasserkraftwerke müssen auf einem Flussfeld stehen',
  'rejection.needsLakeShore': 'Pumpspeicher müssen am Seeufer stehen',
  'rejection.cannotBuildOnWater': 'Auf Wasser kann nicht gebaut werden',
  'help.water.title': 'Wasser und Wasserkraft',
  'help.water.body':
    'Jede Karte hat einen Fluss und einen See. Straßen überqueren den Fluss als Brücken (teurer pro Feld). Ein Laufwasserkraftwerk auf dem Fluss erzeugt Tag und Nacht Strom — mehr nach Regenphasen, weniger in Trockenzeiten. Ein Pumpspeicher am Seeufer ist ein großer, aber trägerer Speicher, der sich nach den Batterien füllt.',
```

`de` is typed `Record<TranslationKey, string>` so the typechecker enforces both locales.

- [ ] **Step 5: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm test`. Visual: toolbar shows two new tools with hotkeys H and U; placing a solar farm on water shows the "Cannot build on water" toast; the energy panel shows the hydro row with the flow percentage and, once a pumped storage plant exists, a second state-of-charge bar.

- [ ] **Step 6: Format and commit**

```bash
pnpm format
git add src/ui
git commit -m "feat(ui): hydro tools, energy panel rows, help and strings

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: e2e assertion, README, final verification

**Files:**
- Modify: `e2e/game.spec.ts`, `README.md`

- [ ] **Step 1: e2e**

In `e2e/game.spec.ts`, in the test that asserts `energy-panel` is visible (line ~72), add:

```ts
  await expect(page.getByTestId('energy-hydro')).toBeVisible();
```

- [ ] **Step 2: README**

In the Gameplay list of `README.md`, after the "Power the city" bullet add:

```md
- **Water**: every map has a seeded river and lake. Bridge the river with
  the road tool, build run-of-river plants on it (output follows rain
  and drought) and pumped storage on the lake shore — a big, slow store
  that fills after your batteries.
```

Also mention the new hotkeys in the Controls section if it lists them (H run-of-river, U pumped storage).

- [ ] **Step 3: Full verification**

Run, in order:

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm coverage
pnpm build
pnpm e2e   # on a machine with WebGL / Chromium available
```

All must pass. If coverage dips below 90 % on `src/sim`, the usual gap is `water.ts` branches (wide sections, candidate fallback) — add a targeted test rather than lowering the gate.

- [ ] **Step 4: Commit**

```bash
git add e2e/game.spec.ts README.md
git commit -m "test+docs: hydro row e2e check, README water section

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review notes

- Spec §1 (terrain, generation, buildability, bridges) → Tasks 1–3. §2 (plants, river flow, balance order, stats) → Tasks 2, 4, 5. §3 (rendering, tools, panel, help, strings) → Tasks 9–12. §4 (saves, goal, tests, probe, e2e, README) → Tasks 6, 7, 8, 13.
- Growth guard (Task 2 step 7) is belt-and-braces: zones can never be painted on water, so growth cannot spawn there; the one-line guard documents the invariant.
- Bridge drag-cost preview intentionally stays at the road price (spec §3: "the drag preview stays as is").
- `WATER_SEED_SALT` keeps `state.rng` untouched so every existing determinism test and the loaded-save RNG reseed remain valid.
