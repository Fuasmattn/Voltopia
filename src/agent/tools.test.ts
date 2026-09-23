import { describe, expect, it } from 'vitest';
import { BALANCE, TICKS_PER_DAY } from '../shared/constants.ts';
import { tileIndex } from '../shared/grid.ts';
import type { SimCommand, SimEvent } from '../shared/messages.ts';
import { PlantType, Terrain, TileType, Zone, type GlobalStats } from '../shared/types.ts';
import { SimEngine } from '../sim/engine.ts';
import { TileMirror } from './tileMirror.ts';
import {
  callTool,
  createAgentTools,
  MAX_ADVANCE_DAYS,
  type AgentContext,
  type AgentTool,
  type NewCityOptions,
} from './tools.ts';

const SIZE = 24;

/** Drives the tools against an in-process engine, mimicking the worker. */
function createHarness(seed = 11): {
  ctx: AgentContext;
  tools: AgentTool[];
  engine: SimEngine;
  newCities: NewCityOptions[];
  call: (name: string, input?: unknown) => Promise<Record<string, unknown>>;
} {
  const engine = new SimEngine(seed, SIZE);
  engine.applyCommand({ type: 'init', seed, size: SIZE });
  const tiles = new TileMirror(SIZE);
  let stats: GlobalStats | null = null;
  const absorb = (event: SimEvent | null): void => {
    if (!event || event.type !== 'tick') return;
    tiles.applyDiffs(event.diffs);
    stats = event.stats;
  };
  absorb(engine.tick());
  const newCities: NewCityOptions[] = [];
  const ctx: AgentContext = {
    tiles,
    getStats: () => stats,
    async sendCommand(command: SimCommand) {
      const events = engine.applyCommand(command);
      absorb(command.type === 'inspectTile' ? engine.snapshot() : engine.flush());
      const rejected = events.find((e) => e.type === 'rejected');
      return rejected && rejected.type === 'rejected' ? { rejected: rejected.reason } : {};
    },
    async waitForTick(target, signal) {
      while ((stats?.tick ?? 0) < target) {
        if (signal?.aborted) throw new Error('aborted');
        absorb(engine.tick());
      }
      return stats!;
    },
    async requestLifetime() {
      const [event] = engine.applyCommand({ type: 'requestLifetime' });
      return event && event.type === 'lifetimeData' ? event.samples : [];
    },
    startNewCity(options) {
      newCities.push(options);
    },
  };
  const tools = createAgentTools(ctx);
  return {
    ctx,
    tools,
    engine,
    newCities,
    call: (name, input = {}) => callTool(tools, name, input) as Promise<Record<string, unknown>>,
  };
}

function findLand(engine: SimEngine, minX = 2): { x: number; y: number } {
  const { terrain } = engine.state.layers;
  for (let y = 2; y < SIZE - 2; y++) {
    for (let x = minX; x < SIZE - 2; x++) {
      // A 6x3 all-land block gives room for road + zone tests.
      let ok = true;
      for (let dy = 0; dy < 3 && ok; dy++) {
        for (let dx = 0; dx < 6; dx++) {
          if (terrain[tileIndex(x + dx, y + dy, SIZE)] !== Terrain.Land) {
            ok = false;
            break;
          }
        }
      }
      if (ok) return { x, y };
    }
  }
  throw new Error('no land block');
}

describe('agent tools: reading', () => {
  it('lists every tool with a schema and description', () => {
    const { tools } = createHarness();
    const names = tools.map((t) => t.name);
    expect(names).toEqual([
      'get_game_overview',
      'get_build_catalog',
      'get_energy_report',
      'get_map',
      'inspect_tile',
      'find_tiles',
      'get_lifetime_stats',
      'build_road',
      'build_power_line',
      'paint_zone',
      'place_plant',
      'bulldoze',
      'undo',
      'set_speed',
      'set_tax_rate',
      'set_smart_charging',
      'buy_insulation',
      'advance_time',
      'save_game',
      'start_new_city',
    ]);
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.inputSchema.type).toBe('object');
    }
    const readOnly = tools.filter((t) => t.annotations?.readOnlyHint).map((t) => t.name);
    expect(readOnly).toHaveLength(7);
  });

  it('get_game_overview reports funds, clock, goals and counts', async () => {
    const { call } = createHarness();
    const overview = await call('get_game_overview');
    expect(overview.gridSize).toBe(SIZE);
    expect(overview.money).toBe(BALANCE.startingMoney);
    expect(overview.population).toBe(0);
    expect(overview.speed).toBe(1);
    expect(overview.taxRate).toBe(BALANCE.tax.defaultRate);
    const goals = overview.goals as Array<{ id: string; title: string; achieved: boolean }>;
    expect(goals.length).toBeGreaterThan(5);
    expect(goals.every((g) => g.title.length > 0 && g.achieved === false)).toBe(true);
    expect((overview.season as { season: string }).season).toBe('spring');
  });

  it('get_build_catalog lists costs and plant placement rules', async () => {
    const { call } = createHarness();
    const catalog = await call('get_build_catalog');
    expect((catalog.costs as { roadPerTile: number }).roadPerTile).toBe(BALANCE.costs.roadPerTile);
    const plants = catalog.plants as Array<{ name: string; cost: number; placement: string }>;
    expect(plants.map((p) => p.name)).toContain('pumped_storage');
    const solar = plants.find((p) => p.name === 'solar')!;
    expect(solar.cost).toBe(BALANCE.costs.plant[PlantType.SolarFarm]);
    expect(plants.find((p) => p.name === 'run_of_river')!.placement).toContain('river');
  });

  it('get_energy_report exposes the energy stats', async () => {
    const { call } = createHarness();
    const report = await call('get_energy_report');
    expect(report.generation).toBeDefined();
    expect(report.consumption).toBeDefined();
    expect(Array.isArray(report.history)).toBe(true);
  });

  it('get_map renders the whole grid and windows of it', async () => {
    const { call, engine } = createHarness();
    const full = await call('get_map');
    const rows = full.rows as string[];
    expect(rows).toHaveLength(SIZE);
    expect(rows.every((row) => row.length === SIZE)).toBe(true);
    expect(full.legend).toContain('river');
    // The terrain layer matches the engine's terrain.
    const terrain = await call('get_map', { layer: 'terrain' });
    const terrainRows = terrain.rows as string[];
    for (let i = 0; i < SIZE * SIZE; i++) {
      const glyph = terrainRows[Math.floor(i / SIZE)][i % SIZE];
      const t = engine.state.layers.terrain[i];
      expect(glyph).toBe(t === Terrain.River ? '~' : t === Terrain.Lake ? '#' : '.');
    }
    const window = await call('get_map', { origin: { x: 20, y: 21 }, width: 10, height: 10 });
    expect(window.width).toBe(4);
    expect(window.height).toBe(3);
    expect((window.rows as string[])[0]).toHaveLength(4);
    expect(await call('get_map', { layer: 'nope' })).toMatchObject({
      ok: false,
      error: 'invalidInput',
    });
    expect(await call('get_map', { origin: { x: 99, y: 0 } })).toMatchObject({ ok: false });
  });

  it('find_tiles finds river, lake shore and empty land, nearest first', async () => {
    const { call, engine } = createHarness();
    const river = await call('find_tiles', { kind: 'river', limit: 5 });
    expect(river.total).toBeGreaterThan(0);
    expect((river.tiles as unknown[]).length).toBeLessThanOrEqual(5);
    for (const { x, y } of river.tiles as Array<{ x: number; y: number }>) {
      expect(engine.state.layers.terrain[tileIndex(x, y, SIZE)]).toBe(Terrain.River);
    }
    const shore = await call('find_tiles', { kind: 'lake_shore' });
    expect(shore.total).toBeGreaterThan(0);
    const land = await call('find_tiles', { kind: 'empty_land', near: { x: 5, y: 5 }, limit: 3 });
    const tiles = land.tiles as Array<{ x: number; y: number }>;
    expect(tiles).toHaveLength(3);
    const d = (p: { x: number; y: number }) => Math.max(Math.abs(p.x - 5), Math.abs(p.y - 5));
    expect(d(tiles[0])).toBeLessThanOrEqual(d(tiles[2]));
    expect(await call('find_tiles', { kind: 'unicorns' })).toMatchObject({ ok: false });
  });

  it('get_lifetime_stats returns one sample per day', async () => {
    const { call } = createHarness();
    expect(await call('get_lifetime_stats')).toMatchObject({ days: 0, samples: [] });
    await call('advance_time', { days: 1 });
    const after = await call('get_lifetime_stats');
    expect(after.days).toBe(1);
  });
});

describe('agent tools: building', () => {
  it('builds a road, zones next to it, places a plant and lines, then inspects', async () => {
    const { call, engine } = createHarness();
    const { x, y } = findLand(engine);
    const road = await call('build_road', { from: { x, y }, to: { x: x + 5, y } });
    expect(road).toMatchObject({ ok: true, tiles: 6, spent: 6 * BALANCE.costs.roadPerTile });
    expect(engine.state.layers.tileType[tileIndex(x + 3, y, SIZE)]).toBe(TileType.Road);

    const zone = await call('paint_zone', {
      zone: 'residential',
      from: { x, y: y + 1 },
      to: { x: x + 5, y: y + 1 },
    });
    expect(zone).toMatchObject({ ok: true, tiles: 6, spent: 6 * BALANCE.costs.zonePerTile });
    expect(engine.state.layers.zone[tileIndex(x + 2, y + 1, SIZE)]).toBe(Zone.Residential);

    const plant = await call('place_plant', { plant: 'solar', x, y: y + 2 });
    expect(plant).toMatchObject({ ok: true, spent: BALANCE.costs.plant[PlantType.SolarFarm] });
    expect(engine.state.layers.plantType[tileIndex(x, y + 2, SIZE)]).toBe(PlantType.SolarFarm);

    const line = await call('build_power_line', {
      tiles: [
        { x: x + 1, y: y + 2 },
        { x: x + 2, y: y + 2 },
      ],
    });
    expect(line).toMatchObject({ ok: true, tiles: 2 });
    expect(engine.state.layers.powerLine[tileIndex(x + 2, y + 2, SIZE)]).not.toBe(0);

    const map = await call('get_map', { origin: { x, y }, width: 6, height: 3 });
    expect(map.rows).toEqual(['++++++', 'rrrrrr', 'V==...']);

    const info = await call('inspect_tile', { x, y: y + 2 });
    expect(info).toMatchObject({ ok: true, plant: 'solar', terrain: 'land', tileType: 'plant' });
    expect(info.peakGeneration).toBe(BALANCE.energy.solarPeakOutput);
    // Inspecting from a tool does not leave the inspector on that tile.
    expect(engine.state.inspectedTile).toBe(-1);

    const zoned = await call('inspect_tile', { x: x + 1, y: y + 1 });
    expect(zoned).toMatchObject({ ok: true, zone: 'residential', density: 0 });
    expect(Array.isArray(zoned.growthBlockers)).toBe(true);
  });

  it('surfaces sim rejections with the code and an English message', async () => {
    const { call, engine } = createHarness();
    const { x, y } = findLand(engine);
    const bad = await call('place_plant', { plant: 'run_of_river', x, y });
    expect(bad).toMatchObject({ ok: false, error: 'needsRiverTile' });
    expect(bad.message).toContain('river');
    engine.state.money = 1;
    const poor = await call('build_road', { from: { x, y }, to: { x: x + 5, y } });
    expect(poor).toMatchObject({ ok: false, error: 'notEnoughMoney', message: 'Not enough money' });
  });

  it('rejects malformed input without throwing', async () => {
    const { call } = createHarness();
    expect(await call('build_road', {})).toMatchObject({ ok: false, error: 'invalidInput' });
    expect(await call('build_road', { from: { x: -1, y: 0 } })).toMatchObject({ ok: false });
    expect(await call('build_road', { tiles: [{ x: 1 }] })).toMatchObject({ ok: false });
    expect(await call('paint_zone', { zone: 'industrial', from: { x: 1, y: 1 } })).toMatchObject({
      ok: false,
    });
    expect(await call('place_plant', { plant: 'coal', x: 1, y: 1 })).toMatchObject({ ok: false });
    expect(await call('place_plant', { plant: 'solar', x: 1.5, y: 1 })).toMatchObject({
      ok: false,
    });
    expect(await call('set_speed', { speed: 2 })).toMatchObject({ ok: false });
    expect(await call('set_tax_rate', { rate: 'high' })).toMatchObject({ ok: false });
    expect(await call('set_smart_charging', { enabled: 'yes' })).toMatchObject({ ok: false });
    expect(await call('advance_time', {})).toMatchObject({ ok: false });
    expect(await call('advance_time', { days: MAX_ADVANCE_DAYS + 1 })).toMatchObject({ ok: false });
    expect(await call('start_new_city', { size: 50 })).toMatchObject({ ok: false });
    expect(await call('no_such_tool')).toMatchObject({ ok: false, error: 'unknownTool' });
    expect(await callTool([], 'x', 'not an object')).toMatchObject({ ok: false });
  });

  it('bulldozes a rectangle and undo refunds the last action', async () => {
    const { call, engine } = createHarness();
    const { x, y } = findLand(engine);
    await call('build_road', { from: { x, y }, to: { x: x + 5, y } });
    const before = engine.state.money;
    await call('place_plant', { plant: 'wind', x, y: y + 1 });
    const undo = await call('undo');
    expect(undo).toMatchObject({ ok: true, refunded: BALANCE.costs.plant[PlantType.WindTurbine] });
    expect(engine.state.money).toBe(before);
    const cleared = await call('bulldoze', { from: { x, y }, to: { x: x + 5, y } });
    expect(cleared).toMatchObject({ ok: true, tiles: 6 });
    expect(engine.state.layers.tileType[tileIndex(x, y, SIZE)]).toBe(TileType.Empty);
    expect(await call('undo')).toMatchObject({ ok: true });
    expect(engine.state.layers.tileType[tileIndex(x, y, SIZE)]).toBe(TileType.Road);
  });

  it('sets speed, tax rate, smart charging and buys insulation', async () => {
    const { call, engine } = createHarness();
    expect(await call('set_speed', { speed: 3 })).toMatchObject({ ok: true, speed: 3 });
    expect(engine.state.speed).toBe(3);
    expect(await call('set_tax_rate', { rate: 0.9 })).toMatchObject({
      ok: true,
      taxRate: BALANCE.tax.maxRate,
    });
    expect(await call('set_smart_charging', { enabled: true })).toMatchObject({ ok: true });
    expect(engine.state.smartCharging).toBe(true);
    expect(await call('buy_insulation')).toMatchObject({
      ok: true,
      spent: BALANCE.costs.insulation,
    });
    expect(await call('buy_insulation')).toMatchObject({ ok: false, error: 'alreadyInsulated' });
  });

  it('advance_time runs the requested ticks and restores a paused game', async () => {
    const { call, engine } = createHarness();
    await call('set_speed', { speed: 0 });
    const start = engine.state.tick;
    const result = await call('advance_time', { ticks: 10 });
    expect(result).toMatchObject({ ok: true, ticksAdvanced: 10 });
    expect(engine.state.tick).toBe(start + 10);
    expect(engine.state.speed).toBe(0);
    const day = await call('advance_time', { days: 0.5 });
    expect(day.ticksAdvanced).toBe(TICKS_PER_DAY / 2);
    expect(await call('save_game')).toMatchObject({ ok: true });
  });

  it('start_new_city hands validated options to the host', async () => {
    const { call, newCities } = createHarness();
    const result = await call('start_new_city', { size: 48, difficulty: 'hard', seed: 7 });
    expect(result).toMatchObject({ ok: true, size: 48, difficulty: 'hard', seed: 7 });
    expect(newCities).toEqual([{ size: 48, startingMoney: 15_000, seed: 7 }]);
    await call('start_new_city');
    expect(newCities[1]).toEqual({ size: 64, startingMoney: BALANCE.startingMoney, seed: null });
  });
});
