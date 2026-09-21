# Voltopia Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan milestone-by-milestone. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** A browser city-builder with renewable-energy balancing as the core mechanic, per `docs/idea.md`.

**Architecture:** Deterministic fixed-tick simulation (4 ticks/s) running in a Web Worker over typed-array grid layers; the worker emits tile diffs + global stats to the main thread. Rendering with three.js (orthographic isometric camera, InstancedMesh everywhere); React 19 UI for HUD/tools; IndexedDB persistence behind a storage interface; PWA for offline play.

**Tech Stack:** React 19, Vite, TypeScript (strict), pnpm, three.js, Vitest (+ v8 coverage), Playwright, vite-plugin-pwa.

**Spec:** `docs/idea.md`

## Global Constraints

- TypeScript `strict: true`; pnpm as package manager
- `src/sim/` is pure logic: no DOM, no three.js imports (enforced by convention + tests run in node env)
- Simulation deterministic: all randomness via seeded RNG (`mulberry32`), including weather
- Worker → main messages carry only diffs of changed tiles + global values, never full state (exception: initial load/save snapshots)
- Grid 64×64 default, size configurable in one constant
- Fixed tick 4/s; speeds pause / 1× / 3×
- Vitest coverage of `src/sim/` ≥ 90%
- Correct energy terminology in code & UI (generation, consumption, state of charge, curtailment, peak load)
- No trademarks/assets/code from existing games

## Module Layout

```
src/
  shared/        # types, constants, message protocol, seeded RNG
    constants.ts   # grid size, tick rate, costs, tuning tables
    grid.ts        # index<->xy helpers, direction masks
    messages.ts    # SimCommand / SimEvent discriminated unions
    rng.ts         # mulberry32 + helpers
    types.ts       # TileType, Zone, ToolId, GlobalStats, Weather, ...
  sim/           # pure simulation (worker-side), no DOM/three
    state.ts       # SimState: typed-array layers + serialization
    roads.ts       # road placement, bitmask auto-tiling
    zones.ts       # zone painting, road adjacency
    growth.ts      # demand model, building spawn/densify/decay
    economy.ts     # taxes, upkeep, construction costs
    energy.ts      # generation (PV/wind/biogas), battery, balance, supply radius
    weather.ts     # smooth seeded cloud cover + wind speed, day/night clock
    vehicles.ts    # random-walk EVs on road graph, charging load
    happiness.ts   # happiness from supply/taxes
    tick.ts        # orchestrates one tick, produces diffs
    worker.ts      # worker entry: command handling, tick scheduling, diff posting
  render/        # three.js, main thread
    scene.ts       # scene, lights, day/night lighting
    camera.ts      # ortho isometric camera: rotate 90°, zoom, pan
    terrain.ts     # ground plane + grid overlay
    roadsMesh.ts   # instanced road tiles (variant by bitmask)
    buildingsMesh.ts # instanced procedural low-poly buildings
    plantsMesh.ts  # solar/wind/battery/biogas/charging hub meshes (wind rotors spin)
    vehiclesMesh.ts# instanced cars + headlights
    overlays.ts    # supply/demand color overlays
    picking.ts     # pointer -> tile raycasting
    renderer.ts    # ties it together, applies diffs
  ui/            # React
    App.tsx, HUD.tsx, Toolbar.tsx, EnergyPanel.tsx, SpeedControls.tsx,
    DemandBars.tsx, TaxSlider.tsx, useSimBridge.ts (worker hook)
  storage/
    storage.ts     # SaveStorage interface
    indexeddb.ts   # IndexedDB impl, autosave
  main.tsx
tests/ (vitest colocated as *.test.ts under src/sim, src/shared)
e2e/   (playwright)
```

## Core Interfaces (stable across milestones)

```ts
// shared/messages.ts
type SimCommand =
  | { type: 'init'; seed: number; size: number; saved?: SaveGame }
  | { type: 'setSpeed'; speed: 0 | 1 | 3 }
  | { type: 'buildRoad'; tiles: number[] }
  | { type: 'paintZone'; tiles: number[]; zone: Zone }
  | { type: 'placeBuilding'; tile: number; building: PlantType }
  | { type: 'bulldoze'; tiles: number[] }
  | { type: 'undo' }
  | { type: 'setTaxRate'; rate: number }
  | { type: 'requestSave' };

type SimEvent =
  | { type: 'ready' }
  | { type: 'tick'; diffs: TileDiff[]; stats: GlobalStats; vehicles: VehicleState[] }
  | { type: 'saveData'; save: SaveGame }
  | { type: 'rejected'; reason: string }; // e.g. not enough money

interface GlobalStats {
  tick: number;
  money: number;
  population: number;
  jobs: number;
  happiness: number; // 0..1
  demand: { residential: number; commercial: number; retail: number }; // -1..1
  timeOfDay: number; // 0..1 (0 = midnight)
  weather: { cloudCover: number; windSpeed: number }; // 0..1
  energy: {
    generation: { solar: number; wind: number; biogas: number };
    consumption: { buildings: number; charging: number };
    batterySoC: number;
    batteryCapacity: number;
    curtailment: number;
    deficit: number; // MW-ish abstract units
    history: EnergyHistoryPoint[]; // last 24 in-game hours, ring buffer
  };
  taxRate: number;
}
```

Layers in `SimState` (all `Uint8Array`/`Float32Array` of length size²): `tileType` (empty/road/plant), `roadMask` (4-bit N/E/S/W), `zone`, `density` (0–3), `buildingVariant`, `supplied` (0/1/2 = unpowered/partial/full), `happiness`, `plantType`.

---

## Milestones

Milestone numbering follows `docs/idea.md` (Way of Working). Each milestone ends runnable (`pnpm dev`), tested (`pnpm test`), committed, and is followed by a short summary of what's done and what comes next.

### M1 — Project setup + grid + camera

- [x] Scaffold Vite + React 19 + TS strict + pnpm; add three.js, vitest, coverage
- [x] `shared/`: constants/balancing config, grid helpers, RNG, message protocol (tests: rng determinism, grid math)
- [x] `sim/state.ts` + `sim/worker.ts`: init, fixed 4/s tick with speed 0/1/3, posts tick events (tests: tick advance, speed changes, determinism)
- [x] `render/`: scene, terrain plane with grid overlay, ortho isometric camera with 90° rotation / zoom / pan; picking returns hovered tile
- [x] `ui/`: App shell, speed controls; `useSimBridge` worker hook
- [x] Deliverable: empty grid, camera navigation, running tick counter. Commit.

### M2 — Road building

- [x] `sim/roads.ts`: place road tiles, recompute 4-neighbor bitmask; cost per tile deducted; reject if broke (tests: bitmask for straights/curves/T/cross/dead-end, cost, rejection)
- [x] Drag-to-draw road lines (L-shaped preview), `render/roadsMesh.ts` instanced variants from bitmask
- [x] Undo for last build action (history in worker, tests); bulldozer for roads
- [x] Deliverable: draw roads with auto intersections. Commit + summary.

### M3 — Zones + worker simulation + growth

- [x] `sim/zones.ts`: paint residential/commercial/retail on empty tiles (tests)
- [x] `sim/growth.ts`: demand model (res needs jobs, jobs need residents, retail needs both), building spawn only on zoned + road-adjacent tiles, 3 density levels, seeded variation; population/jobs derived per density (tests: demand math, growth conditions, determinism)
- [x] `render/buildingsMesh.ts`: procedural low-poly buildings (box compositions per zone/density/variant), scale-in animation
- [x] Demand bars + population in HUD. Deliverable: paint zones, city grows. Commit + summary.

### M4 — Day/night + weather + lighting

- [x] `sim/weather.ts`: day/night clock (1 in-game day ≈ 4 min real time), smooth seeded cloud cover & wind speed (tests: bounds, smoothness, determinism)
- [x] `render/`: sun position/dusk lighting, warm window lights and streetlamps at night
- [x] HUD: time-of-day + weather display. Commit + summary.

### M5 — Generation, storage, energy balance + economy + HUD

- [x] `sim/energy.ts`: plants placeable (solar farm, wind turbine, battery, biogas); generation = f(sun, clouds) / f(wind); load profiles per zone by time of day; balance order: surplus → charge battery → curtail; deficit → discharge battery → biogas → undersupply; supply-radius connection; undersupplied buildings flagged, flicker/dark, happiness drops, growth stops (tests: balance matrix, SoC limits, curtailment accounting, radius)
- [x] `sim/economy.ts`: starting funds, construction costs, per-tick tax income, upkeep incl. plant operating costs, tax slider affects happiness (tests)
- [x] `render/`: plant meshes, wind rotors spinning ∝ output, battery SoC indicator
- [x] `ui/EnergyPanel.tsx`: per-source generation, consumption, SoC, surplus/deficit/curtailment, 24h mini history graph; HUD money/happiness; TaxSlider. Commit + summary.

### M6 — Electric vehicles + charging load + charging hubs

- [x] `sim/vehicles.ts`: EV count scales with population+jobs; random walk along road tiles (tests: stay on roads, count scaling, determinism); evening charging peak in residential; charging hubs shift load to daytime; smart-charging upgrade follows generation surplus (tests: load shapes)
- [x] `render/vehiclesMesh.ts`: instanced low-poly cars, smooth interpolation, headlights at night
- [x] Charging hub buildable; smart-charging toggle in UI. Commit + summary.

### M7 — Overlays + save/load + PWA

- [x] Supply overlay (supplied/undersupplied/not connected) + demand overlay; overlay toggle UI
- [x] `storage/`: `SaveStorage` interface; IndexedDB impl; serialize SimState (typed arrays → ArrayBuffers); autosave every 30s; load on boot; new-game button (tests: round-trip serialization)
- [x] PWA via vite-plugin-pwa (offline playable)
- [x] Playwright e2e: boot, draw road, paint zone, building appears, save/reload persists
- [x] Coverage check ≥90% on `src/sim`. Final commit + summary.

## Testing Strategy

- Sim is pure & deterministic → unit tests drive everything: same seed ⇒ identical state hashes after N ticks
- Worker tested by importing its handler functions directly (no real Worker in vitest)
- Render layer: smoke-tested via Playwright (canvas exists, no console errors) — not unit tested
- e2e uses `data-testid` on HUD values to assert sim progress through the real worker
