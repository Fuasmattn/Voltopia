# Cooling load — design

Date: 2026-09-23
Status: approved for planning

## Goal

Give summer its own energy problem. Today the heating load makes the
winter evening the hardest hour of the year while summer is free. With
an electric cooling load that grows with the heat, the summer afternoon
becomes the second pressure point: the day is warmest at about 16:48,
the summer sun sets at about 19:15, so the cooling peak lands on the
declining side of the PV curve and runs on after sunset. Storage and
wind decide the summer evening the way biogas decides the winter
evening. One new city goal rewards getting through a summer without
undersupply.

## Decisions

- Cooling mirrors heating: a linear degree function of the temperature
  above a comfort threshold, a per-building load scaled by a zone
  weight, a separate consumption line in stats and the energy panel.
- Building insulation halves the cooling load as well as the heating
  load. There is no second upgrade. The insulation tooltip and help
  text say so.
- No new `SimState` fields. Cooling is derived every tick from the
  temperature the season model already provides. The only persisted
  addition is the goal progress counter, an optional `SaveGame` field
  like `winterTicks`. No `SAVE_VERSION` bump.
- No rendering changes.
- Balance target: on a clear summer afternoon the cooling load is about
  half of the winter-evening heating load. Summer stays easier than
  winter but is no longer free. The exact weights are set by a
  temporary two-year headless probe that is deleted afterwards.

## Section 1: Simulation model

### `src/sim/seasons.ts`

```ts
/** 0..1 cooling demand share: 0 at comfort temperature, 1 coolingRange above it. */
export function coolingDegree(temperature: number): number;
```

Mirror of `heatingDegree`: `clamp((temperature - comfortTemperature) /
coolingRange, 0, 1)` with the values from `BALANCE.seasons.cooling`.
Heating and cooling comfort thresholds differ (16 °C and 22 °C), so
between them neither load is active; they can never both be non-zero
at the same temperature.

### `src/sim/energy.ts`

```ts
/**
 * Electric cooling (heat pumps in reverse) of one building tile: grows
 * linearly with the heat above the comfort temperature, scaled by the
 * zone's cooling weight; building insulation halves it.
 */
export function coolingConsumption(
  zone: Zone,
  density: number,
  temperature: number,
  insulation: boolean,
): number;
```

`base × coolingDegree(temperature) × weightByZone[zone] × (insulation ?
insulationFactor : 1)`, where `base` is the zone/density base
consumption, exactly as `heatingConsumption` does it.

In `energyStep` the connected-buildings loop accumulates
`coolingDemand` next to `heatingDemand`. `totalDemand` becomes
`buildingDemand + heatingDemand + coolingDemand + chargingDemand`. The
tick result (`state.lastEnergy`) gains `coolingConsumption`. The
balance order (storage, biogas, import, undersupply) is unchanged;
cooling is simply more load.

### `src/shared/constants.ts`

```ts
seasons: {
  ...
  cooling: {
    /** No cooling below this temperature; full cooling coolingRange above it. */
    comfortTemperature: 22,
    coolingRange: 8,
    /** Cooling load at full heat as a multiple of the zone's base consumption. */
    weightByZone: {
      [Zone.Residential]: 0.35,
      [Zone.Commercial]: 0.6,
      [Zone.Retail]: 0.6,
    },
    /** Cooling multiplier once building insulation is bought. */
    insulationFactor: 0.5,
  },
}
```

Offices and shops cool harder than homes. With a summer seasonal mean
of 24 °C and a diurnal swing of +3 °C, a clear afternoon reaches about
0.6 cooling degree; cloud damping (up to −2 °C by day) lowers it on
overcast days, so cloudy summer days are both weaker on PV and lighter
on cooling. The numbers above are starting values for the probe.

## Section 2: Goal "heat-proof"

### `src/sim/goals.ts`

- `GOAL_IDS` gains `'summerResilience'` after `'winterResilience'`.
- `state.goalProgress` gains `summerTicks: number` (default 0).
- Each tick: if `state.season.season === 'summer'`, population ≥ 50
  (`CLEAN_DAY_MIN_POPULATION`) and `state.lastEnergy.deficit === 0`,
  increment `summerTicks`; otherwise reset it to 0. Achieved once
  `summerTicks >= daysPerSeason × TICKS_PER_DAY`. Identical shape to
  the winter goal.

### Persistence

`SaveGame.summerTicks?: number`, written by `serializeState`, read by
`deserializeState` with `?? 0`, exactly like `winterTicks`. Not part of
undo snapshots.

### Win screen

The win screen fires when every goal is achieved. A city that had
already won gets one more open goal, as happened when the winter goal
was added. Intended.

## Section 3: Stats and UI

### Types (`src/shared/types.ts`)

- `EnergyStats.consumption` gains `cooling: number`.
- `LifetimeSample` gains `cooling?: number` (daily mean, absent in
  samples from before this feature). `tick.ts` sums it in `daySums`
  and includes it in the daily `avgConsumption`.
- `GlobalStats` and the worker protocol change only through
  `EnergyStats`.

### Energy panel (`src/ui/EnergyPanel.tsx`)

A new row directly below heating:

```tsx
<div className="energy-row" data-testid="energy-cooling">
  <span>{t('energy.cooling')}</span>
  <span>{formatEnergy(energy.consumption.cooling)}</span>
</div>
```

Always visible, like the heating row. `totalConsumption` in the panel
adds `energy.consumption.cooling`.

### Strings (`src/ui/i18n.tsx`, English and German)

- `energy.cooling`: `❄️ Cooling` / `❄️ Kühlung`
- `goal.summerResilience.title`: `Heat-proof` / `Hitzefest`
- `goal.summerResilience.body`: `Get through a whole summer without a
single undersupplied tick (50+ residents).` / `Überstehe einen ganzen
Sommer ohne einen einzigen unterversorgten Tick (50+ Einwohner).`
- `insulation.title` becomes `One-off upgrade: halves the electric
heating and cooling load of every building` / `Einmaliges Upgrade:
halbiert die elektrische Heiz- und Kühllast aller Gebäude`.
- `help.seasons.body` gains one sentence after the winter sentence:
  `In summer every building cools electrically, so the cooling load
peaks in the late afternoon as PV fades.` / `Im Sommer kühlen alle
Gebäude elektrisch: Die Kühllast erreicht ihren Gipfel am späten
Nachmittag, wenn die PV nachlässt.` The closing insulation sentence
  says it halves heating and cooling.

### Docs

`docs/idea.md` (Seasons bullet) and the README feature list mention the
cooling load and the heat-proof goal.

## Section 4: Balance, tests, verification

### Balance probe

A temporary script (pattern: commit "balance: resize energy system")
builds a mid-size city via `SimEngine`, runs two in-game years, and
prints per season: peak heating load, peak cooling load, the hour of
each peak, and deficit ticks. Adjust `weightByZone` and `coolingRange`
until the summer cooling peak is roughly half the winter heating peak
and a city that survives winter with the current plant mix still sees
a noticeable summer-evening dip in state of charge. Delete the probe;
record the resulting numbers in the commit message.

### Unit tests

- `seasons.test.ts`: `coolingDegree` is 0 at and below the comfort
  temperature, 1 at the top of the range and beyond, 0.5 midway.
- `energy.test.ts`: `coolingConsumption` is 0 when cool, scales with
  the zone weight, is halved by insulation; `energyStep` adds the
  cooling demand to the total and reports `coolingConsumption`;
  heating and cooling are never both non-zero for one temperature.
- `tick.ts` coverage via `engine.test.ts`/`integration.test.ts`:
  `stats.energy.consumption.cooling` is present and the lifetime sample
  carries `cooling`.
- `goals.test.ts`: `summerResilience` needs a full summer without a
  deficit tick, a deficit resets the streak, ticks outside summer reset
  it. Mirrors the three winter tests.
- `state.test.ts`: `summerTicks` survives a serialize/deserialize round
  trip and a missing field loads as 0.

### End-to-end

In the existing season HUD test, assert that `energy-cooling` is
visible next to `energy-heating`.

### Out of scope

A shading or cool-roof upgrade, heat haze or other summer visuals,
seasonal happiness effects, cooling of plants or storage, a
temperature-dependent PV derating.
