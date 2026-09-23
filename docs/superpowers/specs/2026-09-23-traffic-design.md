# Traffic — design

Date: 2026-09-23
Status: approved for planning

## Goal

Make traffic legible and give the player a lever against it. The
simulation already has commuting vehicles with real pathfinding, lanes
with a capacity, queues and a smoothed congestion ratio that lowers
happiness; none of it is visible in the game and there is nothing to
build against it. This feature adds a per-tile traffic load, a traffic
overlay, a HUD read-out, congestion-aware route choice, a second road
class ("avenue") with more capacity and speed, a "free flow" goal, and
corrects the docs that still describe a random walk.

## Decisions

- Avenues are a road class, not a tile type: a new tile layer
  `roadClass` (0 = street, 1 = avenue) that only means something on
  `TileType.Road` tiles. Every existing `=== TileType.Road` check
  (pathfinding, road access, lines, bridges, minimap) keeps working.
- Drawing an avenue over a street upgrades it for the price difference;
  drawing over empty land builds it at the full avenue price. Bridges
  can be avenues too (avenue bridge price).
- Traffic load is a derived per-tile layer (`trafficLoad`, 0..255): an
  exponential moving average of lane occupancy over capacity. It drives
  the overlay, the inspector and route choice. Never persisted.
- Route choice becomes a deterministic Dijkstra over road tiles with a
  tile cost that is lower on avenues and higher on loaded tiles.
- Vehicles on an avenue tile move faster; an avenue lane holds more
  cars. Both from `BALANCE.vehicles`.
- The HUD shows a traffic chip in the city vitals; a "free flow" goal
  rewards a whole day of smooth commuting in a real city.
- Save: `roadClass` is an optional layer field (absent → all streets).
  No `SAVE_VERSION` bump.

## Section 1: Avenues

### Types and balance

```ts
export const RoadClass = { Street: 0, Avenue: 1 } as const;
export type RoadClass = (typeof RoadClass)[keyof typeof RoadClass];

costs: {
  roadPerTile: 10,          // unchanged
  bridgePerTile: 40,        // unchanged
  avenuePerTile: 30,
  avenueBridgePerTile: 90,
}
upkeepPerTick: {
  roadPerTile: 0.005,       // unchanged
  avenuePerTile: 0.012,
}
vehicles: {
  maxPerRoadTile: 2,        // unchanged: per lane on a street
  avenueMaxPerTile: 4,      // per lane on an avenue
  avenueSpeedFactor: 1.5,   // avenue tiles are driven this much faster
  /** Route cost: multiplier applied per tile at full traffic load. */
  routeLoadPenalty: 2,
  /** Traffic load smoothing per tick (EMA weight of the current tick). */
  trafficLoadSmoothing: 0.05,
}
traffic: {
  /** Congestion factor (commute time over free flow) up to which traffic counts as flowing. */
  flowing: 1.15,
  /** Above this factor the HUD calls it a jam. */
  jammed: 1.5,
  /** Population the free-flow goal requires. */
  goalMinPopulation: 300,
}
```

The existing happiness threshold (`happiness.commuteCongestionThreshold`
1.25) sits between `flowing` and `jammed`, so "slow" is where
happiness starts to suffer.

### State and commands

`TileLayers.roadClass: Uint8Array` (persisted). `SaveGame.layers.roadClass?:
ArrayBuffer`, read with a zero-filled default like `powerLine`. Undo
snapshots include `roadClass` (`snapshotTile`, `undoLastAction`).
`TileDiff.roadClass: number`.

`SimCommand` `buildRoad` gains `avenue?: boolean`. `buildRoads(state,
tiles, avenue = false)`:

- Buildable tiles: empty land/river as today, plus existing street tiles
  when `avenue` is true (upgrade). Existing avenue tiles are skipped.
- Cost per tile: new avenue `avenuePerTile` (river: `avenueBridgePerTile`);
  upgrade `avenuePerTile − roadPerTile` (river: `avenueBridgePerTile −
bridgePerTile`); street as today.
- Sets `roadClass` (0 for streets, 1 for avenues), keeps the road mask
  logic unchanged (an avenue connects to a street like any road).
- Bulldozing a road tile clears `roadClass` to 0.

`economyStep` counts avenue tiles separately for upkeep
(`avenuePerTile`), and `EconomyBreakdown` gains `avenueTiles` so the
budget panel can show the split (one extra row "Avenues").

### Tool and rendering

Tool id `avenue`, hotkey `v`, icon 🛣, in the "basics" category after the
road, drag like the road with an L-shaped preview. The drag cost preview
mirrors the sim's pricing (upgrade vs. new, bridge vs. land).

`roadsMesh.ts`: avenue tiles get a wider pad (`AVENUE_CENTER_SIZE`,
`AVENUE_ARM_WIDTH`) and a thin light centre line per arm; bridges keep
their deck. Minimap: avenue colour lighter than street.

## Section 2: Traffic load and routing (`src/sim/traffic.ts`)

```ts
/** 0..255 per road tile: EMA of lane occupancy over lane capacity. Derived. */
TileLayers.trafficLoad: Uint8Array;

export function laneCapacity(state: SimState, tile: number): number; // 2 or 4
export function updateTrafficLoad(state: SimState, occupancy: Map<number, number>): void;
export function trafficLevel(load: number): number; // 0..7 quantised for diffs/overlay
```

`vehiclesStep` already builds a lane occupancy map at the start of the
tick; after moving every vehicle it calls `updateTrafficLoad` with the
final map. Per road tile: `occupied = max over its four lanes of
occupancy / laneCapacity` (0..1, clamped); `load = load + (occupied × 255
− load) × trafficLoadSmoothing`, stored rounded. If `trafficLevel`
changed, `markDirty`. Non-road tiles stay 0. Deterministic, no
randomness.

`TileDiff.trafficLoad: number` (the raw 0..255 value).

### Routing

`findRoadPath(state, from, to)` becomes a Dijkstra with a binary heap
(new tiny helper in `src/shared/heap.ts`, tested). Tile cost when
entering tile `t`:

```
base = roadClass[t] === Avenue ? 1 / avenueSpeedFactor : 1
cost = base × (1 + routeLoadPenalty × trafficLoad[t] / 255)
```

Ties broken by tile index so results are deterministic. Existing
callers and tests keep the signature; on an unloaded street-only map the
result is a shortest path as before (tests assert path length, not the
exact tiles, where several shortest paths exist).

### Speed and capacity

`driveAlongPath` uses `step × avenueSpeedFactor` while the vehicle's
current tile is an avenue, and `laneCapacity(nextTile)` instead of the
constant `maxPerRoadTile` for the lane check. `tripFreeFlowTicks`
accounts for avenue tiles on the path so the congestion ratio stays
honest (a fast avenue trip is not "congested" just because it is short).

## Section 3: Visibility

### Stats

```ts
GlobalStats.traffic: {
  /** Mean commute time over free flow, smoothed (1 = free flow). */
  congestion: number;
  /** Vehicles currently driving. */
  driving: number;
  /** Road tiles that are avenues / all road tiles (0..1). */
  avenueShare: number;
};
```

`state.commuteCongestion` already exists; `driving` and `avenueShare`
are counted in `buildStats`. `TileCounts` gains `avenueTiles`.

### HUD

`CityVitals` gets a chip `data-testid="traffic"`: 🚗 plus the
congestion factor ("1.3×") with a tooltip label: below
`BALANCE.traffic.flowing` (1.15) "flowing", below `jammed` (1.5) "slow",
else "jammed"; the chip takes the `negative` tone when jammed.

### Overlay

`OverlayMode.Traffic = 4`, toggle button `overlay-traffic`. Road tiles
are tinted by `trafficLevel`: green (0–1), yellow (2–4), orange (5–6),
red (7). Non-road tiles untouched.

### Inspector

Road tiles show a "Traffic" section: class (Street / Avenue), load in %
(`trafficLoad / 255`), lane capacity, and the upkeep row already shown.
`TileInfo` gains `roadClass: RoadClass`, `trafficLoad: number`,
`laneCapacity: number`.

### Goal

`'freeFlow'`: population ≥ `BALANCE.traffic.goalMinPopulation` (300) and
`commuteCongestion ≤ flowing` for every tick of a whole day. Progress
counter `freeFlowTicks` persisted like `winterTicks`.

### Strings (English / German)

- `tool.avenue`: Avenue / Allee; `tool.avenue.desc`: Twice the lane
  capacity and faster driving. Drag over a street to upgrade it. /
  Doppelte Spurkapazität und schnellere Fahrt. Über eine Straße ziehen,
  um sie auszubauen.
- `overlay.traffic`: Traffic / Verkehr; `overlay.traffic.title`: Traffic
  load per road tile: green = free, red = jammed / Verkehrslast pro
  Straßenkachel: grün = frei, rot = Stau
- `vitals.traffic`: Traffic / Verkehr; `traffic.flowing`: flowing /
  fließend; `traffic.slow`: slow / zäh; `traffic.jammed`: jammed / Stau
- `inspect.section.traffic`: Traffic / Verkehr; `inspect.roadClass`:
  Road / Straßenart; `inspect.street`: Street / Straße;
  `inspect.avenue`: Avenue / Allee; `inspect.trafficLoad`: Load /
  Auslastung; `inspect.laneCapacity`: Cars per lane / Autos pro Spur
- `budget.avenues`: Avenues / Alleen
- `goal.freeFlow.title`: Free flow / Freie Fahrt; `goal.freeFlow.body`:
  A whole day of commutes under 1.15× free flow (300+ residents). / Ein
  ganzer Tag mit Pendelzeiten unter dem 1,15-fachen der freien Fahrt (ab
  300 Einwohnern).
- `help.traffic.title`: Traffic / Verkehr; `help.traffic.body`: Every
  car commutes: home to work in the morning, back in the evening, along
  the fastest route it can find. A lane holds two cars; queues form
  behind full tiles and long commutes cost happiness. Avenues carry four
  cars per lane at higher speed and can be drawn over existing streets.
  The traffic overlay shows where it jams. / Jedes Auto pendelt: morgens
  zur Arbeit, abends zurück, auf der schnellsten Route, die es findet.
  Eine Spur fasst zwei Autos; hinter vollen Kacheln bilden sich Staus,
  und lange Pendelzeiten kosten Zufriedenheit. Alleen fassen vier Autos
  pro Spur bei höherem Tempo und lassen sich über bestehende Straßen
  ziehen. Das Verkehrs-Overlay zeigt, wo es stockt.
- The `help.ev.body` sentence about vehicles stays; `docs/idea.md`'s
  E-mobility bullets replace "random walk" with the commuting model,
  lanes, avenues and the overlay; the README feature list mentions
  avenues, the traffic overlay and the goal.

## Section 4: Save, tests, balance

### Save

`layers.roadClass` written by `serializeState`, read by
`deserializeState` when present, otherwise left zero (all streets).
`saveToJson` / `saveFromJson` pass it through like `powerLine`.
`trafficLoad` is never saved. `freeFlowTicks?: number` like
`winterTicks`.

### Unit tests

- `roads.test.ts`: avenue on empty land costs `avenuePerTile`; upgrade
  of a street costs the difference and keeps the road mask; an avenue
  tile is skipped by a second avenue drag; an avenue bridge costs
  `avenueBridgePerTile`; bulldoze clears `roadClass`; undo restores a
  street after an upgrade and refunds the difference.
- `state.test.ts`, `serialization.test.ts`: `roadClass` round-trips;
  a save without it loads as all streets; `freeFlowTicks` round-trips.
- `traffic.test.ts` (new): load rises toward 255 on a saturated lane
  and decays when empty; `trafficLevel` quantises 0..255 into 0..7;
  a tile is marked dirty only when its level changes; non-road tiles
  stay 0; `laneCapacity` is 2 on streets, 4 on avenues.
- `heap.test.ts` (new, `src/shared`): pops in ascending order, stable
  for equal keys.
- `vehicles.test.ts`: on an unloaded street map the path length equals
  the BFS length; a loaded parallel street is avoided in favour of an
  empty one of equal length; an avenue detour of one extra tile wins
  over a street; an avenue lane admits 4 cars; a vehicle crosses an
  avenue tile in fewer ticks than a street tile; `tripFreeFlowTicks`
  accounts for avenue speed.
- `economy.test.ts`: avenue upkeep counted separately.
- `goals.test.ts`: `freeFlow` needs population and a full day under the
  threshold; a slow tick resets the streak.
- `engine.test.ts`: `stats.traffic` present; diffs carry `roadClass` and
  `trafficLoad`.
- `inspect.test.ts`: road tile reports class, load, lane capacity.

### End-to-end

Avenue tool button visible (`tool-avenue`); `overlay-traffic` button
toggles; the traffic chip is visible in the vitals.

### Balance probe

Temporary headless probe: the commuter town of the cooling probe (60
homes, 30 workplaces on one 30-tile road, 48×48, two years) in two
variants: all streets, and the main road as an avenue. Print per day:
peak driving count, congestion ratio at the morning peak and smoothed,
share of road tiles at level ≥ 5, happiness. Targets: with streets the
morning peak ratio is clearly above `flowing` (about 1.3–1.6) and the
smoothed ratio drifts above the happiness threshold (1.25) in the
second year; with the avenue the smoothed ratio stays below `flowing`;
the avenue's total upkeep over two years is well below the happiness
and tax it protects. Tune `avenueMaxPerTile`, `avenueSpeedFactor`,
`routeLoadPenalty`, `trafficLoadSmoothing`, `costs.avenue*` and
`traffic.flowing/jammed` only. Delete the probe; numbers in the commit
message.

### Out of scope

Delivery traffic, public transit, traffic lights or intersections
priority, one-way streets, per-vehicle re-routing mid-trip, parking.
