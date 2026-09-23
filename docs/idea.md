# Project: Voltopia – a modern, simplified city builder for the browser

## Goal

Build a city-building game as a web app, inspired by the classics of the genre
but deliberately its own thing: streamlined, approachable, with a modern
low-poly 3D look (in the spirit of Townscaper / Islanders / Mini Motorways).
The city runs exclusively on renewable energy, and all vehicles are electric.
Balancing fluctuating generation against consumption is a core game mechanic.
Do not use trademarks, assets, or code from existing games.

## Design Principles

- Few, clear key metrics: money, population, happiness, energy balance
- Feedback directly in the world (icons above buildings, toggleable color
  overlays, lighting) instead of statistics dashboards
- Organic growth: buildings appear and densify visibly over time
- Minimal micromanagement, quick to understand, satisfying building interactions
- The energy transition as a playful challenge, not a lecture

## Tech Stack

- React, Vite, TypeScript (strict), pnpm
- three.js with an orthographic camera (isometric perspective, rotatable in
  90° steps, zoomable, pannable)
- Simulation in a Web Worker, rendering on the main thread
- Vitest for unit tests of the simulation, code coverage over 90%
- Playwright for end-to-end tests of the UI
- Persistence via IndexedDB, app playable offline as a PWA, should be extensible
  to other storage backends
- use React v19 best practices

## Architecture

- Strict separation: `sim/` (pure logic, no DOM/three.js dependencies),
  `render/`, `ui/`, `shared/` (types, message protocol)
- Simulation state stored in typed arrays per layer (tile type, zone, density,
  supply, happiness …) on a grid (initially 64×64, configurable)
- Fixed simulation tick (e.g. 4/s) with speed settings (pause, 1×, 3×)
- Deterministic: seeded RNG (including weather) so save games and tests are
  reproducible
- Worker ↔ main thread communication via typed messages; the worker sends only
  diffs of changed tiles plus global values (time of day, weather, energy
  balance), never the full state
- Rendering with InstancedMesh (buildings, vehicles) so large cities stay smooth

## MVP Scope

1. Terrain: flat grid with a subtle grid overlay while building
2. Roads: drawn by dragging, automatic intersections/curves/dead ends
3. Zones: residential, commercial (jobs), and retail painted by dragging (only
   grow next to roads)
4. Growth: demand model (residential needs jobs, jobs need residents, retail
   needs both); buildings grow through 3 density levels, procedurally generated
   from low-poly shapes with slight variation
5. Energy: renewable generation, storage, and energy balance (see section
   "Energy & Mobility")
6. E-mobility: visible electric vehicles, charging load, charging hubs (see
   section "Energy & Mobility")
7. Economy: starting funds, construction costs, tax income per tick, upkeep
   (including plant operating costs), a tax slider
8. Tools: bulldozer, undo for the last action
9. Overlays: supply and demand as toggleable color maps
10. HUD: money, population, happiness, demand bars (R/C/R), time/weather,
    energy panel, game speed
11. Save/load via IndexedDB, autosave

## Energy & Mobility

The city is powered exclusively by renewable energy. There are no fossil-fuel
power plants. The challenge is keeping fluctuating generation and consumption
in balance.

### Day/Night & Weather

- Day-night cycle (one in-game day ≈ a few minutes real time) with visible
  lighting: sun position, dusk, lit windows and streets at night
- Simple weather system: cloud cover (affects PV) and wind speed (affects wind
  power), varying smoothly, shown in the HUD

### Seasons

- A year of 20 in-game days, four seasons of five days; the season is a
  deterministic function of the day (added after the MVP; see the
  seasons spec)
- Temperature, day length, sun strength and weather-front biases follow
  the year; sub-zero precipitation builds a snowpack that melts into the
  river in spring
- Every building heats electrically: a heating load that grows with the
  cold, halved by a one-off building insulation upgrade

### Generation & Storage

- Solar farm (ground-mounted PV): output depends on sun position and cloud cover
- Wind turbine: output depends on wind speed, visibly spinning rotors (speed
  proportional to output)
- Battery storage: charges on surplus, discharges on deficit, state of charge
  (SoC) visible on the building
- Biogas plant: expensive to run but dispatchable – a backup for periods of
  low wind and no sun ("Dunkelflaute")
- Optional later: rooftop PV that grows automatically with increasing density

### Grid & Balance

- Connection via power lines: a bitmask layer over roads and water, a small
  connection radius around energised tiles and plants, one global balance
  (added after the MVP; see the power-lines spec)
- Global energy balance per tick: generation vs. consumption
- Surplus: charge storage first, then curtail (curtailed energy is displayed)
- Deficit: discharge storage, then biogas, then undersupply – affected buildings
  flicker/go dark, happiness drops, growth stops
- Load profile per zone: residential in the morning/evening, commercial during
  the day, retail from daytime into the evening

### E-Mobility

- All vehicles are electric
- In the MVP, vehicles are visual: low-poly cars drive along road tiles using a
  simple random walk (no pathfinding), count scales with population and jobs,
  headlights on at night
- Charging creates consumption: a pronounced evening charging peak in
  residential areas
- Buildable charging hubs at workplaces shift charging load into the daytime
  (matching PV generation)
- "Smart Charging" upgrade: charging load automatically follows generation
  surplus

### HUD & Overlays

- Energy panel: current generation per source, consumption, storage SoC,
  surplus/deficit, mini history graph of the last 24 in-game hours
- "Supply" overlay: supplied / undersupplied / not connected
- Use technically correct energy terminology in code and UI (e.g. generation,
  consumption, state of charge, curtailment, peak load)

## Visual Style

- Reduced, harmonious color palette, soft shadows, gentle lighting
- Day-night lighting as a key stylistic element: warm window lights, streetlamps,
  vehicle headlights
- Short animations when building and growing (fade-in/scale)
- Clean, modern UI with highly readable typography

## Out of Scope for the MVP

Real pathfinding/traffic simulation, water, police/fire services, disasters,
terrain elevation, sound, multiplayer, electricity market/import/
export. Design the architecture so that additional layers, building types,
and energy sources can easily be added later.

## Way of Working

- Start with a short architecture and implementation plan and wait for my
  approval
- Then work in small milestones, each runnable at the end:
  M1 Project setup + grid + camera
  M2 Road building
  M3 Zones + worker simulation + growth
  M4 Day/night + weather + lighting
  M5 Generation, storage, energy balance + economy + HUD
  M6 Electric vehicles + charging load + charging hubs
  M7 Overlays + save/load + PWA
- Cover the simulation with unit tests (demand, growth, grid connectivity,
  energy balance, storage logic, money)
- Code and comments in English, descriptive names, no magic numbers (balancing
  values centralized in a config file)
- After each milestone: a short summary of what's done and what comes next
