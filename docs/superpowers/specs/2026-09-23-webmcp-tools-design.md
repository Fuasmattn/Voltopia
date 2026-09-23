# WebMCP tools — design

Goal: let agents (browser-side LLM agents via WebMCP, or Playwright/DevTools
driven scripts) play Voltopia through structured tools instead of pixels.

## API surface

Tools are registered with `document.modelContext.registerTool(tool, { signal })`
(the current WebMCP draft; Chrome ≥146 early preview, `navigator.modelContext`
as deprecated fallback). Every tool returns MCP-style
`{ content: [{ type: 'text', text: <JSON> }] }` so both the Chrome
implementation and the `@mcp-b/global` polyfill accept it. When no
`modelContext` exists the tools are still exposed on `window.voltopia`
(`{ tools, call(name, input) }`) so scripted agents and e2e tests can use
them in any Chromium.

Read tools (`readOnlyHint: true`):

| tool                 | purpose                                                    |
| -------------------- | ---------------------------------------------------------- |
| `get_game_overview`  | money, population, jobs, happiness, demand, clock, season, |
|                      | weather, energy summary, tax, upgrades, goals, tile counts |
| `get_build_catalog`  | static rules: costs, upkeep, plant roles, placement rules  |
| `get_energy_report`  | full `EnergyStats` incl. the last day's history            |
| `get_map`            | ASCII map (whole grid or a window) for one layer           |
| `inspect_tile`       | every field of one tile                                    |
| `find_tiles`         | coordinates matching a predicate (river, lake shore, …)    |
| `get_lifetime_stats` | one sample per in-game day                                 |

Write tools:

| tool                 | command                                                   |
| -------------------- | --------------------------------------------------------- |
| `build_road`         | `buildRoad` along an L-path from→to (or explicit tiles)   |
| `build_power_line`   | `buildPowerLine`, same shape                              |
| `paint_zone`         | `paintZone` over a rectangle                              |
| `place_plant`        | `placePlant`                                              |
| `bulldoze`           | `bulldoze` over a rectangle                               |
| `undo`               | `undo`                                                    |
| `set_speed`          | `setSpeed` (0 / 1 / 3)                                    |
| `set_tax_rate`       | `setTaxRate`                                              |
| `set_smart_charging` | `setSmartCharging`                                        |
| `buy_insulation`     | `buyInsulation`                                           |
| `advance_time`       | runs the sim for N ticks/days (max 3 days), then resolves |
| `save_game`          | `requestSave` → autosave storage                          |
| `start_new_city`     | new city via the pending-new-game reload (consequential)  |

Coordinates are `{ x, y }` (0-based, y down), names of zones and plants are
lower-case words (`residential`, `solar`, `pumped_storage`, …). Write tools
resolve to `{ ok: true, ... }` or `{ ok: false, error: <rejection code>,
message }` using the sim's existing rejection codes.

## Architecture

- `src/agent/` (new): pure TypeScript, no DOM except `webmcp.ts`.
  - `tileMirror.ts` — main-thread copy of the tile layers built from the
    diffs the worker already sends (the first tick carries the full grid).
  - `tools.ts` — `createAgentTools(ctx)` builds the tool list from an
    `AgentContext` (`getStats`, `tiles`, `sendCommand`, `waitForTick`,
    `requestLifetime`, `startNewCity`). Unit-tested against a headless
    `SimEngine`-backed context.
  - `webmcp.ts` — registers the tools with `modelContext` and installs
    `window.voltopia`.
- Protocol: `SimCommand` gets an optional `requestId`; the worker answers
  with `{ type: 'commandResult', requestId, rejected? }` after applying (and
  flushing) the command, so a tool can await the outcome even while paused.
- `useSimBridge` grows `onTick`, `onCommandResult` and `getStats`; the new
  `useAgentTools` hook wires the bridge into an `AgentContext`.

## Testing

- Vitest: tile mirror, every tool against a real engine (build, reject,
  inspect, map, find, advance).
- Playwright: `window.voltopia.call('build_road', …)` changes the money HUD,
  `get_map` reflects it.
