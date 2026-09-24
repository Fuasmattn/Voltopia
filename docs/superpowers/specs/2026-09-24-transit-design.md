# Public transit — design

Date: 2026-09-24
Status: approved for planning

## Goal

Give the player a lever against traffic that is not "more asphalt". A
bus depot sends electric buses on tours over bus stops the player marks
on road tiles. A commuter whose home and workplace both lie near a
served stop leaves the car at home: fewer cars on the lanes, less
congestion, a smaller evening charging peak. Buses drive on the same
lanes as everybody else and charge at the depot, so transit is one more
load the grid has to carry. One overlay, a HUD chip, inspector sections
and a goal make the mechanic legible.

## Decisions

- No line editor. Stops are placed, tours are planned automatically
  from the depot to the stops that have waited longest (the delivery
  model). Fits "minimal micromanagement" and reuses the tour code.
- A stop is a flag on a road tile (`busStop` layer), not a building. It
  takes no land, the bus halts on the tile, bulldozing removes the stop
  first and the road only on a second pass (the power-line rule).
- The depot is a single-tile plant (`PlantType.BusDepot = 12`) in the
  "services" build category next to the logistics depot, placed like
  the fire station (land, road access). It consumes energy only while
  buses charge.
- Buses live in `src/sim/transit.ts` with their own list `state.buses`;
  they are not `Vehicle`s or `Van`s. They share the movement core, lane
  occupancy and traffic load with cars and vans.
- A stop is served when a bus actually halted there within
  `serviceWindowDays`. Service is a derived tile layer `stopAge`, never
  persisted; on load every stop starts fresh.
- Riders are commuters (`Vehicle`) that stay parked: each morning a
  commuter whose `homeRoad` and `workRoad` are both covered by a served
  stop skips the day's trips. Riders are not rendered, not measured in
  the commute statistic and drain no battery.
- Riders have no capacity limit per bus or stop; the fleet's reach
  bounds the system. More stops than the buses can serve in a day push
  the oldest ones out of service, which the overlay shows.
- Every tuning value lives in `BALANCE.transit`, `BALANCE.costs` and
  `BALANCE.upkeepPerTick`.
- Save: `busStop` is an optional layer field (absent → no stops), the
  goal progress gains one optional counter. No `SAVE_VERSION` bump.

## Section 1: Depot, stops and buses

### Types and balance

```ts
PlantType.BusDepot = 12;
VehicleKind.Bus = 2;

costs.plant[PlantType.BusDepot] = 1_200;
costs.busStop = 60;
upkeepPerTick.plant[PlantType.BusDepot] = 0.03;
upkeepPerTick.busStop = 0.004;

transit: {
  /** Buses stationed at one depot. */
  busesPerDepot: 3,
  /** Stops one tour visits at most. */
  stopsPerTour: 6,
  /** Road distance (tiles) from the depot a stop must be within to be served. */
  maxRouteTiles: 60,
  /** Hours of the in-game day in which tours may start. */
  windowStartHour: 5,
  windowEndHour: 23,
  /** Ticks a bus spends at the depot between tours. */
  turnaroundTicks: 12,
  /** Ticks a bus halts at a stop. */
  dwellTicks: 6,
  /** Buses drive this fraction of the car speed (streets and avenues alike). */
  speedFactor: 0.8,
  /** A bus needs at least this state of charge to start a tour. */
  minTripCharge: 0.3,
  /** Energy drawn per tick by one charging bus. */
  chargingEnergyPerBus: 4,
  /** State of charge gained per tick while charging (0..1). */
  chargeRatePerTick: 0.0012,
  /** A stop counts as served for this long after a bus halted there. */
  serviceWindowDays: 0.5,
  /** The overlay and inspector call a stop "due" after this long. */
  dueAfterDays: 0.35,
  /** Road tiles within this Chebyshev radius of a served stop are covered. */
  stopRadius: 4,
  /** Share of commuters that must ride for the modal-shift goal. */
  goalRiderShare: 0.3,
  /** Population the modal-shift goal requires. */
  goalMinPopulation: 300,
}
```

Battery drain per road tile reuses `vehicles.batteryDrainPerTile`. The
smart-charging floor reuses `vehicles.smartChargeFloor`.

### State

```ts
export const BusPhase = { AtDepot: 0, Driving: 1, Boarding: 2 } as const;

export interface Bus {
  id: number;                 // from nextVehicleId (unique across cars, vans, buses)
  depot: number;              // depot tile
  depotRoad: number;          // road tile next to the depot the bus parks on
  x: number; y: number; angle: number;
  phase: BusPhase;
  /** Remaining stops of the tour (road tiles), last one is depotRoad. */
  stops: number[];
  /** Road tiles from the current position to stops[0]. */
  path: number[];
  pathIndex: number;
  charge: number;             // 0..1
  charging: boolean;
  waitTicks: number;          // lane gridlock breaker, like Vehicle
  dwellTicks: number;         // remaining boarding / turnaround ticks
}

SimState.buses: Bus[];                    // not persisted
TileLayers.busStop: Uint8Array;           // 0/1 on road tiles, persisted
TileLayers.stopAge: Uint16Array;          // ticks since the last halt, derived
TileLayers.transitCover: Uint8Array;      // 0/1 on road tiles, derived
```

`Bus` has the same shape as `Van` apart from the phase name; both
satisfy the `Mover` interface of `vehicles.ts`. `stopAge` saturates at
65 535 like `deliveryAge`.

### Building stops (`src/sim/transit.ts`, roads glue in `roads.ts`)

`SimCommand` gains `{ type: 'buildBusStop'; tiles: number[] }`.
`buildBusStops(state, tiles)`:

- Buildable: `TileType.Road` tiles (street or avenue, bridges included)
  without a stop. Others are skipped; nothing buildable → `{}`.
- Cost `costs.busStop` per stop; the usual "not enough money" rejection.
- Sets `busStop[index] = 1`, `stopAge[index] = 0` (a fresh stop starts
  served so the player sees coverage immediately), marks dirty, pushes
  an undo entry.
- `bulldozeTiles`: a road tile with a stop loses only the stop, like a
  power line, and survives for a second pass. Clearing a road tile also
  clears `busStop`.
- `snapshotTile` / `undoLastAction` include `busStop`.
- `economyStep` counts stops for upkeep; `EconomyBreakdown` gains
  `busStops` (one budget row "Bus stops").

### Depot and fleet

`depotTiles`, `depotRoadTile` and `syncFleet` follow `deliveries.ts`
with `PlantType.BusDepot` and `busesPerDepot`; a depot without a road
neighbour keeps no buses. Bulldozed depot → its buses disappear next
tick.

### Tours

`planTour(state, bus, claimed)` like the van version: candidate stops
are `busStop` tiles within `maxRouteTiles` road distance from
`depotRoad` (`roadDistances`), not claimed by another bus's remaining
stops, sorted by `stopAge` descending, ties by index. Take up to
`stopsPerTour`, order them nearest-first greedily from the depot, append
`depotRoad`. No candidates → no tour.

`transitStep(state, occupancy)` per bus:

- `AtDepot`: tick `dwellTicks` down; when 0, inside the window and
  `charge ≥ minTripCharge` and the depot is powered, plan a tour; if it
  has stops, route to the first (`findRoadPath`), set `Driving`. Charge
  while parked (see below).
- `Driving`: `advanceAlongPath` with `speedFactor`; on arrival at a
  stop set `stopAge = 0`, `dwellTicks = dwellTicks`, phase `Boarding`;
  on arrival at `depotRoad` phase `AtDepot`, `dwellTicks =
turnaroundTicks`. `lost` (road removed) → teleport to the depot road,
  `AtDepot`.
- `Boarding`: count down, then route to the next stop.

Charging: a bus at the depot charges when the depot is energised
(`depotPowered` as for vans) and either smart charging is off, surplus
is available, or `charge < smartChargeFloor`. Charging buses draw
`chargingEnergyPerBus` per tick, added to `chargingConsumption` next to
the van load.

`ageStops(state)` increments `stopAge` on every stop tile (saturating)
and marks a tile dirty when its `StopState` changes:

```ts
export const StopState = { Served: 0, Due: 1, Unserved: 2 } as const;
```

Served below `dueAfterDays`, due below `serviceWindowDays`, unserved
beyond.

### Coverage

`updateCoverage(state)` clears `transitCover`, then for every served
stop (`stopAge < serviceWindowTicks`) sets `transitCover = 1` on road
tiles within Chebyshev `stopRadius`. Tiles whose value changes are
marked dirty. Runs every tick after `ageStops`; cost is stops × 81
tiles, negligible.

## Section 2: Riders

`Vehicle.rider: boolean` (not persisted, vehicles are not either).

In `vehiclesStep`, `ParkedHome` branch, at the moment the commuter would
depart: if `transitCover[homeRoad] && transitCover[workRoad]` (and
`workRoad ≥ 0`), set `rider = true` and stay parked; otherwise `rider =
false` and depart as today. A rider stays `ParkedHome` all day and is
re-evaluated the next morning, so lost coverage puts the car back on the
road within a day. Riders never enter `ToWork`, so `recordCommute` and
the traffic load never see them; they only charge at home when their
battery is below full, which after a few days is never, so the
charging peak drops with the rider share.

`drivingVehicles` is unchanged (riders are parked). New helpers:

```ts
export function riderCount(state: SimState): number;
export function transitStats(state: SimState): TransitStats;
```

```ts
export interface TransitStats {
  /** Riders over commuters with a workplace, 0..1 (0 when there are none). */
  riderShare: number;
  riders: number;
  /** Buses on the road. */
  driving: number;
  stops: number;
  stopsServed: number;
  depots: number;
}
GlobalStats.transit: TransitStats;
```

`riderShare` uses the vehicles that have a `workRoad`; a village without
jobs reports 0.

### Goal

`GOAL_IDS` gains `'modalShift'`: population ≥ `goalMinPopulation` and
`riderShare ≥ goalRiderShare` for `TICKS_PER_DAY` consecutive ticks
(`goalProgress.transitTicks`, reset on any failing tick, saved like
`freeFlowTicks`).

### Tick order

In `tick.ts`: `vehiclesStep` (uses yesterday's coverage for the
morning decision, which is fine) → `deliveriesStep` → `transitStep`
(buses drive on the same occupancy map) → `ageStops` →
`updateCoverage`. Charging loads of all three fleets feed the energy
balance as today.

## Section 3: Rendering, UI, agent, docs

### Diffs and vehicles

`TileDiff` gains `busStop: number` (0/1), `stopState: number` (0 when
no stop), `transitCover: number` (0/1). The tick event's vehicle list
includes buses with `kind: VehicleKind.Bus`.

### Rendering

- `roadsMesh.ts`: a stop shelter instance per stop tile (small box with
  a flat roof at the tile's edge, `frustumCulled = false`), with a warm
  light point at night like streetlamps. Removed when `busStop` goes 0.
- `vehiclesMesh.ts`: buses are a longer, taller box than vans (own
  colour), same interpolation.
- `overlays.ts`: overlay id `transit`: covered road tiles green, stop
  tiles by state (served green, due amber, unserved red), other tiles
  dimmed.
- `minimapLayer.ts`: stop tiles as light dots.

### UI

- Tool `bus-stop`, hotkey `t`, icon 🚏, "basics" category after the
  power line; click or drag along a road like the power line, cost
  preview counts road tiles without a stop. Depot tool `plant-busdepot`,
  hotkey `k`, icon 🚌, "services" category after the logistics depot.
- `OverlayToggle`: `transit` (`overlay-transit`).
- `CityVitals`: chip "transit" showing `riderShare` as a percentage,
  tooltip `{riders} riders · {buses} buses on the road · {served} of
{stops} stops served`. Hidden while there are no stops.
- `TileInspector`: section "Transit" on road tiles (stop yes/no, stop
  state, ticks since last bus as hours, covered yes/no) and on the depot
  (`BusDepotInfo`: buses total / driving / charging, stops in reach).
  `TileInfo` gains `busStop`, `stopState`, `stopAgeTicks`,
  `transitCovered`, `busDepot: BusDepotInfo | null`.
- `BudgetPanel`: row "Bus stops".
- `GoalsPanel`: `modalShift`.
- `HelpPage`: section "Transit".

### Strings (EN / DE)

- `tool.bus-stop`: Bus stop / Haltestelle; `tool.bus-stop.desc`: Mark a
  stop on a road. Commuters near a served stop at home and at work leave
  the car at home. / Haltestelle auf einer Straße. Pendler mit bedienter
  Haltestelle nahe Wohnung und Arbeit lassen das Auto stehen.
- `tool.plant-busdepot`: Bus depot / Busdepot; `tool.plant-busdepot.desc`:
  Sends three electric buses on tours over your stops. Needs a road and
  power to charge. / Schickt drei Elektrobusse über deine Haltestellen.
  Braucht Straße und Strom zum Laden.
- `overlay.transit`: Transit / ÖPNV; `overlay.transit.title`: Bus
  coverage: green = covered, stops by service state / Busabdeckung: grün
  = abgedeckt, Haltestellen nach Bedienung
- `hud.transit`: transit / ÖPNV; `hud.transit.title`: `{riders} riders ·
{buses} buses on the road · {served} of {stops} stops served` / `{riders}
Fahrgäste · {buses} Busse unterwegs · {served} von {stops} Haltestellen
bedient`
- `inspect.section.transit`: Transit / ÖPNV; `inspect.busStop`: Bus stop
  / Haltestelle; `inspect.stopState`: Service / Bedienung;
  `inspect.stop.served`: served / bedient; `inspect.stop.due`: due /
  fällig; `inspect.stop.unserved`: unserved / unbedient;
  `inspect.lastBus`: Last bus / Letzter Bus; `inspect.transitCovered`:
  Covered / Abgedeckt; `inspect.buses`: Buses / Busse;
  `inspect.stopsInReach`: Stops in reach / Haltestellen in Reichweite
- `budget.busStops`: Bus stops / Haltestellen
- `goal.modalShift.title`: Modal shift / Verkehrswende;
  `goal.modalShift.body`: A whole day with 30% of commuters on the bus
  (300+ residents). / Einen ganzen Tag lang 30 % der Pendler im Bus (ab
  300 Einwohnern).
- `help.transit.title`: Transit / ÖPNV; `help.transit.body`: Mark bus
  stops on your roads and build a bus depot. Three electric buses tour
  the stops that have waited longest; a stop a bus visited in the last
  half day counts as served and covers the roads around it. A commuter
  with a served stop near home and near work leaves the car at home,
  which eases traffic and the evening charging peak. Too many stops for
  one depot leave some unserved. / Setze Haltestellen auf deine Straßen
  und baue ein Busdepot. Drei Elektrobusse fahren die Haltestellen ab,
  die am längsten warten; eine Haltestelle mit Bus im letzten halben Tag
  gilt als bedient und deckt die Straßen ringsum ab. Pendler mit
  bedienter Haltestelle nahe Wohnung und Arbeit lassen das Auto stehen,
  was Verkehr und abendliche Ladespitze entlastet. Zu viele Haltestellen
  für ein Depot bleiben teils unbedient.

### Agent tools (`src/agent/tools.ts`, `docs/agent-tools.md`)

- `place_plant` accepts `bus_depot`; `get_build_catalog` lists the depot
  and the stop cost.
- New tool `build_bus_stop` with the shape of `build_power_line`.
- `get_map` layer `transit` (stop states, coverage).
- `get_game_overview` gains `transit` (the `TransitStats` figures).
- `inspect_tile` reports the stop and depot fields.
- `find_tiles` kind `bus_stop`.
- Tool descriptions and the docs table updated.

### Docs

`docs/idea.md` E-mobility: a bullet for transit after deliveries.
README feature list: bus stops, depot, overlay, goal.

## Section 4: Save, tests, balance

### Save

`layers.busStop?: ArrayBuffer` written by `serializeState`, read when
present, else zero. `saveToJson` / `saveFromJson` pass it through like
`roadClass`. `goalProgress.transitTicks?: number`. Buses, `stopAge`,
`transitCover` and `rider` are never saved; after a load every stop is
served for one window and riders are re-decided the next morning.
Vehicles and `riderDay` are not saved either, so the modal-shift streak
(`transitTicks`) restarts after a load: the first tick after a load has
no riders yet. The field is kept as-is; this is not worth a
`SAVE_VERSION` bump.

### Unit tests

- `transit.test.ts` (new): fleet size follows depots × `busesPerDepot`,
  a depot without road keeps none; `planTour` picks the oldest stops
  first, respects `stopsPerTour`, `maxRouteTiles` and claimed stops and
  ends at the depot road; a halt resets `stopAge`; `ageStops`
  transitions served → due → unserved at the configured days and marks
  dirty only on change; coverage marks road tiles within `stopRadius`
  of served stops only; buses drive only in the window and with enough
  charge; a bus charges at an energised depot and draws
  `chargingEnergyPerBus`; a driving bus occupies a lane; `lost` returns
  it to the depot; `transitStats` figures.
- `vehicles.test.ts`: a commuter covered at both ends stays parked and
  is a rider; covered at one end drives; a rider drives again the
  morning after coverage is lost; riders record no commute.
- `roads.test.ts` / `transit.test.ts`: stops only on road tiles, cost
  and rejection, second drag skips existing stops, bulldoze removes the
  stop first and the road on the second pass, clearing a road clears the
  stop, undo restores and refunds.
- `state.test.ts`, `serialization.test.ts`: `busStop` and
  `transitTicks` round-trip; a save without them loads clean.
- `economy.test.ts`: stop upkeep counted.
- `goals.test.ts`: `modalShift` needs population, share and a full day;
  a failing tick resets the streak.
- `engine.test.ts`: `stats.transit` present; diffs carry `busStop`,
  `stopState`, `transitCover`; tick vehicles include buses.
- `inspect.test.ts`: stop tile and depot fields.
- `agent/tools.test.ts`: `build_bus_stop`, `place_plant bus_depot`,
  overview and map layer.

### End-to-end

`tool-bus-stop` and `tool-plant-busdepot` buttons visible,
`overlay-transit` toggles, the transit chip appears once a stop exists.

### Balance probe

Temporary headless probe on the commuter town of the traffic probe (60
homes, 30 workplaces on one 30-tile street, 48×48, two years), three
variants: no transit; one depot with 8 stops; one depot with 16 stops.
Print per day: rider share, morning-peak congestion ratio, smoothed
congestion, evening charging peak, stops served / due / unserved,
transit cost. Targets: 8 stops give a rider share around 0.3–0.4 and a
smoothed congestion clearly below the no-transit run; the evening
charging peak drops visibly; depot plus stops cost less per day than
the happiness and tax they protect; 16 stops leave several stops due or
unserved with one depot, and a second depot clears them. Tune only
`BALANCE.transit`, `costs.busStop`, `costs.plant[BusDepot]` and the two
upkeep values. Delete the probe; numbers in the commit message.

### Out of scope

Line editor, trams and tracks, rider capacity per bus or stop, rider
travel time, transfers, stops on plants or empty land, fares.
