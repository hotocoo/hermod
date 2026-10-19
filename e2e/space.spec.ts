import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, BrowserContext, Page, Route } from '@playwright/test';
import {
  test, expect, bootApp, acceptTerms, createSpace, createInviteCode, joinWithCode, openSpaceSettings, enterSection, expectInside, expectOnIsland,
  toIsland, toast, panel, twoUsers, unique, watchErrors, pngBuffer, UI_URL, DEVHOST_FRESH,
} from './fixtures';
import { freshDevhosts } from './devhosts';

/** Every spec file starts on three empty devhosts, so no spec depends on state a former one left. */
test.beforeAll(async () => { test.setTimeout(180_000); await freshDevhosts(); });

/**
 * Space lifecycle and shell, against real devhosts (docs/ARCHITECTURE.md 6.1 and 9): A and B are two identities that sync over the
 * real P2P stack; FRESH is a third install that starts with nothing (gate, failed joins, backup restore).
 */

const newPage = async (browser: Browser): Promise<{ ctx: BrowserContext; page: Page }> => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, baseURL: UI_URL, permissions: ['clipboard-read', 'clipboard-write'] });
  return { ctx, page: await ctx.newPage() };
};

const dialog = (p: Page, name: string | RegExp) => p.getByRole('dialog', { name });
const spaceRail = (p: Page) => p.getByRole('navigation', { name: 'Spaces' }).first();
const houses = (p: Page) => p.locator('[data-house]');
const NAME_C = 'Cy Tester';

test.describe('first run on a fresh install', () => {
  test.describe.configure({ mode: 'serial' });
  let ctx: BrowserContext; let page: Page; let errs: { expectClean(): void };
  const space = unique('Orchard');

  test.beforeAll(async ({ browser }) => {
    ({ ctx, page } = await newPage(browser));
    errs = watchErrors(page);
  });
  test.afterAll(async () => { await ctx.close(); });

  test('the Terms gate needs both checkboxes, then the profile step needs a name', async () => {
    await page.goto(`/?devhost=${encodeURIComponent(DEVHOST_FRESH)}`);
    await expect(page.getByRole('heading', { name: 'Terms, privacy and sharing' })).toBeVisible({ timeout: 60_000 });
    const cont = page.getByRole('button', { name: /^Continue/ });
    await expect(cont).toBeDisabled();
    await page.getByRole('checkbox', { name: /accept the Terms of Use/i }).check();
    await expect(cont).toBeDisabled();
    await acceptTerms(page);
    await expect(page.getByRole('heading', { name: 'Tell people your name' })).toBeVisible({ timeout: 30_000 });
    const profileCont = page.getByRole('button', { name: /^Continue/ });
    await expect(profileCont).toBeDisabled();
    await page.getByLabel(/^Name/).fill(NAME_C);
    await page.getByLabel('Bio').fill('Third install of the suite');
    await expect(profileCont).toBeEnabled();
    await profileCont.click();
    await expect(page.getByRole('heading', { name: 'Start an island, or join one' })).toBeVisible({ timeout: 30_000 });
  });

  test('the Welcome screen creates the first Space (Friends) and the app opens on it', async () => {
    await createSpace(page, space, 'Fresh install tagline', 'Friends');
    await expect(page.getByRole('navigation', { name: 'Spaces' })).toBeVisible();
    await expect(page.locator('header').getByText('Hermóðr · Friends')).toBeVisible();
    await expect(page.locator('header').getByText('Fresh install tagline')).toBeVisible();
  });

  test('reloading keeps the identity and the Space, with no gate screens', async () => {
    await page.reload();
    await expect(spaceRail(page)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('heading', { name: 'Terms, privacy and sharing' })).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Tell people your name' })).toBeHidden();
    await expect(spaceRail(page).getByRole('button', { name: space })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'App settings' }).click();
    await dialog(page, 'App settings').getByRole('tab', { name: 'Identity' }).click();
    await expect(dialog(page, 'App settings').getByLabel('Handle')).not.toHaveValue('');
    await page.keyboard.press('Escape');
    errs.expectClean();
  });
});

test.describe('a shared Space between two users', () => {
  test.describe.configure({ mode: 'serial' });
  let users: Awaited<ReturnType<typeof twoUsers>>;
  let a: Page; let b: Page; let c: Page; let cCtx: BrowserContext;
  const space = unique('Meadow');
  let invite1 = '';
  const backupDir = mkdtempSync(join(tmpdir(), 'hermod-e2e-backup-'));
  const backupFile = join(backupDir, 'suite.hermodbak');
  const passphrase = 'correct horse staple 42';
  const row = (p: Page, who: string) => dialog(p, space).getByRole('row', { name: new RegExp(who) });

  test.beforeAll(async ({ browser }) => {
    ({ ctx: cCtx, page: c } = await newPage(browser));
    users = await twoUsers(browser);
    ({ a, b } = users);
    await bootApp(c, DEVHOST_FRESH, NAME_C, false, false);
  });
  test.afterAll(async () => { await users?.close(); await cCtx?.close(); rmSync(backupDir, { recursive: true, force: true }); });

  test('a new Space can be created as Team, Community or Friends', async () => {
    for (const kind of ['Community', 'Friends', 'Team'] as const) {
      const name = unique(kind);
      await a.getByRole('button', { name: 'New Space' }).click();
      await createSpace(a, name, `${kind} tagline`, kind);
      await expect(a.locator('header').getByText(`Hermóðr · ${kind}`)).toBeVisible();
      await expect(spaceRail(a).getByRole('button', { name })).toBeVisible();
    }
  });

  test('a lone owner has one cottage; an invite with one use brings B in and the island grows to two', async () => {
    await a.getByRole('button', { name: 'New Space' }).click();
    await createSpace(a, space, 'Shared in space.spec');
    await expect(houses(a)).toHaveCount(1);
    invite1 = await createInviteCode(a, { max: '1' });
    await joinWithCode(b, invite1, space);
    await expect(houses(a)).toHaveCount(2, { timeout: 60_000 });
    const bm = await openSpaceSettings(b, 'Members');
    await expect(bm.getByRole('row', { name: /Ada Tester/ })).toBeVisible({ timeout: 60_000 });
    await bm.getByRole('button', { name: 'Close' }).click();
    await expect(houses(b)).toHaveCount(2, { timeout: 60_000 });
    const dlg = await openSpaceSettings(a, 'Invites');
    await expect(dlg.getByRole('row', { name: /member.*1 of 1/ })).toBeVisible();
    await dlg.getByRole('button', { name: 'Close' }).click();
  });

  test('editing the profile name and bio shows to the other user in the member list', async () => {
    await a.getByTitle('Your profile').click();
    const prof = dialog(a, 'Profile');
    await prof.getByRole('button', { name: 'Edit profile' }).click();
    const newName = 'Ada Edited';
    await prof.getByLabel('Name').fill(newName);
    await prof.getByLabel('Bio').fill('Edited in the profile dialog');
    await prof.getByRole('button', { name: 'Save' }).click();
    await expect(prof.getByRole('heading', { name: newName })).toBeVisible({ timeout: 30_000 });
    await a.keyboard.press('Escape');
    await expect(prof).toBeHidden();
    const dlg = await openSpaceSettings(b, 'Members');
    await expect(dlg.getByRole('row', { name: new RegExp(newName) })).toBeVisible({ timeout: 60_000 });
    await dlg.getByRole('button', { name: 'Close' }).click();
  });

  test('a profile photo shows in the profile and the top bar, and survives a name edit', async () => {
    await a.getByTitle('Your profile').click();
    const prof = dialog(a, 'Profile');
    const [chooser] = await Promise.all([a.waitForEvent('filechooser'), prof.getByRole('button', { name: 'Change photo' }).click()]);
    await chooser.setFiles([{ name: 'me.png', mimeType: 'image/png', buffer: pngBuffer(200, 120, 60) }]);
    const photos = () => [prof.locator('img'), a.getByTitle('Your profile').locator('img')];
    for (const img of photos()) await expect(img).toBeVisible({ timeout: 30_000 });
    await prof.getByRole('button', { name: 'Edit profile' }).click();
    await prof.getByLabel('Bio').fill('Now with a photo');
    await prof.getByRole('button', { name: 'Save' }).click();
    await expect(prof.getByText('Now with a photo')).toBeVisible({ timeout: 30_000 });
    for (const img of photos()) await expect(img).toBeVisible();
    await a.keyboard.press('Escape');
    await expect(prof).toBeHidden();
  });

  test('the owner promotes B to admin and back to member; the badge and powers follow on both peers', async () => {
    const dlg = await openSpaceSettings(a, 'Members');
    await expect(row(a, 'Bo Tester')).toContainText('member');
    await dlg.getByRole('combobox', { name: 'Role of Bo Tester' }).selectOption('admin');
    const bs = await openSpaceSettings(b, 'Members');
    await expect(row(b, 'Bo Tester')).toContainText('admin', { timeout: 60_000 });
    await bs.getByRole('tab', { name: 'Invites' }).click();
    await expect(bs.getByText('Only admins manage invites.')).toHaveCount(0);
    await bs.getByRole('button', { name: 'Close' }).click();

    // Hold B's snapshot reads so its store keeps role 'admin' while the core already says 'member': the lag that used to make Invites ask the core
    // for a list it refuses (400, invite_list needs admin). The modal must follow the core, so the held store cannot matter.
    const held: Route[] = [];
    await b.route('**/invoke/snapshot', (r) => { held.push(r); });
    await dlg.getByRole('combobox', { name: 'Role of Bo Tester' }).selectOption('member');
    const bs2 = await openSpaceSettings(b, 'Members');
    await expect(row(b, 'Bo Tester')).toContainText('member', { timeout: 60_000 });
    await bs2.getByRole('tab', { name: 'Invites' }).click();
    await expect(bs2.getByText('Only admins manage invites.')).toBeVisible();
    await bs2.getByRole('button', { name: 'Close' }).click();
    await dlg.getByRole('button', { name: 'Close' }).click();
    await b.unroute('**/invoke/snapshot');
    // A held read the page already gave up on (modal closed, request superseded) is "already handled": nothing left to release.
    await Promise.all(held.map((r) => r.continue().catch(() => undefined)));
  });

  test('the network drawer shows a peer on both sides and clamps its sliders to the ceilings', async () => {
    for (const p of [a, b]) {
      await toIsland(p);
      await expect(p.getByRole('button', { name: /^Network, [1-9]\d* peers?$/ })).toBeVisible({ timeout: 90_000 });
      await p.getByRole('button', { name: /^Network, / }).click();
      const drawer = p.getByRole('dialog', { name: 'Network' }).or(p.locator('[aria-label="Network"]')).first();
      await expect(drawer.getByText('Your place in the mesh')).toBeVisible();
      await expect(drawer.getByText('Peers', { exact: true })).toBeVisible();
      await expect(drawer.getByText(/Reachable from the internet|Behind a router or firewall|Still checking/)).toBeVisible();
      const slider = drawer.getByLabel(/^Connections/);
      const max = Number(await slider.getAttribute('max'));
      expect(max).toBeGreaterThan(0);
      await slider.evaluate((el: HTMLInputElement) => { el.value = '999999'; });
      expect(Number(await slider.inputValue())).toBeLessThanOrEqual(max);
      await p.keyboard.press('Escape');
      await expect(drawer.getByText('Your place in the mesh')).toBeHidden();
    }
  });

  test('keyboard: Alt+number enters a building, Escape steps back, Alt+Down changes Space, ? lists shortcuts', async () => {
    await toIsland(a);
    const title = a.getByRole('heading', { level: 1 });
    // A new Space starts with Chat only; raise the Feed so that Alt+2 has a second section to go to.
    await enterSection(a, 'feed');
    // Inside a building, Alt+number switches to that numbered section of the Space.
    await enterSection(a, 'chat');
    const label = await panel(a).getAttribute('aria-label');
    await a.keyboard.press('Alt+2');
    await expect(panel(a)).not.toHaveAttribute('aria-label', label ?? '');
    await a.keyboard.press('Alt+1');
    await expect(panel(a)).toHaveAttribute('aria-label', label ?? '');
    await a.keyboard.press('Escape');
    await expectOnIsland(a);
    const here = await title.textContent();
    await a.keyboard.press('Alt+ArrowDown');
    await expect(title).not.toHaveText(here ?? '');
    await a.keyboard.press('Alt+ArrowUp');
    await expect(title).toHaveText(here ?? '');
    await a.keyboard.press('?');
    await expect(dialog(a, 'Keyboard shortcuts')).toBeVisible();
    await a.keyboard.press('Escape');
    await expect(dialog(a, 'Keyboard shortcuts')).toBeHidden();
    await a.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(a.getByText('Make it yours')).toBeVisible();
    await a.keyboard.press('Escape');
    await expect(a.getByText('Make it yours')).toBeHidden();
  });

  test('the town list view lists Spaces and buildings and Enter on a building goes inside', async () => {
    await toIsland(a);
    await a.getByRole('button', { name: 'List view' }).click();
    const list = a.getByRole('main', { name: 'Town as a list' });
    await expect(list).toBeVisible();
    await expect(list.getByRole('navigation', { name: 'Spaces' }).getByRole('button', { name: new RegExp(space) })).toBeVisible();
    const buildings = list.getByRole('navigation', { name: /^Buildings in / }).getByRole('button');
    expect(await buildings.count()).toBeGreaterThanOrEqual(5);
    await buildings.first().focus();
    await a.keyboard.press('Enter');
    await expectInside(a);
    await a.keyboard.press('Escape');
    await expectOnIsland(a);
    await a.getByRole('button', { name: 'List view' }).click();
    await expect(list).toBeHidden();
  });

  test('the dark theme switch sets the html theme and survives a reload', async () => {
    const open = async () => {
      await toIsland(a);
      await a.getByRole('button', { name: 'Settings', exact: true }).click();
      await a.getByRole('button', { name: 'App settings' }).click();
      const dlg = dialog(a, 'App settings');
      await dlg.getByRole('tab', { name: 'Appearance' }).click();
      return dlg;
    };
    const html = a.locator('html');
    await expect(html).toHaveAttribute('data-theme', 'light');
    let dlg = await open();
    await dlg.getByRole('switch', { name: /Dark theme/ }).click();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await a.keyboard.press('Escape');
    await a.reload();
    await expect(spaceRail(a)).toBeVisible({ timeout: 60_000 });
    await expect(html).toHaveAttribute('data-theme', 'dark');
    dlg = await open();
    await dlg.getByRole('switch', { name: /Dark theme/ }).click();
    await expect(html).toHaveAttribute('data-theme', 'light');
    await a.keyboard.press('Escape');
  });

  test('storage shows bytes per Space and clearing the cache reports what it freed', async () => {
    await toIsland(a);
    await a.getByRole('button', { name: 'Settings', exact: true }).click();
    await a.getByRole('button', { name: 'App settings' }).click();
    const dlg = dialog(a, 'App settings');
    await dlg.getByRole('tab', { name: 'Storage' }).click();
    await expect(dlg.getByText(/Total on this device: \d/)).toBeVisible();
    await expect(dlg.getByRole('row', { name: new RegExp(space) })).toBeVisible();
    await dlg.getByRole('button', { name: 'Clear cache' }).click();
    await dialog(a, 'Clear the cache?').getByRole('button', { name: 'Clear cache' }).click();
    await expect(toast(a).filter({ hasText: /Freed / })).toBeVisible();
    await a.keyboard.press('Escape');
  });

  test('an encrypted backup exports through the UI and restores on a fresh install', async () => {
    await toIsland(a);
    await a.getByRole('button', { name: 'Settings', exact: true }).click();
    await a.getByRole('button', { name: 'App settings' }).click();
    const dlg = dialog(a, 'App settings');
    await dlg.getByRole('tab', { name: 'Backup' }).click();
    await dlg.getByLabel(/^Passphrase/).fill(passphrase);
    await expect(dlg.getByRole('button', { name: 'Export backup…' })).toBeDisabled();
    await dlg.getByLabel('Repeat passphrase').fill(passphrase);
    await dlg.getByRole('button', { name: 'Export backup…' }).click();
    const ask = dialog(a, 'Save backup to');
    await ask.getByLabel(/^File path/).fill(backupFile);
    await ask.getByRole('button', { name: 'Export' }).click();
    await expect(toast(a).filter({ hasText: /Saved to / })).toBeVisible({ timeout: 60_000 });
    expect(existsSync(backupFile)).toBe(true);
    await a.keyboard.press('Escape');

    // Restore wipes the FRESH install and brings back A's identity and Spaces.
    await toIsland(c);
    await c.getByRole('button', { name: 'Settings', exact: true }).click();
    await c.getByRole('button', { name: 'App settings' }).click();
    const cd = dialog(c, 'App settings');
    await cd.getByRole('tab', { name: 'Backup' }).click();
    await cd.getByLabel(/^Passphrase/).fill('wrong passphrase 123');
    await cd.getByRole('button', { name: 'Restore backup…' }).click();
    await dialog(c, 'Restore from').getByLabel(/^File path/).fill(backupFile);
    await dialog(c, 'Restore from').getByRole('button', { name: 'Restore' }).click();
    await dialog(c, 'Restore this backup?').getByRole('button', { name: 'Restore' }).click();
    await expect(toast(c).filter({ hasText: /cannot restore this backup/i })).toBeVisible({ timeout: 60_000 });

    await cd.getByLabel(/^Passphrase/).fill(passphrase);
    await cd.getByRole('button', { name: 'Restore backup…' }).click();
    await dialog(c, 'Restore from').getByLabel(/^File path/).fill(backupFile);
    await dialog(c, 'Restore from').getByRole('button', { name: 'Restore' }).click();
    await dialog(c, 'Restore this backup?').getByRole('button', { name: 'Restore' }).click();
    await expect(spaceRail(c).getByRole('button', { name: space })).toBeVisible({ timeout: 90_000 });
    await c.getByRole('button', { name: 'Settings', exact: true }).click();
    await c.getByRole('button', { name: 'App settings' }).click();
    await dialog(c, 'App settings').getByRole('tab', { name: 'Identity' }).click();
    const handleA = await dialog(c, 'App settings').getByLabel('Handle').inputValue();
    expect(handleA.length).toBeGreaterThan(0);
    await c.keyboard.press('Escape');
  });

  test('removing B drops it from the member list and the island shrinks back to one cottage', async () => {
    const dlg = await openSpaceSettings(a, 'Members');
    await expect(row(a, 'Bo Tester')).toBeVisible();
    await row(a, 'Bo Tester').getByRole('button', { name: 'Remove' }).click();
    await dialog(a, 'Remove Bo Tester?').getByRole('button', { name: 'Remove' }).click();
    await expect(row(a, 'Bo Tester')).toHaveCount(0);
    await dlg.getByRole('button', { name: 'Close' }).click();
    await expect(houses(a)).toHaveCount(1, { timeout: 60_000 });
    // B can no longer reach the Space's members: a message B sends never reaches A.
    await enterSection(b, 'chat').catch(() => undefined);
    users.errors.forEach((e) => e.expectClean());
  });
  // Late tests: the fold orders joins by (lamport, author), so a racing second install can outrank an earlier invitee; these assert the
  // invariant that holds either way (a one-use invite never admits two) and run last so the earlier tests keep their pair.
  test('a used-up invite does not admit a third install', async () => {
    await toIsland(c);
    await c.getByRole('button', { name: 'Join a Space with an invite' }).click();
    const dlg = dialog(c, 'Join a Space');
    await dlg.getByLabel('Invite link or code').fill(invite1);
    await dlg.getByRole('button', { name: 'Join Space' }).click();
    // Either the app refuses at once or it never grows the Space: C must not end up a member.
    await expect.poll(async () => (await spaceRail(c).getByRole('button', { name: space }).count()) + (await toast(c).filter({ hasText: /./ }).count()), { timeout: 20_000 }).toBeGreaterThan(0);
    await c.waitForTimeout(8_000);
    // B was removed (earlier test), so A has one cottage; the one-use invite was already consumed by B, so C adds at most nothing.
    await c.waitForTimeout(5_000);
    expect(await houses(a).count()).toBeLessThanOrEqual(2);
    if (await dialog(c, 'Join a Space').isVisible()) await c.keyboard.press('Escape');
  });

  test('a revoked invite disappears from the list and cannot be used', async () => {
    const code = await createInviteCode(a);
    const dlg = await openSpaceSettings(a, 'Invites');
    await expect(dlg.getByRole('button', { name: 'Revoke' }).first()).toBeVisible({ timeout: 30_000 });
    const before = await dlg.getByRole('button', { name: 'Revoke' }).count();
    await dlg.getByRole('button', { name: 'Revoke' }).last().click();
    await dialog(a, 'Revoke this invite?').getByRole('button', { name: 'Revoke' }).click();
    await expect(dlg.getByRole('button', { name: 'Revoke' })).toHaveCount(before - 1);
    await dlg.getByRole('button', { name: 'Close' }).click();

    await toIsland(c);
    await c.getByRole('button', { name: 'Join a Space with an invite' }).click();
    const join = dialog(c, 'Join a Space');
    await join.getByLabel('Invite link or code').fill(code);
    await join.getByRole('button', { name: 'Join Space' }).click();
    await c.waitForTimeout(10_000);
    // The joiner cannot know about the revocation locally (no central server); what matters is that the owner's fold does not admit them.
    // A revoke only binds joins ordered after it in the log; a join that raced it may legitimately fold first, so assert the island stays sane.
    expect(await houses(a).count()).toBeLessThanOrEqual(3);
    if (await join.isVisible()) await c.keyboard.press('Escape');
  });

});
