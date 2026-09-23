# City services (fire and police) — design

Date: 2026-09-23
Status: approved for planning

## Goal

Give the city two services with a coverage radius and real consequences:
a fire station that high-density buildings need before they densify,
and a police station whose absence costs happiness and tax income.
Both are electric consumers that only work while connected to the grid,
so the energy game and the city game pull on each other. One new goal
rewards covering the city.

## Decisions

- Stations are single-tile plants (`PlantType.FireStation`,
  `PlantType.PoliceStation`) in the build bar's "services" category next
  to the charging hub and the park. They follow the park's placement
  rules plus road access.
- Coverage is a Chebyshev radius around each active station, like the
  park's happiness ring. A station is active only while its tile is
  energised; an unpowered station covers nothing.
- Coverage lives in a derived tile layer `layers.services` (bitmask:
  fire, police), recomputed once per tick after the energy step. It is
  never persisted; loading a save recomputes it on the first tick.
- Consequences: without fire coverage a building cannot densify from
  level 2 to 3 (levels 1 and 2 stay free so a village grows without a
  station). Without police coverage happiness drops in proportion to the
  uncovered share, and the tax income of uncovered buildings is scaled
  down. Police effects start at 100 residents so a fresh city is not
  punished.
- A services overlay colours building tiles by coverage; the tile
  inspector shows coverage per building and the ring of a station.
- Every tuning value lives in `BALANCE.services`, `BALANCE.costs.plant`
  and `BALANCE.upkeepPerTick.plant`.
- Save format unchanged: the plant layer already persists the stations.

## Section 1: Stations

### Types and balance

`PlantType` gains `FireStation: 9` and `PoliceStation: 10`.

```ts
costs.plant[PlantType.FireStation] = 1_500;
costs.plant[PlantType.PoliceStation] = 1_200;
upkeepPerTick.plant[PlantType.FireStation] = 0.06;
upkeepPerTick.plant[PlantType.PoliceStation] = 0.05;

services: {
  fire: { radius: 7 },
  police: { radius: 8 },
  /** Energy drawn per tick by one connected station. */
  stationConsumption: 2,
  /** Police consequences apply from this population on. */
  minPopulation: 100,
  /** Tax multiplier for buildings without police coverage. */
  uncoveredTaxFactor: 0.7,
  /** Max happiness penalty when no building has police coverage. */
  policePenaltyWeight: 0.1,
  /** Coverage share (per service) the "safe city" goal requires. */
  goalCoverage: 0.9,
}
```

Radii and costs are starting values; a headless probe sizes them so a
city of about 500 residents needs roughly two stations of each kind.

### Placement

`buildRejection` with `BuildIntent.Plant` already handles land, water,
lines and occupancy. Stations additionally require `hasRoadAccess`
(rejection id `needsRoad`, new string). Bulldoze and undo work as for
any plant.

### Energy

Stations are consumers. In `energyStep`, every station whose tile is
energised adds `BALANCE.services.stationConsumption` to
`buildingDemand`; it is not a separate consumption line. Stations are
not supply sources and do not count for `hasPowerInfrastructure`.
`censusPlants` gains `fireStations` and `policeStations`.

A station is **active** when `layers.energized[tile] === 1`. The grid
recompute (`powerGrid.ts`, `stampRadius`) already writes every tile in
reach regardless of type, so plant tiles carry the flag today; nothing
in the grid code changes.

## Section 2: Coverage (`src/sim/services.ts`)

```ts
export const SERVICE_FIRE = 1;
export const SERVICE_POLICE = 2;

/** Rebuild layers.services from the active stations; marks changed tiles dirty. */
export function recomputeServices(state: SimState): void;

/** Share (0..1) of buildings covered per service, computed from the layer. */
export function serviceCoverage(state: SimState): { fire: number; police: number };
```

`recomputeServices` clears a scratch mask, stamps a square of
`2·radius + 1` around every active station, compares it with
`layers.services` tile by tile, writes the new value and calls
`markDirty` for tiles whose bits changed. Cost is stations × radius²
plus one pass over the grid; no randomness.

`SimState` gains `lastServices: { fire: number; police: number }`
(transient, default 0/0), set right after `recomputeServices` in
`stepTick`, between `energyStep` and `computeDemand`. Economy,
happiness, goals and stats read it. Empty cities (no buildings) report
coverage 1/1 so nothing is penalised before the first house.

`TileLayers.services: Uint8Array` (derived, not persisted). `TileDiff`
gains `services: number` so the renderer's overlay sees coverage
changes.

## Section 3: Consequences

### Growth (`src/sim/growth.ts`)

`canDensify` returns false for a density-2 building without the fire
bit. `growthBlockers` in `inspect.ts` pushes the new
`GrowthBlocker` `'noFireCoverage'` for density-2 buildings without it.

### Happiness (`src/sim/happiness.ts`)

```ts
const policePenalty =
  population >= BALANCE.services.minPopulation
    ? (1 - state.lastServices.police) * BALANCE.services.policePenaltyWeight
    : 0;
```

subtracted from the target next to the tax, supply and commute
penalties. `happinessStep` gets the population passed in from
`stepTick` (it is already counted there).

### Economy (`src/sim/economy.ts`)

```ts
const taxFactor =
  population >= BALANCE.services.minPopulation
    ? police + (1 - police) * BALANCE.services.uncoveredTaxFactor
    : 1;
const taxIncome = taxFactor * state.taxRate * (...)
```

`EconomyBreakdown` is unchanged; the budget panel shows the reduced
tax. The tile inspector's `taxPerTick` applies the per-tile factor
(uncovered building and population ≥ minPopulation → × 0.7) so the
inspector and the budget agree.

### Goal (`src/sim/goals.ts`)

`'safeCity'`: achieved on any tick with population ≥ `minPopulation`
and both coverage shares ≥ `goalCoverage`. No streak, no persisted
progress.

## Section 4: Stats, UI, rendering

### Stats

`GlobalStats.services: { fire: number; police: number }` (coverage
shares). `TileInfo` gains `fireCovered: boolean`,
`policeCovered: boolean` (buildings) and `stationActive: boolean`
(stations; false when unpowered). `ringRadius` returns the station's
radius for station tiles.

### Tools and build bar

Tool ids `plant-fire` (hotkey `f`) and `plant-police` (hotkey `c`),
icons 🚒 and 🚓, in the "services" category after the park. `PLANT_BY_TOOL`,
`PLANT_LABEL` maps in the budget panel and inspector, and the minimap
plant colours gain the two types.

### Overlay

`OverlayMode.Services = 3`, button "Services" / "Dienste" in the overlay
toggle. Building tiles are tinted: both services green (`0x4cd964`),
fire only orange (`0xffb347`), police only blue (`0x5b9bd5`), none red
(`0xe05263`). Other tiles untouched.

### Inspector

A "Services" section for buildings (fire: covered / not covered;
police: covered / not covered) and for stations (radius, active /
unpowered). Growth blocker text for `noFireCoverage`.

### Strings (English / German)

- `tool.plant-fire`: Fire station / Feuerwehr
- `tool.plant-police`: Police station / Polizei
- `overlay.services`: Services / Dienste; `overlay.services.title`:
  Fire and police coverage of every building / Feuerwehr- und
  Polizeiabdeckung jedes Gebäudes
- `inspect.section.services`: Services / Dienste
- `inspect.fire`: Fire cover / Feuerwehrschutz; `inspect.police`:
  Police cover / Polizeischutz; `inspect.covered`: covered / abgedeckt;
  `inspect.uncovered`: not covered / nicht abgedeckt
- `inspect.stationActive`: active / aktiv; `inspect.stationUnpowered`:
  unpowered, covers nothing / ohne Strom, deckt nichts ab
- `inspect.blocker.noFireCoverage`: No fire station in reach for the
  next density / Keine Feuerwehr in Reichweite für die nächste Dichte
- `rejection.needsRoad`: Needs a road next to it / Braucht eine Straße
  daneben
- `goal.safeCity.title`: Safe city / Sichere Stadt; `goal.safeCity.body`:
  Fire and police cover 90 % of buildings (100+ residents) / Feuerwehr
  und Polizei decken 90 % der Gebäude ab (ab 100 Einwohnern)
- `help.services.title`: City services / Stadtdienste; `help.services.body`:
  Fire and police stations protect every building within their ring, but
  only while connected to the grid. Buildings need fire cover to reach the
  highest density; without police cover, happiness and tax income fall
  once the city has 100 residents. The services overlay shows who is
  covered. / Feuerwehr und Polizei schützen jedes Gebäude in ihrem Ring,
  aber nur mit Netzanschluss. Für die höchste Dichte brauchen Gebäude
  Feuerwehrschutz; ohne Polizeischutz sinken Zufriedenheit und
  Steuereinnahmen, sobald die Stadt 100 Einwohner hat. Das
  Dienste-Overlay zeigt, wer abgedeckt ist.

### Rendering

`plantsMesh.ts` gains two box compositions: the fire station a red hall
with a white roof stripe and a short tower; the police station a blue
block with a light bar on the roof. Minimap colours `#c0392b` and
`#2f5fa8`. Nothing animates.

### Docs

`docs/idea.md` moves police/fire out of "Out of Scope" into a Services
bullet; the README feature list mentions the two stations, the overlay
and the goal.

## Section 5: Tests, balance, verification

### Unit tests

- `services.test.ts`: mask covers exactly the Chebyshev square, clipped
  at the map edge; two services overlap into both bits; an unpowered
  station covers nothing; coverage shares count buildings only; changed
  tiles are marked dirty and unchanged ones are not; empty city reports
  1/1.
- `energy.test.ts`: an energised station adds `stationConsumption` to
  building demand; an unconnected one adds nothing; stations do not make
  `hasPowerInfrastructure` true.
- `growth.test.ts`: density 2 → 3 blocked without fire cover, allowed
  with it; 0 → 1 and 1 → 2 unaffected.
- `happiness.test.ts` (new file; `happinessStep` is only exercised via
  `economy.test.ts` today): police penalty scales with the uncovered
  share and is zero below `minPopulation`.
- `economy.test.ts`: tax factor 1 below `minPopulation`, `0.7` with zero
  coverage above it, 1 with full coverage.
- `inspect.test.ts`: `noFireCoverage` blocker, `fireCovered` /
  `policeCovered`, `stationActive`, station `ringRadius`, per-tile tax
  factor.
- `goals.test.ts`: `safeCity` needs population and both coverages.
- `state.test.ts`: `services` layer exists, is not serialised, and a
  loaded save recomputes it on the first tick.
- `engine.test.ts`: `stats.services` present; tile diff carries
  `services`.

### End-to-end

Tool buttons `tool-plant-fire` and `tool-plant-police` visible; the
overlay toggle shows a services button.

### Balance probe

Temporary headless probe: the heating-probe city (60 residential + 30
commercial tiles, 48×48) run for two years with 0, 1, 2 stations of
each kind at fixed positions; print population, share of density-3
buildings, happiness, tax income and coverage per variant. Targets: with
no stations the city plateaus visibly (few density-3 buildings, lower
tax) but does not collapse; two stations of each kind cover ≥ 90 % of
the probe city; a station's upkeep is well below the tax it unlocks.
Delete the probe; record numbers in the commit message.

### Out of scope

Fires and crime as events, response time over roads, station upgrades
or levels, services for plants or roads, a services line in the energy
panel.
