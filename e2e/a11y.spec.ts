import type { Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { GL_ARGS } from './gpu';
import { test, expect, acceptTerms, createSpace, unique, enterSection, toIsland, DEVHOST_A } from './fixtures';
import { freshDevhosts } from './devhosts';

/**
 * Q-004 / X-005: an axe-core WCAG 2 AA pass over every screen and every theme, on a real boot.
 * Zero violations at impact serious or critical; the message lists each finding with its node.
 */
test.use({ launchOptions: { args: GL_ARGS } });
test.beforeAll(async () => { test.setTimeout(180_000); await freshDevhosts(); });

const SERIOUS = new Set(['serious', 'critical']);
async function axeClean(page: Page, where: string): Promise<void> {
  // Mid-fade text reads as low contrast; slow runners are still fading in when axe looks.
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))));
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const bad = violations.filter((v) => SERIOUS.has(v.impact ?? ''));
  expect(
    bad.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => JSON.stringify(n.target)).join(' ')}`),
    `axe violations on ${where}`,
  ).toEqual([]);
}

test('every screen and theme passes axe at AA (Q-004, X-005)', async ({ page }) => {
  test.setTimeout(420_000);
  await page.goto(`/?devhost=${encodeURIComponent(DEVHOST_A)}`);

  // The gates: Terms, profile, welcome.
  await expect(page.getByRole('heading', { name: 'Terms, privacy and sharing' })).toBeVisible({ timeout: 60_000 });
  await axeClean(page, 'terms gate');
  await acceptTerms(page);
  await expect(page.getByRole('heading', { name: 'Tell people your name' })).toBeVisible();
  await axeClean(page, 'profile gate');
  await page.getByLabel(/^Name/).fill('Ada Tester');
  await page.getByRole('button', { name: /^Continue/ }).click();
  await expect(page.getByRole('heading', { name: 'Start an island, or join one' })).toBeVisible();
  await axeClean(page, 'welcome gate');

  // The town, then the list view (the keyboard and screen-reader path).
  const space = unique('Accessible');
  await createSpace(page, space, 'A place axe can check');
  await expect(page.getByRole('navigation', { name: 'Spaces' })).toBeVisible();
  await axeClean(page, 'town island');
  await page.getByRole('button', { name: 'List view' }).click();
  await axeClean(page, 'list view');
  await page.getByRole('button', { name: 'List view' }).click();

  // Every building interior.
  for (const section of ['chat', 'hearth', 'feed', 'board', 'skein', 'desk'] as const) {
    await expect(async () => { await enterSection(page, section); }).toPass({ timeout: 90_000 });
    await axeClean(page, `${section} interior`);
  }

  // Drawers and a modal.
  await toIsland(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('dialog', { name: /Settings/ })).toBeVisible();
  await axeClean(page, 'settings drawer');
  await page.getByRole('dialog', { name: /Settings/ }).getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: /^Network/ }).click();
  await expect(page.getByRole('dialog', { name: /Network/ })).toBeVisible();
  await axeClean(page, 'network drawer');
  await page.getByRole('dialog', { name: /Network/ }).getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'New Space' }).click();
  await expect(page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: /Create a Space/i }) })).toBeVisible();
  await axeClean(page, 'new Space dialog');
  await page.keyboard.press('Escape');

  // The other two themes on the screens that carry the most text.
  for (const theme of ['dark', 'parchment'] as const) {
    await page.evaluate((t) => {
      const root = document.documentElement;
      if (t === 'dark') { root.dataset.theme = 'dark'; delete root.dataset.palette; }
      else { delete root.dataset.theme; root.dataset.palette = 'parchment'; }
    }, theme);
    await expect(async () => { await enterSection(page, 'chat'); }).toPass({ timeout: 90_000 });
    await axeClean(page, `chat in ${theme}`);
    await toIsland(page);
    await axeClean(page, `town in ${theme}`);
  }
  await page.evaluate(() => { delete document.documentElement.dataset.theme; delete document.documentElement.dataset.palette; });
});
