import type { Browser, Page } from '@playwright/test';
import { GL_ARGS } from './gpu';
import { test, expect, bootApp, enterSection, say, toIsland, unique, UI_URL, DEVHOST_A, DEVHOST_B } from './fixtures';
import { freshDevhosts } from './devhosts';

/**
 * T-017 / W-006: reduced motion is honored from the OS flag and from the in-app override.
 * The observable seam is the message entrance animation: `anim()` returns 'none' when reduced,
 * so a fresh message's computed animation name tells the whole story.
 */
test.use({ launchOptions: { args: GL_ARGS } });
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => { test.setTimeout(180_000); await freshDevhosts(); });

/** Boots one user with an explicit OS motion preference (the shared fixtures always emulate reduce). */
async function bootUser(browser: Browser, host: string, who: string, motion: 'reduce' | 'no-preference'): Promise<Page> {
  const ctx = await browser.newContext({ reducedMotion: motion, viewport: { width: 1440, height: 900 }, baseURL: UI_URL });
  const page = await ctx.newPage();
  await bootApp(page, host, who, false);
  return page;
}

/** The animation name a freshly posted message carries: 'none' means motion is off. */
async function freshAnim(page: Page): Promise<string> {
  await say(page, unique('motion probe'));
  const art = page.getByRole('article').last();
  await expect(art).toBeVisible({ timeout: 30_000 });
  return art.evaluate((el) => getComputedStyle(el).animationName);
}

async function setMotionOverride(page: Page, mode: 'system' | 'reduce' | 'full'): Promise<void> {
  // The Settings button lives in the island header; inside, the panel covers the faded HUD.
  // Exact: 'Space settings' and 'Privacy and chat settings' also contain 'Settings'.
  await toIsland(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: /Settings/ });
  await drawer.getByLabel('Reduced motion').selectOption(mode);
  await drawer.getByRole('button', { name: 'Close' }).click();
  await expect(async () => { await enterSection(page, 'chat'); }).toPass({ timeout: 90_000 });
}

test('full motion animates messages; the W-006 override stops and restarts it, across reload', async ({ browser }) => {
  // Two boots, a reload and four sends: give it room on a loaded machine.
  test.setTimeout(480_000);
  const page = await bootUser(browser, DEVHOST_A, 'Mo Tester', 'no-preference');
  await expect(async () => { await enterSection(page, 'chat'); }).toPass({ timeout: 90_000 });
  expect(await freshAnim(page)).not.toBe('none');

  // The override wins over the OS: 'Always reduce' silences the animation at once.
  await setMotionOverride(page, 'reduce');
  expect(await freshAnim(page)).toBe('none');

  // It is a device preference: a reload keeps it.
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Spaces' })).toBeVisible({ timeout: 60_000 });
  // The town rebuilds its scene after reload; wait for the building label before the walk.
  await expect(page.locator('[data-bld="chat"] button')).toBeVisible({ timeout: 180_000 });
  await expect(async () => { await enterSection(page, 'chat'); }).toPass({ timeout: 120_000 });
  expect(await freshAnim(page)).toBe('none');

  // And 'Always full' restores motion even where the OS asked for less.
  await setMotionOverride(page, 'full');
  expect(await freshAnim(page)).not.toBe('none');
  await page.context().close();
});

test('the OS reduced-motion flag alone silences message animations', async ({ browser }) => {
  test.setTimeout(240_000);
  const page = await bootUser(browser, DEVHOST_B, 'Still Tester', 'reduce');
  await expect(async () => { await enterSection(page, 'chat'); }).toPass({ timeout: 90_000 });
  expect(await freshAnim(page)).toBe('none');
  await page.context().close();
});
