# Power Lines — Design Spec

Date: 2026-09-22. Status: approved in brainstorming, awaiting written review.

## Goal

Plants currently supply every building within a Chebyshev radius of 14
tiles, so plant placement is trivial. Power lines replace that radius: a
building is supplied only when a line network connects it to a plant.
Siting plants, bridging the river with lines, and routing a trunk line
along the main street become real decisions. Everything else — the
global energy balance, storage pools, dispatch order, economy — stays as
it is.

## Decisions

- **Lines replace the radius.** No fallback radius around plants beyond
  the small connection radius below.
- **One global balance.** Every supply plant feeds the city balance no
  matter which network it hangs in; lines only decide whether a building
  is connected. Separate networks are not balanced separately.
- **Own bitmask layer, allowed over roads and water.** Lines do not
  consume land: they coexist with roads (pylons at the kerb) and span
  river and lake (overhead line). They cannot share a tile with a
  building or a plant. Plants are network nodes themselves.
- **Small connection radius.** Every energised line tile and every supply
  plant connects buildings within `BALANCE.energy.lineSupplyRadius`
  (Chebyshev, 3). A trunk line along a street serves the houses on both
  sides; no line has to touch every door.
- **Old saves get a network for free.** A save without the line layer
  receives lines on every road tile reachable from a supply plant.
- **Recompute on change, cache in memory.** Connectivity is derived, not
  persisted, and only recomputed when lines or plants change.

## Section 1: Simulation model and rules

### Layer

`SimLayers.powerLine: Uint8Array` — per tile a 4-neighbour bitmask
(`DIR_N | DIR_E | DIR_S | DIR_W`, same encoding as `roadMask`); `0` means
no line. Persisted in `SaveGame.layers.powerLine` (optional;
`SAVE_VERSION` unchanged).

`SimLayers.energized: Uint8Array` — `1` when the tile is within
`lineSupplyRadius` of an energised line tile or a supply plant. Derived,
not persisted, rebuilt by `recomputeGrid`.

`SimState.gridVersion: number` — incremented by every mutation of
`plantType` or `powerLine` (build, bulldoze, undo restore, save load,
migration). `recomputeGrid` remembers the version it last ran for and is
a no-op otherwise.

### Building lines (`src/sim/powerLines.ts`)

- `buildPowerLines(state, tiles): BuildResult` mirrors `buildRoads`:
  filters tiles through `buildRejection(state, index, BuildIntent.PowerLine)`,
  skips tiles that already carry a line (never charged twice), sums the
  cost (`BALANCE.costs.powerLinePerTile`, or
  `BALANCE.costs.powerLineWaterPerTile` when the terrain is river or
  lake), rejects with `notEnoughMoney` when short, sets the bits, recomputes
  the masks of the tiles and their 4-neighbours, pushes one `UndoEntry`,
  bumps `gridVersion`, marks tiles dirty.
- `BuildIntent.PowerLine` in `buildRejection`: allowed when the tile has
  no building (`density === 0`) and is not a plant; the tile type may be
  `Empty` or `Road`; terrain may be land, river or lake. Rejected with
  `needsLineSite` otherwise (occupied by a building or plant). Existing
  intents are unchanged.
- `recomputePowerLineMask(state, index)` mirrors `recomputeRoadMask`: a bit
  is set toward each 4-neighbour that also carries a line. Masks are pure
  rendering/adjacency data; connectivity uses the flood fill below.
- **Bulldozer** on a tile that carries a line removes the line first (and
  only the line): a road tile with a line loses the line, a second pass
  removes the road. Tiles without a line behave as today. Undo snapshots
  gain the `powerLine` byte and restore it.
- **Upkeep**: `BALANCE.upkeepPerTick.powerLinePerTile` per line tile,
  added to the economy's road upkeep line item (shown as one "grid
  upkeep" figure with roads; no new panel row).

### Connectivity (`src/sim/powerGrid.ts`)

`recomputeGrid(state)`:

1. Return early when `state.gridVersion === state.gridComputedVersion`.
2. Seed a queue with every supply plant tile (`SUPPLY_SOURCES` in
   `energy.ts`, i.e. all plants except charging hubs and parks).
3. Flood-fill over 4-neighbours that carry a line (`powerLine !== 0`).
   Every supply plant is a seed, so two plants joined by a line share
   one set of energised tiles; the fill result is the set of energised
   line tiles.
4. Clear `energized`, then stamp a Chebyshev square of radius
   `lineSupplyRadius` around every energised line tile and every supply
   plant, clipped at the map edge.
5. Store `gridComputedVersion = gridVersion`.

Line tiles not reached by the fill are dead: they render, they cost
upkeep, they connect nothing.

### Energy tick

`energyStep` calls `recomputeGrid(state)` first, then treats a building as
connected when `layers.energized[i] === 1`. `isConnected` and
`BALANCE.energy.supplyRadius` are deleted. Charging hubs remain grid
consumers under the same rule (a hub is connected when its tile is
energised). The balance, storage, biogas and import/export logic are
untouched.

### Growth

Unchanged: buildings spawn on zoned tiles next to roads; supply is judged
afterwards by the network, exactly as it was judged by the radius.

### Save migration

`deserializeState`: when `save.layers.powerLine` is absent, after
restoring the other layers, run `grantLegacyNetwork(state)`: flood-fill
over road tiles starting from every road tile 4-adjacent to a supply
plant, set a line on every reached road tile, recompute masks, bump
`gridVersion`. The player loads into a supplied city with a visible
network along the streets. Saves that have the layer (even all-zero) are
never migrated.

### Goal

`gridBuilder`: achieved when any line tile exists. Strings: "Grid
builder" / "Build your first power line." and "Unter Strom" / "Baue deine
erste Stromleitung."

## Section 2: Rendering, tool, UI

### Rendering (`src/render/powerLinesMesh.ts`)

`PowerLinesMesh implements DiffLayer`, modelled on `RoadsMesh`:

- Tracks `powerLine`, `tileType` and `terrain` per tile from `TileDiff`
  (which gains `powerLine: number`).
- One instanced pylon per line tile: a thin vertical box. On a road tile
  the pylon stands at the north-west kerb instead of the tile centre so
  vehicles pass; over water it is taller so the cable clears the deck
  height.
- One instanced cable per set east bit and per set south bit: a thin box
  from this tile's pylon top to the neighbour's pylon top. Drawing only
  east and south draws every connection exactly once.
- Capacities: pylons `gridSize * gridSize`, cables `gridSize * gridSize * 2`.
  Both `frustumCulled = false`. Counts are recomputed on every rebuild.
- Dead lines get no special colour; the supply overlay shows the effect.

### Minimap

A line tile without a road is drawn as a small light dot over the ground
colour. Tiles with roads keep the road colour.

### Tool

`ToolId` gains `'power-line'`, hotkey `l`, toolbar entry after the road
tool with icon ⚡ and the per-tile cost. Interaction is the road tool's:
anchor on press, L-shaped path on drag, preview tiles, cost badge summed
per tile with the water surcharge via `renderer.terrainAt`. Bulldozer and
undo need no new UI. The plant hover radius shrinks from `supplyRadius`
to `lineSupplyRadius`.

### Overlay

The supply overlay is the only network view. Its "not connected" state
now means "no energised line or plant within reach".

### Strings (English and German)

- `tool.power-line`: "Power line" / "Stromleitung".
- `rejection.needsLineSite`: "Power lines need free land, a road or water"
  / "Leitungen brauchen freies Land, eine Straße oder Wasser".
- `goal.gridBuilder.*` as above.
- `help.grid.title` / `help.grid.body`: a new help section explaining
  that plants only supply through lines, the connection radius, lines on
  roads and over water, and the free network in old saves.
- `help.energy.body`: one added sentence that plants need lines.
- README: the "Power the city" and "Overlays" bullets mention lines.

### Out of scope

Line losses, per-line capacity, substations, a dedicated network
overlay colour, per-network balances.

## Section 3: Balance, tests, verification

### Balance values (`BALANCE`)

- `costs.powerLinePerTile: 4`, `costs.powerLineWaterPerTile: 12` (a road
  tile costs 10, a bridge tile 40; a network must not dominate build
  costs).
- `upkeepPerTick.powerLinePerTile`: one tenth of the road upkeep per
  tile.
- `energy.lineSupplyRadius: 3`. `energy.supplyRadius` is deleted.

### Balance probe

A temporary `src/sim/probe-grid.test.ts` plays the known 48×48 probe city
for 20 days with a trunk line along each street and checks that
population, jobs and deficit share match today's numbers within seed
noise, and that total line cost for a ~300-resident city stays under 5 %
of its construction spend. The probe is deleted before committing; the
numbers go into the commit body.

### Unit tests (colocated `*.test.ts`)

- `state.test.ts`: `BuildIntent.PowerLine` matrix — land, road, river,
  lake accepted; building, plant rejected with `needsLineSite`.
- `powerLines.test.ts`: masks on build and bulldoze including neighbours;
  no double charge for existing line tiles; water surcharge; undo
  restores line and money; bulldozer removes the line before the road;
  `gridVersion` bumps on each mutation.
- `powerGrid.test.ts`: flood fill follows only contiguous lines; a line not
  touching a supply plant stays dead; a charging hub or park does not
  seed the fill; two plants joined by a line form one network; radius
  stamp clipped at the map edge; `recomputeGrid` is a no-op when the
  version is unchanged and reruns after a bump.
- `energy.test.ts`: a building beyond the radius of any energised tile is
  `NotConnected`; the same building connects once a line reaches within
  the radius; a hub on the network counts as consumption; existing
  radius-based tests are rewritten to place a line.
- `state.test.ts` / `serialization.test.ts`: round trip of the line
  layer; JSON import accepts exports without it.
- `engine.test.ts`: loading a save without the layer grants lines exactly
  on the road tiles reachable from a plant and nowhere else; a save with
  an all-zero layer is left alone.
- `goals.test.ts`: `gridBuilder`.
- Coverage stays ≥ 90 % on `src/sim` and `src/shared`.

### e2e

The existing build test drags a power line from the placed plant past
the zoned block and asserts the building's supply-overlay colour is no
longer "not connected". Runs on the Mac or in CI only.

### Visual acceptance (Mac)

Pylons on land, at the kerb of a road tile, and taller over the river;
cables in both directions; preview and cost badge while dragging; the
plant hover ring shows the small radius.

### Implementation order

1. Layer, `BuildIntent.PowerLine`, `buildPowerLines`, bulldoze, undo.
2. `recomputeGrid`, `energized`, energy tick switch, delete the radius.
3. Save round trip and legacy migration.
4. Goal.
5. Balance probe and tuning.
6. `PowerLinesMesh`, minimap, `TileDiff.powerLine`.
7. Tool, hover radius, strings, help.
8. e2e assertion, README, full verification.

One commit per step, as on the water branch.
