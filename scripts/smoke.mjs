import { chromium } from '@playwright/test';

const shot = process.argv[2] ?? 'shot.png';
const waitMs = Number(process.argv[3] ?? 4000);
const browser = await chromium.launch({
  channel: 'chromium',
  args: ['--no-proxy-server', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'load' });
await page.waitForTimeout(waitMs);
const tick = await page.getByTestId('tick-counter').textContent().catch(() => 'n/a');
const clock = await page.getByTestId('clock-time').textContent().catch(() => 'n/a');
await page.screenshot({ path: shot });
console.log('tick:', tick, '| clock:', clock);
console.log('console errors:', errors.length ? errors.join('\n') : 'none');
await browser.close();
