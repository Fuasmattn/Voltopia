# Cooling Load Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An electric cooling load that grows with summer heat, is halved by the existing building insulation, shows up as its own consumption line, and a "heat-proof" city goal for a summer without undersupply.

**Architecture:** `coolingDegree` in `src/sim/seasons.ts` mirrors `heatingDegree`; `coolingConsumption` in `src/sim/energy.ts` mirrors `heatingConsumption` and is summed into the energy balance every tick. `state.lastEnergy.coolingConsumption` flows through `tick.ts` into `EnergyStats.consumption.cooling` and the daily lifetime samples. The goal `summerResilience` copies the winter goal with its own persisted counter `summerTicks`. No new state beyond that counter; no rendering.

**Tech Stack:** TypeScript strict, Vitest, React 19, Playwright. Spec: `docs/superpowers/specs/2026-09-23-cooling-load-design.md`.

## Global Constraints

- `src/sim/` stays pure: no DOM or three.js imports; no randomness is added.
- Every tuning value lives in `BALANCE` (`src/shared/constants.ts`); no magic numbers in sim code.
- `SAVE_VERSION` stays as is; the one new save field (`summerTicks`) is optional and defaults to 0 in `deserializeState`.
- All user-visible strings go through `src/ui/i18n.tsx`, English AND German for every key.
- Coverage ≥ 90 % on `src/sim` and `src/shared` (`pnpm coverage`).
- Run `pnpm format` after edits; the pre-commit hook runs `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test`. Never `--no-verify`.
- Energy terminology: generation, consumption, cooling load, heating load, state of charge.
- Commit messages: imperative summary + short body, one task per commit, ending with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- The Linux sandbox has no WebGL; e2e runs on the Mac or in CI.

## File map

| File                           | Change                                                                                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/constants.ts`      | `BALANCE.seasons.cooling` block                                                                                                                 |
| `src/sim/seasons.ts`           | `coolingDegree`                                                                                                                                 |
| `src/sim/energy.ts`            | `coolingConsumption`, cooling demand in `energyStep`, `coolingConsumption` in the tick result                                                   |
| `src/sim/state.ts`             | `lastEnergy.coolingConsumption`, `lifetime.daySums.cooling`, `goalProgress.summerTicks`, serialize/deserialize                                  |
| `src/sim/tick.ts`              | cooling in lifetime sums and in `EnergyStats.consumption`                                                                                       |
| `src/sim/goals.ts`             | `summerResilience` goal                                                                                                                         |
| `src/shared/types.ts`          | `EnergyStats.consumption.cooling`, `LifetimeSample.cooling?`, `SaveGame.summerTicks?`                                                           |
| `src/storage/serialization.ts` | pass `summerTicks` through JSON export/import                                                                                                   |
| `src/ui/EnergyPanel.tsx`       | cooling row, total consumption                                                                                                                  |
| `src/ui/i18n.tsx`              | `energy.cooling`, `goal.summerResilience.*`, updated `insulation.title` and `help.seasons.body` (EN + DE)                                       |
| `e2e/game.spec.ts`             | assert the cooling row is visible                                                                                                               |
| `docs/idea.md`, `README.md`    | mention cooling load and heat-proof goal                                                                                                        |
| Tests                          | `seasons.test.ts`, `energy.test.ts`, `engine.test.ts`, `integration.test.ts`, `goals.test.ts`, `state.test.ts`, `storage/serialization.test.ts` |

---

### Task 1: `coolingDegree` and the balance block

**Files:**

- Modify: `src/shared/constants.ts` (inside `seasons`, after the `heating` block, around line 332)
- Modify: `src/sim/seasons.ts` (after `heatingDegree`, around line 34)
- Test: `src/sim/seasons.test.ts`

**Interfaces:**

- Produces: `coolingDegree(temperature: number): number` (0..1) and `BALANCE.seasons.cooling = { comfortTemperature, coolingRange, weightByZone, insulationFactor }`. Task 2 uses both.

- [x] **Step 1: Write the failing tests**

In `src/sim/seasons.test.ts`, extend the import line to `import { coolingDegree, daysPerYear, heatingDegree, seasonState, yearPhase } from './seasons.ts';` and append at the end of the file:

```ts
describe('coolingDegree', () => {
  it('is 0 at or below the cooling comfort temperature', () => {
    expect(coolingDegree(seasons.cooling.comfortTemperature)).toBe(0);
    expect(coolingDegree(-10)).toBe(0);
  });

  it('reaches 1 at the top of the cooling range and is linear between', () => {
    const { comfortTemperature, coolingRange } = seasons.cooling;
    expect(coolingDegree(comfortTemperature + coolingRange)).toBe(1);
    expect(coolingDegree(comfortTemperature + coolingRange + 10)).toBe(1);
    expect(coolingDegree(comfortTemperature + coolingRange / 2)).toBeCloseTo(0.5, 9);
  });

  it('never overlaps with heating: no temperature has both loads', () => {
    for (let t = -20; t <= 40; t += 0.5) {
      expect(heatingDegree(t) * coolingDegree(t)).toBe(0);
    }
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/sim/seasons.test.ts`
Expected: FAIL, `coolingDegree` is not exported / `seasons.cooling` is undefined.

- [x] **Step 3: Add the balance block**

In `src/shared/constants.ts`, directly after the `heating: { ... },` block inside `seasons` (the block ending with `insulationFactor: 0.5, },`), add:

```ts
    cooling: {
      /** No cooling below this temperature; full cooling coolingRange above it. */
      comfortTemperature: 22,
      coolingRange: 8,
      /** Cooling load at full heat as a multiple of the zone's base consumption. */
      weightByZone: {
        [Zone.Residential]: 0.35,
        [Zone.Commercial]: 0.6,
        [Zone.Retail]: 0.6,
      } as Record<Zone, number>,
      /** Cooling multiplier once building insulation is bought. */
      insulationFactor: 0.5,
    },
```

- [x] **Step 4: Add `coolingDegree`**

In `src/sim/seasons.ts`, directly after `heatingDegree`:

```ts
/** 0..1 cooling demand share: 0 at comfort temperature, 1 coolingRange above it. */
export function coolingDegree(temperature: number): number {
  const { comfortTemperature, coolingRange } = BALANCE.seasons.cooling;
  return Math.min(1, Math.max(0, (temperature - comfortTemperature) / coolingRange));
}
```

- [x] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run src/sim/seasons.test.ts`
Expected: PASS (all season tests, including the three new ones).

- [x] **Step 6: Commit**

```bash
pnpm format
git add src/shared/constants.ts src/sim/seasons.ts src/sim/seasons.test.ts
git commit -m "feat(sim): cooling degree above a summer comfort temperature

Mirror of heatingDegree: linear from 0 at 22 °C to 1 at 30 °C, with the
thresholds in BALANCE.seasons.cooling. Heating and cooling can never
both be active at one temperature.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Cooling consumption in the energy balance

**Files:**

- Modify: `src/sim/energy.ts` (after `heatingConsumption` around line 147; inside `energyStep` around lines 201–222 and 286–298)
- Modify: `src/sim/state.ts` (`lastEnergy` type around line 157 and its initial value around line 234)
- Test: `src/sim/energy.test.ts`

**Interfaces:**

- Consumes: `coolingDegree` and `BALANCE.seasons.cooling` from Task 1.
- Produces: `coolingConsumption(zone: Zone, density: number, temperature: number, insulation: boolean): number`; `state.lastEnergy.coolingConsumption: number`. Task 3 reads the latter.

- [x] **Step 1: Write the failing tests**

In `src/sim/energy.test.ts`, add `coolingConsumption,` to the import from `./energy.ts` (alphabetically after `censusPlants,`). Append at the end of the file:

```ts
describe('cooling load', () => {
  const { comfortTemperature, coolingRange, weightByZone, insulationFactor } =
    BALANCE.seasons.cooling;
  const base = BALANCE.energy.consumptionByZoneAndDensity[Zone.Residential][2];

  it('is zero below the cooling comfort temperature', () => {
    expect(coolingConsumption(Zone.Residential, 2, comfortTemperature - 1, false)).toBe(0);
  });

  it('reaches the full zone weight at the top of the range', () => {
    const hot = comfortTemperature + coolingRange;
    expect(coolingConsumption(Zone.Residential, 2, hot, false)).toBeCloseTo(
      base * weightByZone[Zone.Residential],
      9,
    );
    expect(coolingConsumption(Zone.Commercial, 2, hot, false)).toBeCloseTo(
      BALANCE.energy.consumptionByZoneAndDensity[Zone.Commercial][2] *
        weightByZone[Zone.Commercial],
      9,
    );
  });

  it('is halved by insulation', () => {
    const hot = comfortTemperature + coolingRange;
    const plain = coolingConsumption(Zone.Residential, 3, hot, false);
    expect(coolingConsumption(Zone.Residential, 3, hot, true)).toBeCloseTo(
      plain * insulationFactor,
      9,
    );
  });

  it('is reported separately and counts toward the balance', () => {
    const state = makeState();
    setNoonClearSky(state);
    state.season = { ...state.season, temperature: comfortTemperature + coolingRange };
    placePlant(state, at(5, 5), PlantType.WindTurbine);
    addBuilding(state, at(6, 5), Zone.Residential, 2);
    buildPowerLines(state, [at(6, 6)]);
    energyStep(state, { chargingDemand: 0 });
    const cooling = state.lastEnergy.coolingConsumption;
    expect(cooling).toBeCloseTo(base * weightByZone[Zone.Residential], 6);
    expect(state.lastEnergy.heatingConsumption).toBe(0);
    // Wind is 0 at noon clear sky; rooftop PV covers part of the load and
    // the small shortfall is imported, so the import equals the unmet
    // (buildings + cooling - rooftop). That proves cooling is in the balance.
    expect(state.lastEnergy.gridImport).toBeCloseTo(
      state.lastEnergy.buildingConsumption + cooling - state.lastEnergy.rooftop,
      6,
    );
    expect(state.lastEnergy.deficit).toBe(0);
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/sim/energy.test.ts`
Expected: FAIL, `coolingConsumption` is not exported.

- [x] **Step 3: Add `coolingConsumption`**

In `src/sim/energy.ts`, change the seasons import to `import { coolingDegree, heatingDegree } from './seasons.ts';` and add directly after `heatingConsumption`:

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
): number {
  const { weightByZone, insulationFactor } = BALANCE.seasons.cooling;
  const base = BALANCE.energy.consumptionByZoneAndDensity[zone]?.[density] ?? 0;
  const weight = weightByZone[zone] ?? 0;
  return base * coolingDegree(temperature) * weight * (insulation ? insulationFactor : 1);
}
```

- [x] **Step 4: Sum it in `energyStep`**

In `energyStep`:

- After `let heatingDemand = 0;` add `let coolingDemand = 0;`.
- After the line `heatingDemand += heatingConsumption(zone, density, temperature, state.insulation);` add `coolingDemand += coolingConsumption(zone, density, temperature, state.insulation);`.
- Change `const totalDemand = buildingDemand + heatingDemand + chargingDemand;` to `const totalDemand = buildingDemand + heatingDemand + coolingDemand + chargingDemand;`.
- In the `state.lastEnergy = { ... }` assignment, after `heatingConsumption: heatingDemand,` add `coolingConsumption: coolingDemand,`.

Update the doc comment above `energyStep` that lists the consumption parts (`consumption (buildings, heating, charging)`) to `consumption (buildings, heating, cooling, charging)`.

- [x] **Step 5: Extend the `lastEnergy` type and default**

In `src/sim/state.ts`, in the `lastEnergy` type after `heatingConsumption: number;` add `coolingConsumption: number;`. In `createSimState` after `heatingConsumption: 0,` add `coolingConsumption: 0,`.

- [x] **Step 6: Run the tests and the typecheck**

Run: `pnpm vitest run src/sim/energy.test.ts && pnpm typecheck`
Expected: PASS. Existing energy tests use `makeState()` at 20 °C, below the cooling comfort of 22 °C, so their literal expectations hold. If any other test file with a fixed `lastEnergy` object literal fails the typecheck, add `coolingConsumption: 0` to that literal.

- [x] **Step 7: Run the full suite**

Run: `pnpm test`
Expected: PASS. Spring day 1 in `integration.test.ts` and friends is around 1 °C, so cooling is 0 there and nothing shifts.

- [x] **Step 8: Commit**

```bash
pnpm format
git add src/sim/energy.ts src/sim/energy.test.ts src/sim/state.ts
git commit -m "feat(sim): electric cooling load that follows the heat

Every connected building draws a cooling load above 22 °C, weighted per
zone and halved by insulation. It is a separate part of the balance next
to heating and charging.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Cooling in stats and lifetime samples

**Files:**

- Modify: `src/shared/types.ts` (`EnergyStats.consumption` around line 102; `LifetimeSample` around line 140)
- Modify: `src/sim/state.ts` (`lifetime.daySums` type around line 148 and default around line 232)
- Modify: `src/sim/tick.ts` (`recordLifetime` around lines 57–86; stats consumption around line 142)
- Test: `src/sim/engine.test.ts`, `src/sim/integration.test.ts`

**Interfaces:**

- Consumes: `state.lastEnergy.coolingConsumption` from Task 2.
- Produces: `EnergyStats.consumption.cooling: number`, `LifetimeSample.cooling?: number`. Task 5 renders the former.

- [x] **Step 1: Write the failing tests**

In `src/sim/engine.test.ts`, in the test `'reports the season in stats and advances it with the days'`, directly after `expect(first.stats.energy.consumption.heating).toBe(0);` add:

```ts
expect(first.stats.energy.consumption.cooling).toBe(0);
```

Add a new test right after that test:

```ts
it('reports the cooling load in stats on a hot summer afternoon', () => {
  const engine = makeEngine();
  const at = (x: number, y: number) => tileIndex(x, y, 16);
  const { comfortTemperature } = BALANCE.seasons.cooling;
  // Same powered block as the energy tests: turbine, one residential
  // building next to it, a power line tile touching both.
  placePlant(engine.state, at(5, 5), PlantType.WindTurbine);
  engine.state.layers.zone[at(6, 5)] = Zone.Residential;
  engine.state.layers.density[at(6, 5)] = 2;
  buildPowerLines(engine.state, [at(6, 6)]);
  // Midsummer, warmest hour of the day (see BALANCE.seasons.coldestTime + 0.5).
  engine.state.seasonOriginDay = -Math.floor(BALANCE.seasons.daysPerSeason * 1.5);
  engine.state.tick = Math.floor(TICKS_PER_DAY * 0.7);
  const hot = engine.tick();
  if (hot.type !== 'tick') throw new Error('expected tick');
  expect(hot.stats.season.season).toBe('summer');
  expect(hot.stats.season.temperature).toBeGreaterThan(comfortTemperature);
  expect(hot.stats.energy.consumption.cooling).toBeGreaterThan(0);
  expect(hot.stats.energy.consumption.heating).toBe(0);
});
```

Add the imports this needs at the top of `engine.test.ts`: `Zone` to the import from `'../shared/types.ts'`, and two new lines `import { placePlant } from './energy.ts';` and `import { buildPowerLines } from './powerLines.ts';`. Why this works: `seasonOriginDay` is read by `tick.ts` when it recomputes `state.season`, so a negative origin puts day 0 seven days into the year, which is summer day 3; at 0.7 of the day the diurnal cycle peaks (coldest at 0.2), giving about 27 °C minus at most 2 °C cloud damping, clearly above 22 °C.

In `src/sim/integration.test.ts`, directly after `expect(samples[2].heating).toBeGreaterThanOrEqual(0);` add:

```ts
expect(samples[2].cooling).toBeGreaterThanOrEqual(0);
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/sim/engine.test.ts src/sim/integration.test.ts`
Expected: FAIL, `consumption.cooling` / `samples[2].cooling` is undefined (typecheck errors count as failures too).

- [x] **Step 3: Extend the types**

In `src/shared/types.ts`:

- `EnergyStats.consumption` becomes `consumption: { buildings: number; charging: number; heating: number; cooling: number };`
- In `LifetimeSample`, after the `heating?: number;` line add:

```ts
  /** Average cooling consumption per tick over the day (absent in older samples). */
  cooling?: number;
```

- [x] **Step 4: Extend the day sums**

In `src/sim/state.ts`, in the `lifetime.daySums` type add `cooling: number;` after `heating: number;`, and in `createSimState` change the default to `daySums: { generation: 0, consumption: 0, heating: 0, cooling: 0, temperature: 0, ticks: 0 },`.

- [x] **Step 5: Wire `tick.ts`**

In `recordLifetime`:

- Change `sums.consumption += e.buildingConsumption + e.chargingConsumption + e.heatingConsumption;` to `sums.consumption += e.buildingConsumption + e.chargingConsumption + e.heatingConsumption + e.coolingConsumption;`
- After `sums.heating += e.heatingConsumption;` add `sums.cooling += e.coolingConsumption;`
- In the pushed sample after `heating: sums.heating / ticks,` add `cooling: sums.cooling / ticks,`
- In the reset block after `sums.heating = 0;` add `sums.cooling = 0;`

In `buildStats`, in `consumption: { ... }` after `heating: e.heatingConsumption,` add `cooling: e.coolingConsumption,`.

- [x] **Step 6: Run the tests and the typecheck**

Run: `pnpm vitest run src/sim/engine.test.ts src/sim/integration.test.ts && pnpm typecheck`
Expected: PASS. If the typecheck reports other places that build an `EnergyStats.consumption` literal (for example a UI test fixture or `scripts/`), add `cooling: 0` there.

- [x] **Step 7: Commit**

```bash
pnpm format
git add src/shared/types.ts src/sim/state.ts src/sim/tick.ts src/sim/engine.test.ts src/sim/integration.test.ts
git commit -m "feat(sim): expose the cooling load in stats and daily samples

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Heat-proof goal with persisted progress

**Files:**

- Modify: `src/sim/goals.ts` (`GOAL_IDS` line 7–17; `goalsStep` around lines 52–90)
- Modify: `src/sim/state.ts` (`goalProgress` type line 137, default line 227, serialize around line 402, deserialize around line 439)
- Modify: `src/shared/types.ts` (`SaveGame` after `winterTicks?` around line 245)
- Modify: `src/storage/serialization.ts` (lines 21, 68, 152)
- Test: `src/sim/goals.test.ts`, `src/sim/state.test.ts`, `src/storage/serialization.test.ts`

**Interfaces:**

- Produces: goal id `'summerResilience'` (Task 5 adds its strings), `state.goalProgress.summerTicks: number`, `SaveGame.summerTicks?: number`.

- [x] **Step 1: Write the failing tests**

In `src/sim/goals.test.ts`, directly after the `'ticks outside winter do not count and reset the streak'` test (still inside the `describe('goals', ...)` block), add:

```ts
function summerCity() {
  const state = createSimState(1, SIZE);
  for (let i = 0; i < 5; i++) {
    state.layers.zone[at(i, 1)] = Zone.Residential;
    state.layers.density[at(i, 1)] = 3;
  }
  state.season = { ...state.season, season: 'summer' };
  return state;
}

it('summerResilience needs a full summer without a deficit tick', () => {
  const state = summerCity();
  const summerTicks = BALANCE.seasons.daysPerSeason * TICKS_PER_DAY;
  for (let t = 0; t < summerTicks - 1; t++) goalsStep(state);
  expect(state.goalsAchieved.has('summerResilience')).toBe(false);
  goalsStep(state);
  expect(state.goalsAchieved.has('summerResilience')).toBe(true);
});

it('a deficit tick resets the summer streak', () => {
  const state = summerCity();
  for (let t = 0; t < 100; t++) goalsStep(state);
  expect(state.goalProgress.summerTicks).toBe(100);
  state.lastEnergy.deficit = 1;
  goalsStep(state);
  expect(state.goalProgress.summerTicks).toBe(0);
});

it('ticks outside summer do not count and reset the streak', () => {
  const state = summerCity();
  for (let t = 0; t < 100; t++) goalsStep(state);
  state.season = { ...state.season, season: 'autumn' };
  goalsStep(state);
  expect(state.goalProgress.summerTicks).toBe(0);
});
```

In `src/sim/state.test.ts`, directly after the `'starts a save without winter progress at zero'` test add:

```ts
it('persists summer resilience progress', () => {
  const state = makeState();
  state.goalProgress.summerTicks = 777;
  const restored = deserializeState(serializeState(state));
  expect(restored.goalProgress.summerTicks).toBe(777);
});

it('starts a save without summer progress at zero', () => {
  const state = makeState();
  state.goalProgress.summerTicks = 500;
  const save = serializeState(state);
  delete save.summerTicks;
  expect(deserializeState(save).goalProgress.summerTicks).toBe(0);
});
```

In `src/storage/serialization.test.ts`, directly after the `'accepts exports without winter progress'` test add:

```ts
it('round-trips summer resilience progress', () => {
  const save = makeSave();
  save.summerTicks = 1234;
  expect(saveFromJson(saveToJson(save)).summerTicks).toBe(1234);
});

it('accepts exports without summer progress', () => {
  expect(saveFromJson(saveToJson(makeSave())).summerTicks).toBeUndefined();
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/sim/goals.test.ts src/sim/state.test.ts src/storage/serialization.test.ts`
Expected: FAIL (`summerTicks` unknown, goal never achieved).

- [x] **Step 3: Add the goal**

In `src/sim/goals.ts`:

- In `GOAL_IDS`, after `'winterResilience',` add `'summerResilience',`.
- In `goalsStep`, directly after the winter block (the `if (inWinter && ...) { progress.winterTicks++; } else { progress.winterTicks = 0; }` statement) add:

```ts
// A whole summer (every tick) without undersupply, for a real city.
const inSummer = state.season.season === 'summer';
if (inSummer && population >= CLEAN_DAY_MIN_POPULATION && state.lastEnergy.deficit === 0) {
  progress.summerTicks++;
} else {
  progress.summerTicks = 0;
}
```

- After the `winterResilience` achievement check (the `if (!achieved.has('winterResilience') && ...) { ... }` block) add:

```ts
if (
  !achieved.has('summerResilience') &&
  progress.summerTicks >= BALANCE.seasons.daysPerSeason * TICKS_PER_DAY
) {
  achieved.add('summerResilience');
}
```

- [x] **Step 4: Add the state field and persistence**

In `src/sim/state.ts`:

- `goalProgress` type becomes `goalProgress: { cleanDayTicks: number; exportedTotal: number; winterTicks: number; summerTicks: number };`
- Default becomes `goalProgress: { cleanDayTicks: 0, exportedTotal: 0, winterTicks: 0, summerTicks: 0 },`
- In `serializeState`, after `winterTicks: state.goalProgress.winterTicks,` add `summerTicks: state.goalProgress.summerTicks,`
- In `deserializeState`, after `state.goalProgress.winterTicks = save.winterTicks ?? 0;` add `state.goalProgress.summerTicks = save.summerTicks ?? 0;`

In `src/shared/types.ts`, in `SaveGame` after the `winterTicks?: number;` line add:

```ts
  /** Consecutive deficit-free summer ticks so far (absent in older saves → 0). */
  summerTicks?: number;
```

In `src/storage/serialization.ts`:

- In the JSON shape interface after `winterTicks?: number;` add `summerTicks?: number;`
- In `saveToJson` after the `winterTicks` spread add `...(save.summerTicks !== undefined ? { summerTicks: save.summerTicks } : {}),`
- In `saveFromJson` after the `winterTicks` spread add `...(typeof parsed.summerTicks === 'number' ? { summerTicks: parsed.summerTicks } : {}),`

- [x] **Step 5: Run the tests**

Run: `pnpm vitest run src/sim/goals.test.ts src/sim/state.test.ts src/storage/serialization.test.ts && pnpm typecheck`
Expected: PASS. If a goal-count assertion elsewhere (for example a test that expects a fixed number of goals, or the win-screen test) breaks because there is one more goal, update that count; do not remove the goal.

- [x] **Step 6: Commit**

```bash
pnpm format
git add src/sim/goals.ts src/sim/goals.test.ts src/sim/state.ts src/sim/state.test.ts src/shared/types.ts src/storage/serialization.ts src/storage/serialization.test.ts
git commit -m "feat(sim): heat-proof goal for a summer without undersupply

Counts deficit-free summer ticks like the winter goal and persists the
streak as an optional save field.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Energy panel row, strings, e2e and docs

**Files:**

- Modify: `src/ui/EnergyPanel.tsx` (total consumption line 36; rows around line 87)
- Modify: `src/ui/i18n.tsx` (EN: `energy.heating` line 54, `insulation.title` line 70, `help.seasons.body` line 127, goal strings after line 223; DE: `energy.heating` line 278, `insulation.title` line 294, `help.seasons.body` line 352, goal strings at the end of the DE block)
- Modify: `e2e/game.spec.ts` (season HUD test around line 205)
- Modify: `docs/idea.md` (line 89–90), `README.md` (lines 42–46)

**Interfaces:**

- Consumes: `EnergyStats.consumption.cooling` (Task 3), goal id `summerResilience` (Task 4).

- [x] **Step 1: Extend the e2e assertion**

In `e2e/game.spec.ts`, in the test `'the HUD shows the season and a fresh city starts in spring'`, directly after `await expect(page.getByTestId('energy-heating')).toBeVisible();` add:

```ts
await expect(page.getByTestId('energy-cooling')).toBeVisible();
```

(This test runs on the Mac or in CI; the sandbox has no WebGL. Do not wait on it here.)

- [x] **Step 2: Add the strings**

In `src/ui/i18n.tsx`, English block:

- After `'energy.heating': '🔥 Heating',` add `'energy.cooling': '❄️ Cooling',`
- Replace `'insulation.title': 'One-off upgrade: halves the electric heating load of every building',` with `'insulation.title': 'One-off upgrade: halves the electric heating and cooling load of every building',`
- Replace the value of `'help.seasons.body'` with:

```ts
    'A year has four seasons of five days each. Summer brings long days and strong sun; winter brings short days, weak PV, more cloud and wind, and cold. Every building heats electrically, so the heating load rises with the cold — the winter evening is the hardest hour of the year. In summer every building cools electrically, so the cooling load peaks in the late afternoon as PV fades. Snow that falls in winter melts into the river in spring. Building insulation is a one-off upgrade that halves the heating and cooling load.',
```

- After the `'goal.winterResilience.body'` entry add:

```ts
  'goal.summerResilience.title': 'Heat-proof',
  'goal.summerResilience.body':
    'Get through a whole summer without a single undersupplied tick (50+ residents).',
```

German block:

- After `'energy.heating': '🔥 Heizung',` add `'energy.cooling': '❄️ Kühlung',`
- Replace `'insulation.title': 'Einmaliges Upgrade: halbiert die elektrische Heizlast aller Gebäude',` with `'insulation.title': 'Einmaliges Upgrade: halbiert die elektrische Heiz- und Kühllast aller Gebäude',`
- Replace the value of `'help.seasons.body'` with:

```ts
    'Ein Jahr hat vier Jahreszeiten zu je fünf Tagen. Der Sommer bringt lange Tage und kräftige Sonne; der Winter kurze Tage, schwache PV, mehr Wolken und Wind — und Kälte. Alle Gebäude heizen elektrisch, die Heizlast steigt mit der Kälte: Der Winterabend ist die schwerste Stunde des Jahres. Im Sommer kühlen alle Gebäude elektrisch: Die Kühllast erreicht ihren Gipfel am späten Nachmittag, wenn die PV nachlässt. Schnee aus dem Winter schmilzt im Frühling in den Fluss. Die Gebäudedämmung ist ein einmaliges Upgrade, das Heiz- und Kühllast halbiert.',
```

- After the `'goal.winterResilience.body'` entry add:

```ts
  'goal.summerResilience.title': 'Hitzefest',
  'goal.summerResilience.body':
    'Überstehe einen ganzen Sommer ohne einen einzigen unterversorgten Tick (ab 50 Einwohnern).',
```

Also update `'help.seasons.title'` in both blocks: EN (line 126) from `'Seasons and heating'` to `'Seasons, heating and cooling'`, DE (line 350) from `'Jahreszeiten und Heizung'` to `'Jahreszeiten, Heizung und Kühlung'`.

- [x] **Step 3: Add the panel row**

In `src/ui/EnergyPanel.tsx`:

- Change the `totalConsumption` expression to:

```ts
const totalConsumption =
  energy.consumption.buildings +
  energy.consumption.charging +
  energy.consumption.heating +
  energy.consumption.cooling;
```

- Directly after the `energy-heating` row `</div>` add:

```tsx
<div className="energy-row" data-testid="energy-cooling">
  <span>{t('energy.cooling')}</span>
  <span>{formatEnergy(energy.consumption.cooling)}</span>
</div>
```

- [x] **Step 4: Update the docs**

In `docs/idea.md`, replace the bullet

```
- Every building heats electrically: a heating load that grows with the
  cold, halved by a one-off building insulation upgrade
```

with

```
- Every building heats and cools electrically: a heating load that grows
  with the cold and a cooling load that grows with summer heat, both
  halved by a one-off building insulation upgrade
```

In `README.md`, replace the Seasons bullet (lines 42–46) with:

```
- **Seasons**: a 20-day year. Summer means long days and PV surplus, but
  also an electric cooling load that peaks in the late afternoon as PV
  fades; winter means short days, weak sun, more cloud and wind, snow on
  the ground and a heating load that peaks on cold nights. Snowpack
  melts into the river in spring. A one-off building insulation upgrade
  halves both the heating and the cooling load.
```

- [x] **Step 5: Typecheck, lint, tests, smoke**

Run: `pnpm typecheck && pnpm lint && pnpm test && node scripts/smoke.mjs`
Expected: all PASS; the smoke boots the app headlessly.

- [x] **Step 6: Commit**

```bash
pnpm format
git add src/ui/EnergyPanel.tsx src/ui/i18n.tsx e2e/game.spec.ts docs/idea.md README.md
git commit -m "feat(ui): cooling row, heat-proof goal strings, help and docs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Balance probe and tuning

**Files:**

- Create (temporary, delete before the final commit): `src/sim/cooling.probe.test.ts`
- Modify: `src/shared/constants.ts` (`BALANCE.seasons.cooling` values only)

- [x] **Step 1: Write the probe**

```ts
import { it } from 'vitest';
import { TICKS_PER_DAY } from '../shared/constants.ts';
import { tileIndex } from '../shared/grid.ts';
import { PlantType, Zone } from '../shared/types.ts';
import { SimEngine } from './engine.ts';
import { daysPerYear } from './seasons.ts';
import { totalStorageCapacity } from './state.ts';

const SIZE = 48;
const at = (x: number, y: number) => tileIndex(x, y, SIZE);

function buildCity(engine: SimEngine, extras: PlantType[]): void {
  const road = Array.from({ length: 30 }, (_, x) => at(x + 8, 20));
  engine.applyCommand({ type: 'buildRoad', tiles: road });
  const res: number[] = [];
  const com: number[] = [];
  for (let x = 8; x < 38; x++) {
    res.push(at(x, 19), at(x, 18));
    com.push(at(x, 21));
  }
  engine.applyCommand({ type: 'paintZone', tiles: res, zone: Zone.Residential });
  engine.applyCommand({ type: 'paintZone', tiles: com, zone: Zone.Commercial });
  const plants = [
    PlantType.SolarFarm,
    PlantType.SolarFarm,
    PlantType.WindTurbine,
    PlantType.WindTurbine,
    PlantType.Battery,
    PlantType.BiogasPlant,
    ...extras,
  ];
  plants.forEach((plant, i) => {
    engine.applyCommand({ type: 'placePlant', tile: at(10 + i * 2, 23), plant });
  });
  engine.applyCommand({ type: 'buildPowerLine', tiles: [at(10, 22), ...road] });
  engine.state.money = 1_000_000;
}

interface Acc {
  ticks: number;
  deficit: number;
  heatPeak: number;
  heatPeakHour: number;
  coolPeak: number;
  coolPeakHour: number;
  heat: number;
  cool: number;
  load: number;
  socMin: number;
}

function run(label: string, extras: PlantType[], insulation: boolean): void {
  const engine = new SimEngine(4242, SIZE);
  buildCity(engine, extras);
  engine.state.insulation = insulation;
  const perSeason = new Map<string, Acc>();
  const days = 2 * daysPerYear();
  for (let t = 0; t < days * TICKS_PER_DAY; t++) {
    engine.tick();
    const s = engine.state;
    const e = s.lastEnergy;
    const key = `${s.season.year}-${s.season.season}`;
    const acc = perSeason.get(key) ?? {
      ticks: 0,
      deficit: 0,
      heatPeak: 0,
      heatPeakHour: 0,
      coolPeak: 0,
      coolPeakHour: 0,
      heat: 0,
      cool: 0,
      load: 0,
      socMin: 1,
    };
    const hour = ((s.tick % TICKS_PER_DAY) / TICKS_PER_DAY) * 24;
    acc.ticks++;
    if (e.deficit > 0) acc.deficit++;
    if (e.heatingConsumption > acc.heatPeak) {
      acc.heatPeak = e.heatingConsumption;
      acc.heatPeakHour = hour;
    }
    if (e.coolingConsumption > acc.coolPeak) {
      acc.coolPeak = e.coolingConsumption;
      acc.coolPeakHour = hour;
    }
    acc.heat += e.heatingConsumption;
    acc.cool += e.coolingConsumption;
    acc.load +=
      e.buildingConsumption + e.chargingConsumption + e.heatingConsumption + e.coolingConsumption;
    const capacity = totalStorageCapacity(s);
    if (capacity > 0) acc.socMin = Math.min(acc.socMin, s.storedEnergy / capacity);
    perSeason.set(key, acc);
  }
  console.log(`\n== ${label}`);
  for (const [key, a] of perSeason) {
    console.log(
      key.padEnd(10),
      `deficit ${((a.deficit / a.ticks) * 100).toFixed(1)}%`,
      `heatPeak ${a.heatPeak.toFixed(1)}@${a.heatPeakHour.toFixed(1)}h`,
      `coolPeak ${a.coolPeak.toFixed(1)}@${a.coolPeakHour.toFixed(1)}h`,
      `heat ${((a.heat / Math.max(1, a.load)) * 100).toFixed(0)}%`,
      `cool ${((a.cool / Math.max(1, a.load)) * 100).toFixed(0)}% of load`,
      `socMin ${(a.socMin * 100).toFixed(0)}%`,
    );
  }
}

it('probe', () => {
  run('baseline', [], false);
  run('insulation', [], true);
  run('insulation + battery', [PlantType.Battery], true);
}, 600_000);
```

- [x] **Step 2: Run it**

Run: `pnpm vitest run src/sim/cooling.probe.test.ts --reporter=basic`

Read the table. Targets from the spec:

- Summer `coolPeak` is roughly half of winter `heatPeak` (0.4–0.6×) in the baseline run.
- Summer `coolPeakHour` lies in the late afternoon (about 15–18 h), after the PV peak.
- Summer cooling share of load is clearly non-zero (roughly 15–30 %); spring and autumn cooling share is near 0; winter is 0.
- Summer deficit share rises versus the pre-feature level but stays well below the winter deficit share. Compare against the numbers in the commit "balance: size the heating load from a two-year probe" (summer 4.1 %, winter 20.9 % averaged over seeds; seed 4242 alone is what this probe prints).
- Insulation halves the summer cooling peak.

- [x] **Step 3: Tune**

Adjust only `BALANCE.seasons.cooling` (`weightByZone`, `coolingRange`, `comfortTemperature`) until the targets hold. Re-run the probe after each change. Re-run `pnpm test` afterwards; the cooling tests read the constants and adapt.

- [x] **Step 4: Delete the probe, commit the tuning**

```bash
rm src/sim/cooling.probe.test.ts
pnpm format && pnpm test
git add src/shared/constants.ts
git commit -m "balance: size the cooling load from a two-year probe

<paste the measured per-season cooling and heating peaks, peak hours,
load shares and deficit shares before/after and the values changed, in
the style of 'balance: size the heating load from a two-year probe'>

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

If no value needed to change, still delete the probe and skip the commit; record the measured numbers in the plan's final summary instead.

---

### Task 7: Coverage, plan checkboxes, final summary

**Files:**

- Modify: `docs/superpowers/plans/2026-09-23-cooling-load.md` (tick the boxes)

- [x] **Step 1: Coverage gate**

Run: `pnpm coverage`
Expected: PASS with ≥ 90 % on `src/sim` and `src/shared`. If a new branch is uncovered (for example `weightByZone[zone] ?? 0` for an unknown zone), add a one-line unit test in `energy.test.ts` rather than lowering the gate.

- [x] **Step 2: Tick the plan and commit**

```bash
pnpm format
git add docs/superpowers/plans/2026-09-23-cooling-load.md
git commit -m "docs: mark the cooling load plan done

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [x] **Step 3: Summary for the user**

Report: what was built, the probe numbers (summer cooling peak vs. winter heating peak, peak hour, deficit shares), which balance values changed, and that the e2e assertion needs a run on the Mac or CI.
