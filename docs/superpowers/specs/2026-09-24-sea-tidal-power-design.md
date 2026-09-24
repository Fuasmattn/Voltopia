# Sea Edge & Tidal Power — Design

Date: 2026-09-24
Status: approved for planning
Backlog entry: "Sea edge & tidal power" in `docs/idea.md`

## Goal

Give every map a coast and add tidal power: a generator whose output is
fully predictable yet never steady. Wind and solar are weather-driven and
unknowable; the tide is known hours in advance but runs on its own clock,
drifting against the solar day. The player gains a source they can plan
around and four daily slack-water gaps they must bridge with storage.

Two secondary effects make the coast more than a power site: wind
turbines may stand offshore, and a sea view raises happiness. The same
tiles are therefore contested by housing, turbines, tidal plants and
power-line routes.

## Scope

In scope:

- A sea band along one map edge, generated on every map.
- `Terrain.Sea` and `PlantType.TidalPlant`.
- Tidal output from a deterministic two-constituent tide model.
- Offshore wind turbines with an output bonus and a cost surcharge.
- Coastal happiness bonus.
- Rendering, UI, agent tools, save compatibility, tests, balancing.

Out of scope (not built now):

- Multi-tile barrages across a bay.
- Harbours, shipping, coastal flooding, storm surge.
- Sea-specific disasters (belongs to the "Disasters/events" backlog item).
- Wave power, offshore substations, per-district grids.

## World generation

### Where the sea goes

The sea claims the map edge the river flows toward, so the river always
ends in an estuary.

`generateWater` already picks the river axis and the flow direction
(`reversed`, derived from the mean elevation of the first and last row)
before it rasterises the channel. A new module `src/sim/sea.ts` exposes
`carveSea(state, axis, reversed)`, called from `generateWater` between
those two steps. The downstream edge follows from `axis.vertical` and
`reversed`.

`sea.ts` uses its own seed salt so map generation stays split into
independent deterministic streams (`terrain.ts`, `water.ts`, `forest.ts`
each already have one).

### Shape

- Depth per column along the edge: `seaDepthRange` = 3..7 tiles, drawn
  from smoothed seeded noise so the coastline undulates instead of
  running straight.
- At the river's exit column the band widens into a bay
  (`estuaryWidening`, ~3 extra tiles, tapering over ~6 columns to each
  side), which creates the enclosed water the site factor rewards.
- Sea tiles get `Terrain.Sea` and `elevation = 0` (sea level).

### Interaction with existing generation

- Order: `generateTerrain` → `carveSea` → river rasterisation and
  carving → lake → bank relaxation. Nothing in the existing passes needs
  reordering.
- The river carve is already monotonically non-increasing downstream and
  reaches 0 at the mouth, so the channel meets the sea without a step.
- Bank relaxation at the end of `generateWater` treats every non-land
  tile the same, so sea cliffs are smoothed by the existing code.
- Size cap: the band is capped at `maxSeaFraction` (0.12) of the map.
  While it is over the cap, the deepest column loses one tile (ties go to
  the lowest lateral index) down to a floor of `minDepth` (2). Bounded —
  each pass removes exactly one tile. (`generateTerrain`'s
  `minBuildableFraction` is not reusable here: it is measured over a
  water-free map, so any sizeable water body would push it under the
  threshold and shrink the band to the floor every time.)

## Tide model

The tide is a pure function of `state.tick` — no stored state, no RNG,
deterministic across saves.

Two constituents, as in reality:

- `lunarPeriodHours = 12.42` (M2)
- `solarPeriodHours = 12.00` (S2)
- `solarWeight = 0.29` (w)

```
raw(t)     = cos(2π t / P_lunar) + w · cos(2π t / P_solar)
level(t)   = raw(t) / (1 + w)                      // -1..1, water level
tideFactor = |sin(2π t / P_lunar) + w · sin(2π t / P_solar)| / (1 + w)
```

Periods are converted to ticks via `TICKS_PER_DAY` (960).

Properties this yields, all of which become tests:

- The current runs a quarter period ahead of the water level: zero at
  high and low water (slack), maximal at mid-tide. Two high waters and
  four generation peaks per day. (Each constituent's current is 90° out
  of phase with its level; the exact derivative would also weight the
  terms by `1/P`, which the two periods differ by 3 % in — deliberately
  ignored, it would only rescale `solarWeight`.)
- Spring and neap tides emerge from the beat between the two periods —
  no separate envelope constant. Springs recur every ~7.4 in-game days;
  at neap the amplitude falls to `(1-w)/(1+w)` ≈ 0.55 of spring.
- The 24.84-hour lunar day pushes the tide ~50 minutes later each day, so
  a given tidal phase returns to the same time of day after ~14.8 days
  and generation peaks land at every hour of the solar day in turn.

`level(t)` is exported for rendering (the sea surface rises and falls
with it) and for the HUD tide indicator.

## Tidal plant

`PlantType.TidalPlant = 14`.

**Placement:** one sea tile that has at least one land 4-neighbour
(the shore). Rejections: `needsSeaTile` on non-sea terrain, `needsCoast`
on open water.

**Site factor** — `tidalSiteFactor(state, index)` in `sea.ts`, following
the pattern of `riverDropAt` and `pumpedHeadAt`:

```
narrowness = landNeighbours8(index) / 8         // straight coast ≈ 3/8, inlet ≈ 6/8
factor     = 1 + currentBonus · narrowness
           + (riverTileWithinRadius2 ? estuaryBonus : 0)
factor     = min(factor, maxSiteFactor)
```

Start values: `currentBonus = 0.6`, `estuaryBonus = 0.35`,
`maxSiteFactor = 2.0`.

**Generation:** `censusPlants` accumulates `tidalCapacity` as the sum of
site factors (parallel to `hydroCapacity`). In `energyStep`:

```
tidal = census.tidalCapacity · BALANCE.energy.tidalPeakOutput · tideFactor(state)
```

It joins solar, wind, rooftop and hydro in the renewable total, before
the storage/market cascade — no change to the balance order.

**Start values:** peak output 110, construction 3 000, upkeep 0.09 per
tick. Mean output is ~50 % of peak (mean of |sin| times the spring-neap
envelope), so a tidal plant delivers steadily but costs more than a
run-of-river plant and goes to zero four times a day.

## Offshore wind

Wind turbines may be placed on sea tiles (no shore requirement).

- The elevation bonus is inert at sea level and forest shelter does not
  apply; instead the census multiplies the turbine by
  `1 + offshoreWindBonus` (start 0.35).
- Construction cost is multiplied by `offshoreCostFactor` (start 1.5).
- Connecting the turbine needs power lines over water, which already
  cost `powerLineWaterPerTile` — distance from shore prices itself.

## Coastal happiness

`seaCoverage(state)` in `sea.ts`, mirroring `forestCoverage`: the share
of buildings with a sea tile within Chebyshev radius `coastRadius` (4).
`happinessStep` adds `seaCoverage · coastBonus` (start 0.05) as its own
summand next to the park and forest bonuses.

## Build rules

`buildRejection` in `state.ts` gains a sea branch:

| Intent                  | On `Terrain.Sea`                                                       |
| ----------------------- | ---------------------------------------------------------------------- |
| Tidal plant             | allowed with a land 4-neighbour, else `needsCoast`                     |
| Wind turbine            | allowed                                                                |
| Power line              | allowed (unchanged; water tariff already applies)                      |
| Road                    | rejected (`cannotBuildOnWater`) — bridges cross the river, not the sea |
| Zone, every other plant | rejected (`cannotBuildOnWater`)                                        |

A tidal plant on non-sea terrain is rejected with `needsSeaTile`.
Bulldoze and undo need no changes: `snapshotTile` already restores
`tileType` and `plantType`.

## Data and save compatibility

- `Terrain.Sea = 3` and `PlantType.TidalPlant = 14` are additive enum
  values. `SAVE_VERSION` stays 1.
- The terrain layer is already serialised (optional field, absent means
  all land), so old saves load unchanged as inland maps with no sea and
  no tidal plants.
- `EnergyStats.generation` gains `tidal: number`.
- `GlobalStats` gains `tide: { level: number; factor: number }` for the
  HUD. Stats are derived per tick and never stored.

## Rendering

- `waterMesh.ts`: a third instance group for sea tiles — flat boxes like
  the lake, but their y offset follows `level(t) · tideAmplitude` so the
  water visibly rises and falls against the shore. New `PALETTE.sea`.
- `minimapLayer.ts`: sea colour.
- `plantsMesh.ts`: a half-submerged housing with a rotor whose spin rate
  tracks output, the way wind turbines already do.
- Every new `InstancedMesh` sets `frustumCulled = false` (project rule).

## UI

- BuildBar tool for the tidal plant, with its cost and placement hint.
- Energy panel: a `tidal` generation row. Budget panel: upkeep row.
- Tide indicator next to the weather display (level and rising/falling).
- Tile inspector on a tidal plant: tide factor, site factor, current
  output; on an offshore turbine: the offshore bonus.
- Help page section on tides and coastal building.
- All strings go through `src/ui/i18n.tsx` in English **and** German.

## Agent tools

- `tidal` in `PLANT_NAMES` with its placement description
  ("a coastal sea tile").
- Tide values exposed in the stats tools.
- `docs/agent-tools.md` table updated.

## Goals

One new staged goal in `goals.ts` introducing the coast (build a tidal
plant), placed after the existing hydro goal.

## Testing

Unit tests (`src/sim/sea.test.ts` plus additions to existing suites):

- Sea generation: the band sits on the river's downstream edge; depth
  within `depthRange`; the river reaches the sea; the size cap holds;
  identical output for identical seeds, different output across seeds.
- Tide: value range; slack water exactly at high and low water; four
  generation peaks per in-game day; spring-neap beat period ~7.4 days
  with neap ≈ 0.55 of spring; pure function of tick.
- Site factor: straight coast vs. inlet vs. estuary; cap respected.
- Build rules: every row of the table above.
- Energy balance: tidal output enters the renewable total and is
  curtailed/stored like the others.
- Coastal happiness and offshore wind bonus.
- Save round-trip with sea tiles and tidal plants; an old save without a
  terrain layer still loads.

Coverage on `src/sim` stays ≥ 90 %. The existing e2e suite is unaffected;
the headless smoke script must still run.

## Balancing

Peak output, costs, offshore bonus and coastal bonus are start values.
After the feature works, a temporary headless probe (scripted city via
`SimEngine`, several seeds, a few in-game weeks) prints the tidal share
of generation, storage cycles per day and money over time; the values
are tuned from that output and the probe is deleted afterwards — the
pattern used in the "balance: resize energy system" and transit commits.

## Balance constants

All new values live in `BALANCE` (`src/shared/constants.ts`); no magic
numbers in sim code.

```
sea: {
  depthRange: [3, 7],
  depthCellSize: 10,
  minDepth: 2,
  estuaryWidening: 3,
  estuaryTaper: 6,
  maxSeaFraction: 0.12,
  coastRadius: 4,
  coastBonus: 0.05,
  tide: {
    lunarPeriodHours: 12.42,
    solarPeriodHours: 12.00,
    solarWeight: 0.29,
  },
  tidal: {
    currentBonus: 0.6,
    estuaryBonus: 0.35,
    estuaryRadius: 2,
    maxSiteFactor: 2.0,
  },
  offshoreWindBonus: 0.35,
  offshoreCostFactor: 1.5,
}
energy.tidalPeakOutput: 110
costs.plant[TidalPlant]: 3000
upkeepPerTick.plant[TidalPlant]: 0.09
```

## Module boundaries

`src/sim/sea.ts` owns everything coastal: `carveSea`, `tideLevel`,
`tideFactor`, `tidalSiteFactor`, `seaCoverage`. `water.ts` keeps the
river and the lake and calls `carveSea` once. `energy.ts` consumes the
tide functions the same way it consumes `riverFlowFactor` today. No
module gains a second responsibility, and `sim/` stays free of DOM and
three.js.
