# Terrain Elevation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every map elevation levels 0–7 rendered as smooth 3D slopes, with build constraints, slope surcharges, a wind elevation bonus and hydro head bonuses; the river follows the terrain downhill.

**Architecture:** A new immutable `elevation` layer (Uint8Array) is generated before the water, the river routes by steepest descent and carves monotonically, and all gameplay effects are pure bonus/constraint functions of the layer (all-zero elevation reproduces today's behaviour exactly). The renderer gains a shared `ElevationField` diff layer that every mesh layer reads; the ground plane becomes a height-field mesh and picking raycasts against it.

**Tech Stack:** TypeScript strict, Vitest, three.js, React 19. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-23-terrain-elevation-design.md`

## Global Constraints

- All tuning values go into `BALANCE.terrain` in `src/shared/constants.ts` — no magic numbers in `src/sim/`.
- `src/sim/` must not import DOM or three.js; all randomness through seeded `Rng`.
- Every user-visible string is added to `src/ui/i18n.tsx` in **both** English and German.
- Coverage gate ≥ 90 % on `src/sim` + `src/shared` (`pnpm coverage`).
- Run `pnpm format` after edits; the pre-commit hook runs typecheck+lint+format:check+tests. Never `--no-verify`.
- Old saves (no elevation layer) must load as flat maps and behave bit-for-bit like today. `SAVE_VERSION` stays 1.
- New `InstancedMesh` instances always set `frustumCulled = false`.
- Work on a feature branch (e.g. `feature/terrain-elevation`), created via the using-git-worktrees skill at execution start.

---

### Task 1: Elevation layer, BALANCE.terrain, slopeAt

**Files:**

- Modify: `src/shared/constants.ts` (add `terrain` block after `water`, ~line 179)
- Modify: `src/shared/types.ts` (`TileDiff` gains `elevation`, ~line 308)
- Modify: `src/sim/state.ts` (`TileLayers`, `createTileLayers`, `collectDiffs`, new `slopeAt` + `slopeCostMultiplier`)
- Test: `src/sim/state.test.ts`

**Interfaces:**

- Consumes: existing `neighbors4(index, size)` from `src/shared/grid.ts`.
- Produces: `state.layers.elevation: Uint8Array` (levels 0–7, immutable after map gen, NOT part of undo snapshots); `slopeAt(state, index): number` (max abs level difference to 4-neighbours); `slopeCostMultiplier(state, index): number` (`BALANCE.terrain.slopeCostFactor` when slope > 0, else 1); `TileDiff.elevation: number`; the `BALANCE.terrain` block below.

- [ ] **Step 1: Write the failing tests** (append to `src/sim/state.test.ts`; mirror the file's existing import style)

```ts
describe('elevation', () => {
  it('starts flat and carries elevation in diffs', () => {
    const state = createSimState(1, 8);
    expect(state.layers.elevation.every((v) => v === 0)).toBe(true);
    state.layers.elevation[10] = 5;
    markDirty(state, 10);
    const diff = collectDiffs(state).find((d) => d.index === 10);
    expect(diff?.elevation).toBe(5);
  });

  it('slopeAt is the largest level difference to a 4-neighbour', () => {
    const state = createSimState(1, 8);
    const center = tileIndex(3, 3, 8);
    state.layers.elevation[center] = 4;
    state.layers.elevation[tileIndex(4, 3, 8)] = 6;
    state.layers.elevation[tileIndex(2, 3, 8)] = 4;
    expect(slopeAt(state, center)).toBe(2);
    expect(slopeAt(state, tileIndex(2, 3, 8))).toBe(4); // vs flat neighbour at 0
  });

  it('slopeAt ignores off-map neighbours', () => {
    const state = createSimState(1, 8);
    state.layers.elevation.fill(7);
    expect(slopeAt(state, tileIndex(0, 0, 8))).toBe(0);
  });

  it('slopeCostMultiplier surcharges sloped tiles only', () => {
    const state = createSimState(1, 8);
    expect(slopeCostMultiplier(state, 0)).toBe(1);
    state.layers.elevation[tileIndex(1, 0, 8)] = 1;
    expect(slopeCostMultiplier(state, 0)).toBe(BALANCE.terrain.slopeCostFactor);
  });
});
```

Add `slopeAt`, `slopeCostMultiplier`, `tileIndex`, `BALANCE` to the test file's imports as needed.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run src/sim/state.test.ts`
Expected: FAIL — `slopeAt` not exported / `elevation` undefined.

- [ ] **Step 3: Implement**

`src/shared/constants.ts` — insert after the `water` block:

```ts
terrain: {
  /** Highest elevation level; levels run 0..maxLevel. */
  maxLevel: 7,
  /** Value-noise cell size in tiles (large = broad hills). */
  noiseCellSize: 12,
  /** Octave weights; octave i uses cell size noiseCellSize / 2^i. */
  octaveWeights: [1, 0.35] as const,
  /** Exponent shaping the height distribution toward low levels. */
  noiseExponent: 1.6,
  /** Levels of seed-chosen edge-to-edge tilt (ridges toward one edge). */
  tiltLevels: 3,
  /** Box-blur passes over the raw height field. */
  smoothingPasses: 2,
  /** Required fraction of land tiles with slope <= maxBuildSlope. */
  minBuildableFraction: 0.7,
  /** Extra blur passes tried before the flatten fallback kicks in. */
  maxSmoothingAttempts: 6,
  /** Largest slope (level difference to a neighbour) that stays buildable. */
  maxBuildSlope: 1,
  /** Cost multiplier for building on a sloped (slope >= 1) tile. */
  slopeCostFactor: 1.25,
  /** Wind turbine output bonus per elevation level of its tile. */
  windBonusPerLevel: 0.06,
  /** Run-of-river output bonus per level of drop at the plant tile. */
  hydroDropBonus: 0.2,
  /** Pumped-storage capacity/power bonus per level of head above the lake. */
  headBonusPerLevel: 0.12,
},
```

`src/shared/types.ts` — in `TileDiff`, after `terrain: Terrain;`:

```ts
/** Elevation level 0..7 (immutable after map generation). */
elevation: number;
```

`src/sim/state.ts`:

- `TileLayers`: add `/** Elevation level 0..7, generated per map. Immutable afterwards. */ elevation: Uint8Array;` after `terrain`.
- `createTileLayers`: add `elevation: new Uint8Array(tiles),` after `terrain`.
- `collectDiffs`: add `elevation: layers.elevation[index],` to the pushed object.
- New functions next to `isLakeShore`:

```ts
/** Steepness of a tile: the largest level difference to a 4-neighbour. */
export function slopeAt(state: SimState, index: number): number {
  const { elevation } = state.layers;
  let slope = 0;
  for (const n of neighbors4(index, state.size)) {
    slope = Math.max(slope, Math.abs(elevation[index] - elevation[n]));
  }
  return slope;
}

/** Building on a slope costs extra earthworks. */
export function slopeCostMultiplier(state: SimState, index: number): number {
  return slopeAt(state, index) > 0 ? BALANCE.terrain.slopeCostFactor : 1;
}
```

Do NOT add elevation to `snapshotTile`/`UndoEntry` (immutable) or to `serializeState` yet (Task 6).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run src/sim/state.test.ts` — PASS. Then `pnpm typecheck` — the new required `TileDiff.elevation` must not break other files (only `collectDiffs` constructs `TileDiff`s; test factories in render/UI tests may need the field added — fix any that fail).

- [ ] **Step 5: Format and commit**

```bash
pnpm format
git add -A && git commit -m "feat(sim): elevation layer, slope helpers and BALANCE.terrain"
```

---

### Task 2: generateTerrain

**Files:**

- Create: `src/sim/terrain.ts`
- Test: `src/sim/terrain.test.ts`

**Interfaces:**

- Consumes: `Rng`, `BALANCE.terrain`, `markDirty`, `SimState`.
- Produces: `generateTerrain(state: SimState): void` — fills `state.layers.elevation` deterministically from `state.seed` (own salt `0x7e44a1`), guarantees the buildable-land fraction, marks non-zero tiles dirty. Runs BEFORE `generateWater`.

- [ ] **Step 1: Write the failing tests** (`src/sim/terrain.test.ts`)

```ts
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../shared/constants.ts';
import { createSimState } from './state.ts';
import { generateTerrain } from './terrain.ts';

const SIZES = [48, 64, 96];

function buildableFraction(elevation: Uint8Array, size: number): number {
  let ok = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const level = elevation[y * size + x];
      let slope = 0;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        slope = Math.max(slope, Math.abs(level - elevation[ny * size + nx]));
      }
      if (slope <= BALANCE.terrain.maxBuildSlope) ok++;
    }
  }
  return ok / (size * size);
}

describe('generateTerrain', () => {
  it('is deterministic per seed and differs between seeds', () => {
    const a = createSimState(42, 64);
    const b = createSimState(42, 64);
    const c = createSimState(43, 64);
    generateTerrain(a);
    generateTerrain(b);
    generateTerrain(c);
    expect([...a.layers.elevation]).toEqual([...b.layers.elevation]);
    expect([...a.layers.elevation]).not.toEqual([...c.layers.elevation]);
  });

  it('stays within 0..maxLevel and uses more than one level', () => {
    for (const seed of [1, 7, 99]) {
      const state = createSimState(seed, 64);
      generateTerrain(state);
      const levels = new Set(state.layers.elevation);
      expect(Math.max(...levels)).toBeLessThanOrEqual(BALANCE.terrain.maxLevel);
      expect(levels.size).toBeGreaterThan(2);
    }
  });

  it('keeps enough buildable land on every map size', () => {
    for (const size of SIZES) {
      for (const seed of [1, 2, 3]) {
        const state = createSimState(seed, size);
        generateTerrain(state);
        expect(buildableFraction(state.layers.elevation, size)).toBeGreaterThanOrEqual(
          BALANCE.terrain.minBuildableFraction,
        );
      }
    }
  });

  it('marks raised tiles dirty', () => {
    const state = createSimState(5, 48);
    generateTerrain(state);
    for (let i = 0; i < state.layers.elevation.length; i++) {
      if (state.layers.elevation[i] > 0) expect(state.dirty.has(i)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm exec vitest run src/sim/terrain.test.ts` (module not found).

- [ ] **Step 3: Implement `src/sim/terrain.ts`**

```ts
import { BALANCE } from '../shared/constants.ts';
import { Rng } from '../shared/rng.ts';
import { markDirty, type SimState } from './state.ts';

/** Keeps relief generation independent of water gen and the gameplay RNG. */
const TERRAIN_SEED_SALT = 0x7e44a1;

/**
 * Generate the map's relief: seeded value noise plus a tilt toward one
 * seed-chosen edge, smoothed and quantised to levels 0..maxLevel. Extra
 * smoothing (and, as a last resort, flattening toward the mean) runs
 * until enough land is buildable. Deterministic per seed; elevation
 * never changes afterwards.
 */
export function generateTerrain(state: SimState): void {
  const rng = new Rng((state.seed ^ TERRAIN_SEED_SALT) >>> 0);
  const { size } = state;
  const cfg = BALANCE.terrain;

  // Octaves of value noise, combined and normalised to 0..1.
  const field = new Float32Array(size * size);
  let totalWeight = 0;
  for (let octave = 0; octave < cfg.octaveWeights.length; octave++) {
    const weight = cfg.octaveWeights[octave];
    const noise = valueNoise(rng, size, Math.max(2, cfg.noiseCellSize / 2 ** octave));
    for (let i = 0; i < field.length; i++) field[i] += weight * noise[i];
    totalWeight += weight;
  }
  // Shape the distribution toward low levels, then tilt toward one edge.
  const tiltEdge = rng.nextInt(4); // 0=+x, 1=-x, 2=+y, 3=-y rises
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const shaped = (field[i] / totalWeight) ** cfg.noiseExponent;
      const along =
        tiltEdge === 0 ? x : tiltEdge === 1 ? size - 1 - x : tiltEdge === 2 ? y : size - 1 - y;
      const tilt = (along / (size - 1)) * cfg.tiltLevels;
      field[i] = shaped * (cfg.maxLevel - cfg.tiltLevels) + tilt;
    }
  }

  for (let pass = 0; pass < cfg.smoothingPasses; pass++) boxBlur(field, size);
  const { elevation } = state.layers;
  quantize(field, elevation, cfg.maxLevel);

  // Buildable-land guarantee: blur more, then flatten toward the mean.
  let attempts = 0;
  while (buildableFraction(elevation, size, cfg.maxBuildSlope) < cfg.minBuildableFraction) {
    if (attempts < cfg.maxSmoothingAttempts) {
      boxBlur(field, size);
      quantize(field, elevation, cfg.maxLevel);
      attempts++;
    } else {
      // Deterministic fallback: converges to a constant field (fraction 1).
      const mean = field.reduce((sum, v) => sum + v, 0) / field.length;
      for (let i = 0; i < field.length; i++) field[i] = (field[i] + mean) / 2;
      quantize(field, elevation, cfg.maxLevel);
    }
  }

  for (let i = 0; i < elevation.length; i++) {
    if (elevation[i] > 0) markDirty(state, i);
  }
}

/** Seeded value noise: smooth bilinear interpolation over a random lattice. */
function valueNoise(rng: Rng, size: number, cellSize: number): Float32Array {
  const cells = Math.ceil(size / cellSize) + 2;
  const lattice = new Float32Array(cells * cells);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rng.next();
  const field = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = x / cellSize;
      const gy = y / cellSize;
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const tx = smoothstep(gx - x0);
      const ty = smoothstep(gy - y0);
      const v00 = lattice[y0 * cells + x0];
      const v10 = lattice[y0 * cells + x0 + 1];
      const v01 = lattice[(y0 + 1) * cells + x0];
      const v11 = lattice[(y0 + 1) * cells + x0 + 1];
      const top = v00 + (v10 - v00) * tx;
      const bottom = v01 + (v11 - v01) * tx;
      field[y * size + x] = top + (bottom - top) * ty;
    }
  }
  return field;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** In-place 3x3 box blur (edge tiles average their in-bounds window). */
function boxBlur(field: Float32Array, size: number): void {
  const source = field.slice();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          sum += source[ny * size + nx];
          count++;
        }
      }
      field[y * size + x] = sum / count;
    }
  }
}

function quantize(field: Float32Array, elevation: Uint8Array, maxLevel: number): void {
  for (let i = 0; i < field.length; i++) {
    elevation[i] = Math.min(maxLevel, Math.max(0, Math.round(field[i])));
  }
}

function buildableFraction(elevation: Uint8Array, size: number, maxSlope: number): number {
  let ok = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const level = elevation[y * size + x];
      let slope = 0;
      if (x > 0) slope = Math.max(slope, Math.abs(level - elevation[y * size + x - 1]));
      if (x < size - 1) slope = Math.max(slope, Math.abs(level - elevation[y * size + x + 1]));
      if (y > 0) slope = Math.max(slope, Math.abs(level - elevation[(y - 1) * size + x]));
      if (y < size - 1) slope = Math.max(slope, Math.abs(level - elevation[(y + 1) * size + x]));
      if (slope <= maxSlope) ok++;
    }
  }
  return ok / (size * size);
}
```

If a generation-shape test fails (e.g. only 2 levels used), tune `noiseExponent`/`tiltLevels` in `BALANCE.terrain`, not the test, unless the test's expectation is wrong.

- [ ] **Step 4: Run to verify pass** — `pnpm exec vitest run src/sim/terrain.test.ts`.

- [ ] **Step 5: Format and commit**

```bash
pnpm format
git add -A && git commit -m "feat(sim): seeded terrain elevation generation"
```

---

### Task 3: River follows the terrain, lake basin, engine wiring

**Files:**

- Modify: `src/sim/water.ts` (route by height, carve, sink the lake)
- Modify: `src/sim/state.ts` (`SimState.lakeLevel`, `computeLakeLevel`)
- Modify: `src/sim/engine.ts:42-44` (call `generateTerrain` before `generateWater`)
- Test: `src/sim/water.test.ts` (additions), `src/sim/engine.test.ts` (one addition)

**Interfaces:**

- Consumes: `state.layers.elevation` (Task 1/2), `BALANCE.terrain.maxBuildSlope`.
- Produces: after `generateWater`, river elevation is monotonically non-increasing in flow direction; all Lake tiles share one level stored in `state.lakeLevel: number`; land neighbours of water sit at most `maxBuildSlope + 1` above it. `computeLakeLevel(state): number` (elevation of the first Lake tile, 0 without a lake).

- [ ] **Step 1: Write the failing tests** (append to `src/sim/water.test.ts`; reuse its existing helpers for creating states — read the file first and follow its patterns)

```ts
describe('water on terrain', () => {
  function generated(seed: number, size = 64) {
    const state = createSimState(seed, size);
    generateTerrain(state);
    generateWater(state);
    return state;
  }

  it('the river never flows uphill', () => {
    for (const seed of [1, 7, 42]) {
      const state = generated(seed);
      const { size } = state;
      const { terrain, elevation } = state.layers;
      // Row levels along both axes: the min water level per row must be
      // monotonic in one direction (entry high, exit low).
      for (const vertical of [true, false]) {
        const rows: number[] = [];
        for (let along = 0; along < size; along++) {
          let level = Infinity;
          for (let lateral = 0; lateral < size; lateral++) {
            const x = vertical ? lateral : along;
            const y = vertical ? along : lateral;
            const i = y * size + x;
            if (terrain[i] !== Terrain.Land) level = Math.min(level, elevation[i]);
          }
          if (level !== Infinity) rows.push(level);
        }
        if (rows.length < size) continue; // river runs along the other axis
        const increasing = rows.every((v, i) => i === 0 || v >= rows[i - 1]);
        const decreasing = rows.every((v, i) => i === 0 || v <= rows[i - 1]);
        expect(increasing || decreasing).toBe(true);
      }
    }
  });

  it('all lake tiles share the lake level', () => {
    const state = generated(3);
    const { terrain, elevation } = state.layers;
    let lakeTiles = 0;
    for (let i = 0; i < terrain.length; i++) {
      if (terrain[i] === Terrain.Lake) {
        lakeTiles++;
        expect(elevation[i]).toBe(state.lakeLevel);
      }
    }
    expect(lakeTiles).toBeGreaterThan(0);
    expect(computeLakeLevel(state)).toBe(state.lakeLevel);
  });

  it('banks stay within the relaxed slope limit', () => {
    const state = generated(5);
    const { size } = state;
    const { terrain, elevation } = state.layers;
    const limit = BALANCE.terrain.maxBuildSlope + 1;
    for (let i = 0; i < terrain.length; i++) {
      if (terrain[i] === Terrain.Land) continue;
      for (const n of neighbors4(i, size)) {
        if (terrain[n] === Terrain.Land) {
          expect(elevation[n] - elevation[i]).toBeLessThanOrEqual(limit);
        }
      }
    }
  });
});
```

Also extend the existing determinism test (or add one) so it runs `generateTerrain` before `generateWater` for both states, and add to `src/sim/engine.test.ts`:

```ts
it('init generates terrain before water', () => {
  const engine = new SimEngine(1, 48);
  engine.applyCommand({ type: 'init', seed: 9, size: 48 });
  const { elevation, terrain } = engine.state.layers;
  expect(elevation.some((v) => v > 0)).toBe(true);
  expect(terrain.some((v) => v !== Terrain.Land)).toBe(true);
});
```

(Match the actual `init` command shape used by existing engine tests.)

- [ ] **Step 2: Run to verify failure** — `pnpm exec vitest run src/sim/water.test.ts src/sim/engine.test.ts`.

- [ ] **Step 3: Implement**

`src/sim/state.ts`:

- `SimState` gains `/** Elevation of the lake surface (derived; recomputed on load). */ lakeLevel: number;`, initialised to `0` in `createSimState`.
- New export:

```ts
/** Lake surface level: the (uniform) elevation of the lake tiles. */
export function computeLakeLevel(state: SimState): number {
  const { terrain, elevation } = state.layers;
  for (let i = 0; i < terrain.length; i++) {
    if (terrain[i] === Terrain.Lake) return elevation[i];
  }
  return 0;
}
```

`src/sim/engine.ts` — in the `init` branch:

```ts
this.state = createSimState(command.seed, command.size, command.startingMoney);
generateTerrain(this.state);
generateWater(this.state);
```

(import `generateTerrain` from `./terrain.ts`).

`src/sim/water.ts` — keep the overall structure (axis, centre line, rasterisation, lake ellipse, dirty marking) and make these changes:

1. **Flow direction.** After choosing `axis`, compare the mean elevation of the first and last along-rows (in axis space) and remember `const reversed = meanRow(0) < meanRow(size - 1);` — flow runs from the higher edge to the lower one:

```ts
const { elevation } = state.layers;
const meanRow = (along: number): number => {
  let sum = 0;
  for (let lateral = 0; lateral < size; lateral++) {
    const x = axis.vertical ? lateral : along;
    const y = axis.vertical ? along : lateral;
    sum += elevation[tileIndex(x, y, size)];
  }
  return sum / size;
};
const reversed = meanRow(0) < meanRow(size - 1);
```

2. **Height-aware lateral steps.** In the rasterisation loop, replace the pure centre-line step with steepest descent, meander as tie-breaker. Also record each row's painted river tiles for the carving pass:

```ts
const elevationAt = (along: number, lateral: number): number => {
  const x = axis.vertical ? lateral : along;
  const y = axis.vertical ? along : lateral;
  return inBounds(x, y, size) ? elevation[tileIndex(x, y, size)] : Number.POSITIVE_INFINITY;
};
const riverRows: number[][] = Array.from({ length: size }, () => []);
```

and inside the loop (`along > 0` case):

```ts
const target = centreLine(along / (size - 1));
let lateral = previous;
if (along > 0) {
  let best = Number.POSITIVE_INFINITY;
  for (const candidate of [previous - 1, previous, previous + 1]) {
    if (candidate < lateralMin || candidate > lateralMax) continue;
    // Lowest ground wins; the meander target breaks ties.
    const cost = elevationAt(along, candidate) + Math.abs(candidate - target) * 0.01;
    if (cost < best) {
      best = cost;
      lateral = candidate;
    }
  }
} else {
  lateral = target;
}
```

Change `setTerrain` to also record river tiles: where the loop paints `Terrain.River` (the `lo..hi` span and the wide-section tile), push the painted tile index into `riverRows[along]`.

3. **Carving pass** (after the raster loop, before the lake):

```ts
// The river carves: levels are monotonically non-increasing downstream.
let level = Number.POSITIVE_INFINITY;
for (let step = 0; step < size; step++) {
  const along = reversed ? size - 1 - step : step;
  for (const i of riverRows[along]) level = Math.min(level, elevation[i]);
  for (const i of riverRows[along]) elevation[i] = level;
}
```

4. **Lake basin** (after the ellipse painting): collect all lake tiles, sink them to their minimum level, remember the last along-row the lake touches (in flow order), and clamp the river downstream of it:

```ts
const lakeTiles: number[] = [];
for (let i = 0; i < size * size; i++) {
  if (terrain[i] === Terrain.Lake) lakeTiles.push(i);
}
let lakeLevel = 0;
if (lakeTiles.length > 0) {
  lakeLevel = Math.min(...lakeTiles.map((i) => elevation[i]));
  for (const i of lakeTiles) elevation[i] = lakeLevel;
  // Water leaving the lake keeps flowing downhill.
  const alongOf = (i: number): number => (axis.vertical ? Math.floor(i / size) : i % size);
  const lakeAlongs = lakeTiles.map(alongOf);
  const lastAlong = reversed ? Math.min(...lakeAlongs) : Math.max(...lakeAlongs);
  for (let step = 0; step < size; step++) {
    const along = reversed ? size - 1 - step : step;
    const pastLake = reversed ? along < lastAlong : along > lastAlong;
    if (!pastLake) continue;
    for (const i of riverRows[along]) elevation[i] = Math.min(elevation[i], lakeLevel);
  }
}
state.lakeLevel = lakeLevel;
```

5. **Bank relaxation** (after the lake): for every water tile, clamp land 4-neighbours:

```ts
const bankLimit = BALANCE.terrain.maxBuildSlope + 1;
for (let i = 0; i < size * size; i++) {
  if (terrain[i] === Terrain.Land) continue;
  for (const n of neighbors4(i, size)) {
    if (terrain[n] !== Terrain.Land) continue;
    if (elevation[n] > elevation[i] + bankLimit) {
      elevation[n] = elevation[i] + bankLimit;
      markDirty(state, n);
    }
  }
}
```

(import `neighbors4` from `../shared/grid.ts`). Carving/sinking changes elevation on already-dirty water tiles; also `markDirty` any river/lake tile whose elevation changed if it isn't marked already (the final `terrain !== Land → markDirty` loop already covers water tiles; the bank tiles need the explicit call above).

- [ ] **Step 4: Run the sim suite** — `pnpm exec vitest run src/sim` (the whole sim folder: water changes can ripple into growth/vehicle tests that build cities on water maps). All PASS.

- [ ] **Step 5: Format and commit**

```bash
pnpm format
git add -A && git commit -m "feat(sim): river follows the terrain downhill, lake sits in a basin"
```

---

### Task 4: Build rules — tooSteep and the slope surcharge

**Files:**

- Modify: `src/sim/state.ts:369-413` (`buildRejection`)
- Modify: `src/sim/roads.ts:51-56` (road/bridge cost)
- Modify: `src/sim/zones.ts:24` (zone cost)
- Modify: `src/sim/powerLines.ts:39-43` (`powerLineTileCost`)
- Modify: `src/sim/energy.ts:45` (`placePlant` cost)
- Test: `src/sim/state.test.ts`, `src/sim/roads.test.ts`, `src/sim/zones.test.ts`, `src/sim/powerLines.test.ts`, `src/sim/energy.test.ts`

**Interfaces:**

- Consumes: `slopeAt`, `slopeCostMultiplier` (Task 1).
- Produces: `buildRejection` returns `'tooSteep'` for every intent on tiles with `slopeAt > BALANCE.terrain.maxBuildSlope` (water rejections keep precedence); all four build paths charge `Math.round(base * slopeCostMultiplier(state, index))` per tile.

- [ ] **Step 1: Write the failing tests**

`src/sim/state.test.ts`:

```ts
describe('tooSteep', () => {
  function steepState() {
    const state = createSimState(1, 8);
    // A cliff: centre at 3, east neighbour at 0 -> slope 3 on both tiles.
    state.layers.elevation[tileIndex(3, 3, 8)] = 3;
    return state;
  }

  it('rejects every intent on a steep tile', () => {
    const state = steepState();
    const steep = tileIndex(3, 3, 8);
    expect(buildRejection(state, steep, BuildIntent.Road)).toBe('tooSteep');
    expect(buildRejection(state, steep, BuildIntent.Zone)).toBe('tooSteep');
    expect(buildRejection(state, steep, BuildIntent.Plant, PlantType.SolarFarm)).toBe('tooSteep');
    expect(buildRejection(state, steep, BuildIntent.PowerLine)).toBe('tooSteep');
  });

  it('water rejections win over tooSteep', () => {
    const state = steepState();
    const steep = tileIndex(3, 3, 8);
    state.layers.terrain[steep] = Terrain.Lake;
    expect(buildRejection(state, steep, BuildIntent.Zone)).toBe('cannotBuildOnWater');
  });

  it('a steep river tile cannot carry a bridge', () => {
    const state = steepState();
    const steep = tileIndex(3, 3, 8);
    state.layers.terrain[steep] = Terrain.River;
    expect(buildRejection(state, steep, BuildIntent.Road)).toBe('tooSteep');
  });
});
```

`src/sim/roads.test.ts` — slope surcharge:

```ts
it('charges the slope surcharge on sloped road tiles', () => {
  const state = createSimState(1, 8);
  state.layers.elevation[tileIndex(1, 0, 8)] = 1; // makes tile (0,0) slope 1
  const before = state.money;
  buildRoads(state, [tileIndex(0, 0, 8)]);
  expect(before - state.money).toBe(
    Math.round(BALANCE.costs.roadPerTile * BALANCE.terrain.slopeCostFactor),
  );
});
```

Analogous single tests in `zones.test.ts` (`paintZones` on a slope-1 tile costs `Math.round(zonePerTile * slopeCostFactor)`), `powerLines.test.ts` (`powerLineTileCost` on a slope-1 land tile), and `energy.test.ts` (`placePlant` of a `SolarFarm` on a slope-1 tile charges `Math.round(cost * factor)`).

- [ ] **Step 2: Run to verify failure** — `pnpm exec vitest run src/sim/state.test.ts src/sim/roads.test.ts src/sim/zones.test.ts src/sim/powerLines.test.ts src/sim/energy.test.ts`.

- [ ] **Step 3: Implement**

`src/sim/state.ts` — restructure `buildRejection` so water checks come first, then the slope gate, then the rest (full replacement of the function body after the occupancy checks):

```ts
export function buildRejection(
  state: SimState,
  index: number,
  intent: BuildIntent,
  plant: PlantType = PlantType.None,
): string | null {
  const { layers } = state;
  if (intent === BuildIntent.PowerLine) {
    // Lines share tiles with roads and water but never with buildings or plants.
    if (layers.density[index] !== 0 || layers.tileType[index] === TileType.Plant) {
      return 'needsLineSite';
    }
    if (slopeAt(state, index) > BALANCE.terrain.maxBuildSlope) return 'tooSteep';
    return null;
  }
  if (layers.tileType[index] !== TileType.Empty || layers.density[index] !== 0) {
    return 'tileOccupied';
  }
  // Zones and plants would collide with a line; roads may share the tile.
  if (intent !== BuildIntent.Road && layers.powerLine[index] !== 0) {
    return 'tileOccupied';
  }
  const terrain = layers.terrain[index] as Terrain;
  const wantsRiver = intent === BuildIntent.Plant && plant === PlantType.RunOfRiver;
  if (terrain === Terrain.Lake) return 'cannotBuildOnWater';
  if (terrain === Terrain.River && !(intent === BuildIntent.Road || wantsRiver)) {
    return 'cannotBuildOnWater';
  }
  if (wantsRiver && terrain !== Terrain.River) return 'needsRiverTile';
  // Steep tiles reject everything the water rules did not already veto.
  if (slopeAt(state, index) > BALANCE.terrain.maxBuildSlope) return 'tooSteep';
  if (terrain === Terrain.River) return null; // bridge or run-of-river
  if (
    intent === BuildIntent.Plant &&
    plant === PlantType.PumpedStorage &&
    !isLakeShore(state, index)
  ) {
    return 'needsLakeShore';
  }
  if (
    intent === BuildIntent.Plant &&
    (plant === PlantType.FireStation || plant === PlantType.PoliceStation) &&
    !neighbors4(index, state.size).some((n) => layers.tileType[n] === TileType.Road)
  ) {
    return 'needsRoad';
  }
  return null;
}
```

Costs:

- `src/sim/roads.ts`: `const cost = buildable.reduce((sum, index) => sum + Math.round((layers.terrain[index] === Terrain.River ? bridgePerTile : roadPerTile) * slopeCostMultiplier(state, index)), 0);`
- `src/sim/zones.ts`: `const cost = paintable.reduce((sum, index) => sum + Math.round(BALANCE.costs.zonePerTile * slopeCostMultiplier(state, index)), 0);`
- `src/sim/powerLines.ts`:

```ts
export function powerLineTileCost(state: SimState, index: number): number {
  const base =
    state.layers.terrain[index] === Terrain.Land
      ? BALANCE.costs.powerLinePerTile
      : BALANCE.costs.powerLineWaterPerTile;
  return Math.round(base * slopeCostMultiplier(state, index));
}
```

- `src/sim/energy.ts` (`placePlant`): `const cost = Math.round(BALANCE.costs.plant[plant] * slopeCostMultiplier(state, tile));`

Import `slopeCostMultiplier` from `./state.ts` in each file.

- [ ] **Step 4: Run the full sim suite** — `pnpm exec vitest run src/sim`. Water-map tests may now reject builds near carved banks; if a pre-existing test builds on a tile that is legitimately steep under the new rules, flatten that test's elevation explicitly (`state.layers.elevation.fill(0)` is the default — only generated maps have relief), do NOT weaken the rule.

- [ ] **Step 5: Format and commit**

```bash
pnpm format
git add -A && git commit -m "feat(sim): steep tiles reject builds, slopes carry a cost surcharge"
```

---

### Task 5: Energy bonuses (wind elevation, hydro drop, pumped head) and inspector data

**Files:**

- Modify: `src/sim/state.ts` (`riverDropAt`, `pumpedHeadAt`, `totalPumpedStorageCapacity`)
- Modify: `src/sim/energy.ts` (`PlantCensus` + `censusPlants` + `energyStep`)
- Modify: `src/sim/inspect.ts` (per-tile generation/storage, new `TileInfo` fields)
- Modify: `src/shared/types.ts` (`TileInfo` gains `elevation`, `slope`, `terrainBonus`)
- Test: `src/sim/energy.test.ts`, `src/sim/inspect.test.ts`

**Interfaces:**

- Consumes: `state.layers.elevation`, `state.lakeLevel`, `BALANCE.terrain`.
- Produces:
  - `riverDropAt(state, index): number` — plant tile's elevation minus its lowest water 4-neighbour, ≥ 0.
  - `pumpedHeadAt(state, index): number` — `max(0, elevation[index] - state.lakeLevel)`.
  - `PlantCensus` gains `windCapacity: number`, `hydroCapacity: number`, `pumpedCapacity: number` (sums of per-plant bonus factors; equal to the plant counts on flat maps).
  - `energyStep` uses `census.windCapacity * windPeakOutput * windFactor`, `census.hydroCapacity * hydroPeakOutput * riverFlowFactor`, `census.pumpedCapacity * pumpedStorageCapacity` (and `...PowerLimit`).
  - `TileInfo` gains `elevation: number; slope: number; terrainBonus: number` (bonus factor of the tile's plant, 1 when none).

- [ ] **Step 1: Write the failing tests**

`src/sim/energy.test.ts` (follow the file's existing state-setup helpers):

```ts
describe('terrain energy bonuses', () => {
  it('flat maps reproduce the unbonused outputs', () => {
    const state = createSimState(1, 16);
    placeAt(state, 3, 3, PlantType.WindTurbine); // use the file's helper
    state.weather.windSpeed = 1;
    energyStep(state, { chargingDemand: 0 });
    expect(state.lastEnergy.wind).toBeCloseTo(BALANCE.energy.windPeakOutput);
  });

  it('wind turbines earn the elevation bonus', () => {
    const state = createSimState(1, 16);
    const tile = tileIndex(3, 3, 16);
    state.layers.elevation[tile] = 7;
    // Keep the tile buildable for the placement helper: raise neighbours too.
    for (const n of neighbors4(tile, 16)) state.layers.elevation[n] = 7;
    placeAt(state, 3, 3, PlantType.WindTurbine);
    state.weather.windSpeed = 1;
    energyStep(state, { chargingDemand: 0 });
    expect(state.lastEnergy.wind).toBeCloseTo(
      BALANCE.energy.windPeakOutput * (1 + BALANCE.terrain.windBonusPerLevel * 7),
    );
  });

  it('run-of-river earns the drop bonus', () => {
    const state = createSimState(1, 16);
    const tile = tileIndex(3, 3, 16);
    const downstream = tileIndex(3, 4, 16);
    state.layers.terrain[tile] = Terrain.River;
    state.layers.terrain[downstream] = Terrain.River;
    state.layers.elevation[tile] = 2; // drop of 2 to the downstream tile at 0
    placeAt(state, 3, 3, PlantType.RunOfRiver);
    state.weather.riverFlow = 1;
    energyStep(state, { chargingDemand: 0 });
    expect(state.lastEnergy.hydro).toBeCloseTo(
      BALANCE.energy.hydroPeakOutput * (1 + BALANCE.terrain.hydroDropBonus * 2),
    );
  });

  it('pumped storage capacity grows with head above the lake', () => {
    const state = createSimState(1, 16);
    const shore = tileIndex(3, 3, 16);
    state.layers.terrain[tileIndex(3, 4, 16)] = Terrain.Lake;
    state.layers.elevation[shore] = 3;
    state.lakeLevel = 1; // head = 2
    placeAt(state, 3, 3, PlantType.PumpedStorage);
    const factor = 1 + BALANCE.terrain.headBonusPerLevel * 2;
    expect(totalPumpedStorageCapacity(state)).toBeCloseTo(
      BALANCE.energy.pumpedStorageCapacity * factor,
    );
    // The clamp uses the boosted capacity.
    state.pumpedStorageEnergy = BALANCE.energy.pumpedStorageCapacity * factor + 500;
    energyStep(state, { chargingDemand: 0 });
    expect(state.pumpedStorageEnergy).toBeLessThanOrEqual(
      BALANCE.energy.pumpedStorageCapacity * factor,
    );
  });
});
```

(If placement helpers reject due to slope, set the surrounding elevation so `slopeAt ≤ 1`, as shown.)

`src/sim/inspect.test.ts`:

```ts
it('reports elevation, slope and the plant terrain bonus', () => {
  const state = createSimState(1, 16);
  const tile = tileIndex(3, 3, 16);
  state.layers.elevation[tile] = 4;
  for (const n of neighbors4(tile, 16)) state.layers.elevation[n] = 4;
  placeAt(state, 3, 3, PlantType.WindTurbine);
  const info = inspectTile(state, tile)!;
  expect(info.elevation).toBe(4);
  expect(info.slope).toBe(0);
  expect(info.terrainBonus).toBeCloseTo(1 + BALANCE.terrain.windBonusPerLevel * 4);
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm exec vitest run src/sim/energy.test.ts src/sim/inspect.test.ts`.

- [ ] **Step 3: Implement**

`src/sim/state.ts` (near `slopeAt`):

```ts
/** Levels of drop from a river tile to its lowest water 4-neighbour. */
export function riverDropAt(state: SimState, index: number): number {
  const { terrain, elevation } = state.layers;
  let lowest = elevation[index];
  for (const n of neighbors4(index, state.size)) {
    if (terrain[n] !== Terrain.Land) lowest = Math.min(lowest, elevation[n]);
  }
  return elevation[index] - lowest;
}

/** Head of a pumped-storage site: its height above the lake surface. */
export function pumpedHeadAt(state: SimState, index: number): number {
  return Math.max(0, state.layers.elevation[index] - state.lakeLevel);
}
```

Replace `totalPumpedStorageCapacity`:

```ts
export function totalPumpedStorageCapacity(state: SimState): number {
  const { tileType, plantType } = state.layers;
  let capacity = 0;
  for (let i = 0; i < tileType.length; i++) {
    if (tileType[i] !== TileType.Plant || plantType[i] !== PlantType.PumpedStorage) continue;
    capacity +=
      (1 + BALANCE.terrain.headBonusPerLevel * pumpedHeadAt(state, i)) *
      BALANCE.energy.pumpedStorageCapacity;
  }
  return capacity;
}
```

`src/sim/energy.ts`:

- `PlantCensus` gains the three fields (doc comments as in Interfaces); initialise to 0 in `censusPlants`.
- In the census `switch`, extend the three cases:

```ts
case PlantType.WindTurbine:
  census.windTurbines++;
  census.windCapacity +=
    1 + BALANCE.terrain.windBonusPerLevel * state.layers.elevation[i];
  break;
case PlantType.RunOfRiver:
  census.runOfRiverPlants++;
  census.hydroCapacity += 1 + BALANCE.terrain.hydroDropBonus * riverDropAt(state, i);
  break;
case PlantType.PumpedStorage:
  census.pumpedStoragePlants++;
  census.pumpedCapacity += 1 + BALANCE.terrain.headBonusPerLevel * pumpedHeadAt(state, i);
  break;
```

- In `energyStep` replace:

```ts
const wind = census.windCapacity * BALANCE.energy.windPeakOutput * currentWindFactor(state);
const hydro = census.hydroCapacity * BALANCE.energy.hydroPeakOutput * riverFlowFactor(state);
...
const pumpedCapacity = census.pumpedCapacity * BALANCE.energy.pumpedStorageCapacity;
const pumpedPowerLimit = census.pumpedCapacity * BALANCE.energy.pumpedStoragePowerLimit;
```

`src/shared/types.ts` — `TileInfo` gains:

```ts
/** Elevation level 0..7 of this tile. */
elevation: number;
/** Largest level difference to a neighbour (>= 2 is unbuildable). */
slope: number;
/** Terrain bonus factor on this tile's plant output/capacity (1 = none). */
terrainBonus: number;
```

`src/sim/inspect.ts`:

- `plantGeneration(state, plant, index)`: wind case multiplies generation AND peak by `1 + BALANCE.terrain.windBonusPerLevel * state.layers.elevation[index]`; run-of-river case by `1 + BALANCE.terrain.hydroDropBonus * riverDropAt(state, index)`.
- `plantStorage(state, plant, index)`: pumped case's `capacity` becomes `BALANCE.energy.pumpedStorageCapacity * (1 + BALANCE.terrain.headBonusPerLevel * pumpedHeadAt(state, index))` (stored share stays the equal split).
- In `inspectTile`, compute and return the three new fields:

```ts
const elevation = layers.elevation[index];
const slope = slopeAt(state, index);
const terrainBonus =
  tileType === TileType.Plant
    ? plant === PlantType.WindTurbine
      ? 1 + BALANCE.terrain.windBonusPerLevel * elevation
      : plant === PlantType.RunOfRiver
        ? 1 + BALANCE.terrain.hydroDropBonus * riverDropAt(state, index)
        : plant === PlantType.PumpedStorage
          ? 1 + BALANCE.terrain.headBonusPerLevel * pumpedHeadAt(state, index)
          : 1
    : 1;
```

- [ ] **Step 4: Run the sim suite** — `pnpm exec vitest run src/sim`. Existing energy tests must pass unchanged (flat maps ⇒ factors are exactly the counts).

- [ ] **Step 5: Format and commit**

```bash
pnpm format
git add -A && git commit -m "feat(sim): wind, run-of-river and pumped storage earn terrain bonuses"
```

---

### Task 6: Save games and JSON export

**Files:**

- Modify: `src/shared/types.ts:374` (`SaveGame.layers.elevation?: ArrayBuffer`)
- Modify: `src/sim/state.ts` (`serializeState`, `deserializeState`)
- Modify: `src/storage/serialization.ts:115` (`optionalLayers`)
- Test: `src/sim/engine.test.ts` or `src/sim/state.test.ts` (roundtrip), `src/storage/serialization.test.ts`

**Interfaces:**

- Consumes: `computeLakeLevel` (Task 3).
- Produces: saves carry the elevation layer; old saves load flat with `lakeLevel` recomputed (0 without a lake, since flat lakes sit at 0).

- [ ] **Step 1: Write the failing tests**

In `src/sim/state.test.ts`:

```ts
it('round-trips elevation and recomputes the lake level', () => {
  const state = createSimState(11, 48);
  generateTerrain(state);
  generateWater(state);
  const loaded = deserializeState(serializeState(state));
  expect([...loaded.layers.elevation]).toEqual([...state.layers.elevation]);
  expect(loaded.lakeLevel).toBe(state.lakeLevel);
});

it('loads saves without an elevation layer as flat maps', () => {
  const state = createSimState(11, 48);
  const save = serializeState(state);
  delete save.layers.elevation;
  const loaded = deserializeState(save);
  expect(loaded.layers.elevation.every((v) => v === 0)).toBe(true);
  expect(loaded.lakeLevel).toBe(0);
});
```

In `src/storage/serialization.test.ts`: extend the existing roundtrip test's expectations to include the `elevation` layer, plus one test that a JSON save without `layers.elevation` still parses.

- [ ] **Step 2: Run to verify failure** — `pnpm exec vitest run src/sim/state.test.ts src/storage/serialization.test.ts`.

- [ ] **Step 3: Implement**

- `SaveGame.layers`: add `/** Elevation layer; absent in older saves (flat map). */ elevation?: ArrayBuffer;`
- `serializeState`: add `elevation: copyBuffer(layers.elevation),` to `layers`.
- `deserializeState`: after the `terrain` block add

```ts
if (save.layers.elevation) state.layers.elevation.set(new Uint8Array(save.layers.elevation));
state.lakeLevel = computeLakeLevel(state);
```

- `serialization.ts`: `const optionalLayers = ['terrain', 'powerLine', 'elevation'] as const;`

- [ ] **Step 4: Run to verify pass** — `pnpm exec vitest run src/sim/state.test.ts src/storage/serialization.test.ts`.

- [ ] **Step 5: Format and commit**

```bash
pnpm format
git add -A && git commit -m "feat(storage): persist the elevation layer, flat fallback for old saves"
```

---

### Task 7: Render foundation — ElevationField, height-field ground, picking

**Files:**

- Create: `src/render/elevationField.ts`
- Modify: `src/render/terrain.ts` (ground becomes a height-field `DiffLayer`; grid follows the terrain)
- Modify: `src/render/picking.ts` (raycast the ground mesh, plane fallback)
- Modify: `src/render/renderer.ts` (wire field + ground, marker heights, expose `levelAt`/`slopeAt`)

**Interfaces:**

- Consumes: `TileDiff.elevation`.
- Produces:
  - `LEVEL_HEIGHT = 0.35` (world units per level) exported from `elevationField.ts`.
  - `class ElevationField implements DiffLayer` with `version: number`, `levelAt(index): number`, `centerY(index): number`, `cornerY(vx, vz): number` (mean of adjacent tile levels × `LEVEL_HEIGHT`), `surfaceY(x, z): number` (bilinear over the tile's corners), `slopeAt(index): number`.
  - `GroundMesh implements DiffLayer` replacing `createTerrain` (keeps `group`, `setGridVisible`, `setEnvironment`; exposes `ground: THREE.Mesh` for picking).
  - `pickTile(clientX, clientY, element, camera, gridSize, ground?: THREE.Object3D)` — mesh hit first, y=0 plane fallback.
  - `GameRenderer.levelAt(index)` and `GameRenderer.slopeAt(index)` for the UI (Task 10).

There are no WebGL unit tests (sandbox has no WebGL; visual check happens on the Mac). Correctness here is `pnpm typecheck` + `node scripts/smoke.mjs` + the later visual pass.

- [ ] **Step 1: Implement `src/render/elevationField.ts`**

```ts
import type { TileDiff } from '../shared/types.ts';
import type { DiffLayer } from './renderer.ts';

/** World height of one elevation level. */
export const LEVEL_HEIGHT = 0.35;

/**
 * Per-tile elevation tracked from sim diffs, shared by every render
 * layer. Registered as the FIRST diff layer so heights are current
 * before the other layers rebuild. Corner heights average the adjacent
 * tiles — that interpolation is what makes the slopes smooth.
 */
export class ElevationField implements DiffLayer {
  /** Incremented whenever any height changes; layers rebuild on change. */
  version = 0;
  private readonly levels: Uint8Array;
  private readonly size: number;

  constructor(gridSize: number) {
    this.size = gridSize;
    this.levels = new Uint8Array(gridSize * gridSize);
  }

  applyDiffs(diffs: TileDiff[]): void {
    let changed = false;
    for (const diff of diffs) {
      if (this.levels[diff.index] !== diff.elevation) {
        this.levels[diff.index] = diff.elevation;
        changed = true;
      }
    }
    if (changed) this.version++;
  }

  levelAt(index: number): number {
    return this.levels[index];
  }

  /** Largest level difference to a 4-neighbour (mirrors sim slopeAt). */
  slopeAt(index: number): number {
    const size = this.size;
    const x = index % size;
    const z = Math.floor(index / size);
    let slope = 0;
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
      slope = Math.max(slope, Math.abs(this.levels[index] - this.levels[nz * size + nx]));
    }
    return slope;
  }

  /** Tile centre height in world units (built tiles sit flat on this). */
  centerY(index: number): number {
    return this.levels[index] * LEVEL_HEIGHT;
  }

  /** Height of the ground-mesh vertex at integer corner (vx, vz). */
  cornerY(vx: number, vz: number): number {
    const size = this.size;
    let sum = 0;
    let count = 0;
    for (const [dx, dz] of [
      [-1, -1],
      [0, -1],
      [-1, 0],
      [0, 0],
    ] as const) {
      const x = vx + dx;
      const z = vz + dz;
      if (x < 0 || z < 0 || x >= size || z >= size) continue;
      sum += this.levels[z * size + x];
      count++;
    }
    return count > 0 ? (sum / count) * LEVEL_HEIGHT : 0;
  }

  /** Smooth ground height at a continuous tile-space position. */
  surfaceY(x: number, z: number): number {
    const size = this.size;
    const cx = Math.min(size - 1, Math.max(0, Math.floor(x)));
    const cz = Math.min(size - 1, Math.max(0, Math.floor(z)));
    const tx = Math.min(1, Math.max(0, x - cx));
    const tz = Math.min(1, Math.max(0, z - cz));
    const h00 = this.cornerY(cx, cz);
    const h10 = this.cornerY(cx + 1, cz);
    const h01 = this.cornerY(cx, cz + 1);
    const h11 = this.cornerY(cx + 1, cz + 1);
    const top = h00 + (h10 - h00) * tx;
    const bottom = h01 + (h11 - h01) * tx;
    return top + (bottom - top) * tz;
  }
}
```

- [ ] **Step 2: Rework `src/render/terrain.ts`**

Keep `groundColor` as is. Replace `createTerrain` with a class (the shape mirrors other diff layers):

```ts
/** Per-vertex brightness ramp so relief reads from the iso camera. */
const SHADE_LOW = 0.92;
const SHADE_SPAN = 0.1;

export class GroundMesh implements DiffLayer {
  readonly group: THREE.Group;
  readonly ground: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshLambertMaterial>;
  private readonly gridLines: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private readonly field: ElevationField;
  private readonly size: number;
  private appliedVersion = -1;

  constructor(size: number, field: ElevationField) {
    this.size = size;
    this.field = field;
    this.group = new THREE.Group();

    const geometry = new THREE.PlaneGeometry(size, size, size, size);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(size / 2, 0, size / 2);
    const colors = new Float32Array(geometry.attributes.position.count * 3).fill(1);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.MeshLambertMaterial({ color: PALETTE.ground, vertexColors: true });
    this.ground = new THREE.Mesh(geometry, material);
    this.ground.receiveShadow = true;
    this.group.add(this.ground);

    // Grid lines follow the terrain (a flat GridHelper would clip into hills).
    this.gridLines = new THREE.LineSegments(
      this.buildGridGeometry(),
      new THREE.LineBasicMaterial({
        color: PALETTE.grid,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
      }),
    );
    this.group.add(this.gridLines);
    this.rebuildHeights();
  }

  applyDiffs(): void {
    if (this.field.version !== this.appliedVersion) {
      this.appliedVersion = this.field.version;
      this.rebuildHeights();
    }
  }

  setEnvironment(environment: RenderEnvironment): void {
    groundColor(this.ground.material.color, environment.phase, environment.snowCover);
  }

  setGridVisible(visible: boolean): void {
    this.gridLines.visible = visible;
  }

  private rebuildHeights(): void {
    const position = this.ground.geometry.attributes.position;
    const color = this.ground.geometry.attributes.color;
    const maxY = 7 * LEVEL_HEIGHT;
    for (let i = 0; i < position.count; i++) {
      const vx = Math.round(position.getX(i));
      const vz = Math.round(position.getZ(i));
      const y = this.field.cornerY(vx, vz);
      position.setY(i, y);
      const shade = SHADE_LOW + SHADE_SPAN * (maxY > 0 ? y / maxY : 0);
      color.setXYZ(i, shade, shade, shade);
    }
    position.needsUpdate = true;
    color.needsUpdate = true;
    this.ground.geometry.computeVertexNormals();
    this.ground.geometry.computeBoundingSphere();
    this.rebuildGridHeights();
  }

  /** One line segment per tile edge, slightly above the ground. */
  private buildGridGeometry(): THREE.BufferGeometry {
    const size = this.size;
    const points: number[] = [];
    for (let v = 0; v <= size; v++) {
      for (let a = 0; a < size; a++) {
        points.push(a, 0, v, a + 1, 0, v); // lines along x at z = v
        points.push(v, 0, a, v, 0, a + 1); // lines along z at x = v
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(points), 3));
    return geometry;
  }

  private rebuildGridHeights(): void {
    const position = this.gridLines.geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      const vx = Math.round(position.getX(i));
      const vz = Math.round(position.getZ(i));
      position.setY(i, this.field.cornerY(vx, vz) + 0.02);
    }
    position.needsUpdate = true;
    this.gridLines.geometry.computeBoundingSphere();
  }
}
```

Add imports (`ElevationField`, `LEVEL_HEIGHT`, `DiffLayer`). Note the grid geometry allocates `4 * size * (size+1)` vertices once — fine for size ≤ 96.

- [ ] **Step 3: Rework `src/render/picking.ts`**

```ts
export function pickTile(
  clientX: number,
  clientY: number,
  element: HTMLElement,
  camera: THREE.Camera,
  gridSize: number,
  ground?: THREE.Object3D,
): { index: number; x: number; y: number } | null {
  const rect = element.getBoundingClientRect();
  pointerNdc.set(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(pointerNdc, camera);
  let point: THREE.Vector3 | null = null;
  if (ground) {
    const hit = raycaster.intersectObject(ground, false)[0];
    if (hit) point = hit.point;
  }
  if (!point) {
    if (!raycaster.ray.intersectPlane(groundPlane, hitPoint)) return null;
    point = hitPoint;
  }
  const x = Math.floor(point.x);
  const y = Math.floor(point.z);
  if (!inBounds(x, y, gridSize)) return null;
  return { index: tileIndex(x, y, gridSize), x, y };
}
```

`groundPointAtNdc` stays plane-based (it feeds the minimap view footprint, where the flat approximation is fine).

- [ ] **Step 4: Wire it in `src/render/renderer.ts`**

- Add fields `private readonly elevation: ElevationField;` and `private readonly groundMesh: GroundMesh;`.
- In the constructor, replace the `createTerrain` block with:

```ts
this.elevation = new ElevationField(gridSize);
this.addDiffLayer(this.elevation); // MUST be the first diff layer
this.groundMesh = new GroundMesh(gridSize, this.elevation);
this.addDiffLayer(this.groundMesh);
this.setGridVisible = (visible) => this.groundMesh.setGridVisible(visible);
this.setTerrainEnvironment = (environment) => this.groundMesh.setEnvironment(environment);
scene.add(this.groundMesh.group);
```

(or store the methods directly; keep the existing `setGridVisible`/`setTerrainEnvironment` field types.)

- `pick()` passes the mesh: `pickTile(e.clientX, e.clientY, this.webgl.domElement, this.isoCamera.camera, this.gridSize, this.groundMesh.ground)`.
- Marker heights gain the tile height (all in this file):
  - `updateHoverMarker`: `this.hoverMarker.position.set(tile.x + 0.5, 0.03 + this.elevation.centerY(tile.index), tile.y + 0.5);` and the radius ring `0.05 + centerY`.
  - `setSelectedTile`: marker `0.02 + centerY(index)`, ring `0.04 + centerY(index)`.
  - `setPreviewTiles`: `0.06 + this.elevation.centerY(index)`.
- Public accessors for the UI:

```ts
/** Elevation level of a tile, tracked from diffs. */
levelAt(index: number): number {
  return this.elevation.levelAt(index);
}

/** Slope (max level difference to a neighbour), tracked from diffs. */
slopeAt(index: number): number {
  return this.elevation.slopeAt(index);
}
```

- [ ] **Step 5: Verify and commit**

Run: `pnpm typecheck && pnpm exec vitest run && node scripts/smoke.mjs`
Expected: all pass (smoke boots headless without WebGL).

```bash
pnpm format
git add -A && git commit -m "feat(render): height-field ground mesh, elevation field and mesh picking"
```

---

### Task 8: Content layers, markers and vehicles follow the elevation

**Files:**

- Modify: `src/render/renderer.ts` (pass the field into the layer constructors)
- Modify: `src/render/waterMesh.ts`, `src/render/roadsMesh.ts`, `src/render/powerLinesMesh.ts`, `src/render/zoneTilesMesh.ts`, `src/render/buildingsMesh.ts`, `src/render/plantsMesh.ts`, `src/render/overlays.ts`, `src/render/iconsMesh.ts`, `src/render/vehiclesMesh.ts`

**Interfaces:**

- Consumes: `ElevationField.centerY(index)` / `surfaceY(x, z)` (Task 7).
- Produces: every world-space instance sits on its tile's centre height; vehicles ride the smooth surface.

Pattern for every layer: the constructor gains a trailing `elevation: ElevationField` parameter stored as `private readonly elevation`, and each place that writes a world-space y adds the tile's centre height. Elevation only changes at map generation / load, when every tile is dirty, so existing rebuild triggers already fire — no extra version tracking needed in the layers.

- [ ] **Step 1: Update the constructors in `renderer.ts`**

```ts
this.addDiffLayer(new WaterMesh(scene, gridSize, this.elevation));
this.addDiffLayer(new RoadsMesh(scene, gridSize, this.elevation));
this.addDiffLayer(new PowerLinesMesh(scene, gridSize, this.elevation));
this.addDiffLayer(new ZoneTilesMesh(scene, gridSize, this.elevation));
this.addDiffLayer(new BuildingsMesh(scene, gridSize, this.elevation));
this.addDiffLayer(new PlantsMesh(scene, gridSize, this.elevation));
this.vehiclesMesh = new VehiclesMesh(scene, this.elevation);
this.overlays = new OverlaysMesh(scene, gridSize, this.elevation);
...
this.addDiffLayer(new IconsMesh(scene, gridSize, this.isoCamera.camera, this.elevation));
```

(`MinimapLayer` and `WeatherFx` stay as they are; the minimap is Task 9.)

- [ ] **Step 2: Add the offsets** — in each file compute `const lift = this.elevation.centerY(index);` in the rebuild loop and add it to every y:

- `waterMesh.ts:76` → `this.matrix.setPosition(x, WATER_HEIGHT + lift, z);`
- `zoneTilesMesh.ts:59-63` → y `0.04 + lift`.
- `overlays.ts:137-141` → y `0.07 + lift`.
- `iconsMesh.ts:121-125` (in `update`, per icon index) → y `ICON_HEIGHT + bob + this.elevation.centerY(index)`.
- `roadsMesh.ts`: `setInstance` gains an `index` parameter (its callers pass it; y becomes `ROAD_HEIGHT / 2 + lift`); `rebuildLamps` poles `0 + lift`, heads `0.33 + lift`; `rebuildBridges` deck `DECK_HEIGHT / 2 + lift`, rails `RAIL_HEIGHT / 2 + lift`.
- `powerLinesMesh.ts`: `pylonAt` returns `{ x, z, y: this.elevation.centerY(index) }`; pylon position `(here.x, here.y, here.z)`; cable y `(here.y + there.y) / 2 + PYLON_HEIGHT` and its length uses the 3D distance: `Math.hypot(dx, dz, there.y - here.y)` with an added tilt rotation only if trivial — otherwise keep the horizontal rotation and accept the slight visual stretch (slopes are ≤ 1 level between line tiles).
- `buildingsMesh.ts`: `writeTileMatrices` → `this.matrix.setPosition(cx + p.ox * scale, p.oy * scale + lift, cz + p.oz * scale);`; the window pass (~line 318) adds `lift` to its `y`.
- `plantsMesh.ts`: in `rebuild` add `lift` to `part.oy`, push rotor hubs at `HUB_HEIGHT + lift`, dome at `DOME_BASE + lift`; `writeSocFills` stores the battery's lift with its position (`batteryPositions.push(new THREE.Vector3(cx, lift, cz))` and y `0.03 + p.y`).
- `vehiclesMesh.ts`: constructor takes the field; in `update`: `this.position.set(x, 0.03 + this.elevation.surfaceY(x, y), y);`

- [ ] **Step 3: Verify and commit**

Run: `pnpm typecheck && pnpm exec vitest run && node scripts/smoke.mjs` — PASS.

```bash
pnpm format
git add -A && git commit -m "feat(render): meshes, markers and vehicles follow the terrain height"
```

---

### Task 9: Minimap elevation shading

**Files:**

- Modify: `src/render/minimapLayer.ts`
- Test: none (DOM canvas; covered by the visual pass)

**Interfaces:**

- Consumes: `TileDiff.elevation`.
- Produces: ground and zoned minimap pixels are darker in valleys, lighter on hills; roads, buildings, plants and water keep their identity colours.

- [ ] **Step 1: Implement**

Track elevation and shade:

```ts
private readonly elevations: Uint8Array;
// in the constructor:
this.elevations = new Uint8Array(gridSize * gridSize);

applyDiffs(diffs: TileDiff[]): void {
  for (const diff of diffs) {
    this.elevations[diff.index] = diff.elevation;
    this.context.fillStyle = this.tileColor(diff);
    ...
  }
}

/** Darken valleys, lighten hills (levels 0..7 around a level-2 baseline). */
private shade(hex: string, level: number): string {
  const factor = 0.9 + 0.05 * (level - 2);
  const value = parseInt(hex.slice(1), 16);
  const channel = (shift: number): number =>
    Math.min(255, Math.round(((value >> shift) & 0xff) * factor));
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}
```

In `tileColor`, shade only the terrain-coloured branches: the final `return COLORS.ground` and the zoned branch become `return this.shade(COLORS.ground, this.elevations[diff.index]);` / `return this.shade(COLORS.zoned[diff.zone] ?? COLORS.ground, this.elevations[diff.index]);` — the constructor's initial fill keeps plain `COLORS.ground`.

- [ ] **Step 2: Verify and commit**

Run: `pnpm typecheck && pnpm exec vitest run` — PASS.

```bash
pnpm format
git add -A && git commit -m "feat(render): minimap shades terrain by elevation"
```

---

### Task 10: UI — inspector, rejection toast, cost preview, help, i18n

**Files:**

- Modify: `src/ui/i18n.tsx` (new keys, EN and DE)
- Modify: `src/ui/TileInspector.tsx` (elevation / steep / bonus rows)
- Modify: `src/ui/useTools.ts` (slope surcharge in the drag cost preview)
- Modify: `src/ui/HelpPage.tsx` (terrain section)
- Test: `pnpm typecheck` + existing UI behaviour (no UI unit-test harness beyond hooks)

**Interfaces:**

- Consumes: `TileInfo.elevation/slope/terrainBonus` (Task 5), `renderer.slopeAt(index)` (Task 7), `'rejection.tooSteep'` reaching the existing toast path automatically (rejections surface by key).

- [ ] **Step 1: i18n keys** — add to BOTH language maps in `src/ui/i18n.tsx` (next to the existing `rejection.*` / `inspector.*` / `help.*` keys, following the file's naming):

English:

```ts
'rejection.tooSteep': 'Too steep to build on',
'inspector.elevation': 'Elevation',
'inspector.steepSlope': 'Steep slope — cannot be built on',
'inspector.terrainBonus': 'Terrain bonus',
'help.terrain.title': 'Hills and slopes',
'help.terrain.body':
  'Every map has hills. Steep slopes cannot be built on, and building on a gentle slope costs extra. Wind turbines generate more on high ground, run-of-river plants gain from a drop in the river, and pumped storage stores more the higher it sits above the lake.',
```

German:

```ts
'rejection.tooSteep': 'Zu steil zum Bebauen',
'inspector.elevation': 'Höhenstufe',
'inspector.steepSlope': 'Steilhang — nicht bebaubar',
'inspector.terrainBonus': 'Geländebonus',
'help.terrain.title': 'Hügel und Hänge',
'help.terrain.body':
  'Jede Karte hat Hügel. Steilhänge sind nicht bebaubar, Bauen am Hang kostet einen Aufschlag. Windräder erzeugen auf Anhöhen mehr, Laufwasserkraft profitiert vom Gefälle des Flusses, und Pumpspeicher speichern umso mehr, je höher sie über dem See liegen.',
```

- [ ] **Step 2: TileInspector** — in `src/ui/TileInspector.tsx`, following the component's existing row idiom, add for land tiles a row `t('inspector.elevation')` showing `info.elevation`; when `info.slope > 1` show `t('inspector.steepSlope')`; when `info.terrainBonus > 1` show `t('inspector.terrainBonus')` with `+${Math.round((info.terrainBonus - 1) * 100)} %`.

- [ ] **Step 3: Cost preview** — in `src/ui/useTools.ts`, add a helper and use it in both cost paths:

```ts
const slopeFactorAt = (index: number): number =>
  renderer.slopeAt(index) > 0 ? BALANCE.terrain.slopeCostFactor : 1;
```

- `showPathCost` (~line 126): wrap each per-tile term in `Math.round(base * slopeFactorAt(index))` (both the power-line and road/bridge branches).
- The zone paths (~lines 176, 182): replace `showCost(path.length, BALANCE.costs.zonePerTile)` with a reduce over the tiles using `Math.round(BALANCE.costs.zonePerTile * slopeFactorAt(index))`, keeping the `{tiles, cost}` shape.

(Adapt to how `renderer` is available in that scope — `terrainAt` is already called there, use the same reference for `slopeAt`.)

- [ ] **Step 4: Help page** — add a section to `src/ui/HelpPage.tsx` using `help.terrain.title` / `help.terrain.body`, matching the existing section markup.

- [ ] **Step 5: Verify and commit**

Run: `pnpm typecheck && pnpm lint && pnpm exec vitest run` — PASS. (The i18n test, if present, checks key parity between languages.)

```bash
pnpm format
git add -A && git commit -m "feat(ui): elevation in inspector, slope surcharge preview, tooSteep toast and help"
```

---

### Task 11: Balance probe, full verification, plan close-out

**Files:**

- Create (temporary): `scripts/probe-terrain.mjs` or a scratch `src/sim/probe.test.ts` — DELETED before the final commit
- Possibly modify: `src/shared/constants.ts` (tuning only)
- Modify: `docs/plan.md` or the spec status line (mark done, following the repo's "docs: mark the … plan done" convention)

- [ ] **Step 1: Write the probe** (pattern: commit "balance: resize energy system") — a headless script that, for a fixed seed, builds the same scripted city twice via `SimEngine`: once with elevation zeroed after generation (flat control) and once on the generated relief, placing wind turbines on the highest buildable tiles and hydro on the river; run ~20 in-game days (`20 * TICKS_PER_DAY` ticks) and print daily generation, deficit and money for both runs.

- [ ] **Step 2: Judge and tune** — hills should be clearly attractive but not mandatory: the hilly run's wind/hydro output should land roughly 10–30 % above the flat run's with the same build; the slope surcharge should be noticeable in the money curve but never game-deciding. Adjust `windBonusPerLevel`, `hydroDropBonus`, `headBonusPerLevel`, `slopeCostFactor` in `BALANCE.terrain` if outside that corridor; re-run the probe and the energy tests after each change.

- [ ] **Step 3: Delete the probe** — `git rm`/delete the temporary script; it must not be committed.

- [ ] **Step 4: Full verification**

Run: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm coverage && node scripts/smoke.mjs`
Expected: all green, coverage ≥ 90 % on `src/sim` + `src/shared`. If coverage dropped, add sim tests (not render) for uncovered branches (`terrain.ts` fallback path, `riverDropAt` without water neighbours, etc.).

- [ ] **Step 5: Close out and commit**

Mark the terrain plan done in the docs (repo convention), then:

```bash
pnpm format
git add -A && git commit -m "balance: size the terrain bonuses; docs: mark the terrain plan done"
```

- [ ] **Step 6: Hand back for the visual pass** — the sandbox has no WebGL. Tell the user the branch is ready for the Mac check: hills render with smooth slopes and terrain-following grid, picking is accurate on hills, bridges/vehicles/pylons sit on the terrain, minimap shows relief. Merge/push per the finishing-a-development-branch skill after their go.

---

## Verification summary

| Check                 | Command                                            |
| --------------------- | -------------------------------------------------- |
| Unit tests            | `pnpm test`                                        |
| Coverage gate         | `pnpm coverage`                                    |
| Types / lint / format | `pnpm typecheck && pnpm lint && pnpm format:check` |
| Headless smoke        | `node scripts/smoke.mjs`                           |
| e2e (CI or Mac)       | `pnpm e2e`                                         |
| Visual                | Mac only — hills, picking, water levels, minimap   |
