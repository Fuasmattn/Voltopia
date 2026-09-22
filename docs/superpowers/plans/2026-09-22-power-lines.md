# Power Lines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Power lines replace the plant supply radius: a building is supplied only when it sits within a small radius of a supply plant or of a line tile that a line network connects to a supply plant.

**Architecture:** A new `powerLine` bitmask layer (presence bit + 4 neighbour bits) lives beside `roadMask`; lines may share tiles with roads and water but never with buildings or plants. `recomputeGrid` flood-fills from every supply plant over line tiles and stamps a Chebyshev radius into a derived `energized` layer, and only reruns when `gridVersion` changed. The energy tick reads `energized` instead of measuring distances. Old saves without the layer get lines on every road tile reachable from a plant. Rendering, tool and strings follow the road patterns.

**Tech Stack:** TypeScript strict, React 19, three.js, Vitest, Playwright, pnpm. Spec: `docs/superpowers/specs/2026-09-22-power-lines-design.md`.

## Global Constraints

- `src/sim/` has no DOM or three.js imports; all randomness through seeded `Rng`.
- No magic numbers in sim code: every tuning value lives in `BALANCE` (`src/shared/constants.ts`).
- Every user-visible string goes through `src/ui/i18n.tsx` in BOTH English and German.
- New `InstancedMesh` → `frustumCulled = false`.
- `SaveGame` stays backward compatible: `layers.powerLine` is optional, `SAVE_VERSION` unchanged.
- Worker ↔ main: commands in, tile diffs + `GlobalStats` out — never the full state.
- React effects depend on stable identities (`bridge.send`), never on the `bridge` object.
- Run `pnpm format` after edits; pre-commit runs `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test`. Never `--no-verify`.
- Coverage ≥ 90 % on `src/sim` + `src/shared` (`pnpm coverage`).
- Commit messages: imperative summary + short body, end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- If `git commit` fails with "Author identity unknown" (Linux sandbox), commit with `git -c user.name="Thorsten Rinne" -c user.email="thorsten@rinne.info" commit …`.
- The Linux sandbox cannot launch Chromium: `pnpm e2e` and visual checks run on the Mac or in CI only. Never claim they ran here.
- Do not `git add` the untracked file `core` in the repo root. Stage files explicitly.
- Line mask encoding (shared by sim, save and renderer): value `0` = no line; otherwise bit `LINE_PRESENT` (16) is set and the low four bits are neighbour connections `DIR_N=1, DIR_E=2, DIR_S=4, DIR_W=8`.

## File Map

| File                                                                              | Change                                                                                                                                                                               |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/shared/types.ts`                                                             | `TileDiff.powerLine`, `SaveGame.layers.powerLine?`, `TileCounts.powerLineTiles`                                                                                                      |
| `src/shared/messages.ts`                                                          | `buildPowerLine` command                                                                                                                                                             |
| `src/shared/grid.ts`                                                              | `LINE_PRESENT`                                                                                                                                                                       |
| `src/shared/constants.ts`                                                         | line costs, line upkeep, `lineSupplyRadius`; `supplyRadius` deleted (Task 2)                                                                                                         |
| `src/sim/state.ts`                                                                | `powerLine`/`energized` layers, `gridVersion`, `BuildIntent.PowerLine`, `buildRejection` rules, `snapshotTile`/`withNeighbors` moved here, `bumpGridVersion`, save (de)serialization |
| `src/sim/powerLines.ts` (new) + test                                              | build/clear lines, masks, tile cost, counts                                                                                                                                          |
| `src/sim/powerGrid.ts` (new) + test                                               | `isSupplySource`, `recomputeGrid`, `grantLegacyNetwork`                                                                                                                              |
| `src/sim/roads.ts`                                                                | bulldozer clears lines first; undo restores lines; helpers moved out                                                                                                                 |
| `src/sim/energy.ts`                                                               | `placePlant` bumps grid version; `energyStep` reads `energized`; `isConnected`/`supplySources` deleted                                                                               |
| `src/sim/zones.ts`, `growth.ts`, `economy.ts`, `tick.ts`, `engine.ts`, `goals.ts` | snapshot helper, growth guard, line upkeep, tile counts, command, goal                                                                                                               |
| `src/storage/serialization.ts` + test                                             | optional `powerLine` layer in JSON export/import                                                                                                                                     |
| `src/render/powerLinesMesh.ts` (new), `renderer.ts`, `minimapLayer.ts`            | pylons and cables, wiring, minimap dot                                                                                                                                               |
| `src/ui/useTools.ts`, `Toolbar.tsx`, `Tutorial.tsx`, `HelpPage.tsx`, `i18n.tsx`   | tool, hover radius, tutorial step, help section, strings                                                                                                                             |
| `e2e/game.spec.ts`, `README.md`, `docs/idea.md`                                   | line drag test, docs                                                                                                                                                                 |

---

### Task 1: Line layer, build rules, building and clearing lines

**Files:**

- Modify: `src/shared/types.ts`, `src/shared/messages.ts`, `src/shared/grid.ts`, `src/shared/constants.ts`, `src/sim/state.ts`, `src/sim/roads.ts`, `src/sim/energy.ts`, `src/sim/zones.ts`, `src/sim/growth.ts`, `src/sim/economy.ts`, `src/sim/tick.ts`, `src/sim/engine.ts`
- Create: `src/sim/powerLines.ts`
- Test: `src/sim/powerLines.test.ts` (new), `src/sim/state.test.ts`, `src/sim/economy.test.ts`, `src/sim/growth.test.ts`, `src/sim/energy.test.ts`

**Interfaces:**

- Produces: `LINE_PRESENT = 16` (`src/shared/grid.ts`); `BuildIntent.PowerLine`; `SimState.gridVersion` / `gridComputedVersion`; `bumpGridVersion(state)`; `snapshotTile(state, index)`, `withNeighbors(state, tiles): Set<number>` (exported from `state.ts`); `buildPowerLines(state, tiles): BuildResult`, `clearPowerLines(state, tiles): void`, `recomputePowerLineMask(state, index)`, `powerLineTileCost(state, index): number`, `hasPowerLines(state): boolean`, `countPowerLineTiles(state): number` (`src/sim/powerLines.ts`); `SimCommand { type: 'buildPowerLine'; tiles: number[] }`; `TileDiff.powerLine`; `TileCounts.powerLineTiles`.

- [ ] **Step 1: Shared types, command, mask bit and balance values**

`src/shared/grid.ts`, after `DIR_W`:

```ts
/**
 * Power line presence bit. A line tile's mask is LINE_PRESENT | connection
 * bits (DIR_*), so an isolated line tile (no connections) is still != 0.
 */
export const LINE_PRESENT = 16;
```

`src/shared/types.ts`:

- `TileCounts`: add `powerLineTiles: number;` after `buildingTiles`.
- `TileDiff`: after `roadMask` add
  ```ts
  /** Power line mask: 0 = none, else LINE_PRESENT | connection bits (N=1, E=2, S=4, W=8). */
  powerLine: number;
  ```
- `SaveGame.layers`: after `terrain?: ArrayBuffer;` add
  ```ts
      /** Power line layer; absent in saves from before power lines. */
      powerLine?: ArrayBuffer;
  ```

`src/shared/messages.ts`, in `SimCommand` after the `buildRoad` member:

```ts
  | { type: 'buildPowerLine'; tiles: number[] }
```

`src/shared/constants.ts`:

- `costs`: after `bridgePerTile: 40,` add
  ```ts
      /** Power line per tile on land; over river or lake it is an overhead crossing. */
      powerLinePerTile: 4,
      powerLineWaterPerTile: 12,
  ```
- `upkeepPerTick`: after `roadPerTile: 0.005,` add
  ```ts
      powerLinePerTile: 0.0005,
  ```
- `energy`: after the `supplyRadius: 14,` line (kept until Task 2) add

  ```ts
      /**
       * Tiles around an energised line tile or a supply plant that count as
       * connected (Chebyshev distance).
       */
      lineSupplyRadius: 3,
  ```

- [ ] **Step 2: Write the failing tests**

Create `src/sim/powerLines.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../shared/constants.ts';
import { DIR_E, DIR_W, LINE_PRESENT, tileIndex } from '../shared/grid.ts';
import { PlantType, Terrain } from '../shared/types.ts';
import { placePlant } from './energy.ts';
import { buildPowerLines, countPowerLineTiles, hasPowerLines } from './powerLines.ts';
import { buildRoads, bulldozeTiles, undoLastAction } from './roads.ts';
import { collectDiffs, createSimState, TileType, type SimState } from './state.ts';

const SIZE = 16;
const at = (x: number, y: number) => tileIndex(x, y, SIZE);

function makeState(): SimState {
  const state = createSimState(1, SIZE);
  state.layers.terrain[at(8, 5)] = Terrain.River;
  return state;
}

describe('buildPowerLines', () => {
  it('places an isolated line tile with the presence bit and no connections', () => {
    const state = makeState();
    expect(buildPowerLines(state, [at(5, 5)]).rejected).toBeUndefined();
    expect(state.layers.powerLine[at(5, 5)]).toBe(LINE_PRESENT);
    expect(hasPowerLines(state)).toBe(true);
    expect(countPowerLineTiles(state)).toBe(1);
  });

  it('connects adjacent line tiles in both directions', () => {
    const state = makeState();
    buildPowerLines(state, [at(5, 5), at(6, 5)]);
    expect(state.layers.powerLine[at(5, 5)]).toBe(LINE_PRESENT | DIR_E);
    expect(state.layers.powerLine[at(6, 5)]).toBe(LINE_PRESENT | DIR_W);
  });

  it('charges the land price on land and the water price over the river', () => {
    const state = makeState();
    const before = state.money;
    buildPowerLines(state, [at(7, 5), at(8, 5)]);
    expect(state.money).toBe(
      before - BALANCE.costs.powerLinePerTile - BALANCE.costs.powerLineWaterPerTile,
    );
  });

  it('never charges twice for a tile that already carries a line', () => {
    const state = makeState();
    buildPowerLines(state, [at(5, 5)]);
    const before = state.money;
    buildPowerLines(state, [at(5, 5), at(6, 5)]);
    expect(state.money).toBe(before - BALANCE.costs.powerLinePerTile);
  });

  it('rejects the whole drag when money is short', () => {
    const state = makeState();
    state.money = BALANCE.costs.powerLinePerTile - 1;
    expect(buildPowerLines(state, [at(5, 5)]).rejected).toBe('notEnoughMoney');
    expect(state.layers.powerLine[at(5, 5)]).toBe(0);
  });

  it('runs over road tiles but not over plants', () => {
    const state = makeState();
    buildRoads(state, [at(5, 5)]);
    placePlant(state, at(6, 6), PlantType.SolarFarm);
    buildPowerLines(state, [at(5, 5), at(6, 6)]);
    expect(state.layers.powerLine[at(5, 5)]).toBe(LINE_PRESENT);
    expect(state.layers.powerLine[at(6, 6)]).toBe(0);
    expect(state.layers.tileType[at(5, 5)]).toBe(TileType.Road);
  });

  it('bumps the grid version so connectivity is recomputed', () => {
    const state = makeState();
    const before = state.gridVersion;
    buildPowerLines(state, [at(5, 5)]);
    expect(state.gridVersion).toBe(before + 1);
  });

  it('reports the line mask in tile diffs', () => {
    const state = makeState();
    collectDiffs(state);
    buildPowerLines(state, [at(5, 5)]);
    const diff = collectDiffs(state).find((d) => d.index === at(5, 5));
    expect(diff?.powerLine).toBe(LINE_PRESENT);
  });
});

describe('bulldozer and undo with lines', () => {
  it('clears only the line on a road tile; a second pass clears the road', () => {
    const state = makeState();
    buildRoads(state, [at(5, 5)]);
    buildPowerLines(state, [at(5, 5)]);
    bulldozeTiles(state, [at(5, 5)]);
    expect(state.layers.powerLine[at(5, 5)]).toBe(0);
    expect(state.layers.tileType[at(5, 5)]).toBe(TileType.Road);
    bulldozeTiles(state, [at(5, 5)]);
    expect(state.layers.tileType[at(5, 5)]).toBe(TileType.Empty);
  });

  it('clearing a line updates the neighbours connection bits', () => {
    const state = makeState();
    buildPowerLines(state, [at(5, 5), at(6, 5), at(7, 5)]);
    bulldozeTiles(state, [at(6, 5)]);
    expect(state.layers.powerLine[at(5, 5)]).toBe(LINE_PRESENT);
    expect(state.layers.powerLine[at(7, 5)]).toBe(LINE_PRESENT);
  });

  it('bulldozing a line bumps the grid version', () => {
    const state = makeState();
    buildPowerLines(state, [at(5, 5)]);
    const before = state.gridVersion;
    bulldozeTiles(state, [at(5, 5)]);
    expect(state.gridVersion).toBe(before + 1);
  });

  it('undo restores the line, its neighbours and the money', () => {
    const state = makeState();
    buildPowerLines(state, [at(5, 5)]);
    const money = state.money;
    buildPowerLines(state, [at(6, 5)]);
    expect(undoLastAction(state).rejected).toBeUndefined();
    expect(state.money).toBe(money);
    expect(state.layers.powerLine[at(6, 5)]).toBe(0);
    expect(state.layers.powerLine[at(5, 5)]).toBe(LINE_PRESENT);
  });

  it('undo bumps the grid version', () => {
    const state = makeState();
    buildPowerLines(state, [at(5, 5)]);
    const before = state.gridVersion;
    undoLastAction(state);
    expect(state.gridVersion).toBe(before + 1);
  });
});
```

Append to the `describe('buildRejection', …)` block in `src/sim/state.test.ts`:

```ts
it('accepts power lines on land, roads, river and lake but not on plants or buildings', () => {
  const state = makeState();
  expect(buildRejection(state, at(1, 1), BuildIntent.PowerLine)).toBeNull();
  expect(buildRejection(state, at(5, 5), BuildIntent.PowerLine)).toBeNull(); // river
  expect(buildRejection(state, at(8, 8), BuildIntent.PowerLine)).toBeNull(); // lake
  state.layers.tileType[at(2, 2)] = TileType.Road;
  expect(buildRejection(state, at(2, 2), BuildIntent.PowerLine)).toBeNull();
  state.layers.tileType[at(3, 3)] = TileType.Plant;
  expect(buildRejection(state, at(3, 3), BuildIntent.PowerLine)).toBe('needsLineSite');
  state.layers.density[at(4, 4)] = 1;
  expect(buildRejection(state, at(4, 4), BuildIntent.PowerLine)).toBe('needsLineSite');
});

it('keeps zones and plants off line tiles while roads may share them', () => {
  const state = makeState();
  state.layers.powerLine[at(1, 1)] = 16;
  expect(buildRejection(state, at(1, 1), BuildIntent.Road)).toBeNull();
  expect(buildRejection(state, at(1, 1), BuildIntent.Zone)).toBe('tileOccupied');
  expect(buildRejection(state, at(1, 1), BuildIntent.Plant, PlantType.SolarFarm)).toBe(
    'tileOccupied',
  );
});
```

Append to `src/sim/economy.test.ts` inside its first `describe` (it already has `SIZE`, `at`, `BALANCE`, `createSimState` and `economyStep`; add `import { buildPowerLines } from './powerLines.ts';`):

```ts
it('charges upkeep per power line tile alongside road upkeep', () => {
  const state = createSimState(1, SIZE);
  buildPowerLines(state, [at(1, 1), at(2, 1)]);
  const breakdown = economyStep(state, 0, 0);
  expect(breakdown.roadUpkeep).toBeCloseTo(2 * BALANCE.upkeepPerTick.powerLinePerTile, 9);
});
```

Append to the `describe('growthStep', …)` block in `src/sim/growth.test.ts` (add `import { buildPowerLines } from './powerLines.ts';`; `cityWithRoad`, `runGrowth`, `totalDensity` already exist there):

```ts
it('never spawns a building on a tile that carries a power line', () => {
  const state = cityWithRoad();
  const zoned: number[] = [];
  for (let i = 0; i < state.layers.zone.length; i++) {
    if (state.layers.zone[i] !== Zone.None) zoned.push(i);
  }
  expect(zoned.length).toBeGreaterThan(0);
  state.money = 1e9;
  buildPowerLines(state, zoned);
  runGrowth(state, 500);
  expect(totalDensity(state, Zone.Residential)).toBe(0);
});
```

In `src/sim/energy.test.ts` the `censusPlants` test (around line 84) asserts `census.supplySources` — leave it for Task 2, which removes that field.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run src/sim/powerLines.test.ts src/sim/state.test.ts src/sim/economy.test.ts src/sim/growth.test.ts`
Expected: FAIL — `./powerLines.ts` cannot be resolved; `BuildIntent.PowerLine` undefined; `needsLineSite` not returned.

- [ ] **Step 4: State: layers, version, intent, rules, helpers**

`src/sim/state.ts`:

1. `UndoEntry.tiles` element type: add `powerLine: number;` after `roadMask: number;`.
2. `TileLayers`: after `terrain: Uint8Array;` add
   ```ts
   /** Power line mask per tile (0 = none, else LINE_PRESENT | connection bits). */
   powerLine: Uint8Array;
   /** 1 when the tile is within lineSupplyRadius of an energised line or supply plant. Derived, not persisted. */
   energized: Uint8Array;
   ```
   and in `createTileLayers` add `powerLine: new Uint8Array(tiles),` and `energized: new Uint8Array(tiles),`.
3. `SimState`: after `pumpedStorageEnergy: number;` add
   ```ts
   /** Incremented whenever plants or power lines change; drives recomputeGrid. */
   gridVersion: number;
   /** gridVersion the energized layer was last computed for (-1 = never). */
   gridComputedVersion: number;
   ```
   and in `createSimState` add `gridVersion: 0,` and `gridComputedVersion: -1,` after `pumpedStorageEnergy: 0,`.
4. After `markDirty` add:
   ```ts
   /** Plants or lines changed: the energized layer must be recomputed. */
   export function bumpGridVersion(state: SimState): void {
     state.gridVersion++;
   }

   /** Snapshot one tile's buildable layers for undo. */
   export function snapshotTile(state: SimState, index: number): UndoEntry['tiles'][number] {
     const { layers } = state;
     return {
       index,
       tileType: layers.tileType[index],
       roadMask: layers.roadMask[index],
       powerLine: layers.powerLine[index],
       zone: layers.zone[index],
       density: layers.density[index],
       variant: layers.variant[index],
       plantType: layers.plantType[index],
     };
   }

   /** The given tiles plus their 4-neighbours (deduplicated). */
   export function withNeighbors(state: SimState, tiles: number[]): Set<number> {
     const affected = new Set<number>();
     for (const index of tiles) {
       affected.add(index);
       for (const neighbor of neighbors4(index, state.size)) affected.add(neighbor);
     }
     return affected;
   }
   ```
5. `collectDiffs`: after `roadMask: layers.roadMask[index],` add `powerLine: layers.powerLine[index],`.
6. `BuildIntent`: `export const BuildIntent = { Road: 0, Zone: 1, Plant: 2, PowerLine: 3 } as const;`
7. Replace the start of `buildRejection` (up to and including the `tileOccupied` return) with:
   ```ts
   const { layers } = state;
   if (intent === BuildIntent.PowerLine) {
     // Lines share tiles with roads and water but never with buildings or plants.
     if (layers.density[index] !== 0 || layers.tileType[index] === TileType.Plant) {
       return 'needsLineSite';
     }
     return null;
   }
   if (layers.tileType[index] !== TileType.Empty || layers.density[index] !== 0) {
     return 'tileOccupied';
   }
   // Zones and plants would collide with a line; roads may share the tile.
   if (intent !== BuildIntent.Road && layers.powerLine[index] !== 0) {
     return 'tileOccupied';
   }
   ```
   Update the docblock: "Power lines are accepted on any terrain and on roads, but not on buildings or plants; zones and plants are rejected on line tiles."

- [ ] **Step 5: `src/sim/powerLines.ts`**

```ts
import { BALANCE } from '../shared/constants.ts';
import { DIRECTIONS, inBounds, LINE_PRESENT, tileIndex, tileX, tileY } from '../shared/grid.ts';
import type { BuildResult } from './roads.ts';
import {
  BuildIntent,
  bumpGridVersion,
  isBuildable,
  markDirty,
  snapshotTile,
  Terrain,
  withNeighbors,
  type SimState,
  type UndoEntry,
} from './state.ts';

/**
 * Recompute a line tile's connection bits from its 4-neighbours. Tiles
 * without a line stay 0; line tiles always keep LINE_PRESENT.
 */
export function recomputePowerLineMask(state: SimState, index: number): void {
  const { layers } = state;
  const previous = layers.powerLine[index];
  if (previous === 0) return;
  let mask = LINE_PRESENT;
  const x = tileX(index, state.size);
  const y = tileY(index, state.size);
  for (const { dx, dy, bit } of DIRECTIONS) {
    if (!inBounds(x + dx, y + dy, state.size)) continue;
    if (layers.powerLine[tileIndex(x + dx, y + dy, state.size)] !== 0) mask |= bit;
  }
  if (mask !== previous) {
    layers.powerLine[index] = mask;
    markDirty(state, index);
  }
}

/** Price of one line tile: overhead crossings over water cost more. */
export function powerLineTileCost(state: SimState, index: number): number {
  return state.layers.terrain[index] === Terrain.Land
    ? BALANCE.costs.powerLinePerTile
    : BALANCE.costs.powerLineWaterPerTile;
}

/**
 * Build power lines on the given tiles. Tiles that already carry a line
 * are kept and not charged again; occupied tiles are skipped.
 */
export function buildPowerLines(state: SimState, tiles: number[]): BuildResult {
  const { layers } = state;
  const buildable = tiles.filter(
    (index) => layers.powerLine[index] === 0 && isBuildable(state, index, BuildIntent.PowerLine),
  );
  if (buildable.length === 0) return {};

  const cost = buildable.reduce((sum, index) => sum + powerLineTileCost(state, index), 0);
  if (cost > state.money) {
    return { rejected: 'notEnoughMoney' };
  }

  const affected = withNeighbors(state, buildable);
  const undo: UndoEntry = {
    moneyDelta: cost,
    tiles: [...affected].map((index) => snapshotTile(state, index)),
  };

  state.money -= cost;
  for (const index of buildable) {
    layers.powerLine[index] = LINE_PRESENT;
    markDirty(state, index);
  }
  for (const index of affected) recomputePowerLineMask(state, index);
  bumpGridVersion(state);

  state.undoStack.push(undo);
  return {};
}

/**
 * Remove the lines from the given tiles; roads, zones and buildings on
 * them stay. The caller owns the undo entry.
 */
export function clearPowerLines(state: SimState, tiles: number[]): void {
  const { layers } = state;
  for (const index of tiles) {
    layers.powerLine[index] = 0;
    markDirty(state, index);
  }
  for (const index of withNeighbors(state, tiles)) recomputePowerLineMask(state, index);
  bumpGridVersion(state);
}

export function hasPowerLines(state: SimState): boolean {
  const { powerLine } = state.layers;
  for (let i = 0; i < powerLine.length; i++) {
    if (powerLine[i] !== 0) return true;
  }
  return false;
}

export function countPowerLineTiles(state: SimState): number {
  const { powerLine } = state.layers;
  let count = 0;
  for (let i = 0; i < powerLine.length; i++) {
    if (powerLine[i] !== 0) count++;
  }
  return count;
}
```

- [ ] **Step 6: Roads: helpers moved, bulldozer clears lines first, undo restores lines**

`src/sim/roads.ts`:

1. Delete the local `snapshotTile` and `withNeighbors` functions; import `snapshotTile`, `withNeighbors`, `bumpGridVersion` from `./state.ts` and `clearPowerLines` from `./powerLines.ts`. (`powerLines.ts` imports only `type BuildResult` from here, so there is no runtime cycle.) Drop the now unused `DIRECTIONS`/`inBounds` imports if `recomputeRoadMask` is the only user — it still needs `DIRECTIONS`, `inBounds`, `tileIndex`, `tileX`, `tileY`; keep those.
2. Replace `bulldozeTiles` with:
   ```ts
   /**
    * Remove roads, zones, buildings and plants from the given tiles. A tile
    * that carries a power line loses only the line; whatever else stands
    * there survives for a second pass.
    */
   export function bulldozeTiles(state: SimState, tiles: number[]): BuildResult {
     const { layers } = state;
     const lineTiles = tiles.filter((index) => layers.powerLine[index] !== 0);
     const clearable = tiles.filter(
       (index) =>
         layers.powerLine[index] === 0 &&
         (layers.tileType[index] !== TileType.Empty ||
           layers.zone[index] !== Zone.None ||
           layers.density[index] !== 0),
     );
     if (lineTiles.length === 0 && clearable.length === 0) return {};

     const affected = withNeighbors(state, [...lineTiles, ...clearable]);
     const undo: UndoEntry = {
       moneyDelta: 0,
       tiles: [...affected].map((index) => snapshotTile(state, index)),
     };

     if (lineTiles.length > 0) clearPowerLines(state, lineTiles);
     for (const index of clearable) {
       layers.tileType[index] = TileType.Empty;
       layers.zone[index] = Zone.None;
       layers.density[index] = 0;
       layers.variant[index] = 0;
       layers.plantType[index] = 0;
       layers.buildingAge[index] = 0;
       markDirty(state, index);
     }
     for (const index of affected) recomputeRoadMask(state, index);
     // A cleared tile may have been a plant: connectivity must be recomputed.
     if (clearable.length > 0) bumpGridVersion(state);

     state.undoStack.push(undo);
     return {};
   }
   ```
3. In `undoLastAction`, inside the loop add `layers.powerLine[tile.index] = tile.powerLine;` after the `roadMask` line, and after the loop add `bumpGridVersion(state);` before `return {};`.

- [ ] **Step 7: Plants, zones, growth, economy, tick, engine**

`src/sim/energy.ts` `placePlant`: import `bumpGridVersion` and `snapshotTile` from `./state.ts`; replace the inline undo object with

```ts
const undo: UndoEntry = { moneyDelta: cost, tiles: [snapshotTile(state, tile)] };
```

and add `bumpGridVersion(state);` right after `markDirty(state, tile);`.

`src/sim/zones.ts`: import `snapshotTile` and replace the inline `tiles:` mapping with `tiles: paintable.map((index) => snapshotTile(state, index)),`.

`src/sim/growth.ts` `growthStep`: after `if (layers.terrain[index] !== Terrain.Land) continue;` add

```ts
// Lines may run over zoned land; nothing is ever built on a line tile.
if (layers.powerLine[index] !== 0) continue;
```

`src/sim/economy.ts`: destructure `powerLine` too (`const { tileType, plantType, powerLine } = state.layers;`), add `let lineTiles = 0;` and inside the loop, first statement: `if (powerLine[i] !== 0) lineTiles++;`. Then

```ts
// Grid upkeep: roads and power lines share one line item.
const roadUpkeep =
  roadTiles * BALANCE.upkeepPerTick.roadPerTile +
  lineTiles * BALANCE.upkeepPerTick.powerLinePerTile;
```

`src/sim/tick.ts` `countTiles`: add `powerLineTiles` to the return type and the `counts` literal; destructure `powerLine` and add `if (powerLine[i] !== 0) counts.powerLineTiles++;` as the loop's first statement.

`src/sim/engine.ts`: import `buildPowerLines` from `./powerLines.ts` and add

```ts
      case 'buildPowerLine':
        return this.toEvents(buildPowerLines(state, command.tiles));
```

after the `buildRoad` case.

- [ ] **Step 8: Run tests and typecheck**

Run: `pnpm typecheck && pnpm vitest run src/sim`
Expected: PASS. If `energy.test.ts` fails only on `census.supplySources`, that test is untouched here and still passes (the field is removed in Task 2).

- [ ] **Step 9: Format and commit**

```bash
pnpm format
git add src/shared src/sim
git commit -m "feat(sim): power line layer, build rules, bulldoze and undo

Lines are a bitmask layer beside the road mask (presence bit plus four
connection bits) that may share tiles with roads and water but never
with buildings or plants. Building, bulldozing and undoing lines and
placing plants bump a grid version that later drives the connectivity
cache.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Connectivity: recomputeGrid replaces the supply radius

**Files:**

- Create: `src/sim/powerGrid.ts`
- Modify: `src/sim/energy.ts`, `src/shared/constants.ts`, `src/ui/useTools.ts`
- Test: `src/sim/powerGrid.test.ts` (new), `src/sim/energy.test.ts`, `src/sim/integration.test.ts`

**Interfaces:**

- Consumes: `bumpGridVersion`, `state.gridVersion`/`gridComputedVersion`, `layers.powerLine`/`energized`, `buildPowerLines` (Task 1).
- Produces: `isSupplySource(plant: PlantType): boolean`, `recomputeGrid(state: SimState): void` (`src/sim/powerGrid.ts`). `BALANCE.energy.supplyRadius` no longer exists.

- [ ] **Step 1: Write the failing tests**

Create `src/sim/powerGrid.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../shared/constants.ts';
import { LINE_PRESENT, tileIndex } from '../shared/grid.ts';
import { PlantType } from '../shared/types.ts';
import { placePlant } from './energy.ts';
import { isSupplySource, recomputeGrid } from './powerGrid.ts';
import { buildPowerLines } from './powerLines.ts';
import { bumpGridVersion, createSimState, type SimState } from './state.ts';

const SIZE = 24;
const at = (x: number, y: number) => tileIndex(x, y, SIZE);
const R = BALANCE.energy.lineSupplyRadius;

function makeState(): SimState {
  const state = createSimState(1, SIZE);
  state.money = 1e9;
  return state;
}

describe('isSupplySource', () => {
  it('counts generators and storage, not hubs or parks', () => {
    expect(isSupplySource(PlantType.SolarFarm)).toBe(true);
    expect(isSupplySource(PlantType.Battery)).toBe(true);
    expect(isSupplySource(PlantType.PumpedStorage)).toBe(true);
    expect(isSupplySource(PlantType.ChargingHub)).toBe(false);
    expect(isSupplySource(PlantType.Park)).toBe(false);
    expect(isSupplySource(PlantType.None)).toBe(false);
  });
});

describe('recomputeGrid', () => {
  it('a supply plant energises its own neighbourhood only', () => {
    const state = makeState();
    placePlant(state, at(10, 10), PlantType.WindTurbine);
    recomputeGrid(state);
    expect(state.layers.energized[at(10 + R, 10 + R)]).toBe(1);
    expect(state.layers.energized[at(10 + R + 1, 10)]).toBe(0);
  });

  it('lines connected to a plant extend the energised area', () => {
    const state = makeState();
    placePlant(state, at(2, 10), PlantType.SolarFarm);
    const line = Array.from({ length: 10 }, (_, i) => at(3 + i, 10)); // x 3..12
    buildPowerLines(state, line);
    recomputeGrid(state);
    expect(state.layers.energized[at(12 + R, 10)]).toBe(1);
    expect(state.layers.energized[at(12 + R + 1, 10)]).toBe(0);
  });

  it('a line that touches no supply plant stays dead', () => {
    const state = makeState();
    placePlant(state, at(2, 2), PlantType.SolarFarm);
    buildPowerLines(state, [at(15, 15), at(16, 15), at(17, 15)]);
    recomputeGrid(state);
    expect(state.layers.energized[at(17 + R, 15)]).toBe(0);
  });

  it('charging hubs and parks neither energise nor seed the fill', () => {
    const state = makeState();
    placePlant(state, at(10, 10), PlantType.ChargingHub);
    placePlant(state, at(10, 14), PlantType.Park);
    buildPowerLines(state, [at(11, 10), at(12, 10)]);
    recomputeGrid(state);
    expect(state.layers.energized[at(10, 10)]).toBe(0);
    expect(state.layers.energized[at(12, 10)]).toBe(0);
  });

  it('clips the radius stamp at the map edge', () => {
    const state = makeState();
    placePlant(state, at(0, 0), PlantType.WindTurbine);
    expect(() => recomputeGrid(state)).not.toThrow();
    expect(state.layers.energized[at(R, R)]).toBe(1);
    expect(state.layers.energized[at(R + 1, 0)]).toBe(0);
    expect(state.layers.energized[at(SIZE - 1, SIZE - 1)]).toBe(0);
  });

  it('is a no-op until the grid version changes', () => {
    const state = makeState();
    placePlant(state, at(2, 10), PlantType.SolarFarm);
    recomputeGrid(state);
    expect(state.gridComputedVersion).toBe(state.gridVersion);
    // Poke the layer behind the version's back: nothing happens…
    state.layers.powerLine[at(3, 10)] = LINE_PRESENT;
    recomputeGrid(state);
    expect(state.layers.energized[at(3 + R, 10)]).toBe(0);
    // …until the version is bumped.
    bumpGridVersion(state);
    recomputeGrid(state);
    expect(state.layers.energized[at(3 + R, 10)]).toBe(1);
  });

  it('forgets energised tiles when their plant is gone', () => {
    const state = makeState();
    placePlant(state, at(10, 10), PlantType.WindTurbine);
    recomputeGrid(state);
    expect(state.layers.energized[at(10, 10)]).toBe(1);
    state.layers.tileType[at(10, 10)] = 0;
    state.layers.plantType[at(10, 10)] = PlantType.None;
    bumpGridVersion(state);
    recomputeGrid(state);
    expect(state.layers.energized[at(10, 10)]).toBe(0);
  });
});
```

In `src/sim/energy.test.ts`:

1. In the `censusPlants` test delete the line `expect(census.supplySources).toHaveLength(4);`.
2. Add `import { buildPowerLines } from './powerLines.ts';`.
3. Replace the test `'marks buildings outside the supply radius as not connected'` with:

```ts
it('marks buildings beyond the connection radius of any plant as not connected', () => {
  const state = makeState();
  placePlant(state, at(0, 0), PlantType.WindTurbine);
  const inside = at(BALANCE.energy.lineSupplyRadius, 0);
  const outside = at(BALANCE.energy.lineSupplyRadius + 2, 0);
  addBuilding(state, inside, Zone.Residential, 1);
  addBuilding(state, outside, Zone.Residential, 1);
  state.weather.windSpeed = 1; // plenty of power
  energyStep(state, { chargingDemand: 0 });
  expect(state.layers.supplied[inside]).toBe(SupplyStatus.Supplied);
  expect(state.layers.supplied[outside]).toBe(SupplyStatus.NotConnected);
  // Unconnected buildings do not draw from the grid.
  expect(state.lastEnergy.buildingConsumption).toBeCloseTo(
    buildingConsumption(Zone.Residential, 1, 0),
    3,
  );
});

it('a power line from the plant connects a distant building', () => {
  const state = makeState();
  placePlant(state, at(0, 0), PlantType.WindTurbine);
  const far = at(12, 0);
  addBuilding(state, far, Zone.Residential, 1);
  state.weather.windSpeed = 1;
  energyStep(state, { chargingDemand: 0 });
  expect(state.layers.supplied[far]).toBe(SupplyStatus.NotConnected);
  state.money = 1e9;
  buildPowerLines(
    state,
    Array.from({ length: 9 }, (_, i) => at(1 + i, 0)),
  ); // x 1..9
  energyStep(state, { chargingDemand: 0 });
  expect(state.layers.supplied[far]).toBe(SupplyStatus.Supplied);
});
```

4. In `'unconnected buildings do not feed rooftop PV into the grid'` replace `at(BALANCE.energy.supplyRadius + 3, 20)` with `at(BALANCE.energy.lineSupplyRadius + 3, 20)`.

In `src/sim/integration.test.ts`, in the first test after the five `placePlant` commands add a trunk line from the solar farm at (10, 13) west along row 12, up column 3 and east along the main street so every zoned row lies within the connection radius:

```ts
// Grid: from the solar farm west along row 12, up column 3, then along
// the main street. The street row energises the zones on both sides.
const trunk = [
  ...Array.from({ length: 8 }, (_, i) => at(10 - i, 12)), // (10,12) … (3,12)
  at(3, 11),
  at(3, 10),
  ...Array.from({ length: 16 }, (_, x) => at(x + 4, 10)), // main street
];
engine.applyCommand({ type: 'buildPowerLine', tiles: trunk });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/sim/powerGrid.test.ts src/sim/energy.test.ts src/sim/integration.test.ts`
Expected: FAIL — `./powerGrid.ts` unresolved; the line-based energy tests fail because `energyStep` still uses the radius.

- [ ] **Step 3: `src/sim/powerGrid.ts`**

```ts
import { BALANCE } from '../shared/constants.ts';
import { neighbors4, tileIndex, tileX, tileY } from '../shared/grid.ts';
import { PlantType, TileType } from '../shared/types.ts';
import type { SimState } from './state.ts';

/** Plants that feed the grid and seed the line network (hubs and parks do not). */
const SUPPLY_SOURCES: ReadonlySet<PlantType> = new Set<PlantType>([
  PlantType.SolarFarm,
  PlantType.WindTurbine,
  PlantType.Battery,
  PlantType.BiogasPlant,
  PlantType.RunOfRiver,
  PlantType.PumpedStorage,
]);

export function isSupplySource(plant: PlantType): boolean {
  return SUPPLY_SOURCES.has(plant);
}

/** Mark every tile within a Chebyshev radius of `index`, clipped to the map. */
function stampRadius(target: Uint8Array, index: number, size: number, radius: number): void {
  const cx = tileX(index, size);
  const cy = tileY(index, size);
  const x0 = Math.max(0, cx - radius);
  const x1 = Math.min(size - 1, cx + radius);
  const y0 = Math.max(0, cy - radius);
  const y1 = Math.min(size - 1, cy + radius);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) target[tileIndex(x, y, size)] = 1;
  }
}

/**
 * Rebuild the energized layer when plants or lines changed: flood-fill
 * from every supply plant over 4-connected line tiles, then stamp the
 * connection radius around every energised line tile and every supply
 * plant. Line tiles the fill never reaches are dead.
 */
export function recomputeGrid(state: SimState): void {
  if (state.gridComputedVersion === state.gridVersion) return;
  const { layers } = state;
  const size = state.size;
  const { powerLine, energized, tileType, plantType } = layers;
  const radius = BALANCE.energy.lineSupplyRadius;

  const reached = new Uint8Array(size * size);
  const queue: number[] = [];
  const sources: number[] = [];
  for (let i = 0; i < tileType.length; i++) {
    if (tileType[i] !== TileType.Plant || !isSupplySource(plantType[i] as PlantType)) continue;
    sources.push(i);
    for (const n of neighbors4(i, size)) {
      if (powerLine[n] !== 0 && reached[n] === 0) {
        reached[n] = 1;
        queue.push(n);
      }
    }
  }
  while (queue.length > 0) {
    const index = queue.pop()!;
    for (const n of neighbors4(index, size)) {
      if (powerLine[n] !== 0 && reached[n] === 0) {
        reached[n] = 1;
        queue.push(n);
      }
    }
  }

  energized.fill(0);
  for (const source of sources) stampRadius(energized, source, size, radius);
  for (let i = 0; i < reached.length; i++) {
    if (reached[i] === 1) stampRadius(energized, i, size, radius);
  }
  state.gridComputedVersion = state.gridVersion;
}
```

- [ ] **Step 4: Energy tick reads the energized layer**

`src/sim/energy.ts`:

1. Delete the local `SUPPLY_SOURCES` set and the `isConnected` function; import `isSupplySource` and `recomputeGrid` from `./powerGrid.ts`. Remove the now unused `tileX`/`tileY` import.
2. `hasPowerInfrastructure`: replace `SUPPLY_SOURCES.has(plant)` with `isSupplySource(plant)`.
3. `PlantCensus`: delete `supplySources` (interface, initialiser and the `if (SUPPLY_SOURCES.has(plant)) …` push).
4. `energyStep`: as the first statement after `const { layers } = state;` add `recomputeGrid(state);` and replace `const connected = isConnected(state, i, census.supplySources);` with `const connected = layers.energized[i] === 1;`. Update the docblock's step 4 wording to "connected (energised) buildings".

`src/shared/constants.ts`: delete the `supplyRadius: 14,` line and its comment.

`src/ui/useTools.ts`: replace `renderer?.setHoverRadius(BALANCE.energy.supplyRadius);` with `renderer?.setHoverRadius(BALANCE.energy.lineSupplyRadius);` and update the comment above it to "the connection radius for supply plants".

- [ ] **Step 5: Run the sim suite and typecheck**

Run: `pnpm typecheck && pnpm vitest run src/sim`
Expected: PASS. If another existing test fails with `NotConnected`, its building is more than `lineSupplyRadius` tiles from its plant; move the building next to the plant (keep the test's intent) rather than weakening the assertion.

- [ ] **Step 6: Format and commit**

```bash
pnpm format
git add src/shared/constants.ts src/sim src/ui/useTools.ts
git commit -m "feat(sim): power lines replace the plant supply radius

Connectivity is a cached flood fill from supply plants over line tiles
plus a small connection radius around energised tiles and plants,
recomputed only when the grid version changes. The energy tick reads
the energized layer; the 14-tile supply radius is gone.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Saves carry lines; old saves get a network along the roads

**Files:**

- Modify: `src/sim/state.ts`, `src/sim/powerGrid.ts`, `src/storage/serialization.ts`
- Test: `src/sim/state.test.ts`, `src/sim/engine.test.ts`, `src/storage/serialization.test.ts`

**Interfaces:**

- Consumes: `LINE_PRESENT`, `recomputePowerLineMask`, `bumpGridVersion`, `isSupplySource`.
- Produces: `grantLegacyNetwork(state: SimState): void` (`src/sim/powerGrid.ts`); `SaveGame.layers.powerLine` written by `serializeState`.

- [ ] **Step 1: Write the failing tests**

Append to the `describe('save round trip', …)` block in `src/sim/state.test.ts` (add `import { LINE_PRESENT } from '../shared/grid.ts';` and `import { buildRoads } from './roads.ts';`):

```ts
it('persists the power line layer', () => {
  const state = makeState();
  state.layers.powerLine[at(1, 1)] = LINE_PRESENT;
  const restored = deserializeState(serializeState(state));
  expect(restored.layers.powerLine[at(1, 1)]).toBe(LINE_PRESENT);
  expect(restored.gridComputedVersion).toBe(-1);
});

it('grants lines along plant-connected roads to saves without the layer', () => {
  const state = makeState();
  state.money = 1e9;
  buildRoads(state, [at(1, 2), at(2, 2), at(3, 2)]);
  state.layers.tileType[at(1, 1)] = TileType.Plant;
  state.layers.plantType[at(1, 1)] = PlantType.WindTurbine; // touches road (1,2)
  buildRoads(state, [at(10, 10), at(11, 10)]); // no plant nearby
  const save = serializeState(state);
  delete save.layers.powerLine;
  const restored = deserializeState(save);
  expect(restored.layers.powerLine[at(1, 2)]).not.toBe(0);
  expect(restored.layers.powerLine[at(3, 2)]).not.toBe(0);
  expect(restored.layers.powerLine[at(10, 10)]).toBe(0);
});

it('leaves a save that has an all-zero line layer alone', () => {
  const state = makeState();
  state.money = 1e9;
  buildRoads(state, [at(1, 2)]);
  state.layers.tileType[at(1, 1)] = TileType.Plant;
  state.layers.plantType[at(1, 1)] = PlantType.WindTurbine;
  const restored = deserializeState(serializeState(state));
  expect(restored.layers.powerLine[at(1, 2)]).toBe(0);
});
```

Append to the `describe('SimEngine basics', …)` block in `src/sim/engine.test.ts`:

```ts
it('a legacy save loads into a supplied city', () => {
  const engine = new SimEngine(3, 16);
  engine.applyCommand({ type: 'init', seed: 3, size: 16 });
  engine.state.money = 1e9;
  const road = Array.from({ length: 8 }, (_, x) => tileIndex(x + 2, 8, 16));
  engine.applyCommand({ type: 'buildRoad', tiles: road });
  engine.applyCommand({
    type: 'placePlant',
    tile: tileIndex(2, 7, 16),
    plant: PlantType.WindTurbine,
  });
  engine.state.layers.zone[tileIndex(9, 9, 16)] = 1;
  engine.state.layers.density[tileIndex(9, 9, 16)] = 1;
  const events = engine.applyCommand({ type: 'requestSave' });
  const save = events[0].type === 'saveData' ? events[0].save : null;
  if (!save) throw new Error('expected save data');
  delete save.layers.powerLine;

  const restored = new SimEngine(0, 4);
  restored.applyCommand({ type: 'init', seed: 3, size: 16, save });
  restored.state.weather.windSpeed = 1;
  restored.tick();
  expect(restored.state.layers.supplied[tileIndex(9, 9, 16)]).not.toBe(0); // not NotConnected
});
```

Append to `src/storage/serialization.test.ts`:

```ts
it('round-trips the optional power line layer', () => {
  const save = makeSave();
  save.layers.powerLine = new Uint8Array(save.size * save.size).fill(16).buffer as ArrayBuffer;
  const restored = saveFromJson(saveToJson(save));
  expect(new Uint8Array(restored.layers.powerLine!)).toEqual(new Uint8Array(save.layers.powerLine));
});

it('accepts exports without the power line layer', () => {
  const restored = saveFromJson(saveToJson(makeSave()));
  expect(restored.layers.powerLine).toBeUndefined();
});

it('rejects a wrongly sized power line layer', () => {
  const save = makeSave();
  save.layers.powerLine = new Uint8Array(3).buffer as ArrayBuffer;
  expect(() => saveFromJson(saveToJson(save))).toThrow(/powerLine/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/sim/state.test.ts src/sim/engine.test.ts src/storage/serialization.test.ts`
Expected: FAIL — `powerLine` not in the save, `restored.layers.powerLine` undefined / all zero, legacy city `NotConnected`.

- [ ] **Step 3: Legacy network in `src/sim/powerGrid.ts`**

Add the imports `LINE_PRESENT` (from `../shared/grid.ts`) and `recomputePowerLineMask` (from `./powerLines.ts`). Keep the import from `./state.ts` type-only: `state.ts` will import this module, and a value import back would make a runtime cycle. Then append:

```ts
/**
 * One-time migration for saves from before power lines: put a line on
 * every road tile reachable (over roads) from a road tile next to a
 * supply plant, so the loaded city stays supplied and shows a network.
 */
export function grantLegacyNetwork(state: SimState): void {
  const { layers } = state;
  const size = state.size;
  const { tileType, plantType, powerLine } = layers;
  const seen = new Uint8Array(size * size);
  const queue: number[] = [];
  for (let i = 0; i < tileType.length; i++) {
    if (tileType[i] !== TileType.Plant || !isSupplySource(plantType[i] as PlantType)) continue;
    for (const n of neighbors4(i, size)) {
      if (tileType[n] === TileType.Road && seen[n] === 0) {
        seen[n] = 1;
        queue.push(n);
      }
    }
  }
  while (queue.length > 0) {
    const index = queue.pop()!;
    for (const n of neighbors4(index, size)) {
      if (tileType[n] === TileType.Road && seen[n] === 0) {
        seen[n] = 1;
        queue.push(n);
      }
    }
  }
  for (let i = 0; i < seen.length; i++) {
    if (seen[i] === 1) powerLine[i] = LINE_PRESENT;
  }
  for (let i = 0; i < seen.length; i++) {
    if (seen[i] === 1) recomputePowerLineMask(state, i);
  }
  // Inline instead of bumpGridVersion(): keeps this module's import of
  // state.ts type-only (state.ts imports this module for the migration).
  state.gridVersion++;
}
```

- [ ] **Step 4: Sim serialization in `src/sim/state.ts`**

`serializeState` layers: after `terrain: copyBuffer(layers.terrain),` add `powerLine: copyBuffer(layers.powerLine),`.

`deserializeState`: import `grantLegacyNetwork` from `./powerGrid.ts` and after the `terrain` line add

```ts
if (save.layers.powerLine) {
  state.layers.powerLine.set(new Uint8Array(save.layers.powerLine));
} else {
  grantLegacyNetwork(state);
}
```

(`powerGrid.ts` imports nothing from `state.ts` at runtime, so this import creates no cycle; `powerLines.ts` does import `state.ts` values but only uses them inside functions, which is safe.)

- [ ] **Step 5: JSON export/import in `src/storage/serialization.ts`**

Replace the `terrainEncoded` block with a loop over both optional layers:

```ts
const optionalLayers = ['terrain', 'powerLine'] as const;
for (const name of optionalLayers) {
  const encoded = parsed.layers[name];
  if (typeof encoded !== 'string') continue;
  const buffer = base64ToBuffer(encoded);
  if (buffer.byteLength !== expectedBytes) {
    throw new Error(`Layer "${name}" has the wrong size`);
  }
  layers[name] = buffer;
}
```

`saveToJson` already exports every present layer.

- [ ] **Step 6: Run tests**

Run: `pnpm typecheck && pnpm vitest run src/sim src/storage`
Expected: PASS.

- [ ] **Step 7: Format and commit**

```bash
pnpm format
git add src/sim/state.ts src/sim/powerGrid.ts src/sim/state.test.ts src/sim/engine.test.ts src/storage
git commit -m "feat(save): persist power lines; grant legacy saves a road network

The line layer is optional in the save. A save without it receives a
line on every road tile reachable from a supply plant so an old city
loads supplied and shows what a network looks like. SAVE_VERSION is
unchanged.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Grid builder goal

**Files:**

- Modify: `src/sim/goals.ts`, `src/sim/goals.test.ts`, `src/ui/i18n.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/sim/goals.test.ts` (add `import { buildPowerLines } from './powerLines.ts';`):

```ts
it('gridBuilder is achieved by the first power line', () => {
  const state = createSimState(1, SIZE);
  goalsStep(state);
  expect(state.goalsAchieved.has('gridBuilder')).toBe(false);
  buildPowerLines(state, [at(3, 3)]);
  goalsStep(state);
  expect(state.goalsAchieved.has('gridBuilder')).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/sim/goals.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`src/sim/goals.ts`: add `'gridBuilder',` after `'hydroPower',` in `GOAL_IDS`; import `hasPowerLines` from `./powerLines.ts`; in `goalsStep` add

```ts
if (!achieved.has('gridBuilder') && hasPowerLines(state)) {
  achieved.add('gridBuilder');
}
```

`src/ui/i18n.tsx` — English, after `goal.hydroPower.body`:

```ts
  'goal.gridBuilder.title': 'Grid builder',
  'goal.gridBuilder.body': 'Build your first power line.',
```

German, after `goal.hydroPower.body`:

```ts
  'goal.gridBuilder.title': 'Unter Strom',
  'goal.gridBuilder.body': 'Baue deine erste Stromleitung.',
```

- [ ] **Step 4: Run tests, format, commit**

Run: `pnpm typecheck && pnpm vitest run src/sim/goals.test.ts` → PASS.

```bash
pnpm format
git add src/sim/goals.ts src/sim/goals.test.ts src/ui/i18n.tsx
git commit -m "feat: grid builder goal

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Balance probe and tuning

**Files:**

- Create (temporary, deleted before commit): `src/sim/probe-grid.test.ts`
- Modify: `src/shared/constants.ts` (only if the probe says so)

- [ ] **Step 1: Write the probe**

```ts
import { it } from 'vitest';
import { BALANCE, TICKS_PER_DAY } from '../shared/constants.ts';
import { tileIndex } from '../shared/grid.ts';
import { PlantType, Zone } from '../shared/types.ts';
import { SimEngine } from './engine.ts';
import { countPowerLineTiles } from './powerLines.ts';
import { countPopulationAndJobs } from './state.ts';

const SIZE = 48;
const at = (x: number, y: number) => tileIndex(x, y, SIZE);

function run(label: string, withLines: boolean): void {
  const engine = new SimEngine(99, SIZE);
  engine.applyCommand({ type: 'init', seed: 99, size: SIZE });
  const state = engine.state;
  state.money = 1e9;
  let spent = 0;
  const streets = [10, 16, 22];
  for (const y of streets) {
    const road = Array.from({ length: 30 }, (_, x) => at(x + 5, y));
    engine.applyCommand({ type: 'buildRoad', tiles: road });
    const res: number[] = [];
    const com: number[] = [];
    const ret: number[] = [];
    for (let x = 5; x < 35; x++) {
      res.push(at(x, y - 1), at(x, y - 2));
      if (x < 25) com.push(at(x, y + 1));
      else ret.push(at(x, y + 1));
    }
    engine.applyCommand({ type: 'paintZone', tiles: res, zone: Zone.Residential });
    engine.applyCommand({ type: 'paintZone', tiles: com, zone: Zone.Commercial });
    engine.applyCommand({ type: 'paintZone', tiles: ret, zone: Zone.Retail });
  }
  for (let x = 6; x < 34; x += 2) {
    engine.applyCommand({
      type: 'placePlant',
      tile: at(x, 26),
      plant: x % 4 === 2 ? PlantType.SolarFarm : PlantType.WindTurbine,
    });
    engine.applyCommand({
      type: 'placePlant',
      tile: at(x, 28),
      plant: x % 4 === 2 ? PlantType.Battery : PlantType.BiogasPlant,
    });
  }
  if (withLines) {
    const before = state.money;
    // Feeder from the plant row up column 5, then every street.
    const feeder = Array.from({ length: 16 }, (_, i) => at(5, 25 - i)); // (5,25) … (5,10)
    engine.applyCommand({ type: 'buildPowerLine', tiles: feeder });
    for (const y of streets) {
      engine.applyCommand({
        type: 'buildPowerLine',
        tiles: Array.from({ length: 30 }, (_, x) => at(x + 5, y)),
      });
    }
    spent = before - state.money;
  }
  const rows: string[] = [label];
  for (let day = 0; day <= 20; day++) {
    let deficitTicks = 0;
    for (let t = 0; t < TICKS_PER_DAY; t++) {
      engine.tick();
      if (state.lastEnergy.deficit > 0) deficitTicks++;
    }
    state.money = 1e9;
    if (day % 4 === 0) {
      const { population, jobs } = countPopulationAndJobs(state);
      rows.push(
        `  day ${String(day).padStart(2)} pop ${population} jobs ${jobs} deficit ${((deficitTicks / TICKS_PER_DAY) * 100).toFixed(1)}%`,
      );
    }
  }
  rows.push(
    `  line tiles ${countPowerLineTiles(state)} spent on lines ${spent} (per tile ${BALANCE.costs.powerLinePerTile})`,
  );
  console.log(rows.join('\n'));
}

it('probe: lines vs. no lines', () => {
  run('with trunk lines', true);
  run('without lines (plants only)', false);
});
```

- [ ] **Step 2: Run the probe**

Run: `pnpm vitest run src/sim/probe-grid.test.ts 2>&1 | grep -E "^(with|without|  )"`

Targets:

- With lines, population, jobs and deficit share on day 20 are within seed noise of the pre-branch numbers for this city (from the growth-fix commit body: about 1500 residents and 1000 jobs, energy-limited).
- Without lines the plant row (y 26–28) energises rows 23–31 only: the city must be visibly starved (most buildings `NotConnected`, population a fraction of the lined run). This is the point of the feature; if it is NOT starved, the radius is too large.
- Line spend for the three streets plus feeder (about 106 tiles) stays under 5 % of the city's construction spend (roads 90 × 10 + zones 270 × 5 + plants ≈ 25,000 → lines must cost under 1,250).

Adjust `powerLinePerTile`, `powerLineWaterPerTile`, `lineSupplyRadius` in `BALANCE` until these hold. Re-run `pnpm vitest run src/sim` after any change.

- [ ] **Step 3: Delete the probe, commit any tuning**

```bash
rm src/sim/probe-grid.test.ts
pnpm format
git add src/shared/constants.ts
git commit -m "balance: size power line costs and connection radius from a 20-day probe

<one line per finding, with the before/after numbers>

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Skip the commit if nothing changed, but still delete the probe and report the numbers.

---

### Task 6: Pylons and cables, minimap dot

**Files:**

- Create: `src/render/powerLinesMesh.ts`
- Modify: `src/render/renderer.ts`, `src/render/minimapLayer.ts`

**Interfaces:**

- Consumes: `TileDiff.powerLine`, `LINE_PRESENT`, `DIR_E`, `DIR_S`, `DiffLayer`.
- Produces: `PowerLinesMesh implements DiffLayer`.

- [ ] **Step 1: `src/render/powerLinesMesh.ts`**

```ts
import * as THREE from 'three';
import { DIR_E, DIR_S } from '../shared/grid.ts';
import type { TileDiff } from '../shared/types.ts';
import { TileType } from '../shared/types.ts';
import type { DiffLayer } from './renderer.ts';

const PYLON_COLOR = 0x6b6f75;
const CABLE_COLOR = 0x2b2f33;
const PYLON_HEIGHT = 0.55;
const PYLON_THICKNESS = 0.06;
const CABLE_THICKNESS = 0.025;
/** On a road tile the pylon stands at the north-west kerb so cars pass. */
const KERB_OFFSET = 0.12;

/**
 * Instanced power lines: one pylon per line tile and one cable per
 * connection. Cables are drawn for the east and south bits only, so every
 * connection is drawn exactly once. Dead lines look like live ones; the
 * supply overlay shows whether they carry power.
 */
export class PowerLinesMesh implements DiffLayer {
  private readonly pylons: THREE.InstancedMesh;
  private readonly cables: THREE.InstancedMesh;
  private readonly gridSize: number;
  private readonly masks: Uint8Array;
  private readonly tileTypes: Uint8Array;
  private readonly dummy = new THREE.Object3D();

  constructor(scene: THREE.Scene, gridSize: number) {
    this.gridSize = gridSize;
    this.masks = new Uint8Array(gridSize * gridSize);
    this.tileTypes = new Uint8Array(gridSize * gridSize);

    const pylonGeometry = new THREE.BoxGeometry(PYLON_THICKNESS, PYLON_HEIGHT, PYLON_THICKNESS);
    pylonGeometry.translate(0, PYLON_HEIGHT / 2, 0);
    this.pylons = new THREE.InstancedMesh(
      pylonGeometry,
      new THREE.MeshLambertMaterial({ color: PYLON_COLOR }),
      gridSize * gridSize,
    );
    // Instance transforms live across the whole grid; the base geometry's
    // bounds would wrongly cull the mesh, so culling is disabled.
    this.pylons.frustumCulled = false;
    this.pylons.count = 0;
    scene.add(this.pylons);

    const cableGeometry = new THREE.BoxGeometry(1, CABLE_THICKNESS, CABLE_THICKNESS);
    this.cables = new THREE.InstancedMesh(
      cableGeometry,
      new THREE.MeshLambertMaterial({ color: CABLE_COLOR }),
      gridSize * gridSize * 2,
    );
    // Instance transforms live across the whole grid; the base geometry's
    // bounds would wrongly cull the mesh, so culling is disabled.
    this.cables.frustumCulled = false;
    this.cables.count = 0;
    scene.add(this.cables);
  }

  applyDiffs(diffs: TileDiff[]): void {
    let changed = false;
    for (const diff of diffs) {
      if (this.masks[diff.index] !== diff.powerLine) {
        this.masks[diff.index] = diff.powerLine;
        changed = true;
      }
      if (this.tileTypes[diff.index] !== diff.tileType) {
        this.tileTypes[diff.index] = diff.tileType;
        changed = true;
      }
    }
    if (changed) this.rebuild();
  }

  /** World position of a tile's pylon (kerb on roads, centre elsewhere). */
  private pylonAt(index: number): { x: number; z: number } {
    const tx = index % this.gridSize;
    const tz = Math.floor(index / this.gridSize);
    const onRoad = this.tileTypes[index] === TileType.Road;
    const offset = onRoad ? KERB_OFFSET : 0.5;
    return { x: tx + offset, z: tz + offset };
  }

  private rebuild(): void {
    let pylonCount = 0;
    let cableCount = 0;
    for (let index = 0; index < this.masks.length; index++) {
      const mask = this.masks[index];
      if (mask === 0) continue;
      const here = this.pylonAt(index);
      this.dummy.position.set(here.x, 0, here.z);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      this.pylons.setMatrixAt(pylonCount++, this.dummy.matrix);

      const east = (mask & DIR_E) !== 0 ? index + 1 : -1;
      const south = (mask & DIR_S) !== 0 ? index + this.gridSize : -1;
      for (const neighbor of [east, south]) {
        if (neighbor < 0 || neighbor >= this.masks.length) continue;
        const there = this.pylonAt(neighbor);
        const dx = there.x - here.x;
        const dz = there.z - here.z;
        const length = Math.hypot(dx, dz);
        this.dummy.position.set((here.x + there.x) / 2, PYLON_HEIGHT, (here.z + there.z) / 2);
        this.dummy.rotation.set(0, -Math.atan2(dz, dx), 0);
        this.dummy.scale.set(length, 1, 1);
        this.dummy.updateMatrix();
        this.cables.setMatrixAt(cableCount++, this.dummy.matrix);
      }
    }
    this.pylons.count = pylonCount;
    this.cables.count = cableCount;
    this.pylons.instanceMatrix.needsUpdate = true;
    this.cables.instanceMatrix.needsUpdate = true;
  }
}
```

Deviation from the spec, on purpose: pylons keep one height everywhere. Bridge rails are 0.14 high and the cable runs at 0.55, so a taller water pylon is unnecessary. Cables between a kerb pylon and a centre pylon run diagonally within the tile pair; that is intended.

- [ ] **Step 2: Wire it into the renderer**

`src/render/renderer.ts`: import `PowerLinesMesh` from `./powerLinesMesh.ts` and add `this.addDiffLayer(new PowerLinesMesh(scene, gridSize));` directly after the `RoadsMesh` line.

- [ ] **Step 3: Minimap**

`src/render/minimapLayer.ts`: add `powerLine: '#e8d76a',` to `COLORS` after `lake`. In `tileColor`, after the `diff.density > 0` line and before the `diff.zone !== Zone.None` line add:

```ts
if (diff.powerLine !== 0) return COLORS.powerLine;
```

- [ ] **Step 4: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: clean. Visual check on the Mac (`pnpm dev`): pylons on land and at the kerb of road tiles, cables between neighbours in both axes, a cable across the river. In the sandbox note that the visual check is deferred.

- [ ] **Step 5: Format and commit**

```bash
pnpm format
git add src/render
git commit -m "feat(render): power line pylons and cables, minimap lines

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Tool, tutorial step, help and strings

**Files:**

- Modify: `src/ui/useTools.ts`, `src/ui/Toolbar.tsx`, `src/ui/Tutorial.tsx`, `src/ui/HelpPage.tsx`, `src/ui/i18n.tsx`

- [ ] **Step 1: Tool**

`src/ui/useTools.ts`:

- `ToolId` union: add `| 'power-line'` after `'road'`.
- `TOOL_HOTKEYS`: add `l: 'power-line',` after `u: 'plant-pumped',`.
- Replace the `showRoadCost` helper with a helper that prices both drag tools:

```ts
// Mirrors the sim's per-tile pricing (src/sim/roads.ts, powerLines.ts):
// river tiles are bridges; lines over river or lake are crossings.
// Falls back to the land price when the renderer isn't mounted yet.
const showPathCost = (tiles: number[], line: boolean): void => {
  const renderer = rendererRef.current;
  const cost = tiles.reduce((sum, index) => {
    const terrain = renderer?.terrainAt(index);
    if (line) {
      const water = terrain !== undefined && terrain !== Terrain.Land;
      return sum + (water ? BALANCE.costs.powerLineWaterPerTile : BALANCE.costs.powerLinePerTile);
    }
    return (
      sum + (terrain === Terrain.River ? BALANCE.costs.bridgePerTile : BALANCE.costs.roadPerTile)
    );
  }, 0);
  setCostPreview({ tiles: tiles.length, cost });
};
```

- Replace `if (tool === 'road') {` with `if (tool === 'road' || tool === 'power-line') {` and inside that branch: `const line = tool === 'power-line';`, every `showRoadCost(path)` becomes `showPathCost(path, line)`, and the send becomes `send({ type: line ? 'buildPowerLine' : 'buildRoad', tiles: path });`.
- Update the hook's docblock: "road and power line drags preview an L-shaped path".

`src/ui/Toolbar.tsx` `TOOLS`, after the `road` entry:

```ts
  { id: 'power-line', icon: '⚡', cost: BALANCE.costs.powerLinePerTile, perTile: true },
```

- [ ] **Step 2: Tutorial step**

`src/ui/Tutorial.tsx` `STEPS`: after the step whose `isComplete` checks `stats.counts.plantTiles > 0` insert

```ts
  {
    title: 'tutorial.grid.title',
    body: 'tutorial.grid.body',
    isComplete: (stats) => stats.counts.powerLineTiles > 0,
  },
```

(the existing steps are `{ title, body, isComplete? }` objects with `TranslationKey` fields; this one has the same shape).

- [ ] **Step 3: Help**

`src/ui/HelpPage.tsx` `SECTIONS`: insert `{ title: 'help.grid.title', body: 'help.grid.body' },` after the energy section.

- [ ] **Step 4: Strings**

`src/ui/i18n.tsx` English:

- after `'tool.road': 'Road',`: `'tool.power-line': 'Power line',`
- after `'rejection.cannotBuildOnWater': …`: `'rejection.needsLineSite': 'Power lines need free land, a road or water',`
- after `'help.energy.body'` entry:
  ```ts
    'help.grid.title': 'Grid and power lines',
    'help.grid.body':
      'Plants only supply buildings connected to them. Draw power lines (⚡, key L) from a plant along your streets — they run over roads and across water. Every energised line tile and every plant connects buildings within three tiles. A line that does not touch a plant carries nothing; the supply overlay shows what is connected. Cities from before power lines got lines along their roads for free.',
  ```
- replace in `help.energy.body` the sentence `Every plant supplies a radius around it.` with `Plants supply only what power lines connect to them (see Grid and power lines).`
- replace `'tutorial.power.body'` with `'Place a wind turbine (🌀, key 7) or a solar farm (☀️, key 6) next to your road. The ring shows how far it reaches on its own — just a few tiles.'`
- after the `tutorial.power.body` entry:
  ```ts
    'tutorial.grid.title': 'Connect the grid',
    'tutorial.grid.body':
      'Draw a power line (⚡, key L) from the plant along your road. Buildings within three tiles of a connected line get power.',
  ```

German:

- after `'tool.road': 'Straße',`: `'tool.power-line': 'Stromleitung',`
- after `'rejection.cannotBuildOnWater': …`: `'rejection.needsLineSite': 'Leitungen brauchen freies Land, eine Straße oder Wasser',`
- after `'help.energy.body'`:
  ```ts
    'help.grid.title': 'Netz und Leitungen',
    'help.grid.body':
      'Anlagen versorgen nur Gebäude, die mit ihnen verbunden sind. Ziehe Stromleitungen (⚡, Taste L) von einer Anlage entlang deiner Straßen — sie laufen über Straßen und über Wasser. Jedes angeschlossene Leitungsfeld und jede Anlage versorgt Gebäude im Umkreis von drei Feldern. Eine Leitung ohne Anlage führt keinen Strom; das Versorgungs-Overlay zeigt, was angeschlossen ist. Städte aus der Zeit vor den Leitungen haben ihre Leitungen entlang der Straßen geschenkt bekommen.',
  ```
- replace in `help.energy.body` the sentence `Jede Anlage versorgt einen Radius um sich herum.` with `Anlagen versorgen nur, was Stromleitungen mit ihnen verbinden (siehe Netz und Leitungen).`
- replace `'tutorial.power.body'` with `'Platziere ein Windrad (🌀, Taste 7) oder einen Solarpark (☀️, Taste 6) neben deiner Straße. Der Ring zeigt, wie weit die Anlage allein reicht — nur ein paar Felder.'`
- after `tutorial.power.body`:
  ```ts
    'tutorial.grid.title': 'Schließe das Netz an',
    'tutorial.grid.body':
      'Ziehe eine Stromleitung (⚡, Taste L) von der Anlage entlang deiner Straße. Gebäude im Umkreis von drei Feldern einer angeschlossenen Leitung bekommen Strom.',
  ```

`de` is typed `Record<TranslationKey, string>`, so a missing key fails `pnpm typecheck`.

- [ ] **Step 5: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: clean. Visual (Mac): toolbar shows the ⚡ tool with hotkey L; dragging previews the path and the per-tile cost; the tutorial has a "Connect the grid" step that completes after the first line.

- [ ] **Step 6: Format and commit**

```bash
pnpm format
git add src/ui
git commit -m "feat(ui): power line tool, tutorial step, help and strings

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: e2e, docs, final verification

**Files:**

- Modify: `e2e/game.spec.ts`, `README.md`, `docs/idea.md`

- [ ] **Step 1: e2e**

Append to `e2e/game.spec.ts` after the road-cost test:

```ts
test('drawing a power line costs money (needs WebGL)', async ({ page }) => {
  test.skip(!(await has3dView(page)), 'WebGL not available in this environment');

  const moneyText = async (): Promise<number> => {
    const text = await page.getByTestId('money').textContent();
    return Number(text?.replace(/[^\d]/g, '') ?? '0');
  };
  const before = await moneyText();

  await page.getByTestId('tool-power-line').click();
  const canvas = page.locator('.game-view canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  await page.mouse.move(centerX - 60, centerY + 40);
  await page.mouse.down();
  await page.mouse.move(centerX + 60, centerY + 40, { steps: 8 });
  await page.mouse.up();

  await expect.poll(moneyText, { timeout: 5_000 }).toBeLessThan(before);
});
```

Deviation from the spec: the supply-overlay colour of a building lives on a WebGL canvas and cannot be read reliably from Playwright; the money assertion proves the line was built through the real tool path. Connectivity itself is covered by the sim tests.

- [ ] **Step 2: Docs**

`README.md` Gameplay: replace the "Power the city" bullet with

```md
- **Power the city** with solar farms, wind turbines, battery storage and a
  dispatchable (but expensive) biogas plant. Plants only supply what your
  **power lines** (⚡, key L) connect to them — lines run over roads and
  across water, and every connected line tile reaches three tiles around it.
```

and in the "Overlays" bullet change "show supply status" to "show supply status (connected, undersupplied, not connected to the grid)".

`docs/idea.md` "Grid & Balance": replace `- Connection via the supply radius of plants (no power lines)` with `- Connection via power lines: a bitmask layer over roads and water, a small connection radius around energised tiles and plants, one global balance (added after the MVP; see the power-lines spec)` and remove "power lines" from the "Out of Scope for the MVP" list.

- [ ] **Step 3: Full verification**

Run, in order:

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm coverage
pnpm build
pnpm e2e   # on the Mac / CI only
```

All must pass. If coverage dips below 90 % on `src/sim`, the usual gap is an unexercised branch in `powerGrid.ts` or `powerLines.ts` — add a targeted test rather than lowering the gate.

- [ ] **Step 4: Commit**

```bash
git add e2e/game.spec.ts README.md docs/idea.md
git commit -m "test+docs: power line e2e drag, README and idea doc

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review notes

- Spec §1 (layer, build rules, bulldozer, undo, upkeep) → Task 1; connectivity and energy tick → Task 2; migration and saves → Task 3; goal → Task 4; balance → Task 5. §2 rendering/minimap → Task 6; tool, overlay meaning, strings, help → Task 7 (plus the tutorial, which the spec missed but which still told players to keep zones inside a supply ring). §3 tests are spread over Tasks 1–4; e2e and docs → Task 8.
- The presence bit (`LINE_PRESENT`) is a plan addition: an isolated line tile has no connection bits and would otherwise be indistinguishable from "no line".
- Charging hubs are unchanged: `chargingDemand` was never gated by connection before and the spec keeps hubs as grid consumers; no task touches `vehicles.ts`.
- `snapshotTile` and `withNeighbors` move from `roads.ts` to `state.ts` so `powerLines.ts` and `roads.ts` can share them without a runtime import cycle (`powerLines.ts` imports `roads.ts` as type-only).
- Pylon height is uniform (spec said taller over water): rails are 0.14 high, cables hang at 0.55, so nothing to clear.
