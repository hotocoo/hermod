import type { BrowserContext, Page } from '@playwright/test';
import {
  test, expect, acceptTerms, bootApp, createInviteCode, createSpace, enterSection, openSpaceSettings, say, toIsland, unique, watchErrors,
  DEVHOST_A, DEVHOST_B, UI_URL,
} from './fixtures';
import { freshDevhosts } from './devhosts';

/**
 * Deep links (G-004, W-010) against real devhosts: the devhost's `POST /deeplink` stands in for the OS opening
 * `hermod://join/<code>` and takes the same Rust path as the desktop shell. B is a second install that has never
 * loaded the page when the first link arrives (cold start), then gets a second link while running.
 */
test.describe.configure({ mode: 'serial' });

let ctxs: BrowserContext[] = [];
let a: Page;
let b: Page;
const first = unique('Harbour');
const second = unique('Lantern');
const preJoin = unique('before you came');

const spaceRail = (p: Page) => p.getByRole('navigation', { name: 'Spaces' }).first();

/** What the OS does when the user clicks an invite link with Hermod installed. */
async function openLink(page: Page, host: string, code: string): Promise<void> {
  const res = await page.request.post(`${host}/deeplink`, { data: { url: `hermod://join/${code}` } });
  expect(res.status()).toBe(204);
}

/** A creates a Space and an invite for it; returns the code. */
async function spaceWithInvite(name: string): Promise<string> {
  await toIsland(a);
  await a.getByRole('button', { name: 'New Space' }).click();
  await createSpace(a, name, 'Joined by link');
  return createInviteCode(a);
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  await freshDevhosts();
  ctxs = await Promise.all([0, 1].map(() => browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, baseURL: UI_URL })));
  [a, b] = await Promise.all(ctxs.map((c) => c.newPage()));
  watchErrors(a); watchErrors(b);
  await bootApp(a, DEVHOST_A, 'Ada Tester', false, false);
});
test.afterAll(async () => { await Promise.all(ctxs.map((c) => c.close())); });

test('a link that opens a second install joins the Space and backfills what was said before', async () => {
  test.setTimeout(240_000);
  const code = await spaceWithInvite(first);
  await enterSection(a, 'chat');
  await say(a, preJoin);
  await expect(a.getByRole('article').filter({ hasText: preJoin })).toBeVisible();

  // The link arrives before B's page exists, as when the OS launches the app from it.
  await openLink(b, DEVHOST_B, code);
  await b.addInitScript(() => { try { localStorage.setItem('hermodr.welcomed', '1'); } catch { /* storage blocked: the tour may show */ } });
  await b.goto(`/?devhost=${encodeURIComponent(DEVHOST_B)}`);
  await expect(b.getByRole('heading', { name: 'Terms, privacy and sharing' })).toBeVisible({ timeout: 60_000 });
  await acceptTerms(b);
  await expect(b.getByRole('heading', { name: 'Tell people your name' })).toBeVisible({ timeout: 30_000 });
  const profile = b.getByRole('heading', { name: 'Tell people your name' });
  // The form can re-mount while the node starts (as in bootApp); retry until the name sticks.
  await expect(async () => {
    if (!(await profile.isVisible())) return;
    await b.getByLabel(/^Name/).fill('Bo Tester');
    await b.getByRole('button', { name: /^Continue/ }).click({ timeout: 5_000 });
  }).toPass({ timeout: 40_000 });

  const welcome = b.getByRole('region', { name: 'Join with an invite' });
  await expect(b.getByRole('heading', { name: 'Start an island, or join one' })).toBeVisible({ timeout: 30_000 });
  await expect(welcome.getByLabel('Invite link or code')).toHaveValue(code);
  await welcome.getByRole('button', { name: 'Join Space' }).click();
  await expect(b.getByRole('heading', { level: 1 })).toHaveText(first, { timeout: 60_000 });
  await enterSection(b, 'chat');
  await expect(b.getByRole('article').filter({ hasText: preJoin })).toBeVisible({ timeout: 60_000 });
});

test('a link opened while the app runs brings up the join dialog with the code filled in', async () => {
  const code = await spaceWithInvite(second);
  await toIsland(b);
  await openLink(b, DEVHOST_B, code);
  const dlg = b.getByRole('dialog', { name: 'Join a Space' });
  await expect(dlg.getByLabel('Invite link or code')).toHaveValue(code, { timeout: 30_000 });
  await dlg.getByRole('button', { name: 'Join Space' }).click();
  await expect(b.getByRole('heading', { level: 1 })).toHaveText(second, { timeout: 60_000 });
  await expect(spaceRail(b).getByRole('button', { name: second })).toBeVisible();
});

test('leaving a Space takes it off the rail', async () => {
  const dlg = await openSpaceSettings(b);
  await dlg.getByRole('button', { name: 'Leave Space' }).click();
  await b.getByRole('dialog', { name: `Leave ${second}?` }).getByRole('button', { name: 'Leave Space' }).click();
  await expect(spaceRail(b).getByRole('button', { name: second })).toHaveCount(0, { timeout: 30_000 });
  await expect(spaceRail(b).getByRole('button', { name: first })).toBeVisible();
});

test('a malformed link is refused and changes nothing', async () => {
  const res = await b.request.post(`${DEVHOST_B}/deeplink`, { data: { url: 'https://example.invalid/join/x' } });
  expect(res.status()).toBe(400);
  await expect(b.getByRole('dialog', { name: 'Join a Space' })).toHaveCount(0);
});
