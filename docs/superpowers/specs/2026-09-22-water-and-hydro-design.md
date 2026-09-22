# Water and hydro power — design

Date: 2026-09-22
Status: approved for planning

## Goal

Give every map a seeded river and lake, and add two hydro plants that use
them: a run-of-river plant on the river and pumped storage on the lake
shore. Water makes maps visually distinct and adds a steady, rain-driven
renewable that complements photovoltaics and wind.

## Decisions

- Every new map has one river and one lake (no dialog option).
- Roads cross the river as bridges, built by the normal road tool at a
  higher per-tile cost. Lake tiles are never buildable.
- Run-of-river output follows a new seeded "river flow" value that rises
  in rainy spells and recedes in droughts.
- Water lives in a persisted, immutable `terrain` layer. Tile type stays
  empty / road / plant. A bridge is a road on a river tile.

## Section 1: Terrain layer and map generation

### Terrain layer

`TileLayers` gains `terrain: Uint8Array` with values from a new
`Terrain` enum in `shared/types.ts`: `Land = 0`, `River = 1`, `Lake = 2`.
`createTileLayers` allocates it; `createSimState` leaves it all land.
Terrain never changes after generation, so undo snapshots do not include
it.

### Generation (`src/sim/water.ts`)

`generateWater(state)` runs once for new games (in the engine's `init`
handler, after `createSimState`, before the first tick) using
`state.rng`, so the same seed always yields the same map. All tunables
live in a new `BALANCE.water` block.

- **River.** Enters on one map edge and exits on the opposite edge; the
  axis (north-south or east-west) and the entry/exit columns are chosen
  by seed, with entry and exit kept `BALANCE.water.edgeMargin` tiles away
  from the corners. The path is a biased random walk toward the exit with
  smooth lateral drift (a bounded per-step lateral offset). It never
  doubles back along its main axis. Width is one tile, with occasional
  two-tile sections (`BALANCE.water.wideSectionChance`).
- **Lake.** One rounded blob with a diameter in
  `BALANCE.water.lakeDiameter` (roughly 5 to 9 tiles), centred on a river
  tile at a fraction along the river drawn from
  `BALANCE.water.lakePositionRange` (about one third to two thirds). The
  blob is an ellipse with slight per-tile radius noise so the shore is not
  perfectly round. The river visibly enters and leaves the lake.
- **Dry centre.** The lake centre is at least `size / 4` tiles from the
  map centre (re-pick the lake position along the river until this holds,
  deterministically, with a bounded number of attempts and a fallback of
  the farthest candidate). The river may cross the centre.
- After generation every water tile is marked dirty so the first tick
  event carries it to the renderer.

### Buildability

A single helper in `state.ts`:

```ts
export const BuildIntent = { Road: 0, Zone: 1, Plant: 2, Growth: 3 } as const;
export function isBuildable(state, index, intent, plant?: PlantType): boolean;
```

Rules:

| Terrain | Road                | Zone                | Plant               | Growth              |
| ------- | ------------------- | ------------------- | ------------------- | ------------------- |
| Land    | empty + no building | empty + no building | empty + no building | zoned + no building |
| River   | yes (bridge)        | no                  | only `RunOfRiver`   | no                  |
| Lake    | no                  | no                  | no                  | no                  |

`buildRoads`, `paintZones`, `placePlant` and the growth spawn check all
call this helper instead of repeating the "empty and density 0" test.

- Bridges cost `BALANCE.costs.bridgePerTile` instead of
  `BALANCE.costs.roadPerTile`; road upkeep applies equally.
- Bulldozing a bridge sets the tile back to empty; terrain remains river,
  so it renders as water again.
- Rejection reasons for the UI: `needsRiverTile`, `needsLakeShore`,
  `cannotBuildOnWater`.

## Section 2: Hydro plants and the energy balance

### Plant types

- `PlantType.RunOfRiver = 7`. Placed on an empty river tile. Output per
  tick: `BALANCE.energy.hydroPeakOutput * riverFlowFactor(state)`. Day and
  night, no fuel cost, upkeep in `BALANCE.upkeepPerTick.plant`. Counted as
  non-dispatchable generation alongside solar, wind and rooftop.
- `PlantType.PumpedStorage = 8`. Placed on an empty land tile with at
  least one lake tile among its four neighbours. Each plant adds
  `BALANCE.energy.pumpedStorageCapacity` capacity and
  `BALANCE.energy.pumpedStoragePowerLimit` charge/discharge power, with
  round-trip efficiency `BALANCE.energy.pumpedStorageChargeEfficiency`
  (lower than batteries). Multiple plants on one shore each add their own
  capacity.

Both plants join `SUPPLY_SOURCES` so they provide grid connection within
the supply radius. `censusPlants` counts them.

### River flow

`Weather` gains `riverFlow: number` (0..1, default
`BALANCE.water.initialFlow`). `updateWeather` advances it each tick:

- If `cloudCover > BALANCE.water.rainCloudThreshold`, flow rises by
  `rainRate * (cloudCover - threshold) / (1 - threshold)`.
- Otherwise flow decays toward `BALANCE.water.dryBaselineFlow` by
  `dryRate * (flow - baseline)`.
- Clamped to 0..1. Rates are sized so about two rainy days fill the river
  and about three dry days return it to the baseline.

`riverFlowFactor = minFlowFactor + (1 - minFlowFactor) * riverFlow`
(`BALANCE.water.minFlowFactor` around 0.4), so a drought halves output
rather than stopping it.

The renderer's rain effect switches from its private threshold constant to
`BALANCE.water.rainCloudThreshold` so visible rain and river flow agree.

### Balance order

State gains `pumpedStorageEnergy` next to `storedEnergy`.

- Surplus: charge batteries → charge pumped storage → export → curtail.
- Deficit: discharge batteries → discharge pumped storage → biogas →
  import → undersupply.

Each pool applies its own power limit and charge efficiency, and its
stored energy is clamped to its capacity every tick (so bulldozing a plant
drops stored energy, as batteries do today).

### Stats and history

- `state.lastEnergy` gains `hydro`.
- `GlobalStats.energy` gains `generation.hydro`, `pumpedSoC` (0..1) and
  `pumpedCapacity`; `GlobalStats.weather` gains `riverFlow`.
- `EnergyHistoryPoint.stateOfCharge` becomes combined stored energy over
  combined capacity (both pools). No graph change needed.
- Lifetime day sums include hydro in generation.

## Section 3: Rendering and UI

`TileDiff` gains `terrain: Terrain`.

- **Water mesh** (`render/waterMesh.ts`, a `DiffLayer`): one instanced
  flat quad per water tile just above the ground plane; river and lake use
  two nearby blues added to `PALETTE`. A slow, cheap per-frame brightness
  wobble on the material makes the water read as alive; it dims at night
  with the environment. `frustumCulled = false`.
- **Bridges**: the road tile is unchanged (vehicles and lamps stay at road
  height). `RoadsMesh` adds an instanced railing pair and a lighter deck
  slab on road tiles whose terrain is river.
- **Plant meshes** (`plantsMesh.ts`): run-of-river is a low weir block
  spanning the tile perpendicular to the river's local direction (derived
  from which neighbours are river) with a small powerhouse cube; pumped
  storage is a powerhouse block with a penstock pipe pointing toward the
  nearest lake neighbour. Existing procedural box style.
- **Minimap** paints water tiles blue. Supply and demand overlays ignore
  water tiles.
- **Toolbar**: tools `plant-hydro` (run-of-river) and `plant-pumped`
  with the next free hotkeys and costs shown like other plants. New
  rejection reasons surface through the existing toast path.
- **Energy panel**: a hydro row under generation with a small river flow
  percentage; a pumped storage row under storage with its own state of
  charge bar.
- **Help page**: a short paragraph on water, bridges and hydro.
- All new strings in `i18n.tsx`, English and German.

## Section 4: Saves, goals, tests, scope

### Saves

`SaveGame` gains optional `layers.terrain`, `riverFlow` and
`pumpedStorageEnergy`. `SAVE_VERSION` is unchanged. Old saves load as
all-land maps with `riverFlow` at the dry baseline and empty pumped
storage; they keep working without water.

### Goals

One new goal `hydroPower`: build a run-of-river plant. English and German
text; unlock toast as with existing goals.

### Tests (colocated `*.test.ts`)

- `water.test.ts`: river touches both opposite edges and is 4-connected;
  lake overlaps the river; lake centre respects the dry-centre rule; same
  seed gives identical terrain; different seeds differ; generation works
  for all map sizes in `MAP_SIZES`.
- `state.test.ts` / `roads.test.ts` / `zones.test.ts` / `growth.test.ts`:
  buildability matrix per terrain; bridge price; bulldozed bridge leaves
  river; zones and growth never touch water.
- `energy.test.ts`: run-of-river only on river tiles; pumped storage only
  on lake shore; hydro output scales with river flow; balance order across
  both pools with efficiency accounting; capacity clamps when a plant is
  removed; stats and history include hydro and combined SoC.
- `weather.test.ts`: river flow rises under heavy cloud, decays in clear
  weather, stays within 0..1, deterministic.
- Save round trip with and without the optional fields.
- Coverage gate stays at 90 % on `src/sim` and `src/shared`.

### Balance probe

A temporary headless script (per the "balance: resize energy system"
pattern) runs a scripted city with hydro for 30 in-game days to size
`hydroPeakOutput`, pumped storage capacity/power and river flow rates
against the existing PV, wind and battery numbers. Deleted before commit.

### e2e

The existing road drag keeps working (a bridge still costs money). One
new assertion: the energy panel shows the hydro row.

### Out of scope

Waterfront happiness bonus, boats, seasons, terrain elevation, multiple
rivers, water as a new-game option.
