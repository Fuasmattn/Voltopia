# Seasons — design

Date: 2026-09-23
Status: approved for planning

## Goal

Give the city a year with four seasons that changes the energy problem
over time: long, sunny summers with surplus and short, cloudy, windy
winters where an electric heating load meets weak photovoltaics. Seasons
also give hydro a spring melt, make the world look different across the
year, and add one long-term goal: get the city through a winter without
undersupply.

## Decisions

- A year is 20 in-game days: spring, summer, autumn, winter, five days
  each, in that order. A day stays 4 real minutes at 1×.
- New games start on the first day of spring. Saves without season data
  are treated as being on the first day of spring at load time.
- Seasons are a continuous, deterministic function of the day (no
  random component). Weather variance keeps coming from the existing
  fronts and drift; seasons only shift their means.
- Temperature in °C is the one signal downstream systems read (heating
  load, snow, melt, snowfall visuals). Day length and sun strength come
  from the same year phase.
- Every building heats electrically (heat pumps). Heating is a new
  consumption line that scales with cold and density. One permanent,
  city-wide "building insulation" purchase halves it.
- Rendering changes are limited to uniforms and particles: ground tint,
  sun arc and light colour, rain turning to snow. No new meshes or
  building materials.

## Section 1: Year model and season state

### State

`SimState` gains two scalars, both persisted as optional `SaveGame`
fields (no `SAVE_VERSION` bump):

- `seasonOriginDay: number` — the day number on which year 1 started.
  `0` for new games. `deserializeState` sets it to
  `dayNumber(save.tick)` when the field is missing, so a legacy city
  starts its year on the day it is loaded.
- `snowpack: number` 0..1 — see Section 2. Default `0`.

Undo snapshots do not include either (they are not build actions).

### `src/sim/seasons.ts`

A pure module. `seasonState(state, timeOfDay, cloudCover): SeasonState`
is stateless and cheap enough to call once per tick from `tick.ts`,
which stores the result on `state.season` for the rest of the tick
(energy, weather, stats) and for `buildStats`.

```ts
type SeasonId = 'spring' | 'summer' | 'autumn' | 'winter';

interface SeasonState {
  phase: number; // 0..1 through the year, 0 = first spring day
  season: SeasonId;
  dayOfSeason: number; // 1..5
  year: number; // 1-based
  temperature: number; // °C, includes diurnal cycle and cloud damping
  sunrise: number; // fraction of day
  sunset: number; // fraction of day
  solarStrength: number; // 0..1 sun elevation factor
  cloudBias: number; // added to front base for cloud cover
  windBias: number; // added to front base for wind speed
}
```

Definitions, all constants under a new `BALANCE.seasons` block:

- `phase = ((day - seasonOriginDay) mod daysPerYear) / daysPerYear`,
  `daysPerYear = seasonsPerYear × daysPerSeason = 4 × 5`.
  `season = SEASON_ORDER[floor(phase × 4)]`.
- Seasonal mean temperature: a cosine between `winterLow` (about −4 °C)
  and `summerHigh` (about 24 °C), with its maximum at `warmestPhase`
  (late summer, about 0.4) and minimum half a year later.
- Diurnal cycle: `+ diurnalAmplitude × −cos(2π × (timeOfDay − coldestTime))`
  scaled so the minimum falls just before sunrise (`coldestTime` about
  0.2) and the maximum in the afternoon; amplitude about 3 °C each way.
- Cloud damping: `− cloudDamping × cloudCover × sunIntensity(...)` so
  overcast days are cooler, nights unaffected. About 2 °C at most.
- Day length: `halfDay = 0.25 + dayLengthSwing × cos(2π × (phase − longestDayPhase))`
  with `longestDayPhase` about 0.3 (mid summer) and a swing giving about
  9.5 h in winter and 14.5 h in summer, symmetric around noon:
  `sunrise = 0.5 − halfDay`, `sunset = 0.5 + halfDay`.
- `solarStrength = winterSolarStrength + (1 − winterSolarStrength) × (1 + cos(2π × (phase − longestDayPhase))) / 2`,
  `winterSolarStrength` about 0.45.
- `cloudBias` / `windBias`: cosine around the year with amplitudes
  about ±0.12 (cloud) and ±0.12 (wind), most cloud and wind in winter,
  least in summer.

### `src/shared/daylight.ts`

`sunIntensity` and `nightFactor` gain optional `sunrise` / `sunset`
parameters defaulting to the existing constants, so callers that do not
care about seasons keep working. The renderer and the sim pass the
season's values.

### Stats

`GlobalStats` gains `season: SeasonStats` mirroring `SeasonState` plus
`snowpack`. `EnergyStats.consumption` gains `heating`. Legacy JSON
imports that predate the fields are fine because stats are not persisted.

## Section 2: Weather, generation, water, heating

### Weather fronts

`frontMeans` adds `cloudBias` to the cloud base and `windBias` to the
wind base before clamping to 0.05..0.95. Drift, noise and the RNG
consumption per tick are unchanged, so existing determinism tests hold.
Dunkelflaute spells become more frequent in winter and rarer in summer
as a side effect of the biases.

### Photovoltaics

`solarFactor(time, cloudCover, season)` becomes
`sunIntensity(time, sunrise, sunset) × solarStrength × (1 − 0.85 × cloudCover)`.
It applies to solar farms and rooftop PV alike. Wind, biogas, batteries,
pumped storage and the interconnector are untouched.

### Snowpack and river flow

`nextRiverFlow` becomes `nextWaterStep(flow, snowpack, cloudCover, temperature)`
returning both values:

- Precipitation is still "cloud cover above `rainCloudThreshold`", with
  the same intensity.
- `temperature < snowTemperature` (0 °C): the precipitation amount goes
  into `snowpack` (capped at 1) instead of the river; flow relaxes toward
  `dryBaselineFlow` as in a dry spell.
- `temperature ≥ meltTemperature` (about 2 °C) and `snowpack > 0`: melt
  `meltRate × (temperature − meltTemperature)` per tick (capped by what
  is left) is removed from the snowpack and added to the flow, on top of
  any rain.
- Otherwise unchanged behaviour.

Net effect: little run-of-river output in winter, a melt surge in
spring, the existing summer drought. `dryBaselineFlow` stays constant.
`snowpack` is also the visual snow cover (Section 3).

### Heating load

`buildingConsumption(zone, density, time, season, insulation)` becomes
`base × loadProfileFactor + base × heatingDegree × heatingWeight[zone] × (insulation ? insulationFactor : 1)`
where

- `base = consumptionByZoneAndDensity[zone][density]`,
- `heatingDegree = clamp((comfortTemperature − temperature) / heatingRange, 0, 1)`
  with `comfortTemperature` about 16 °C and `heatingRange` about 20 °C
  (full load at −4 °C),
- `heatingWeight` per zone, residential highest (about 1.2), commercial
  and retail lower (about 0.6),
- `insulationFactor = 0.5`.

`energyStep` sums the heating term separately into
`consumption.heating`; `consumption.buildings` keeps the profile term
only. Everything downstream (dispatch order, deficit flagging, history,
lifetime sums) works on the total as before. There is no cooling load.

### Building insulation

- `SimState.insulation: boolean`, default `false`, optional in the save.
- New command `{ type: 'buyInsulation' }`. Rejected with a reason when
  already bought or when `money < BALANCE.economy.insulationCost`;
  otherwise deducts the cost once and sets the flag. Not undoable.
- `GlobalStats.insulation: boolean`.

### Goal `winterResilience`

Added to `GOAL_IDS`. Progress counter in `goalProgress`: during winter
ticks with `population ≥ 50`, count consecutive ticks with
`energy.deficit === 0`; reset to 0 on any deficit tick or when
population is below the threshold. Achieved when the counter reaches
`daysPerSeason × TICKS_PER_DAY`. Outside winter the counter is reset so
a winter must be survived end to end.

## Section 3: Rendering and UI

### Render environment

`RenderEnvironment` gains `season`, `phase`, `temperature`,
`snowCover` (= `snowpack`), `sunrise`, `sunset`, `solarStrength`.
`Renderer.setStats` fills them from `stats.season`.

- **Sun arc.** Uses the seasonal `sunrise` / `sunset` for the east-west
  arc; the arc's peak height scales with `solarStrength` so winter sun
  stays low. Sun colour lerps between a slightly cool winter tint and a
  warm summer tint by `phase`.
- **Ground.** `terrain.ts` gets `setEnvironment`: the material colour is
  the interpolation between four palette entries (`groundSpring`,
  `groundSummer`, `groundAutumn`, `groundWinter`) by `phase`, then lerped
  toward `groundSnow` by `snowCover`.
- **Snowfall.** In `weatherFx.ts`, when `temperature < 0 °C` the rain
  particles are written as snow: white, larger, slower fall, gentle
  horizontal drift. Same particle pool and count logic.

The Linux sandbox has no WebGL; the visual check is done on the Mac.

### HUD

- The weather block shows a season glyph, season day and temperature:
  `🌸 Spring 3/5 · 12 °C`. Glyphs: spring 🌸, summer ☀️, autumn 🍂,
  winter ❄️. Tooltip gets a line about the season.
- Energy panel: a new consumption row "Heating".
- Next to smart charging: a "Building insulation" button showing the
  price, disabled when unaffordable, replaced by a checked, disabled
  state once bought.
- Help panel: a short paragraph on seasons, heating and insulation.
- Goal title and body for `winterResilience`.
- All new strings in English and German (`src/ui/i18n.tsx`).

### Lifetime statistics

`LifetimeSample` gains optional `temperature` (daily mean) and
`heating` (daily heating energy). The stats page shows a temperature
chart. Old samples without the fields are drawn as gaps.

## Section 4: Saves, tests, balance, scope

### Saves

Optional fields `seasonOriginDay`, `snowpack`, `insulation` on
`SaveGame`, written by `serializeState`, read with defaults by
`deserializeState` (`seasonOriginDay` defaults to the save's current
day). `saveToJson` / `saveFromJson` pass them through when present.

### Tests (colocated `*.test.ts`)

- `seasons.test.ts`: phase and season for day 0, 4, 5, 19, 20 and with
  a non-zero origin; temperature within [winterLow − amplitude − damping,
  summerHigh + amplitude] and continuous across day and year boundaries;
  winter day length shorter than summer and symmetric around noon;
  `solarStrength` 1 at the longest day, `winterSolarStrength` at the
  shortest.
- `weather.test.ts`: sub-zero precipitation grows `snowpack` and leaves
  flow on the dry path; warm ticks melt snowpack into flow; same seed
  gives identical weather and snowpack after N ticks.
- `energy.test.ts`: heating consumption 0 above `comfortTemperature`,
  full at `comfortTemperature − heatingRange`, halved with insulation;
  `consumption.heating` reported and included in the balance; winter
  solar output lower than summer at noon under clear sky.
- `engine.test.ts`: `buyInsulation` deducts once, rejects when poor or
  already bought.
- `goals.test.ts`: `winterResilience` achieved after a deficit-free
  winter, reset by one deficit tick, not counted in other seasons.
- `state.test.ts`: round-trip of the new fields; a save without
  `seasonOriginDay` loads with the origin set to its current day.
- Coverage stays ≥ 90 % on `src/sim` and `src/shared`.

### Balance probe

A temporary headless probe scripts a mid-sized city with the current
default plant mix, runs two in-game years at 3× and prints per season:
mean PV and hydro output, heating share of consumption, deficit ticks,
curtailment. Targets: a city that is comfortable in summer sees
noticeable deficit in its first winter without extra storage or
insulation, and clears it with insulation plus one more storage unit.
The probe is deleted after tuning.

### e2e

The HUD season element (`data-testid="season"`) is visible after boot
and shows the spring label of the active locale.

### Out of scope

Cooling load, seasonal heat storage, snow on roofs and trees, seasonal
growth or happiness factors, random temperature, seasons as a new-game
option, seasonal wind turbine icing.
