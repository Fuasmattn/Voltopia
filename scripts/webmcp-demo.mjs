/**
 * Smoke demo: play Voltopia through native WebMCP via Chrome DevTools MCP.
 *
 * Spawns `chrome-devtools-mcp` (its own isolated Chrome with WebMCP enabled),
 * opens the game, discovers the tools with list_webmcp_tools and plays a
 * small opening with execute_webmcp_tool. Needs a running dev server
 * (VOLTOPIA_URL, default http://localhost:5173/) and Chrome >= 150.
 *
 *   node scripts/webmcp-demo.mjs
 */
import { spawn } from 'node:child_process';
import readline from 'node:readline';

const args = [
  '-y',
  'chrome-devtools-mcp@latest',
  '--categoryExperimentalWebmcp=true',
  '--chromeArg=--enable-features=WebMCP,WebMCPTesting',
  '--isolated',
  '--no-usage-statistics',
  '--viewport=1280x800',
];
const proc = spawn('npx', args, { stdio: ['pipe', 'pipe', 'inherit'] });
const rl = readline.createInterface({ input: proc.stdout });
const pending = new Map();
let nextId = 1;
rl.on('line', (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.id !== undefined && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});
const send = (method, params) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, (m) =>
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result),
    );
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout ${method}`));
      }
    }, 240_000);
  });
const text = (r) =>
  (r?.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
const call = async (name, a) => text(await send('tools/call', { name, arguments: a }));

await send('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'voltopia-demo', version: '0' },
});
proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
const tools = await send('tools/list', {});
console.log(
  'server tools:',
  tools.tools
    .map((t) => t.name)
    .filter((n) => /webmcp|page/.test(n))
    .join(', '),
);

const opened = await call('new_page', {
  url: process.env.VOLTOPIA_URL ?? 'http://localhost:5173/',
});
console.log('--- new_page ---\n' + opened.slice(0, 600));
const pageId = Number(opened.match(/^(\d+): .*\[selected\]/m)?.[1] ?? 2);
console.log('pageId =', pageId);
await new Promise((r) => setTimeout(r, 3000));

const listed = await call('list_webmcp_tools', { pageId });
console.log('--- list_webmcp_tools ---\n' + listed.slice(0, 1500));

const game = async (toolName, input = {}) => {
  const raw = await call('execute_webmcp_tool', { pageId, toolName, input: JSON.stringify(input) });
  let parsed = raw;
  try {
    const outer = JSON.parse(raw);
    const inner = outer?.output?.content?.[0]?.text ?? outer?.content?.[0]?.text;
    parsed = inner ? JSON.parse(inner) : outer;
  } catch {
    /* keep raw */
  }
  return parsed;
};
const show = (label, v) =>
  console.log(
    `\n== ${label}\n` + (typeof v === 'string' ? v.slice(0, 800) : JSON.stringify(v).slice(0, 800)),
  );

const ov = await game('get_game_overview');
show('overview', {
  money: ov.money,
  population: ov.population,
  day: ov.day,
  season: ov.season?.season,
  gridSize: ov.gridSize,
  raw: typeof ov === 'string' ? ov.slice(0, 300) : undefined,
});
const land = await game('find_tiles', { kind: 'empty_land', near: { x: 32, y: 32 }, limit: 1 });
const { x, y } = land.tiles[0];
show('start tile', { x, y });
show('build_road', await game('build_road', { from: { x, y }, to: { x: x + 11, y } }));
show(
  'paint_zone residential',
  await game('paint_zone', {
    zone: 'residential',
    from: { x, y: y - 1 },
    to: { x: x + 11, y: y - 1 },
  }),
);
show(
  'paint_zone commercial',
  await game('paint_zone', {
    zone: 'commercial',
    from: { x, y: y + 1 },
    to: { x: x + 5, y: y + 1 },
  }),
);
show(
  'paint_zone retail',
  await game('paint_zone', {
    zone: 'retail',
    from: { x: x + 6, y: y + 1 },
    to: { x: x + 11, y: y + 1 },
  }),
);
show('place solar', await game('place_plant', { plant: 'solar', x: x - 1, y: y - 2 }));
show('place wind', await game('place_plant', { plant: 'wind', x: x - 1, y: y + 2 }));
show('place battery', await game('place_plant', { plant: 'battery', x: x - 1, y }));
show(
  'power line',
  await game('build_power_line', { from: { x: x - 1, y: y - 1 }, to: { x: x - 1, y: y + 1 } }),
);
show(
  'power line along road',
  await game('build_power_line', { from: { x, y }, to: { x: x + 11, y } }),
);
show(
  'map',
  (await game('get_map', { origin: { x: x - 2, y: y - 3 }, width: 15, height: 7 })).rows?.join(
    '\n',
  ),
);
show('advance 1 day', await game('advance_time', { days: 1 }));
show(
  'map after',
  (await game('get_map', { origin: { x: x - 2, y: y - 3 }, width: 15, height: 7 })).rows?.join(
    '\n',
  ),
);
const after = await game('get_game_overview');
show('overview after', {
  money: after.money,
  population: after.population,
  jobs: after.jobs,
  happiness: after.happiness,
  goals: after.goals?.filter((g) => g.achieved).map((g) => g.id),
});
proc.kill();
process.exit(0);
