import { expect, test, type Page } from '@playwright/test';

async function readTick(page: Page): Promise<number> {
  const text = await page.getByTestId('tick-counter').textContent();
  return Number(text?.replace(/\D/g, '') ?? '0');
}

/** True when the environment has WebGL and the 3D canvas is present. */
async function has3dView(page: Page): Promise<boolean> {
  return (await page.locator('.game-view canvas').count()) > 0;
}

test.beforeEach(async ({ page }) => {
  // Keep the first-run tutorial out of unrelated tests (the tutorial
  // test opts back in via the e2eAllowTutorial marker).
  await page.addInitScript(() => {
    if (!localStorage.getItem('voltopia.e2eAllowTutorial')) {
      localStorage.setItem('voltopia.tutorialDone', '1');
    }
  });
  await page.goto('/');
  await expect(page.getByTestId('tick-counter')).toBeVisible({ timeout: 15_000 });
});

test('tutorial guides brand-new games and can be skipped', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem('voltopia.e2eAllowTutorial', '1');
    localStorage.removeItem('voltopia.tutorialDone');
  });
  await page.evaluate(() => indexedDB.deleteDatabase('voltopia'));
  await page.reload();
  await expect(page.getByTestId('tutorial')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('tutorial-next').click(); // welcome -> build a road
  await expect(page.getByTestId('tutorial')).toContainText('2');
  await page.getByTestId('tutorial-skip').click();
  await expect(page.getByTestId('tutorial')).toHaveCount(0);
  // Skipping is remembered.
  await page.reload();
  await expect(page.getByTestId('tick-counter')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('tutorial')).toHaveCount(0);
});

test('new-game dialog starts a fresh city with chosen difficulty', async ({ page }) => {
  await page.getByTestId('new-game').click();
  await expect(page.getByTestId('new-game-page')).toBeVisible();
  await page.getByTestId('size-48').click();
  await page.getByTestId('difficulty-hard').click();
  await page.getByTestId('seed-input').fill('gridtown');
  await page.getByTestId('start-city').click();
  await expect(page.getByTestId('tick-counter')).toBeVisible({ timeout: 15_000 });
  // Hard difficulty: starting funds are 15,000.
  await expect(page.getByTestId('money')).toContainText('15,000');
});

test('settings page toggles persist', async ({ page }) => {
  await page.getByTestId('open-settings').click();
  await expect(page.getByTestId('settings-page')).toBeVisible();
  await page.getByTestId('setting-shadows').click();
  await page.getByTestId('setting-sound').click();
  await page.reload();
  await expect(page.getByTestId('tick-counter')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('open-settings').click();
  await expect(page.getByTestId('setting-shadows')).not.toBeChecked();
  await expect(page.getByTestId('setting-sound')).not.toBeChecked();
});

test('boots with a running simulation', async ({ page }) => {
  await expect(page).toHaveTitle(/Voltopia/);
  const before = await readTick(page);
  await expect.poll(async () => readTick(page), { timeout: 5_000 }).toBeGreaterThan(before);
  await expect(page.getByTestId('money')).toBeVisible();
  await expect(page.getByTestId('energy-panel')).toBeVisible();
  await expect(page.getByTestId('energy-hydro')).toBeVisible();
});

test('pause stops the simulation, play resumes it', async ({ page }) => {
  await page.getByTestId('speed-0').click();
  await page.waitForTimeout(400);
  const paused = await readTick(page);
  await page.waitForTimeout(800);
  expect(await readTick(page)).toBe(paused);
  await page.getByTestId('speed-3').click();
  await expect.poll(async () => readTick(page), { timeout: 5_000 }).toBeGreaterThan(paused);
});

test('tax slider and smart charging are interactive', async ({ page }) => {
  const slider = page.getByTestId('tax-slider').locator('input');
  await slider.fill('25');
  await expect(page.getByTestId('tax-slider')).toContainText('25%');

  // The checkbox is controlled by worker stats, so the checked state
  // only flips with the next tick event — click and poll.
  const smartCharging = page.getByTestId('smart-charging').locator('input');
  await smartCharging.click();
  await expect(smartCharging).toBeChecked({ timeout: 5_000 });
});

test('overlay toggle switches modes', async ({ page }) => {
  await page.getByTestId('overlay-supply').click();
  await expect(page.getByTestId('overlay-supply')).toHaveClass(/active/);
  await page.getByTestId('overlay-off').click();
  await expect(page.getByTestId('overlay-off')).toHaveClass(/active/);
});

test('game state persists across a reload', async ({ page }) => {
  await page.getByTestId('speed-3').click();
  await expect.poll(async () => readTick(page), { timeout: 10_000 }).toBeGreaterThan(20);
  const beforeSave = await readTick(page);
  await page.keyboard.press('Control+s'); // quick-save
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByTestId('tick-counter')).toBeVisible({ timeout: 15_000 });
  expect(await readTick(page)).toBeGreaterThanOrEqual(beforeSave);
});

test('autosave persists without the quick-save key', async ({ page }) => {
  await page.getByTestId('speed-3').click();
  // Wait past the autosave interval (10s) so a periodic save must fire.
  await page.waitForTimeout(11_500);
  const beforeReload = await readTick(page);
  expect(beforeReload).toBeGreaterThan(50);
  await page.reload();
  await expect(page.getByTestId('tick-counter')).toBeVisible({ timeout: 15_000 });
  // The reloaded city continues from a recent snapshot, not from zero.
  expect(await readTick(page)).toBeGreaterThan(beforeReload / 2);
});

test('help and imprint pages work in both languages', async ({ page }) => {
  // Default (non-German browser) is English.
  await page.getByTestId('open-help').click();
  await expect(page.getByTestId('help-page')).toBeVisible();
  await expect(page.getByTestId('help-page')).toContainText('Goal');
  await page.getByTestId('help-page').getByRole('button').click(); // close
  await expect(page.getByTestId('help-page')).toHaveCount(0);

  // Switch to German: UI translates immediately.
  await page.getByTestId('language-de').click();
  await expect(page.getByTestId('tool-road')).toContainText('Straße');
  await page.getByTestId('open-help').click();
  await expect(page.getByTestId('help-page')).toContainText('Ziel');
  await page.getByTestId('help-page').getByRole('button').click();

  await page.getByTestId('open-imprint').click();
  await expect(page.getByTestId('imprint-page')).toContainText('Thorsten Rinne');
  await expect(page.getByTestId('imprint-page')).toContainText('Impressum');

  // The chosen language survives a reload.
  await page.reload();
  await expect(page.getByTestId('tool-road')).toContainText('Straße', {
    timeout: 15_000,
  });
});

test('building a road costs money (needs WebGL)', async ({ page }) => {
  test.skip(!(await has3dView(page)), 'WebGL not available in this environment');

  const moneyText = async (): Promise<number> => {
    const text = await page.getByTestId('money').textContent();
    return Number(text?.replace(/[^\d]/g, '') ?? '0');
  };
  const before = await moneyText();

  await page.getByTestId('tool-road').click();
  const canvas = page.locator('.game-view canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  await page.mouse.move(centerX - 60, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX + 60, centerY, { steps: 8 });
  await page.mouse.up();

  await expect.poll(moneyText, { timeout: 5_000 }).toBeLessThan(before);
});

test('drawing a power line costs money (needs WebGL)', async ({ page }) => {
  test.skip(!(await has3dView(page)), 'WebGL not available in this environment');

  const moneyText = async (): Promise<number> => {
    const text = await page.getByTestId('money').textContent();
    return Number(text?.replace(/[^\d]/g, '') ?? '0');
  };
  const before = await moneyText();

  await page.getByTestId('tool-power-line').click();
  const canvas = page.locator('.game-view canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  await page.mouse.move(centerX - 60, centerY + 40);
  await page.mouse.down();
  await page.mouse.move(centerX + 60, centerY + 40, { steps: 8 });
  await page.mouse.up();

  await expect.poll(moneyText, { timeout: 5_000 }).toBeLessThan(before);
});

test('the HUD shows the season and a fresh city starts in spring', async ({ page }) => {
  const season = page.getByTestId('season');
  await expect(season).toBeVisible();
  await expect(season).toContainText(/Spring|Frühling/);
  await expect(season).toContainText('°C');
  await expect(page.getByTestId('energy-heating')).toBeVisible();
  await expect(page.getByTestId('energy-cooling')).toBeVisible();
  await expect(page.getByTestId('insulation')).toBeVisible();
});
