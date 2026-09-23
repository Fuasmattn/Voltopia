# Playing Voltopia with an agent

Voltopia exposes its game actions as **WebMCP tools** so an AI agent (or
any script) can play without pixel-hunting. The same tools are available
in every browser on `window.voltopia`.

## Connecting

**WebMCP (Chrome ≥ 146 with the WebMCP early preview / origin trial).**
The app registers its tools with `document.modelContext` on boot
(falling back to the deprecated `navigator.modelContext`). Any WebMCP
client — Gemini in Chrome, the DevTools _WebMCP_ panel, or
[chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp)
— lists them via `getTools()` and runs them via `executeTool()`. Results
are MCP-style `{ content: [{ type: 'text', text: '<JSON>' }] }`.

**Without WebMCP.** Every tool is on `window.voltopia`:

```js
const { tools, call } = window.voltopia;
tools.map((t) => t.name); // discovery
await call('get_game_overview'); // plain JSON result
await call('build_road', { from: { x: 10, y: 10 }, to: { x: 20, y: 10 } });
```

Playwright, Puppeteer or a DevTools MCP `evaluate_script` can drive the
game this way (see the e2e test "agent tools drive the game").

## Conventions

- Coordinates are `{ x, y }`, 0-based; `x` grows east, `y` grows south.
- Zones: `residential`, `commercial`, `retail`. Plants: `solar`, `wind`,
  `battery`, `biogas`, `charging_hub`, `park`, `run_of_river`,
  `pumped_storage`.
- Write tools resolve to `{ ok: true, ... }` or
  `{ ok: false, error: '<code>', message: '<English text>' }`. The codes
  are the simulation's own rejection codes (`notEnoughMoney`,
  `tileOccupied`, `needsRiverTile`, `needsLakeShore`, `cannotBuildOnWater`,
  `needsLineSite`, `alreadyInsulated`, `nothingToUndo`) plus
  `invalidInput` and `unknownTool`.
- Bad input never throws; it comes back as `invalidInput`.

## Tools

| Tool                 | Kind  | Purpose                                                                                                                                                                          |
| -------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_game_overview`  | read  | Funds, population, jobs, happiness, demand, clock, season, weather, energy summary, budget, goals, counts                                                                        |
| `get_build_catalog`  | read  | Static rules: costs, upkeep, plant roles and placement, supply radius                                                                                                            |
| `get_energy_report`  | read  | Full energy stats incl. the last day's history                                                                                                                                   |
| `get_map`            | read  | ASCII map (whole grid or a window) — layers `overview`, `terrain`, `supply`, `density`, `power`                                                                                  |
| `inspect_tile`       | read  | Every field of one tile plus live figures and growth blockers                                                                                                                    |
| `find_tiles`         | read  | Tiles by kind (`empty_land`, `river`, `lake_shore`, `road`, `power_line`, `plant`, `zoned_empty`, `building`, `not_connected_building`, `undersupplied_building`), nearest-first |
| `get_lifetime_stats` | read  | One sample per in-game day                                                                                                                                                       |
| `build_road`         | write | L-shaped path `from`→`to` (horizontal leg first) or explicit `tiles`                                                                                                             |
| `build_power_line`   | write | Same shape as `build_road`                                                                                                                                                       |
| `paint_zone`         | write | Rectangle `from`→`to` with `zone`                                                                                                                                                |
| `place_plant`        | write | `plant` at `x`, `y`                                                                                                                                                              |
| `bulldoze`           | write | Rectangle `from`→`to`                                                                                                                                                            |
| `undo`               | write | Revert and refund the last build action                                                                                                                                          |
| `set_speed`          | write | 0 (pause), 1, 3                                                                                                                                                                  |
| `set_tax_rate`       | write | 0 … 0.3                                                                                                                                                                          |
| `set_smart_charging` | write | `enabled: boolean`                                                                                                                                                               |
| `buy_insulation`     | write | One-off heating upgrade                                                                                                                                                          |
| `advance_time`       | write | Run `ticks` or `days` (max 3 days), then return a summary; fast-forwards a paused game and restores the speed                                                                    |
| `save_game`          | write | Write the autosave now                                                                                                                                                           |
| `start_new_city`     | write | New city (`size` 48/64/96, `difficulty`, `seed`); reloads the page                                                                                                               |

A typical loop: `get_build_catalog` once, then repeat `get_game_overview`
→ `get_map` / `find_tiles` → build → `advance_time` → check
`inspect_tile` on anything that is not growing.

## How it works

- `src/agent/tools.ts` defines the tools over an `AgentContext` (stats,
  a main-thread tile mirror, promise-based commands). It has no DOM
  dependency and is unit-tested against a headless `SimEngine`.
- `src/agent/tileMirror.ts` rebuilds the tile layers from the diffs the
  worker already streams to the renderer.
- `src/agent/webmcp.ts` registers with `modelContext` and installs
  `window.voltopia`.
- Commands carry a `requestId`; the worker answers with a
  `commandResult` event so tools can await the outcome even while the
  game is paused.
