# Sea Edge & Tidal Power Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every map gets a sea along the edge its river flows toward, plus a tidal plant whose output follows a deterministic two-constituent tide — predictable, but with four slack-water gaps a day.

**Architecture:** A new `src/sim/sea.ts` owns everything coastal: carving the sea band during map generation, the tide clock (a pure function of `state.tick`), the tidal site factor, and the coastal happiness coverage. `water.ts` calls `carveSea` once between choosing the river axis and rasterising the channel. `energy.ts` consumes `tideFactor` exactly the way it consumes `riverFlowFactor` today. Rendering, UI and agent tools follow the established per-plant-type patterns.

**Tech Stack:** TypeScript (strict), React 19, three.js, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-24-sea-tidal-power-design.md`

## Global Constraints

- `src/sim/` is pure: no DOM, no three.js imports. Determinism via the seeded `Rng` only.
- No magic numbers in sim code — every tuning value goes into `BALANCE` in `src/shared/constants.ts`.
- All user-visible strings go through `src/ui/i18n.tsx`, **English and German both**.
- Every new `InstancedMesh` sets `frustumCulled = false`.
- Tests colocated as `*.test.ts`. Coverage on `src/sim` + `src/shared` stays ≥ 90 %.
- `pnpm test` must pass before every commit; the pre-commit hook runs `typecheck && lint && format:check && test`. Run `pnpm format` after editing — oxfmt also formats Markdown.
- Save compatibility: `SAVE_VERSION` stays 1; new enum values are additive; old saves load as inland maps.
- Energy terminology stays correct (generation, consumption, state of charge, curtailment).
- Commit messages: imperative summary + short body, one feature per commit.

## File Structure

**Created:**

- `src/sim/sea.ts` — sea generation, tide clock, tidal site factor, coastal coverage.
- `src/sim/sea.test.ts` — unit tests for all of the above.

**Modified:**

- `src/shared/types.ts` — `Terrain.Sea`, `PlantType.TidalPlant`, `EnergyStats.generation.tidal`, `GlobalStats.tide`, `TideState`.
- `src/shared/constants.ts` — `BALANCE.sea`, `energy.tidalPeakOutput`, cost and upkeep entries.
- `src/sim/water.ts` — call `carveSea`; never overwrite sea tiles.
- `src/sim/state.ts` — sea build rules in `buildRejection`, `lastEnergy.tidal`.
- `src/sim/energy.ts` — census, generation, offshore wind bonus, offshore cost.
- `src/sim/happiness.ts` — coastal bonus.
- `src/sim/inspect.ts` — tidal plant generation and site bonus.
- `src/sim/tick.ts` — `tidal` in `EnergyStats`, `tide` in `GlobalStats`, lifetime sums.
- `src/sim/goals.ts` — one new goal.
- `src/agent/tools.ts`, `docs/agent-tools.md` — tidal plant and tide values.
- `src/render/scene.ts`, `waterMesh.ts`, `plantsMesh.ts`, `minimapLayer.ts` — sea surface with tide, plant mesh, colours.
- `src/ui/BuildBar.tsx`, `useTools.ts`, `i18n.tsx`, `EnergyPanel.tsx`, `BudgetPanel.tsx`, `TileInspector.tsx`, `HelpPage.tsx` — tool, strings, panels.
- `docs/idea.md`, `docs/plan.md` — backlog status and module layout.

---

### Task 1: Sea terrain and generation

**Files:**

- Create: `src/sim/sea.ts`, `src/sim/sea.test.ts`
- Modify: `src/shared/types.ts` (Terrain), `src/shared/constants.ts` (`BALANCE.sea`), `src/sim/water.ts`
- Modify: `docs/superpowers/specs/2026-09-24-sea-tidal-power-design.md` (see Step 9)

**Interfaces:**

- Consumes: `SimState`, `markDirty` from `state.ts`; `Rng`; `BALANCE`.
- Produces: `carveSea(state: SimState, vertical: boolean, reversed: boolean, mouthLateral: number): void`, `Terrain.Sea = 3`, `BALANCE.sea`.

**Background:** `generateWater` (`src/sim/water.ts`) fills the terrain with land, picks the river axis (`vertical`, `entry`, `exit`) and the flow direction (`reversed` — true means the river flows from `along = size-1` toward `along = 0`), then rasterises the channel row by row. The sea must be carved _after_ the axis is known and _before_ the rasterisation, so the channel stops at the coast.

- [ ] **Step 1: Add the terrain value**

In `src/shared/types.ts`:

```ts
/** Immutable ground type per tile, generated once per map. */
export const Terrain = {
  Land: 0,
  River: 1,
  Lake: 2,
  Sea: 3,
} as const;
```

- [ ] **Step 2: Add the balance block**

In `src/shared/constants.ts`, add a `sea` block after the `water` block:

```ts
  sea: {
    /** Depth of the coastal band in tiles, per column (seeded noise). */
    depthRange: [3, 7] as const,
    /** Noise cell size along the coast, in tiles (large = long smooth bays). */
    depthCellSize: 10,
    /** The band never shrinks below this depth. */
    minDepth: 2,
    /** Extra depth at the river mouth, tapering over estuaryTaper columns. */
    estuaryWidening: 3,
    estuaryTaper: 6,
    /** The sea never covers more than this share of the map. */
    maxSeaFraction: 0.12,
    /** Chebyshev radius in which buildings count as having a sea view. */
    coastRadius: 4,
    /** Max happiness bonus when every building has the sea in reach. */
    coastBonus: 0.05,
    /** Two tidal constituents; their beat produces spring and neap tides. */
    tide: {
      /** Lunar semidiurnal (M2) period in in-game hours. */
      lunarPeriodHours: 12.42,
      /** Solar semidiurnal (S2) period in in-game hours. */
      solarPeriodHours: 12.0,
      /** Weight of the solar constituent; sets the neap depth to (1-w)/(1+w). */
      solarWeight: 0.29,
    },
    tidal: {
      /** Output bonus at full narrowness (all 8 neighbours are land). */
      currentBonus: 0.6,
      /** Extra bonus when a river tile lies within estuaryRadius. */
      estuaryBonus: 0.35,
      estuaryRadius: 2,
      /** Cap on the combined site factor. */
      maxSiteFactor: 2.0,
    },
    /** Wind turbine output bonus offshore (free wind, no shelter). */
    offshoreWindBonus: 0.35,
    /** Construction cost multiplier for building on a sea tile. */
    offshoreCostFactor: 1.5,
  },
```

- [ ] **Step 3: Write the failing tests**

Create `src/sim/sea.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../shared/constants.ts';
import { Terrain } from '../shared/types.ts';
import { createSimState } from './state.ts';

/** Sea tiles of a state. */
function seaTiles(state: ReturnType<typeof createSimState>): number[] {
  const out: number[] = [];
  for (let i = 0; i < state.layers.terrain.length; i++) {
    if (state.layers.terrain[i] === Terrain.Sea) out.push(i);
  }
  return out;
}

describe('sea generation', () => {
  it('puts sea on exactly one map edge', () => {
    for (const seed of [1, 2, 3, 7, 42]) {
      const state = createSimState(seed, 64);
      const { terrain } = state.layers;
      const size = state.size;
      const edges = [0, 1, 2, 3].map((edge) => {
        let count = 0;
        for (let i = 0; i < size; i++) {
          const index =
            edge === 0
              ? i // top row
              : edge === 1
                ? (size - 1) * size + i // bottom row
                : edge === 2
                  ? i * size // left column
                  : i * size + size - 1; // right column
          if (terrain[index] === Terrain.Sea) count++;
        }
        return count;
      });
      // Exactly one edge is fully sea; the two perpendicular edges are only
      // clipped at their ends, so they never reach a full row.
      expect(edges.filter((count) => count === size)).toHaveLength(1);
    }
  });

  it('keeps the sea within its depth range and size cap', () => {
    const cfg = BALANCE.sea;
    for (const seed of [1, 5, 9, 23]) {
      const state = createSimState(seed, 64);
      const tiles = seaTiles(state);
      expect(tiles.length).toBeGreaterThan(0);
      expect(tiles.length / (state.size * state.size)).toBeLessThanOrEqual(cfg.maxSeaFraction);
      // Every sea tile sits at sea level.
      for (const index of tiles) expect(state.layers.elevation[index]).toBe(0);
    }
  });

  it('lets the river reach the sea', () => {
    for (const seed of [1, 2, 3, 7, 42]) {
      const state = createSimState(seed, 64);
      const { terrain } = state.layers;
      const size = state.size;
      let touching = 0;
      for (let i = 0; i < terrain.length; i++) {
        if (terrain[i] !== Terrain.River) continue;
        const x = i % size;
        const y = Math.floor(i / size);
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          if (terrain[ny * size + nx] === Terrain.Sea) touching++;
        }
      }
      expect(touching).toBeGreaterThan(0);
    }
  });

  it('is deterministic per seed and varies across seeds', () => {
    const a = seaTiles(createSimState(11, 64));
    const b = seaTiles(createSimState(11, 64));
    const c = seaTiles(createSimState(12, 64));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
});
```

- [ ] **Step 4: Run the tests and watch them fail**

Run: `pnpm vitest run src/sim/sea.test.ts`
Expected: FAIL — no sea tiles exist yet (`tiles.length` is 0, no edge is fully sea).

- [ ] **Step 5: Write `src/sim/sea.ts`**

```ts
import { BALANCE } from '../shared/constants.ts';
import { tileIndex } from '../shared/grid.ts';
import { Rng } from '../shared/rng.ts';
import { Terrain } from '../shared/types.ts';
import { markDirty, type SimState } from './state.ts';

/** Keeps the coastline independent of terrain, river and gameplay RNG. */
const SEA_SEED_SALT = 0x5ea1c3;

/**
 * Carve the sea: a band along the map edge the river flows toward, so
 * the river always ends in an estuary. Called from `generateWater` after
 * the river axis is known and before the channel is rasterised — the
 * rasteriser then stops where the sea begins.
 *
 * `vertical` and `reversed` are the river axis and flow direction;
 * `mouthLateral` is the centre line's lateral position at the downstream
 * edge, around which the band widens into a bay.
 *
 * Sea tiles sit at elevation 0 (sea level). The band is capped at
 * `maxSeaFraction` of the map so the coast never eats the city's room.
 */
export function carveSea(
  state: SimState,
  vertical: boolean,
  reversed: boolean,
  mouthLateral: number,
): void {
  const rng = new Rng((state.seed ^ SEA_SEED_SALT) >>> 0);
  const { size } = state;
  const cfg = BALANCE.sea;
  const { terrain, elevation } = state.layers;

  // The river flows toward along = 0 when reversed, else toward size-1.
  const fromEnd = !reversed;
  const [minDepth, maxDepth] = cfg.depthRange;
  const depths = depthProfile(rng, size, minDepth, maxDepth, cfg.depthCellSize);

  // Widen into a bay at the mouth: the enclosed water is what the tidal
  // site factor rewards, and it guarantees a strong first site.
  for (let lateral = 0; lateral < size; lateral++) {
    const distance = Math.abs(lateral - mouthLateral);
    if (distance > cfg.estuaryTaper) continue;
    depths[lateral] += Math.round(cfg.estuaryWidening * (1 - distance / cfg.estuaryTaper));
  }

  // Size cap: shave the deepest column (lowest lateral wins ties) until
  // the band fits. Bounded — every pass removes one tile.
  const maxTiles = Math.floor(size * size * cfg.maxSeaFraction);
  let total = depths.reduce((sum, depth) => sum + depth, 0);
  while (total > maxTiles) {
    let deepest = 0;
    for (let lateral = 1; lateral < size; lateral++) {
      if (depths[lateral] > depths[deepest]) deepest = lateral;
    }
    if (depths[deepest] <= cfg.minDepth) break;
    depths[deepest]--;
    total--;
  }

  for (let lateral = 0; lateral < size; lateral++) {
    for (let d = 0; d < depths[lateral]; d++) {
      const along = fromEnd ? size - 1 - d : d;
      const x = vertical ? lateral : along;
      const y = vertical ? along : lateral;
      const index = tileIndex(x, y, size);
      terrain[index] = Terrain.Sea;
      elevation[index] = 0;
      markDirty(state, index);
    }
  }
}

/** Smooth seeded depth per column along the coast. */
function depthProfile(
  rng: Rng,
  size: number,
  minDepth: number,
  maxDepth: number,
  cellSize: number,
): number[] {
  const cells = Math.ceil(size / cellSize) + 2;
  const lattice = Array.from({ length: cells }, () => rng.next());
  const depths: number[] = [];
  for (let lateral = 0; lateral < size; lateral++) {
    const g = lateral / cellSize;
    const i0 = Math.floor(g);
    const t = smoothstep(g - i0);
    const value = lattice[i0] + (lattice[i0 + 1] - lattice[i0]) * t;
    depths.push(Math.round(minDepth + value * (maxDepth - minDepth)));
  }
  return depths;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}
```

- [ ] **Step 6: Hook it into `generateWater`**

In `src/sim/water.ts`, import `carveSea`:

```ts
import { carveSea } from './sea.ts';
```

Call it immediately **after** the `centreLine` declaration ends (it is a `const` arrow function, so it cannot be called before that) and **before** the rasterisation loop that starts with `let previous = centreLine(0);`. The mouth's lateral position is the centre line at the downstream end — `t = 0` when the river flows toward `along = 0` (`reversed`), else `t = 1`:

```ts
// The sea claims the edge the river flows toward, so the channel ends
// in an estuary. Carved before rasterising: the river stops at the coast.
carveSea(state, axis.vertical, reversed, centreLine(reversed ? 0 : 1));
```

Then make the rasteriser respect the sea. In `setTerrain`:

```ts
const setTerrain = (along: number, lateral: number, value: Terrain): void => {
  const x = axis.vertical ? lateral : along;
  const y = axis.vertical ? along : lateral;
  if (!inBounds(x, y, size)) return;
  const index = tileIndex(x, y, size);
  // The river and the lake stop at the coast; the sea stays sea.
  if (terrain[index] === Terrain.Sea) return;
  terrain[index] = value;
  if (value === Terrain.River) riverRows[along].push(index);
};
```

- [ ] **Step 7: Run the tests**

Run: `pnpm vitest run src/sim/sea.test.ts src/sim/water.test.ts src/sim/terrain.test.ts`
Expected: PASS. If `water.test.ts` has an assertion that every row contains river tiles, or that terrain is only Land/River/Lake, update it to account for the sea and say so in the commit body.

- [ ] **Step 8: Run the whole suite**

Run: `pnpm test`
Expected: PASS. Failures here are most likely tests that assume all terrain is land near the edges — fix them by choosing inland tiles, not by weakening the assertion.

- [ ] **Step 9: Check the implementation against the spec**

Re-read the "World generation" section of `docs/superpowers/specs/2026-09-24-sea-tidal-power-design.md` and confirm the code matches it — in particular the size cap (the spec explains why `minBuildableFraction` is not reusable here). If the code had to diverge, update the spec in this commit rather than leaving the two out of step.

- [ ] **Step 10: Format and commit**

```bash
pnpm format
git add src/sim/sea.ts src/sim/sea.test.ts src/sim/water.ts src/shared/types.ts src/shared/constants.ts
git commit -m "feat(sim): carve a sea along the river's downstream edge

The river now ends in an estuary instead of a map edge. The band is
seeded noise, widened at the mouth and capped at a share of the map."
```

---

### Task 2: Tide clock

**Files:**

- Modify: `src/sim/sea.ts`, `src/sim/sea.test.ts`

**Interfaces:**

- Consumes: `BALANCE.sea.tide`, `TICKS_PER_DAY` from `src/shared/constants.ts`.
- Produces: `tideLevel(tick: number): number` (-1..1, water level) and `tideFactor(tick: number): number` (0..1, current strength — what generation scales with).

- [ ] **Step 1: Write the failing tests**

Append to `src/sim/sea.test.ts`:

```ts
import { TICKS_PER_DAY } from '../shared/constants.ts';
import { tideFactor, tideLevel } from './sea.ts';

describe('tide clock', () => {
  it('stays in range', () => {
    for (let tick = 0; tick < 20 * TICKS_PER_DAY; tick += 7) {
      expect(tideLevel(tick)).toBeGreaterThanOrEqual(-1);
      expect(tideLevel(tick)).toBeLessThanOrEqual(1);
      expect(tideFactor(tick)).toBeGreaterThanOrEqual(0);
      expect(tideFactor(tick)).toBeLessThanOrEqual(1);
    }
  });

  it('is slack at high water', () => {
    // Tick 0: both constituents peak — spring high water, no current.
    expect(tideLevel(0)).toBeCloseTo(1, 5);
    expect(tideFactor(0)).toBeCloseTo(0, 5);
  });

  it('peaks about four times a day', () => {
    let peaks = 0;
    const days = 10;
    for (let tick = 1; tick < days * TICKS_PER_DAY - 1; tick++) {
      const previous = tideFactor(tick - 1);
      const current = tideFactor(tick);
      const next = tideFactor(tick + 1);
      if (current > previous && current >= next) peaks++;
    }
    // Peaks come every ~6.21 in-game hours → ~3.9 per day.
    expect(peaks).toBeGreaterThanOrEqual(37);
    expect(peaks).toBeLessThanOrEqual(41);
  });

  it('runs through spring and neap tides', () => {
    const springMax = dailyMax(0);
    // Half a beat period later (~7.39 days) the constituents cancel.
    const neapMax = dailyMax(Math.round(7.39 * TICKS_PER_DAY));
    expect(springMax).toBeGreaterThan(0.98);
    expect(neapMax).toBeLessThan(0.62);
    expect(neapMax).toBeGreaterThan(0.5);
  });

  it('is a pure function of the tick', () => {
    expect(tideFactor(1234)).toBe(tideFactor(1234));
    expect(tideLevel(1234)).toBe(tideLevel(1234));
  });
});

/** Highest current factor over the in-game day starting at `startTick`. */
function dailyMax(startTick: number): number {
  let max = 0;
  for (let tick = startTick; tick < startTick + TICKS_PER_DAY; tick++) {
    max = Math.max(max, tideFactor(tick));
  }
  return max;
}
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `pnpm vitest run src/sim/sea.test.ts`
Expected: FAIL with "tideFactor is not exported" / import error.

- [ ] **Step 3: Implement the tide**

Append to `src/sim/sea.ts` (and add `TICKS_PER_DAY` to the constants import):

```ts
const HOURS_PER_DAY = 24;

/** Angular phase of one tidal constituent at a tick. */
function tidePhase(tick: number, periodHours: number): number {
  const periodTicks = (periodHours / HOURS_PER_DAY) * TICKS_PER_DAY;
  return (2 * Math.PI * tick) / periodTicks;
}

/**
 * Water level, -1 (low water) .. 1 (high water). Two constituents — the
 * lunar (12.42 h) and the solar (12.00 h) semidiurnal tide — whose beat
 * produces spring and neap tides every ~7.4 in-game days without any
 * extra envelope. A pure function of the tick: deterministic, nothing to
 * persist.
 */
export function tideLevel(tick: number): number {
  const { lunarPeriodHours, solarPeriodHours, solarWeight } = BALANCE.sea.tide;
  const lunar = Math.cos(tidePhase(tick, lunarPeriodHours));
  const solar = Math.cos(tidePhase(tick, solarPeriodHours));
  return (lunar + solarWeight * solar) / (1 + solarWeight);
}

/**
 * Tidal current strength, 0..1 — what a tidal plant's output scales
 * with. The current runs a quarter period ahead of the level: slack at
 * high and low water, strongest at mid-tide, so there are four
 * generation peaks per day. (The exact derivative would weight the terms
 * by 1/period as well; the two periods differ by 3 %, which would only
 * rescale solarWeight.)
 */
export function tideFactor(tick: number): number {
  const { lunarPeriodHours, solarPeriodHours, solarWeight } = BALANCE.sea.tide;
  const lunar = Math.sin(tidePhase(tick, lunarPeriodHours));
  const solar = Math.sin(tidePhase(tick, solarPeriodHours));
  return Math.abs(lunar + solarWeight * solar) / (1 + solarWeight);
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run src/sim/sea.test.ts`
Expected: PASS (all tide tests).

- [ ] **Step 5: Format and commit**

```bash
pnpm format
git add src/sim/sea.ts src/sim/sea.test.ts
git commit -m "feat(sim): tide clock from two constituents

Lunar and solar semidiurnal tides; their beat gives spring and neap
tides every ~7.4 days. Pure function of the tick, nothing persisted."
```

---

### Task 3: Tidal plant type and build rules

**Files:**

- Modify: `src/shared/types.ts` (PlantType), `src/shared/constants.ts` (cost, upkeep), `src/sim/state.ts` (`buildRejection`), `src/sim/sea.ts` (`isCoastalSea`)
- Test: `src/sim/state.test.ts`, `src/sim/sea.test.ts`

**Interfaces:**

- Consumes: `Terrain.Sea`, `BALANCE.sea`.
- Produces: `PlantType.TidalPlant = 14`, `isCoastalSea(state: SimState, index: number): boolean`, rejection strings `needsSeaTile` and `needsCoast`.

- [ ] **Step 1: Write the failing tests**

Add to `src/sim/state.test.ts` (follow the file's existing helper style for building a state and finding tiles of a terrain type — reuse whatever helper the neighbouring water tests use):

```ts
describe('sea build rules', () => {
  it('accepts a tidal plant on a coastal sea tile', () => {
    const state = createSimState(1, 64);
    const coastal = findTile(state, (index) => isCoastalSea(state, index));
    expect(buildRejection(state, coastal, BuildIntent.Plant, PlantType.TidalPlant)).toBeNull();
  });

  it('rejects a tidal plant on open water and on land', () => {
    const state = createSimState(1, 64);
    const open = findTile(
      state,
      (index) => state.layers.terrain[index] === Terrain.Sea && !isCoastalSea(state, index),
    );
    expect(buildRejection(state, open, BuildIntent.Plant, PlantType.TidalPlant)).toBe('needsCoast');
    const land = findTile(state, (index) => state.layers.terrain[index] === Terrain.Land);
    expect(buildRejection(state, land, BuildIntent.Plant, PlantType.TidalPlant)).toBe(
      'needsSeaTile',
    );
  });

  it('accepts wind turbines at sea but no roads, zones or other plants', () => {
    const state = createSimState(1, 64);
    const sea = findTile(state, (index) => state.layers.terrain[index] === Terrain.Sea);
    expect(buildRejection(state, sea, BuildIntent.Plant, PlantType.WindTurbine)).toBeNull();
    expect(buildRejection(state, sea, BuildIntent.Road)).toBe('cannotBuildOnWater');
    expect(buildRejection(state, sea, BuildIntent.Zone)).toBe('cannotBuildOnWater');
    expect(buildRejection(state, sea, BuildIntent.Plant, PlantType.SolarFarm)).toBe(
      'cannotBuildOnWater',
    );
  });

  it('still allows power lines across the sea', () => {
    const state = createSimState(1, 64);
    const sea = findTile(state, (index) => state.layers.terrain[index] === Terrain.Sea);
    expect(buildRejection(state, sea, BuildIntent.PowerLine)).toBeNull();
  });
});

/** First tile index matching the predicate; fails loudly when there is none. */
function findTile(state: SimState, predicate: (index: number) => boolean): number {
  for (let i = 0; i < state.layers.terrain.length; i++) {
    if (predicate(i)) return i;
  }
  throw new Error('no matching tile on this map');
}
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `pnpm vitest run src/sim/state.test.ts`
Expected: FAIL — `PlantType.TidalPlant` does not exist, `isCoastalSea` is not exported.

- [ ] **Step 3: Add the plant type, cost and upkeep**

In `src/shared/types.ts`, extend `PlantType` with `TidalPlant: 14`.

In `src/shared/constants.ts` add entries to **both** maps (they are cast with `as Record<PlantType, number>`, so a missing entry compiles but produces `NaN` at runtime):

```ts
      [PlantType.TidalPlant]: 3_000,
```

```ts
      [PlantType.TidalPlant]: 0.09,
```

And to the `energy` block:

```ts
    /** Tidal plant output per plant per tick at peak current. */
    tidalPeakOutput: 110,
```

- [ ] **Step 4: Add `isCoastalSea`**

Append to `src/sim/sea.ts` (import `neighbors4` from `../shared/grid.ts`):

```ts
/** True on a sea tile that touches land — where a tidal plant may stand. */
export function isCoastalSea(state: SimState, index: number): boolean {
  const { terrain } = state.layers;
  if (terrain[index] !== Terrain.Sea) return false;
  return neighbors4(index, state.size).some((n) => terrain[n] === Terrain.Land);
}
```

- [ ] **Step 5: Extend `buildRejection`**

In `src/sim/state.ts`, inside `buildRejection`, replace the water block with:

```ts
const terrain = layers.terrain[index] as Terrain;
const wantsRiver = intent === BuildIntent.Plant && plant === PlantType.RunOfRiver;
const wantsTidal = intent === BuildIntent.Plant && plant === PlantType.TidalPlant;
const offshoreWind = intent === BuildIntent.Plant && plant === PlantType.WindTurbine;
if (terrain === Terrain.Sea) {
  // The sea carries tidal plants on its shore and offshore turbines;
  // roads stop at the coast (bridges cross the river, not the sea).
  if (wantsTidal) return isCoastalSea(state, index) ? null : 'needsCoast';
  if (offshoreWind) return null;
  return 'cannotBuildOnWater';
}
if (wantsTidal) return 'needsSeaTile';
if (terrain === Terrain.Lake) return 'cannotBuildOnWater';
```

Keep the rest of the function unchanged. Note the import of `isCoastalSea` from `./sea.ts`; `sea.ts` imports `markDirty` and `SimState` from `state.ts`, so this is a cycle between the two modules — it resolves fine under ES modules because both are used at call time, and the codebase already has this shape (`energy.ts` ↔ `state.ts`). If the typecheck complains, move `isCoastalSea` into `state.ts` next to `isLakeShore` and re-export it from `sea.ts`.

- [ ] **Step 6: Add the rejection strings**

In `src/ui/i18n.tsx`, next to `rejection.needsLakeShore`, add to the English block:

```ts
  'rejection.needsSeaTile': 'Tidal plants must stand on a sea tile',
  'rejection.needsCoast': 'Tidal plants need the shore: pick a sea tile touching land',
```

and to the German block:

```ts
  'rejection.needsSeaTile': 'Gezeitenkraftwerke müssen auf einem Meeresfeld stehen',
  'rejection.needsCoast':
    'Gezeitenkraftwerke brauchen die Küste: ein Meeresfeld mit Landkontakt wählen',
```

- [ ] **Step 7: Run the tests**

Run: `pnpm vitest run src/sim/state.test.ts src/sim/sea.test.ts`
Expected: PASS.

- [ ] **Step 8: Prove the save format still round-trips**

Add to `src/storage/serialization.test.ts`, matching the file's existing round-trip style:

```ts
it('round-trips sea tiles and tidal plants', () => {
  const state = createSimState(1, 64);
  state.money = 1_000_000;
  const tile = firstCoastalSeaTile(state);
  placePlant(state, tile, PlantType.TidalPlant);

  const restored = stateFromSave(saveFromState(state));
  expect(restored.layers.terrain).toEqual(state.layers.terrain);
  expect(restored.layers.plantType[tile]).toBe(PlantType.TidalPlant);
});

it('loads an old save without a terrain layer as an inland map', () => {
  const save = saveFromState(createSimState(1, 64));
  delete (save.layers as { terrain?: unknown }).terrain;
  const restored = stateFromSave(save);
  expect([...restored.layers.terrain].every((value) => value === Terrain.Land)).toBe(true);
});
```

Use the actual serialization function names from that file (`saveFromState` / `stateFromSave` are placeholders for whatever it exports) and reuse its existing helpers.

Run: `pnpm vitest run src/storage/serialization.test.ts`
Expected: PASS. `SAVE_VERSION` must stay 1 — if a test forces you to bump it, stop and report instead.

- [ ] **Step 9: Run the whole suite and typecheck**

Run: `pnpm typecheck && pnpm test`
Expected: PASS. A `Record<PlantType, …>` that is not a cast (for example an exhaustive `switch`) will now fail to compile — add the `TidalPlant` case wherever the compiler points, returning the same thing a run-of-river plant returns for now; Task 4 fills in the real behaviour.

- [ ] **Step 10: Format and commit**

```bash
pnpm format
git add -A src/shared src/sim src/storage src/ui/i18n.tsx
git commit -m "feat(sim): tidal plant type and sea build rules

Sea tiles take tidal plants on the shore and offshore turbines; roads,
zones and every other plant stop at the coast."
```

---

### Task 4: Tidal generation, site factor and stats

**Files:**

- Modify: `src/sim/sea.ts` (`tidalSiteFactor`), `src/sim/energy.ts` (census + generation), `src/sim/state.ts` (`lastEnergy.tidal`), `src/sim/tick.ts` (stats), `src/shared/types.ts` (`EnergyStats`, `GlobalStats`, `TideState`), `src/sim/inspect.ts`
- Test: `src/sim/sea.test.ts`, `src/sim/energy.test.ts`, `src/sim/inspect.test.ts`

**Interfaces:**

- Consumes: `tideFactor`, `isCoastalSea`.
- Produces: `tidalSiteFactor(state: SimState, index: number): number`; `census.tidalCapacity`; `state.lastEnergy.tidal`; `EnergyStats.generation.tidal`; `GlobalStats.tide: TideState` where `interface TideState { level: number; factor: number }`.

- [ ] **Step 1: Write the failing site-factor tests**

Append to `src/sim/sea.test.ts`:

```ts
import { Terrain } from '../shared/types.ts';
import { isCoastalSea, tidalSiteFactor } from './sea.ts';

describe('tidal site factor', () => {
  /** A 16x16 all-land state with the terrain painted by hand. */
  function paintedState(paint: (terrain: Uint8Array, size: number) => void) {
    const state = createSimState(1, 16);
    state.layers.terrain.fill(Terrain.Land);
    paint(state.layers.terrain, state.size);
    return state;
  }

  it('rewards a narrow inlet over a straight coast', () => {
    const straight = paintedState((terrain, size) => {
      for (let y = 0; y < 2; y++) {
        for (let x = 0; x < size; x++) terrain[y * size + x] = Terrain.Sea;
      }
    });
    const inlet = paintedState((terrain, size) => {
      // A one-tile channel poking into the land: land on both sides.
      for (let y = 0; y < 4; y++) terrain[y * size + 8] = Terrain.Sea;
    });
    const straightTile = 1 * 16 + 8; // coastal row of the open coast
    const inletTile = 3 * 16 + 8; // deep in the channel
    expect(tidalSiteFactor(inlet, inletTile)).toBeGreaterThan(
      tidalSiteFactor(straight, straightTile),
    );
  });

  it('adds the estuary bonus near a river tile', () => {
    const cfg = BALANCE.sea.tidal;
    const plain = paintedState((terrain, size) => {
      for (let x = 0; x < size; x++) terrain[0 * size + x] = Terrain.Sea;
    });
    const estuary = paintedState((terrain, size) => {
      for (let x = 0; x < size; x++) terrain[0 * size + x] = Terrain.Sea;
      terrain[1 * 16 + 8] = Terrain.River;
    });
    expect(tidalSiteFactor(estuary, 8) - tidalSiteFactor(plain, 8)).toBeCloseTo(
      cfg.estuaryBonus,
      5,
    );
  });

  it('never exceeds the cap', () => {
    const enclosed = paintedState((terrain) => {
      terrain[5 * 16 + 5] = Terrain.Sea; // a single sea tile ringed by land
      terrain[4 * 16 + 5] = Terrain.River;
    });
    expect(tidalSiteFactor(enclosed, 5 * 16 + 5)).toBeLessThanOrEqual(
      BALANCE.sea.tidal.maxSiteFactor,
    );
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `pnpm vitest run src/sim/sea.test.ts`
Expected: FAIL — `tidalSiteFactor` is not exported.

- [ ] **Step 3: Implement the site factor**

Append to `src/sim/sea.ts` (import `inBounds`, `tileX`, `tileY` from `../shared/grid.ts`):

```ts
/**
 * Output factor of a tidal plant on this tile. Narrow water runs fast:
 * the more of the eight neighbours are land, the stronger the current.
 * A river mouth within `estuaryRadius` adds its own bonus. Off-map
 * neighbours count as open water, so the map edge is never a narrows.
 */
export function tidalSiteFactor(state: SimState, index: number): number {
  const cfg = BALANCE.sea.tidal;
  const { terrain } = state.layers;
  const { size } = state;
  const cx = tileX(index, size);
  const cy = tileY(index, size);

  let land = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const x = cx + dx;
      const y = cy + dy;
      if (!inBounds(x, y, size)) continue;
      if (terrain[tileIndex(x, y, size)] === Terrain.Land) land++;
    }
  }
  let factor = 1 + cfg.currentBonus * (land / 8);

  const r = cfg.estuaryRadius;
  for (let dy = -r; dy <= r && factor < cfg.maxSiteFactor; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (!inBounds(x, y, size)) continue;
      if (terrain[tileIndex(x, y, size)] === Terrain.River) {
        factor += cfg.estuaryBonus;
        dy = r + 1; // found one; stop both loops
        break;
      }
    }
  }
  return Math.min(cfg.maxSiteFactor, factor);
}
```

- [ ] **Step 4: Write the failing generation test**

Add to `src/sim/energy.test.ts`, following the file's existing style for placing plants and stepping energy:

```ts
it('generates from tidal plants and follows the tide', () => {
  const state = createSimState(1, 64);
  const tile = firstCoastalSeaTile(state);
  state.money = 1_000_000;
  expect(placePlant(state, tile, PlantType.TidalPlant).rejected).toBeUndefined();

  // Slack water at tick 0, strong current a quarter period later.
  state.tick = 0;
  energyStep(state, { chargingDemand: 0 });
  expect(state.lastEnergy.tidal).toBeCloseTo(0, 5);

  state.tick = Math.round(TICKS_PER_DAY * (12.42 / 24) * 0.25);
  energyStep(state, { chargingDemand: 0 });
  expect(state.lastEnergy.tidal).toBeGreaterThan(BALANCE.energy.tidalPeakOutput * 0.7);
});

it('scales tidal output with the site factor', () => {
  const state = createSimState(1, 64);
  state.money = 1_000_000;
  const tile = firstCoastalSeaTile(state);
  placePlant(state, tile, PlantType.TidalPlant);
  state.tick = Math.round(TICKS_PER_DAY * (12.42 / 24) * 0.25);
  energyStep(state, { chargingDemand: 0 });
  const expected =
    BALANCE.energy.tidalPeakOutput * tidalSiteFactor(state, tile) * tideFactor(state.tick);
  expect(state.lastEnergy.tidal).toBeCloseTo(expected, 5);
});

/** First sea tile touching land on this map. */
function firstCoastalSeaTile(state: SimState): number {
  for (let i = 0; i < state.layers.terrain.length; i++) {
    if (isCoastalSea(state, i)) return i;
  }
  throw new Error('no coastal sea tile on this map');
}
```

- [ ] **Step 5: Run it and watch it fail**

Run: `pnpm vitest run src/sim/energy.test.ts`
Expected: FAIL — `state.lastEnergy.tidal` is `undefined`.

- [ ] **Step 6: Wire the census and the balance**

In `src/sim/energy.ts`:

Add to the `PlantCensus` interface and its initialiser:

```ts
tidalPlants: number;
/** Sum of tidal plants' site factors (narrowness and estuary bonus). */
tidalCapacity: number;
```

```ts
    tidalPlants: 0,
    tidalCapacity: 0,
```

Add the case to the census switch, next to `RunOfRiver`:

```ts
      case PlantType.TidalPlant:
        census.tidalPlants++;
        census.tidalCapacity += tidalSiteFactor(state, i);
        break;
```

In `energyStep`, next to the `hydro` line:

```ts
const tidal = census.tidalCapacity * BALANCE.energy.tidalPeakOutput * tideFactor(state.tick);
```

and include it in the renewable total:

```ts
const generation = solar + wind + rooftop + hydro + tidal;
```

and in the `state.lastEnergy = { … }` assignment add `tidal,`.

Import `tideFactor` and `tidalSiteFactor` from `./sea.ts`.

- [ ] **Step 7: Extend the state and stats shapes**

In `src/sim/state.ts`, add `tidal: number;` to the `lastEnergy` shape (next to `hydro: number;`) and `tidal: 0,` to its initialiser (next to `hydro: 0,`).

In `src/shared/types.ts`:

```ts
/** Tide at this tick: water level, current strength and direction. */
export interface TideState {
  /** Water level, -1 (low water) .. 1 (high water). */
  level: number;
  /** Current strength, 0..1 — tidal generation scales with this. */
  factor: number;
  /** True while the water is rising (flood), false while it falls (ebb). */
  rising: boolean;
}
```

Add `tidal: number;` to `EnergyStats.generation` (with a doc comment: `/** Tidal plant output this tick. */`) and `tide: TideState;` to `GlobalStats` (next to `forestShare`).

In `src/sim/tick.ts`:

- in the generation block (`hydro: e.hydro,`) add `tidal: e.tidal,`;
- in the lifetime sums line (`sums.generation += e.solar + e.wind + e.rooftop + e.hydro + e.biogas;`) add `+ e.tidal`;
- where `forestShare: forestShare(state),` is assembled, add `tide: tideState(state.tick),` and import `tideState` from `./sea.ts`.

Add that assembler to `src/sim/sea.ts` so the UI never has to derive the direction itself:

```ts
/** The tide at a tick, ready for the HUD. */
export function tideState(tick: number): TideState {
  const level = tideLevel(tick);
  return { level, factor: tideFactor(tick), rising: level > tideLevel(tick - 1) };
}
```

(At tick 0 this reports falling, which is correct — tick 0 is high water.)

- [ ] **Step 8: Add the inspector case**

In `src/sim/inspect.ts`, in `plantGeneration`, next to the `RunOfRiver` case:

```ts
    case PlantType.TidalPlant: {
      const bonus = tidalSiteFactor(state, index);
      return {
        generation: e.tidalPeakOutput * tideFactor(state.tick) * bonus,
        peak: e.tidalPeakOutput * bonus,
      };
    }
```

Also extend the terrain-bonus expression further down the file (the chain that currently reads `: plant === PlantType.RunOfRiver ? 1 + BALANCE.terrain.hydroDropBonus * riverDropAt(state, index)`) with a `plant === PlantType.TidalPlant ? tidalSiteFactor(state, index)` branch, so the inspector shows the site factor in its terrain-bonus field.

- [ ] **Step 9: Run the tests**

Run: `pnpm vitest run src/sim/energy.test.ts src/sim/sea.test.ts src/sim/inspect.test.ts`
Expected: PASS.

- [ ] **Step 10: Run the whole suite**

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 11: Format and commit**

```bash
pnpm format
git add -A src/sim src/shared
git commit -m "feat(sim): tidal generation with a site factor

Output follows the tide clock and the site: narrow water and the river
mouth run faster. Reported as its own generation source."
```

---

### Task 5: Offshore wind

**Files:**

- Modify: `src/sim/energy.ts` (census bonus + construction cost), `src/sim/inspect.ts`
- Test: `src/sim/energy.test.ts`

**Interfaces:**

- Consumes: `BALANCE.sea.offshoreWindBonus`, `BALANCE.sea.offshoreCostFactor`, `Terrain.Sea`.
- Produces: no new exports — behaviour only.

- [ ] **Step 1: Write the failing tests**

Add to `src/sim/energy.test.ts`:

```ts
it('gives offshore turbines their bonus instead of the elevation bonus', () => {
  const state = createSimState(1, 64);
  state.money = 1_000_000;
  const sea = firstSeaTile(state);
  placePlant(state, sea, PlantType.WindTurbine);
  const census = censusPlants(state);
  expect(census.windCapacity).toBeCloseTo(1 + BALANCE.sea.offshoreWindBonus, 5);
});

it('charges the offshore surcharge for building at sea', () => {
  const state = createSimState(1, 64);
  state.money = 1_000_000;
  const before = state.money;
  placePlant(state, firstSeaTile(state), PlantType.WindTurbine);
  const expected = Math.round(
    BALANCE.costs.plant[PlantType.WindTurbine] * BALANCE.sea.offshoreCostFactor,
  );
  expect(before - state.money).toBe(expected);
});

/** First sea tile on this map. */
function firstSeaTile(state: SimState): number {
  for (let i = 0; i < state.layers.terrain.length; i++) {
    if (state.layers.terrain[i] === Terrain.Sea) return i;
  }
  throw new Error('no sea tile on this map');
}
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm vitest run src/sim/energy.test.ts`
Expected: FAIL — the turbine currently gets `windCapacity` 1 and the plain construction cost.

- [ ] **Step 3: Apply the bonus in the census**

In `src/sim/energy.ts`, replace the `WindTurbine` census case:

```ts
      case PlantType.WindTurbine:
        census.windTurbines++;
        // Offshore: free wind, no shelter, no height to gain. On land:
        // height helps, sheltering woods hurt (turbulence and lower wind).
        census.windCapacity +=
          state.layers.terrain[i] === Terrain.Sea
            ? 1 + BALANCE.sea.offshoreWindBonus
            : (1 + BALANCE.terrain.windBonusPerLevel * state.layers.elevation[i]) *
              windForestFactor(state, i);
        break;
```

- [ ] **Step 4: Charge the surcharge**

In `placePlant` in `src/sim/energy.ts`, replace the cost line:

```ts
const offshore = state.layers.terrain[tile] === Terrain.Sea;
const cost =
  Math.round(
    BALANCE.costs.plant[plant] *
      (offshore ? BALANCE.sea.offshoreCostFactor : slopeCostMultiplier(state, tile)),
  ) + fellingCost(state, tile);
```

(Sea tiles are flat and treeless, so the slope multiplier and the felling fee are both inert there — the offshore factor replaces the slope factor rather than stacking with it.)

- [ ] **Step 5: Mirror it in the inspector**

In `src/sim/inspect.ts`, the `WindTurbine` case of `plantGeneration` must use the same bonus:

```ts
    case PlantType.WindTurbine: {
      const bonus =
        state.layers.terrain[index] === Terrain.Sea
          ? 1 + BALANCE.sea.offshoreWindBonus
          : 1 + BALANCE.terrain.windBonusPerLevel * state.layers.elevation[index];
      return {
        generation: e.windPeakOutput * currentWindFactor(state) * bonus,
        peak: e.windPeakOutput * bonus,
      };
    }
```

- [ ] **Step 6: Run the tests**

Run: `pnpm vitest run src/sim/energy.test.ts src/sim/inspect.test.ts`
Expected: PASS.

- [ ] **Step 7: Format and commit**

```bash
pnpm format
git add -A src/sim
git commit -m "feat(sim): offshore wind turbines

Turbines may stand at sea: stronger, unsheltered wind for a higher
construction cost and a longer line out to them."
```

---

### Task 6: Coastal happiness

**Files:**

- Modify: `src/sim/sea.ts` (`seaCoverage`), `src/sim/happiness.ts`
- Test: `src/sim/sea.test.ts`, `src/sim/happiness.test.ts`

**Interfaces:**

- Consumes: `BALANCE.sea.coastRadius`, `BALANCE.sea.coastBonus`.
- Produces: `seaCoverage(state: SimState): number` (0..1 share of buildings with the sea in reach).

- [ ] **Step 1: Write the failing test**

Append to `src/sim/sea.test.ts`:

```ts
import { seaCoverage } from './sea.ts';
import { TileType, Zone } from '../shared/types.ts';

describe('coastal happiness coverage', () => {
  it('counts only buildings with the sea within the coast radius', () => {
    const state = createSimState(1, 32);
    state.layers.terrain.fill(Terrain.Land);
    for (let x = 0; x < state.size; x++) state.layers.terrain[x] = Terrain.Sea;

    const radius = BALANCE.sea.coastRadius;
    // One building just inside the radius, one far inland.
    const near = radius * state.size + 5;
    const far = (radius + 6) * state.size + 5;
    for (const index of [near, far]) {
      state.layers.tileType[index] = TileType.Empty;
      state.layers.zone[index] = Zone.Residential;
      state.layers.density[index] = 1;
    }
    expect(seaCoverage(state)).toBeCloseTo(0.5, 5);
  });

  it('is zero without buildings', () => {
    const state = createSimState(1, 32);
    expect(seaCoverage(state)).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/sim/sea.test.ts`
Expected: FAIL — `seaCoverage` is not exported.

- [ ] **Step 3: Implement the coverage**

Append to `src/sim/sea.ts` (import `TileType` from `../shared/types.ts`):

```ts
/**
 * Share (0..1) of buildings with a sea tile within the coast radius —
 * the sea view that raises happiness. Mirrors `forestCoverage`.
 */
export function seaCoverage(state: SimState): number {
  const { layers } = state;
  const radius = BALANCE.sea.coastRadius;
  let buildings = 0;
  let covered = 0;
  for (let i = 0; i < layers.tileType.length; i++) {
    if (layers.tileType[i] !== TileType.Empty || layers.density[i] === 0) continue;
    buildings++;
    if (hasSeaWithin(state, i, radius)) covered++;
  }
  return buildings > 0 ? covered / buildings : 0;
}

/** True when any tile in the Chebyshev ring around `index` is sea. */
function hasSeaWithin(state: SimState, index: number, radius: number): boolean {
  const { terrain } = state.layers;
  const { size } = state;
  const cx = tileX(index, size);
  const cy = tileY(index, size);
  const x0 = Math.max(0, cx - radius);
  const x1 = Math.min(size - 1, cx + radius);
  const y0 = Math.max(0, cy - radius);
  const y1 = Math.min(size - 1, cy + radius);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (terrain[y * size + x] === Terrain.Sea) return true;
    }
  }
  return false;
}
```

- [ ] **Step 4: Add the bonus to happiness**

In `src/sim/happiness.ts`, import `seaCoverage` from `./sea.ts` and add next to the forest bonus:

```ts
// A sea view is worth its own bonus, like woods and parks.
const coastBonus = seaCoverage(state) * BALANCE.sea.coastBonus;
```

and include `coastBonus +` in the `target` expression right after `forestBonus +`.

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run src/sim/sea.test.ts src/sim/happiness.test.ts`
Expected: PASS.

- [ ] **Step 6: Format and commit**

```bash
pnpm format
git add -A src/sim
git commit -m "feat(sim): a sea view raises happiness

Coastal buildings get their own bonus next to parks and woods, so the
shore is contested between housing, turbines and tidal plants."
```

---

### Task 7: City goal

**Files:**

- Modify: `src/sim/goals.ts`, `src/ui/i18n.tsx`
- Test: `src/sim/goals.test.ts`

**Interfaces:**

- Consumes: `countPlants`, `PlantType.TidalPlant`.
- Produces: goal id `tidalPower`.

- [ ] **Step 1: Write the failing test**

Add to `src/sim/goals.test.ts`, following the file's existing goal-test style:

```ts
it('achieves tidalPower once a tidal plant stands', () => {
  const state = createSimState(1, 64);
  state.money = 1_000_000;
  goalsStep(state);
  expect(state.goals.find((goal) => goal.id === 'tidalPower')?.achieved).toBe(false);

  for (let i = 0; i < state.layers.terrain.length; i++) {
    if (isCoastalSea(state, i)) {
      placePlant(state, i, PlantType.TidalPlant);
      break;
    }
  }
  goalsStep(state);
  expect(state.goals.find((goal) => goal.id === 'tidalPower')?.achieved).toBe(true);
});
```

Check how `state.goals` is actually exposed in the existing tests in that file and match it — the assertion style matters more than the exact accessor.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/sim/goals.test.ts`
Expected: FAIL — `tidalPower` is not a goal id.

- [ ] **Step 3: Add the goal**

In `src/sim/goals.ts`, add `'tidalPower'` to `GOAL_IDS` directly after `'hydroPower'`, and add the check next to the existing hydro check (find it by grepping for `hydroPower` in that file), following the same shape:

```ts
achieve('tidalPower', countPlants(state, PlantType.TidalPlant) > 0);
```

Use whatever helper the neighbouring goals use — do not invent a new one.

- [ ] **Step 4: Add the strings**

In `src/ui/i18n.tsx`, next to the `hydroPower` goal strings (grep for `goal.hydroPower`), add the English and German entries, matching the neighbouring keys' shape exactly (title and description):

```ts
  'goal.tidalPower': 'Tidal power',
  'goal.tidalPower.desc': 'Build a tidal plant on the coast.',
```

```ts
  'goal.tidalPower': 'Gezeitenkraft',
  'goal.tidalPower.desc': 'Baue ein Gezeitenkraftwerk an der Küste.',
```

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run src/sim/goals.test.ts && pnpm typecheck`
Expected: PASS. If `SaveGame` stores goals by id, confirm an old save without this id still loads (the goal list is rebuilt from `GOAL_IDS`; a missing entry defaults to not achieved).

- [ ] **Step 6: Format and commit**

```bash
pnpm format
git add -A src/sim src/ui/i18n.tsx
git commit -m "feat(sim): tidal power city goal"
```

---

### Task 8: Agent tools

**Files:**

- Modify: `src/agent/tools.ts`, `docs/agent-tools.md`
- Test: `src/agent/tools.test.ts`

**Interfaces:**

- Consumes: `PlantType.TidalPlant`, `Terrain.Sea`, `GlobalStats.tide`.
- Produces: plant name `tidal`, terrain name `sea`.

- [ ] **Step 1: Write the failing test**

Add to `src/agent/tools.test.ts`, in the building section:

```ts
it('places a tidal plant on the coast', async () => {
  const tools = createTools(engine);
  const tile = findCoastalSeaTile(engine);
  const result = await tools.place_plant({ plant: 'tidal', x: tile.x, y: tile.y });
  expect(result.ok).toBe(true);
});
```

Match the file's existing call style for `place_plant` (look at the `run_of_river` or `pumped_storage` test); add a small helper that scans the tile mirror for a sea tile with a land 4-neighbour.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/agent/tools.test.ts`
Expected: FAIL — `'tidal'` is not a valid plant name.

- [ ] **Step 3: Register the plant**

In `src/agent/tools.ts`:

```ts
export const PLANT_NAMES = {
  …
  tidal: PlantType.TidalPlant,
  …
} as const;
```

```ts
const PLANT_TOOL_KEY: Record<PlantName, TranslationKey> = {
  …
  tidal: 'tool.plant-tidal',
  …
};
```

```ts
const PLANT_PLACEMENT: Record<PlantName, string> = {
  …
  tidal:
    'an empty sea tile touching land; output follows the tide and rises in narrow water and at the river mouth',
  …
};
```

```ts
const TERRAIN_NAME: Record<Terrain, string> = {
  [Terrain.Land]: 'land',
  [Terrain.River]: 'river',
  [Terrain.Lake]: 'lake',
  [Terrain.Sea]: 'sea',
};
```

Also extend the placement description string that lists water-bound plants (grep for `'run_of_river (river tile)'`) with `tidal (coastal sea tile)`, and add the tide to whatever the stats tool returns for weather/energy — one line, `tide: stats.tide`.

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run src/agent/tools.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Update the docs**

In `docs/agent-tools.md`, add `tidal` to the plant table with its placement rule and cost, and mention the tide field wherever the stats output is documented. Keep the table's existing column order.

- [ ] **Step 6: Format and commit**

```bash
pnpm format
git add -A src/agent docs/agent-tools.md
git commit -m "feat(agent): expose the tidal plant and the tide"
```

---

### Task 9: Rendering

**Files:**

- Modify: `src/render/scene.ts` (palette), `src/render/waterMesh.ts` (sea group + tide), `src/render/plantsMesh.ts` (plant mesh), `src/render/minimapLayer.ts` (colour)
- Test: none (the render layer is smoke-tested via Playwright, per the project's testing strategy)

**Interfaces:**

- Consumes: `Terrain.Sea`, `tideLevel` from `src/sim/sea.ts` (a pure function — importing it into render is fine; it has no state).
- Produces: sea surface that rises and falls, tidal plant mesh.

**Note:** this sandbox has no WebGL. Verify by `pnpm typecheck`, `pnpm test` and `node scripts/smoke.mjs`; the visual check happens on the Mac.

- [ ] **Step 1: Add the palette colour**

In `src/render/scene.ts`:

```ts
  river: 0x4d8fc4,
  lake: 0x3f7fb5,
  sea: 0x2f6ea8,
```

- [ ] **Step 2: Render sea tiles**

In `src/render/waterMesh.ts`, add a third instanced mesh alongside `mesh` (lake) and `riverMesh`:

```ts
  /** Sea tiles: flat boxes on the tide-driven sea level. */
  private readonly seaMesh: THREE.InstancedMesh;
```

Build it in the constructor exactly like the lake mesh (same box geometry, same material, `frustumCulled = false`, `receiveShadow = true`, `count = 0`, added to the scene). In the rebuild pass that walks the terrain, add a `Terrain.Sea` branch next to the `Terrain.Lake` branch that writes into `seaMesh` with `PALETTE.sea` at elevation 0.

- [ ] **Step 3: Make the sea breathe with the tide**

The mesh already receives per-frame updates for the brightness wobble. In that same update, offset the whole sea mesh vertically:

```ts
/** Peak-to-peak tidal range of the rendered sea surface, in tile units. */
const TIDE_AMPLITUDE = 0.05;
```

```ts
// The sea rises and falls with the tide; the range is deliberately
// small so the shore reads as a shore, not as a flood.
this.seaMesh.position.y = WATER_HEIGHT + tideLevel(tick) * TIDE_AMPLITUDE;
```

`tick` comes from the environment the renderer already passes into this update (`RenderEnvironment`); if the tick is not on it yet, add it where the environment is assembled in `renderer.ts` from the latest `GlobalStats`. Respect `reducedMotion` the way the brightness wobble does — when it is set, hold the sea at `WATER_HEIGHT`.

- [ ] **Step 4: Add the plant mesh**

In `src/render/plantsMesh.ts`, add a `TidalPlant` case to the shape function, in the style of its neighbours — a low, half-submerged housing with a marker buoy above the waterline, using existing `COLORS` entries plus one new colour if needed:

```ts
    case PlantType.TidalPlant:
      return [
        // Submerged turbine housing with a slim pylon and a surface buoy.
        { sx: 0.5, sy: 0.14, sz: 0.34, ox: 0, oy: 0.02, oz: 0, color: COLORS.tidalHousing },
        { sx: 0.08, sy: 0.4, sz: 0.08, ox: 0, oy: 0.14, oz: 0, color: COLORS.tidalPylon },
        { sx: 0.22, sy: 0.12, sz: 0.22, ox: 0, oy: 0.5, oz: 0, color: COLORS.tidalBuoy },
      ];
```

Define the three colours next to the existing hydrogen ones, in the same muted palette.

- [ ] **Step 5: Colour the minimap**

In `src/render/minimapLayer.ts`, give `Terrain.Sea` its own colour (darker than the lake) wherever terrain colours are chosen, and make sure the tidal plant is drawn in the plant layer like other plants.

- [ ] **Step 6: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm test && node scripts/smoke.mjs`
Expected: all pass, smoke prints its usual summary with no errors.

- [ ] **Step 7: Format and commit**

```bash
pnpm format
git add -A src/render
git commit -m "feat(render): sea surface with a tide, tidal plant mesh

The sea rises and falls with the tide clock; the plant sits half
submerged with a surface buoy."
```

---

### Task 10: UI

**Files:**

- Modify: `src/ui/BuildBar.tsx`, `src/ui/useTools.ts`, `src/ui/i18n.tsx`, `src/ui/EnergyPanel.tsx`, `src/ui/BudgetPanel.tsx`, `src/ui/TileInspector.tsx`, `src/ui/HelpPage.tsx`
- Test: existing UI tests only; add none unless a file already has a test

**Interfaces:**

- Consumes: `GlobalStats.tide`, `EnergyStats.generation.tidal`, `PlantType.TidalPlant`.
- Produces: the `plant-tidal` tool id.

- [ ] **Step 1: Add the build tool**

In `src/ui/BuildBar.tsx`, in the energy category next to `plant-hydro`:

```ts
      { id: 'plant-tidal', icon: '🌊', cost: BALANCE.costs.plant[PlantType.TidalPlant] },
```

In `src/ui/useTools.ts`:

```ts
  'plant-tidal': PlantType.TidalPlant,
```

- [ ] **Step 2: Add the strings (English and German)**

In `src/ui/i18n.tsx`, English block:

```ts
  'tool.plant-tidal': 'Tidal plant',
  'tool.plant-tidal.desc':
    'Stands on the coast and generates from the tidal current: two high waters a day, four peaks, four slack-water gaps — fully predictable, and it drifts against the sun. Narrow water and the river mouth run faster.',
  'energy.tidal': 'Tidal',
  'hud.tide': 'tide',
  'hud.tide.title': 'Tide: {state} · current {percent} %',
  'tide.rising': 'rising',
  'tide.falling': 'falling',
  'tide.high': 'high water',
  'tide.low': 'low water',
  'inspect.tideFactor': 'Tidal current',
  'inspect.siteFactor': 'Site factor',
```

German block:

```ts
  'tool.plant-tidal': 'Gezeitenkraftwerk',
  'tool.plant-tidal.desc':
    'Steht an der Küste und erzeugt aus der Gezeitenströmung: zwei Hochwasser am Tag, vier Spitzen, vier Stillwasserphasen — vollständig vorhersagbar, und es driftet gegen die Sonne. In engem Wasser und an der Flussmündung läuft die Strömung schneller.',
  'energy.tidal': 'Gezeiten',
  'hud.tide': 'Tide',
  'hud.tide.title': 'Tide: {state} · Strömung {percent} %',
  'tide.rising': 'auflaufend',
  'tide.falling': 'ablaufend',
  'tide.high': 'Hochwasser',
  'tide.low': 'Niedrigwasser',
  'inspect.tideFactor': 'Gezeitenströmung',
  'inspect.siteFactor': 'Standortfaktor',
```

- [ ] **Step 3: Show tidal generation**

In `src/ui/EnergyPanel.tsx`, add a `tidal` row next to the hydro row, using `energy.generation.tidal` and the `energy.tidal` label — copy the neighbouring row's markup exactly.

In `src/ui/BudgetPanel.tsx`, the upkeep breakdown is driven by `plantUpkeepByType`, so the tidal plant appears automatically once it has a label — check that the panel's plant-label map has a `TidalPlant` entry and add it (`'tool.plant-tidal'`) if it does not.

- [ ] **Step 4: Show the tide in the HUD**

Next to the weather display (grep for `hud.weather.title`), add a small tide readout built only from `stats.tide` — no local state:

- label: `hud.tide`;
- state text: `tide.high` when `tide.factor` is below 0.05 and `tide.level > 0`, `tide.low` when it is below 0.05 and `tide.level <= 0`, otherwise `tide.rising` or `tide.falling` from `tide.rising`;
- tooltip via `hud.tide.title` with that state and `Math.round(tide.factor * 100)`.

- [ ] **Step 5: Show the site factor in the inspector**

In `src/ui/TileInspector.tsx`, where the plant details are rendered, show `inspect.tideFactor` and `inspect.siteFactor` for a tidal plant, using the values the sim already puts on `TileInfo` (the terrain-bonus field set in Task 4). Follow the existing rows' formatting.

- [ ] **Step 6: Document it in the help page**

In `src/ui/HelpPage.tsx` (strings live in `i18n.tsx`), extend the energy section text — both languages — with two sentences on tides: predictable, four peaks a day, drifts against the sun, so storage bridges the slack; the coast also carries offshore turbines and raises happiness.

- [ ] **Step 7: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS. If a test asserts the set of i18n keys is identical between English and German, it will catch any key you added to only one block — fix the missing side.

- [ ] **Step 8: Format and commit**

```bash
pnpm format
git add -A src/ui
git commit -m "feat(ui): tidal plant tool, tide readout and help

Build bar entry, generation row, HUD tide state and inspector fields,
in English and German."
```

---

### Task 11: Balance probe, tuning and docs

**Files:**

- Create (temporary): `scripts/probe-tidal.mjs` — deleted again in this task
- Modify: `src/shared/constants.ts` (final values), `docs/idea.md`, `docs/plan.md`

- [ ] **Step 1: Write the probe**

Create `scripts/probe-tidal.mjs`, following the pattern described in `CLAUDE.md` (script a city via the headless `SimEngine`, run N in-game days, print pacing). It should, for several seeds:

- build a small working city (roads, zones, a few plants, power lines),
- place two tidal plants on coastal tiles and one offshore turbine,
- run 20 in-game days,
- print per day: tidal share of total generation, curtailment, deficit ticks, storage cycles, money delta, and the min/max daily tidal output (to see the spring-neap swing).

- [ ] **Step 2: Run it and read the numbers**

Run: `node scripts/probe-tidal.mjs`

Judge against these targets:

- Tidal contributes a visible but not dominating share with two plants in a small city — roughly on par with two run-of-river plants, but steadier across the day.
- The four daily slack periods actually produce deficits in a city that relies on tidal alone without storage (the mechanic must bite).
- A tidal plant pays back over a comparable horizon to a run-of-river plant, not obviously faster.
- Offshore turbines are attractive but not strictly better than a good hilltop once the line cost is counted.

- [ ] **Step 3: Tune**

Adjust `BALANCE.energy.tidalPeakOutput`, `BALANCE.costs.plant[PlantType.TidalPlant]`, `BALANCE.upkeepPerTick.plant[PlantType.TidalPlant]`, `BALANCE.sea.offshoreWindBonus`, `BALANCE.sea.offshoreCostFactor` and `BALANCE.sea.coastBonus` until the targets hold. Re-run the probe after each change.

- [ ] **Step 4: Run the full suite**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm coverage`
Expected: PASS, coverage on `src/sim` and `src/shared` ≥ 90 %. If `sea.ts` is below that, add the missing unit tests — do not lower the gate.

- [ ] **Step 5: Delete the probe**

```bash
rm scripts/probe-tidal.mjs
```

- [ ] **Step 6: Update the docs**

In `docs/idea.md`, mark the backlog entry done and fix the two stale markers found earlier:

- **Hydrogen & electrolysers**: change `(in progress)` to `(done)`.
- **Dynamic electricity market**: add `(done)`.
- **Sea edge & tidal power**: add `(done)` and rewrite the entry to describe what shipped — sea on the river's downstream edge, two-constituent tide with spring and neap, coastal tidal plants with a site factor, offshore wind, sea-view happiness.

In `docs/plan.md`, add to the module layout under `sim/`:

```
    sea.ts         # sea edge, tide clock, tidal site factor, coast happiness
```

- [ ] **Step 7: Commit**

```bash
pnpm format
git add -A
git commit -m "balance: tune tidal power from the headless probe

Peak output, costs and the offshore bonus set from a 20-day probe over
several seeds. Docs updated; the probe is deleted again."
```

- [ ] **Step 8: Final verification**

Run: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm build && node scripts/smoke.mjs`
Expected: everything passes. Report the results; the visual check and `pnpm e2e` need the Mac (no WebGL in the Linux sandbox).
