# Delivery traffic — design

Date: 2026-09-24
Status: approved for planning

## Goal

Give retail a supply chain and put goods vehicles on the roads. A new
logistics depot sends electric delivery vans on tours to the shops.
Vans drive on the same lanes as the commuters, so a jammed city delays
its deliveries; a shop that has not seen a van for a while stops
densifying. The vans charge at the depot, so the depot is another
consumer that the grid has to carry. One new overlay, an inspector
section, a HUD chip and a goal make the mechanic legible.

## Decisions

- The depot is a single-tile plant (`PlantType.LogisticsDepot = 11`) in
  the build bar's "services" category next to the charging hub. It
  follows the fire station's placement rules (land, road access) and
  consumes energy only while vans charge.
- Vans live in their own module `src/sim/deliveries.ts` with their own
  list `state.vans`; they are not `Vehicle`s. Commuter code is not
  touched apart from sharing lane occupancy and the routing helpers.
- `findRoadPath` moves from `vehicles.ts` to a new `src/sim/routing.ts`
  together with a new multi-target distance search. `vehicles.ts`
  re-exports nothing; callers import from `routing.ts`.
- A shop is supplied when a van has actually reached it within the last
  `supplyWindowDays` (1.5 days). Supply state is a derived tile layer
  `deliveryAge` (ticks since the last delivery, saturating), never
  persisted; on load every shop starts fresh (grace of one window).
- Only retail needs deliveries. Unsupplied retail cannot densify (level
  1 → 2 and 2 → 3); spawning at level 1 stays free so a village grows
  without a depot. No happiness or tax effect.
- Vans use the existing lane model (capacity, waiting, gridlock breaker)
  and count in the traffic load, at a lower speed than cars.
- Vans charge at the depot; the smart-charging toggle applies to them
  like to cars. Their charging load is part of `chargingConsumption`.
- Every tuning value lives in `BALANCE.deliveries`, `BALANCE.costs.plant`
  and `BALANCE.upkeepPerTick.plant`.
- Save format unchanged: the plant layer already persists the depot.
  `goalProgress` gains one optional counter like `freeFlowTicks`.

## Section 1: Depot and vans

### Types and balance

```ts
PlantType.LogisticsDepot = 11;

costs.plant[PlantType.LogisticsDepot] = 1_000;
upkeepPerTick.plant[PlantType.LogisticsDepot] = 0.03;

deliveries: {
  /** Vans stationed at one depot. */
  vansPerDepot: 3,
  /** Shops one tour visits at most. */
  stopsPerTour: 5,
  /** Road distance (tiles) from the depot a shop must be within to be served. */
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
}
```

Battery drain per road tile reuses `vehicles.batteryDrainPerTile`. The
smart-charging floor reuses `vehicles.smartChargeFloor`.

### State

```ts
export const VanPhase = { AtDepot: 0, Driving: 1, Unloading: 2 } as const;

export interface Van {
  id: number;                 // shares nextVehicleId with cars (unique across both)
  depot: number;              // depot tile
  depotRoad: number;          // road tile next to the depot the van parks on
  x: number; y: number; angle: number;
  phase: VanPhase;
  /** Remaining stops of the tour (road tiles), last one is depotRoad. */
  stops: number[];
  /** Road tiles from the current position to stops[0]. */
  path: number[];
  pathIndex: number;
  charge: number;             // 0..1
  charging: boolean;
  waitTicks: number;          // lane gridlock breaker, like Vehicle
  dwellTicks: number;         // remaining unload / turnaround ticks
}

SimState.vans: Van[];                       // not persisted
TileLayers.deliveryAge: Uint16Array;        // derived, not persisted
```

`Uint16` holds 65 535 ticks (68 days) which is far beyond the supply
window; the counter saturates there.

### Depot placement

`placePlant` accepts the depot wherever it accepts a fire station: land,
empty tile, road access. Bulldozing a depot removes its vans on the next
tick (vans whose depot tile no longer holds a depot are dropped; a van
mid-tour just vanishes, like commuters when their home is bulldozed).
The depot is a consumer plant: `energy.ts` treats it like the stations
for connection and supply status but its demand is dynamic (charging
vans), reported through the existing `chargingDemand` input instead of a
fixed `stationConsumption`.

## Section 2: Tours (`src/sim/deliveries.ts`)

`deliveriesStep(state, occupancy)` runs right after `vehiclesStep` in
`tick.ts` and before `updateTrafficLoad`, which therefore sees cars and
vans. `vehiclesStep` is changed so the occupancy map it builds is shared:
it seeds the map with the lanes of every driving car and van, moves the
cars, and returns the map; `tick.ts` calls `deliveriesStep(state,
occupancy)` and then `updateTrafficLoad(state, occupancy)`. (Today
`vehiclesStep` calls `updateTrafficLoad` itself; that call moves to
`tick.ts`.) `vehicleLane` is generalised to accept anything with a
position, heading and path (the `Mover` interface below).

### Per tick

1. **Fleet.** For every depot tile (plant layer) make sure
   `vansPerDepot` vans exist, parked on the depot's road-access tile
   (first road neighbour by tile index; a depot without road access
   fields no vans). Drop vans whose depot is gone. New vans start with
   `charge = rng.nextRange(0.5, 0.9)`.
2. **Age.** `deliveryAge[i] = min(65535, deliveryAge[i] + 1)` for
   every retail building tile (zone Retail, `density > 0`); every other
   tile is reset to 0. A tile whose age crosses `supplyWindowTicks` or
   `dueTicks` is marked dirty (drives the overlay).
3. **Charging.** A van `AtDepot` with `charge < 1` charges when the
   depot tile is `SupplyStatus.Supplied` and (smart charging off, or a
   surplus is available as in `vehiclesStep`, or `charge <
smartChargeFloor`). Sets `charging`, adds `chargeRatePerTick`.
4. **Dispatch.** A van `AtDepot` with `dwellTicks === 0`, `charge >=
minTripCharge`, inside the delivery window, starts a tour if
   `planTour` returns at least one stop.
5. **Move.** A `Driving` van advances along `path` with the car
   movement rules (`driveAlongPath` logic: lane capacity, `waitTicks`,
   `maxWaitTicks`, avenue speed factor) at `speedTilesPerSecond ×
speedFactor`, draining `batteryDrainPerTile`. Reaching `stops[0]`:
   if it is `depotRoad`, the van becomes `AtDepot` with `dwellTicks =
turnaroundTicks`; otherwise `Unloading` with `dwellTicks =
unloadTicks`.
6. **Unload.** When `dwellTicks` reaches 0 on an `Unloading` van, every
   retail building tile 4-adjacent to the van's road tile gets
   `deliveryAge = 0` (and is marked dirty if its state changed), the
   stop is shifted off, and the van routes to the next stop with
   `findRoadPath`. If no path exists (road bulldozed), the stop is
   skipped; if the depot is unreachable the van is dropped.

To keep the movement code shared, the car-moving function in
`vehicles.ts` is generalised to take the moving object's position
fields, path and wait counter (`Vehicle` and `Van` both satisfy a small
`Mover` interface) plus a speed factor. Cars pass 1, vans
`speedFactor`.

### `planTour(state, van, claimed): number[]`

- `distances = roadDistances(state, van.depotRoad, maxRouteTiles)`
  (Dijkstra with the same tile cost as `findRoadPath`, stops expanding
  past `maxRouteTiles`; returns `Map<tile, cost>`).
- Candidate stops: road tiles adjacent to at least one retail building
  tile, reachable per `distances`, not in `claimed` (the union of the
  stops of every other van of any depot, rebuilt each tick). Each
  candidate's `age` is the maximum `deliveryAge` of its adjacent shops.
- Sort candidates by `age` descending, then distance ascending, then
  tile index; take the first `stopsPerTour`.
- Order the chosen stops nearest-neighbour from `depotRoad` using
  `findRoadPath` lengths (deterministic tie-break by tile index), append
  `depotRoad`.
- Only candidates with `age >= dueTicks / 2` are considered, so a shop
  is visited about twice per supply window at most and an idle fleet
  does not circle. Returns `[]` when nothing qualifies.

### `roadDistances(state, from, maxCost)` (`src/sim/routing.ts`)

Bounded Dijkstra over road tiles from one source, sharing `tileCost`
with `findRoadPath`. Tested on its own.

## Section 3: Supply, growth and energy

### Supplied

```ts
export function deliveryState(state, index): 'supplied' | 'due' | 'unsupplied';
```

`supplied` while `deliveryAge <= supplyWindowTicks`; `due` once past
`dueTicks` but still within the window; `unsupplied` beyond. Non-retail
tiles are always `supplied`.

### Growth

`growth.ts`: a retail building at density 1 or 2 densifies only when
`deliveryAge <= supplyWindowTicks`. `inspect.ts` adds the blocker
`'noDeliveries'` in the same branch that reports `tooYoung` and
`noFireCoverage`. New buildings start at age 0 (the layer is reset for
non-buildings, so a fresh spawn is at 0 automatically).

### Energy

`chargingDemand(state)` (moved to `deliveries.ts` or a shared helper)
returns cars × `chargingEnergyPerVehicle` + charging vans ×
`chargingEnergyPerVan`. `EnergyStats.chargingConsumption` therefore
includes the vans; no new stat field. The depot shows up as a consumer
in the energy panel's charging row, not as its own row.

## Section 4: Visibility

### Stats

```ts
GlobalStats.deliveries: {
  /** Retail buildings currently supplied / all retail buildings (0..1; 1 when there are none). */
  suppliedShare: number;
  /** Retail buildings. */
  shops: number;
  /** Vans on the road. */
  driving: number;
  /** Depots. */
  depots: number;
};
TileCounts.depots: number;
```

### Vehicles on screen

`VehicleState` gains `kind: VehicleKind` (`Car = 0`, `Van = 1`).
`collectVehicles` appends the vans. `vehiclesMesh.ts` keeps a second
`InstancedMesh` for vans (`frustumCulled = false`): a taller box body,
light grey, same headlights at night, same interpolation.

### HUD

`CityVitals` chip `data-testid="deliveries"`: 🚚 plus the supplied share
as a percentage, shown once `shops > 0`. Tooltip: "x of y shops
supplied, n vans on the road". `negative` tone when the share drops
below `goalSuppliedShare`.

### Overlay

`OverlayMode.Deliveries = 5`, toggle button `overlay-deliveries`. Retail
building tiles green (supplied), orange (due), red (unsupplied); depot
tiles blue; every other tile untouched. `TileDiff.deliveryState: number`
(0 supplied, 1 due, 2 unsupplied) so the overlay updates without full
redraws.

### Inspector

- Retail building: section "Deliveries" with the state and "last
  delivery x.x days ago" (from `deliveryAge`), or "never" when the age
  is saturated. `TileInfo.deliveryAgeTicks: number`.
- Depot: vans at depot / driving / charging, shops within reach (count
  from `roadDistances`), plus the usual plant rows. `TileInfo.depot?:
{ vansTotal; vansDriving; vansCharging; shopsInReach }`.

### Goal

`'wellStocked'`: `shops >= goalMinShops` and `suppliedShare >=
goalSuppliedShare` for every tick of a whole day. Progress counter
`goalProgress.wellStockedTicks`, persisted as optional
`wellStockedTicks` like `freeFlowTicks`. The goal joins the win
condition like all others.

### Strings and help

New i18n keys (English and German): tool label and description for the
depot, overlay label, chip label and tooltip, inspector section, the
blocker `inspect.blocker.noDeliveries`, goal title and description,
and one help-page paragraph under the traffic section. `docs/idea.md`
lists deliveries under the delivered features, the README gets one
line.

### WebMCP tools

`CLAUDE.md` asks for feature parity in `src/agent/tools.ts` and
`docs/agent-tools.md`: `place_plant` accepts `logistics_depot`;
`get_stats` returns the `deliveries` block; `inspect_tile` returns
`deliveryAgeDays` on retail buildings and the `depot` figures on a
depot; the `noDeliveries` blocker appears in `growthBlockers`. The
tool description and the table in `docs/agent-tools.md` name the new
plant and fields. (The stations and traffic figures are missing from
the tools today; closing that gap is separate work.)

## Section 5: Save, tests, balance

### Save

Nothing new in `layers`. `wellStockedTicks?: number` in `SaveGame`,
passed through like `freeFlowTicks`. `deliveryAge` and `vans` are
rebuilt: after a load every shop is at age 0 and the fleets respawn at
their depots on the first tick. Undo of a depot placement refunds as
for any plant.

### Unit tests

- `routing.test.ts` (new): `findRoadPath` keeps its existing tests
  (moved); `roadDistances` returns costs matching path lengths on a
  street grid, omits tiles beyond `maxCost`, and is deterministic.
- `deliveries.test.ts` (new): a depot fields `vansPerDepot` vans on its
  road tile; a depot without road access fields none; bulldozing drops
  the vans; `planTour` picks the oldest shops first, caps at
  `stopsPerTour`, never picks a stop claimed by another van, ends at the
  depot, ignores shops beyond `maxRouteTiles`; a van that reaches a
  stop resets the adjacent shops' `deliveryAge` after `unloadTicks`; no
  tour starts outside the window or below `minTripCharge`; a van drains
  charge per tile and charges only on a supplied depot; smart charging
  holds off without surplus above the floor; two runs with the same
  seed produce identical van positions after a day; vans appear in the
  lane occupancy map.
- `growth.test.ts`: a retail building with `deliveryAge` past the
  window does not densify; one inside the window does.
- `inspect.test.ts`: `noDeliveries` blocker; depot info; retail
  delivery age.
- `energy.test.ts` / `vehicles.test.ts`: `chargingDemand` includes
  charging vans.
- `goals.test.ts`: `wellStocked` needs the shop count and a full day at
  the share; one bad tick resets the streak.
- `engine.test.ts`: `stats.deliveries` present; van states carry
  `kind = Van`; diffs carry `deliveryState`.
- `serialization.test.ts`: `wellStockedTicks` round-trips; old saves
  load with 0.

### End-to-end

Depot tool button visible (`tool-logisticsDepot`); `overlay-deliveries`
toggles; the deliveries chip appears once a shop exists.

### Balance probe

Temporary headless probe on the traffic probe's town (48×48, 60 homes,
30 workplaces of which 15 retail, one main road) with one depot at the
road's end, two years. Print per day: supplied share, due share, mean
delivery age, vans driving at noon, depot charging energy per day, and
the morning congestion ratio. Targets: with one depot within
`maxRouteTiles` of every shop the supplied share sits above 0.95 from
the second day on; doubling the shops without a second depot pushes the
share below the goal (so a second depot is a real decision); van
charging is a visible but small slice of the charging load (below a
quarter of the car charging); the congestion ratio moves by less than
0.05 from the vans alone. Delete the probe afterwards.
