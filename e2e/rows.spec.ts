import type { Locator, Page } from '@playwright/test';
import { test, expect, twoUsers, sharedSpace, enterSection, say, unique, openSpaceSettings, toIsland, acceptTerms, toast, DEVHOST_FRESH } from './fixtures';
import { freshDevhosts } from './devhosts';

test.beforeAll(async () => { test.setTimeout(180_000); await freshDevhosts(); });

/**
 * UI proofs of FEATURES acceptance: G-006 node down before Terms, E-015 no directory, W-004 About and licenses,
 * W-005 log viewer, D-004 retention, E-011 join proof of work, E-005 admin removal, X-003 focus, X-004 live regions, D-007 reset.
 */
test.describe.configure({ mode: 'serial' });

let users: Awaited<ReturnType<typeof twoUsers>>;
let a: Page;
let b: Page;
const space = unique('Rows');
const article = (p: Page, text: string): Locator => p.getByRole('article').filter({ hasText: text });
const dialog = (p: Page, name: string | RegExp) => p.getByRole('dialog', { name });
const invoke = async <T,>(host: string, cmd: string): Promise<T> => {
  const res = await fetch(`${host}/invoke/${cmd}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  if (!res.ok) throw new Error(`${cmd}: ${await res.text()}`);
  return (await res.json()) as T;
};
const openAppSettings = async (p: Page, tab: string): Promise<Locator> => {
  await toIsland(p);
  await p.getByRole('button', { name: 'Settings', exact: true }).click();
  await p.getByRole('button', { name: 'App settings' }).click();
  const dlg = dialog(p, 'App settings');
  await dlg.getByRole('tab', { name: tab }).click();
  return dlg;
};

test('G-006: the node is down while the Terms gate shows and starts only after accept', async ({ page }) => {
  await page.goto(`/?devhost=${encodeURIComponent(DEVHOST_FRESH)}`);
  await expect(page.getByRole('heading', { name: 'Terms, privacy and sharing' })).toBeVisible({ timeout: 60_000 });
  expect((await invoke<{ running: boolean; listen: string[] }>(DEVHOST_FRESH, 'node_status'))).toMatchObject({ running: false, listen: [] });
  await acceptTerms(page);
  await expect(async () => {
    expect((await invoke<{ running: boolean }>(DEVHOST_FRESH, 'node_status')).running).toBe(true);
  }).toPass({ timeout: 30_000 });
});

test.describe('with a shared Space', () => {
  test.beforeAll(async ({ browser }) => {
    users = await twoUsers(browser);
    ({ a, b } = users);
    await sharedSpace(a, b, space);
    await enterSection(a, 'chat');
    await enterSection(b, 'chat');
  });
  test.afterAll(async () => { await users.close(); });

  test('E-015: the join dialog says there is no search for Spaces', async () => {
    await toIsland(a);
    await a.getByRole('button', { name: 'Join a Space with an invite' }).click();
    await expect(dialog(a, 'Join a Space').getByText('Hermod has no search for Spaces. Ask someone for an invite.')).toBeVisible();
    await a.keyboard.press('Escape');
  });

  test('W-004: About shows the version, the Terms and Privacy texts and the generated third-party licenses', async () => {
    await toIsland(a);
    await a.getByRole('button', { name: 'Settings', exact: true }).click();
    await a.getByRole('button', { name: 'About Hermod' }).click();
    const dlg = dialog(a, 'About Hermod');
    await expect(dlg.getByText(/Version \d+\.\d+\.\d+/)).toBeVisible();
    await dlg.getByRole('button', { name: 'Terms of Use' }).click();
    await expect(dialog(a, /Terms/)).toBeVisible();
    await dialog(a, /Terms/).getByRole('button', { name: 'Back' }).click();
    await dlg.getByRole('button', { name: 'Privacy notice' }).click();
    await expect(dialog(a, /Privacy/)).toBeVisible();
    await dialog(a, /Privacy/).getByRole('button', { name: 'Back' }).click();
    await dlg.getByText(/Third-party licenses: \d+ Rust crates and \d+ npm packages/).click();
    const list = dlg.getByRole('list', { name: 'Third-party licenses' });
    await expect(list.getByRole('listitem').filter({ hasText: /^react \d/ })).toHaveCount(1);
    await expect(list.getByRole('listitem').filter({ hasText: /^libp2p \d/ })).not.toHaveCount(0);
    await a.keyboard.press('Escape');
    await a.keyboard.press('Escape');
  });

  test('W-005: the Logs tab shows the local log and copies it', async () => {
    const dlg = await openAppSettings(a, 'Logs');
    const log = dlg.getByLabel('Log');
    await expect(log).not.toHaveText('Loading…');
    await expect(log).not.toHaveText('The log is empty.');
    await expect(dlg.getByRole('button', { name: 'Copy log' })).toBeEnabled();
    await dlg.getByRole('button', { name: 'Copy log' }).click();
    await expect(toast(a).filter({ hasText: 'Copied' })).toBeVisible();
    expect(await a.evaluate(() => navigator.clipboard.readText())).toContain(((await log.textContent()) ?? '').split('\n')[0]);
    await a.keyboard.press('Escape');
  });

  test('D-004: the retention choice is saved per Space and read back', async () => {
    const dlg = await openSpaceSettings(a, 'Safety');
    await dlg.getByLabel(/Delete my copy of messages older than/).selectOption({ label: '30 days' });
    await expect(toast(a).filter({ hasText: 'Saved' })).toBeVisible();
    await a.keyboard.press('Escape');
    const again = await openSpaceSettings(a, 'Safety');
    await expect(again.getByLabel(/Delete my copy of messages older than/)).toHaveValue('30');
    await again.getByLabel(/Delete my copy of messages older than/).selectOption({ label: 'Keep everything' });
    await a.keyboard.press('Escape');
  });

  test('E-011: an admin sets the join proof of work and it sticks', async () => {
    const dlg = await openSpaceSettings(a, 'General');
    await dlg.getByLabel('Work required to join').selectOption({ label: '12 bits' });
    await expect(toast(a).filter({ hasText: 'Join setting saved' })).toBeVisible();
    await a.keyboard.press('Escape');
    const again = await openSpaceSettings(a, 'General');
    await expect(again.getByLabel('Work required to join')).toHaveValue('12');
    await a.keyboard.press('Escape');
  });

  test('E-005: an admin removes another member\'s message and both sides show the tombstone', async () => {
    const text = unique('remove-me');
    await enterSection(b, 'chat');
    await enterSection(a, 'chat');
    await say(b, text);
    await expect(article(a, text)).toBeVisible({ timeout: 45_000 });
    await article(b, text).hover();
    await expect(article(b, text).getByRole('button', { name: 'Remove message (admin)' })).toHaveCount(0);
    await article(a, text).hover();
    await article(a, text).getByRole('button', { name: 'Remove message (admin)' }).click();
    await dialog(a, 'Remove this message?').getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(a.getByText('Removed by an admin').last()).toBeVisible({ timeout: 30_000 });
    await expect(b.getByText('Removed by an admin').last()).toBeVisible({ timeout: 45_000 });
    await expect(article(b, text)).toHaveCount(0);
  });

  test('X-004: a new message from someone else is announced in a polite live region', async () => {
    const text = unique('announce');
    await say(b, text);
    await expect(article(a, text)).toBeVisible({ timeout: 45_000 });
    const live = a.locator('[role="status"][aria-live="polite"]').filter({ hasText: `New message from Bo Tester: ${text}` });
    await expect(live).toHaveCount(1);
    await expect(live).toHaveAttribute('aria-atomic', 'true');
    // The toast bubble is a live region too (polite status; errors switch to an assertive alert).
    await expect(a.locator('[role="status"][aria-live="polite"]').filter({ has: a.locator('span[aria-hidden="true"]') })).toBeAttached();
  });

  test('X-003: a drawer and a dialog trap Tab, Escape closes them and focus returns to the opener', async () => {
    await toIsland(a);
    const opener = a.getByRole('button', { name: 'Settings', exact: true });
    await opener.focus();
    await opener.click();
    const drawer = a.locator('[role="dialog"][aria-label="Settings"]');
    await expect(drawer).toBeVisible();
    await expect(drawer.locator(':focus')).toHaveCount(1);
    const stops = await drawer.locator('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])').count();
    for (let i = 0; i < stops + 2; i += 1) {
      await a.keyboard.press('Tab');
      await expect(drawer.locator(':focus')).toHaveCount(1);
    }
    await a.keyboard.press('Shift+Tab');
    await expect(drawer.locator(':focus')).toHaveCount(1);
    await a.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(opener).toBeFocused();
    await opener.click();
    await a.getByRole('button', { name: 'About Hermod' }).click();
    const about = dialog(a, 'About Hermod');
    await expect(about).toBeVisible();
    for (let i = 0; i < 8; i += 1) {
      await a.keyboard.press('Tab');
      await expect(about.locator(':focus')).toHaveCount(1);
    }
    await a.keyboard.press('Escape');
    await expect(about).toBeHidden();
    // Opening a dialog from the drawer closes the drawer; focus must land back on what opened the drawer, not on the page body.
    await expect(opener).toBeFocused();
  });

  test('D-007: Delete all local data needs the typed word, then wipes the install back to the Terms gate', async () => {
    const dlg = await openAppSettings(b, 'Backup');
    await dlg.getByRole('button', { name: 'Delete all local data…' }).click();
    const confirm = dialog(b, 'Delete all local data?');
    const go = confirm.getByRole('button', { name: 'Delete everything' });
    await expect(go).toBeDisabled();
    await confirm.getByLabel(/Type DELETE to confirm/).fill('delete');
    await expect(go).toBeDisabled();
    await confirm.getByLabel(/Type DELETE to confirm/).fill('DELETE');
    await expect(go).toBeEnabled();
    await go.click();
    await expect(b.getByRole('heading', { name: 'Terms, privacy and sharing' })).toBeVisible({ timeout: 60_000 });
  });
});
