# Terrain elevation — design

Date: 2026-09-23
Status: approved for planning

## Goal

Give every map real height: rolling hills rendered as smooth 3D slopes,
with gameplay attached. Steep slopes limit where the city can grow,
building on a slope costs extra, wind turbines earn more on high ground,
and the existing hydro plants gain head-based bonuses because the river
now genuinely flows downhill.

## Decisions

- Discrete elevation levels 0–7 per tile, stored in a new immutable
  `elevation` layer generated once per map.
- Terrain generation runs first; the river follows the terrain downhill
  (steepest descent), never uphill. The lake sits in a basin at a single
  surface level.
- Rendered as true 3D with smooth slopes: one ground mesh with
  per-vertex heights, no terraces. Built tiles count as levelled — the
  object stands flat at the tile's centre height.
- All four gameplay effects ship together: build constraints, slope
  surcharge, wind elevation bonus, hydro head bonuses. The hydro effects
  are bonuses, never new requirements — flat maps and old saves keep
  today's behaviour exactly.
- Vehicles ignore slope for speed and pathfinding (bridges unchanged);
  they only follow the ground visually.

## Section 1: Elevation layer and map generation

### Elevation layer

`TileLayers` gains `elevation: Uint8Array` with values 0–7
(`BALANCE.terrain.maxLevel = 7`). `createTileLayers` allocates it;
`createSimState` leaves it all zero. Elevation never changes after
generation, so undo snapshots do not include it. All tunables live in a
new `BALANCE.terrain` block.

### Generation (`src/sim/terrain.ts`)

`generateTerrain(state)` runs in the engine's `newGame` handler after
`createSimState` and **before** `generateWater`, using its own `Rng`
seeded from `state.seed` with a fixed salt (the `water.ts` pattern), so
the same seed always yields the same relief and map generation stays
independent of the gameplay random stream.

- **Height field.** Seeded value noise (two to three octaves) over the
  grid, followed by `BALANCE.terrain.smoothingPasses` box-blur passes,
  normalised to 0–7. The distribution is shaped so most land sits at
  levels 1–3 (plenty of buildable ground) and ridges climb toward one
  seed-chosen map edge, leaving the opposite edge low.
- **Buildable-land guarantee.** After shaping, if the fraction of land
  tiles with slope ≤ 1 (see Section 2) falls below
  `BALANCE.terrain.minBuildableFraction`, extra smoothing passes run
  until it holds (bounded attempts, then a final global flatten step
  toward the mean — deterministic).

### Water follows terrain (`src/sim/water.ts` rework)

`generateWater` keeps its public shape (river edge to edge, one lake,
dry centre rule, widths, its own seeded `Rng`) but routes by height:

- **River.** Entry on the high edge, exit on the low edge. Each step
  moves to the lowest eligible forward neighbour, with the existing
  sine-meander offset applied as a tie-breaking perturbation so the
  river still winds. Along the finished path, elevation is clamped to
  be monotonically non-increasing from entry to exit (the river carves);
  bank tiles are relaxed so no riverside slope exceeds the buildable
  limit plus one.
- **Lake.** Placed on the river as today, but sunk into a basin: every
  lake tile's elevation is set to one common level, the **lake surface
  level** (the minimum elevation the ellipse covered). Shore tiles are
  relaxed to at most one level above the surface. `state` keeps
  `lakeSurfaceLevel` (derived, recomputed on load — not saved).

After generation every tile with non-zero elevation is marked dirty so
the first tick carries heights to the renderer (water tiles already
are).

## Section 2: Gameplay rules

### Slope

`slopeAt(state, index)` = maximum elevation difference to the up-to-four
edge neighbours. Map-edge neighbours are ignored.

### Build constraints

`buildRejection` gains a `tooSteep` reason: roads, zones, plants,
power-line sites and growth all require `slope <= 1`
(`BALANCE.terrain.maxBuildSlope`). Water rules are unchanged and checked
first, so river and lake messages keep their specific texts. Growth can
never hit `tooSteep` on its own because steep tiles can never be zoned;
no new `GrowthBlocker` is needed.

### Slope surcharge

Building anything (road, zone, plant, power line) on a tile with
`slope === 1` costs `BALANCE.terrain.slopeCostFactor` (about 1.25×) of
the normal price, rounded to whole money. On a bridge tile the factor
multiplies the bridge price. Upkeep is unaffected.

### Wind elevation bonus

Wind turbine output scales with the turbine tile's elevation:
`1 + BALANCE.terrain.windBonusPerLevel * level` (about +6 % per level,
so up to roughly +42 % at level 7). The energy census sums this factor
over wind turbine tiles instead of counting them, and wind generation
uses the summed effective capacity. Rooftop PV and solar farms are
unaffected.

### Hydro head bonuses

- **Run-of-river.** Each plant's output gains
  `1 + BALANCE.terrain.hydroDropBonus * drop`, where `drop` is the
  elevation difference between the plant's river tile and its lowest
  downstream river neighbour (0 on flat water — today's behaviour).
- **Pumped storage.** Each plant's capacity and power limit gain
  `1 + BALANCE.terrain.headBonusPerLevel * head`, where `head` is the
  plant tile's elevation minus the lake surface level, clamped to ≥ 0.
  Efficiency is unchanged. The census aggregates effective capacity and
  power the same way it will for wind.

Both are pure bonuses: with all-zero elevation every factor is exactly
1 and the energy balance reproduces today's numbers.

## Section 3: Rendering

### Ground mesh

`render/terrain.ts` replaces the single `PlaneGeometry` with one
`BufferGeometry` grid of `(size + 1)²` vertices (still one draw call).
A vertex's height is the mean of the elevations of its up-to-four
adjacent tiles, times a world unit per level (a render constant, about
0.35) — smooth slopes fall out of the interpolation. The seasonal
`groundColor()` tint stays; vertex colours add a subtle
brightness ramp by height so relief reads from the isometric camera.

### Content on the terrain

The renderer keeps a `elevationY(index)` helper (tile centre height in
world units), fed by terrain diffs. Every `DiffLayer` that today uses a
constant `y` — buildings, zones, plants, roads, power lines, water,
overlays, icons, the selection marker — adds `elevationY` for its tile.
Built tiles are rendered levelled: the instance sits flat at the tile
centre height.

- **Picking** (`render/picking.ts`) raycasts against the ground mesh
  instead of the y = 0 plane.
- **Vehicles** interpolate height between tile centre heights along the
  path, matching the existing position interpolation.
- **Water** renders river tiles at their carved tile height and all
  lake tiles at the lake surface level.
- **Minimap** shades the terrain colour by elevation level (darker low,
  lighter high) before the existing road/plant/building priorities.

### TileDiff

`TileDiff` gains `elevation: number`; `collectDiffs` includes it.

## Section 4: UI

No separate overlay — 3D relief plus minimap shading carry the
information.

- **Inspector**: shows the tile's elevation level, flags a steep tile,
  and shows the active bonus on wind turbines (elevation), run-of-river
  (drop) and pumped storage (head).
- **Build feedback**: the `tooSteep` rejection surfaces through the
  existing toast path; the cost preview shows the slope surcharge.
- **Help page**: a short paragraph on hills, slopes and the bonuses.
- All new strings in `i18n.tsx`, English and German.

## Section 5: Saves, tests, scope

### Saves

`SaveGame.layers` gains optional `elevation`; the JSON export adds it to
`optionalLayers`. `SAVE_VERSION` is unchanged. Old saves load as
all-zero (flat) maps: every bonus factor is 1, nothing is steep, and
the sim reproduces its previous behaviour bit for bit.

### Tests (colocated `*.test.ts`)

- `terrain.test.ts`: same seed gives identical elevation; different
  seeds differ; values stay within 0–7; buildable-land guarantee holds
  for all `MAP_SIZES`; determinism across the water rework.
- `water.test.ts` additions: river elevation is monotonically
  non-increasing entry to exit; river still touches both edges and
  stays 4-connected; all lake tiles share one level; shore relaxation
  holds.
- `state.test.ts`: `tooSteep` for every build intent at slope ≥ 2;
  slope surcharge applied at slope 1 (including the bridge combination);
  water rejections still win over `tooSteep`.
- `energy.test.ts`: wind census sums elevation factors; run-of-river
  drop bonus; pumped-storage head bonus on capacity and power; all-zero
  elevation reproduces current outputs exactly.
- Save round trip with and without the `elevation` layer.
- Coverage gate stays at 90 % on `src/sim` and `src/shared`.

### Balance probe

A temporary headless probe (the "balance: resize energy system"
pattern) compares a flat map against a hilly seed over 20 in-game days
to size `windBonusPerLevel`, `hydroDropBonus`, `headBonusPerLevel` and
`slopeCostFactor` so hills are attractive but not mandatory. Deleted
before commit.

### e2e / visual

The Linux sandbox has no WebGL; the ground mesh, picking and vehicle
heights need a visual check on the Mac. Headless smoke
(`node scripts/smoke.mjs`) covers boot. Existing e2e keeps passing; no
new e2e assertion is required.

### Out of scope

Slope effects on vehicle speed or pathfinding, erosion or terraforming
tools, cliffs above level 7, multiple rivers, waterfalls, an elevation
overlay mode, and elevation as a new-game option.
