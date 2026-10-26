import { deflateSync } from 'node:zlib';
import { test as base, expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { BOOT_FACTOR, BOOT_WAIT } from './gpu';

export { expect };

export type SectionId = 'chat' | 'hearth' | 'feed' | 'board' | 'skein' | 'desk' | 'arcade';

/** Two real devhosts (ARCHITECTURE section 9): two identities, two data dirs, synced through the real P2P stack. */
const BASE = Number(process.env.E2E_BASE ?? 7781);
export const UI_URL = `http://localhost:${process.env.E2E_UI_PORT ?? 3210}`;
export const DEVHOST_A = `http://127.0.0.1:${BASE}`;
export const DEVHOST_B = `http://127.0.0.1:${BASE + 1}`;
export const DEVHOST_FRESH = `http://127.0.0.1:${BASE + 2}`;

/** Console noise that is not an app error (software-GL driver chatter). */
const IGNORED = [/GL Driver Message/i, /GPU stall/i, /swiftshader/i];

/** Unique names so repeated runs against a persistent devhost never collide. */
export const unique = (prefix: string): string => `${prefix} ${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

type ErrorWatch = { expectClean(): void };
/** Every page watched in this worker; the auto `consoleClean` fixture checks them all after each test. */
const watches = new Set<ErrorWatch>();

/** Watches a page for console and page errors; call `expectClean()` at the end of a test (the `consoleClean` fixture also does after every test). */
export function watchErrors(page: Page): ErrorWatch {
  let errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !IGNORED.some((re) => re.test(m.text()))) errors.push(`console.error: ${m.text()} (${m.location().url})`);
  });
  // Drains what arrived since the last check, so an error fails the test it happened in and is reported once.
  const watch: ErrorWatch = {
    expectClean: () => { const seen = errors; errors = []; expect(seen, 'no console errors or page errors').toEqual([]); },
  };
  watches.add(watch);
  page.on('close', () => { watches.delete(watch); });
  return watch;
}

/** Gate screens, by their headings (the profile name field and the create-Space name field share a label). */
const gate = (page: Page) => ({
  town: page.getByRole('navigation', { name: 'Spaces' }),
  terms: page.getByRole('heading', { name: 'Terms, privacy and sharing' }),
  profile: page.getByRole('heading', { name: 'Tell people your name' }),
  welcome: page.getByRole('heading', { name: 'Start an island, or join one' }),
});

/** Accepts the Terms gate (both checkboxes) and continues. */
export async function acceptTerms(page: Page): Promise<void> {
  await page.getByRole('checkbox', { name: /accept the Terms of Use/i }).check();
  await page.getByRole('checkbox', { name: /share these resources/i }).check();
  await page.getByRole('button', { name: /^Continue/ }).click();
  await expect(page.getByRole('heading', { name: 'Terms, privacy and sharing' })).toBeHidden();
}

/**
 * Walks every gate that is showing (Terms, profile, create or join) until the town is up. Idempotent on a used devhost.
 * `studio` creates a first Space when the Welcome screen shows; otherwise it is skipped.
 */
export async function bootApp(page: Page, host: string, who: string, keepTour = false, studio = true): Promise<void> {
  // The tour opens on a timer after boot and would cover whatever the test clicks next; opt out as a returning user would.
  if (!keepTour) await page.addInitScript(() => { try { localStorage.setItem('hermodr.welcomed', '1'); } catch { /* storage blocked: the tour may show */ } });
  await page.goto(`/?devhost=${encodeURIComponent(host)}`);
  const g = gate(page);
  for (let step = 0; step < 6; step += 1) {
    await expect(g.town.or(g.terms).or(g.profile).or(g.welcome)).toBeVisible({ timeout: 60_000 * BOOT_FACTOR });
    if (await g.town.isVisible()) break;
    if (await g.terms.isVisible()) {
      await acceptTerms(page);
    } else if (await g.profile.isVisible()) {
      // The form can re-mount while the node starts; retry until the name sticks and Continue is live.
      await expect(async () => {
        if (!(await g.profile.isVisible())) return;
        await page.getByLabel(/^Name/).fill(who);
        await expect(page.getByRole('button', { name: /^Continue/ })).toBeEnabled({ timeout: 2_000 });
        await page.getByRole('button', { name: /^Continue/ }).click({ timeout: 5_000 });
      }).toPass({ timeout: 40_000 });
    } else if (await g.welcome.isVisible()) {
      if (studio) await createSpace(page, unique('Studio'), 'A place for tests');
      else await page.getByRole('button', { name: 'Skip for now' }).click();
    }
  }
  // The town canvas mounts after the scene module loads and the GL context is created: under software GL that waits on the shared GPU process, which the other page's shader compiles keep busy.
  await expect(g.town).toBeVisible();
  await expect(page.locator('canvas')).toHaveCount(1, { timeout: BOOT_WAIT.canvas });
  await expect(page.getByText('A messenger for everything you make together')).toBeHidden({ timeout: BOOT_WAIT.intro });
  await expect(page.getByText(/^Raising/)).toBeHidden({ timeout: BOOT_WAIT.raising });
  if (!keepTour) await dismissOnboarding(page);
}

/** The welcome tour opens after the intro on a fresh browser profile; skip it when it shows. */
export async function dismissOnboarding(page: Page): Promise<void> {
  const skip = page.getByRole('button', { name: 'Skip' });
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

/** Creates a Space from the Welcome screen or the new-Space dialog, whichever is open, and waits for the town header. */
export async function createSpace(page: Page, name: string, tagline = '', kind: 'Team' | 'Community' | 'Friends' = 'Team'): Promise<void> {
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: /Create a Space/i }) });
  const scope = (await dialog.isVisible()) ? dialog : page;
  await scope.getByLabel(/^Name/).fill(name);
  if (tagline) await scope.getByLabel(/Tagline/i).fill(tagline);
  await scope.locator('label.seg-opt', { hasText: kind }).click();
  await scope.getByRole('button', { name: /Create Space/i }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
}

/** The inside panel (always mounted, clipped away while on the island). */
export const panel = (page: Page): Locator => page.locator('section[aria-label]').filter({ has: page.getByRole('button', { name: /Island/ }) });

/** Resolves once the panel has opened (pointer events on, clip circle expanded). */
export async function expectInside(page: Page): Promise<void> {
  await expect(panel(page)).toHaveCSS('pointer-events', 'auto');
  await expect(page.getByRole('button', { name: /Island/ })).toBeInViewport();
}

export async function expectOnIsland(page: Page): Promise<void> {
  await expect(panel(page)).toHaveCSS('pointer-events', 'none');
}

/**
 * Walks up to a building through its DOM label and steps inside (label click, then the door card CTA).
 * Canvas picking is position dependent; the label buttons are the stable route.
 */
export async function enterBuilding(page: Page, id: SectionId): Promise<void> {
  await page.locator(`[data-bld="${id}"] button`).dispatchEvent('click');
  const cta = id === 'hearth' ? 'Take a seat' : 'Step inside';
  const door = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: cta }) });
  await door.getByRole('button', { name: cta }).click();
  await expectInside(page);
}

/** Opens the command palette with the keyboard and returns its input. */
export async function openPalette(page: Page): Promise<Locator> {
  await page.keyboard.press('Control+k');
  const input = page.getByPlaceholder(/Search people, channels/);
  await expect(input).toBeFocused();
  return input;
}

/** Switches section from the panel header tabs (aria-label = section label). */
export async function goTab(page: Page, label: string): Promise<void> {
  await panel(page).getByRole('tablist').first().getByRole('button', { name: label }).click();
}

/** The toast bubble: role status, or alert for an error. Filter it with `{ hasText }`; the text sits beside a decorative glyph. */
export const toast = (page: Page): Locator => page.getByRole('status').or(page.getByRole('alert'));

/** A valid solid-colour PNG (8x8), built from real zlib/CRC so the browser decodes it as an image. */
export function pngBuffer(r: number, g: number, b: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf: Buffer) => { let c = 0xffffffff; for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const size = 8;
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => [r, g, b]).flat())]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** Blob chunk size in bytes (hermod-core `CHUNK_SIZE`): a blob is fetched and stored per chunk of this size. */
export const BLOB_CHUNK_BYTES = 256 * 1024;

/** A valid PNG followed by `chunks` whole chunks of non-repeating trailer bytes (decoders ignore data after IEND), so the blob spans several chunks. */
export function multiChunkPng(r: number, g: number, b: number, chunks: number): Buffer {
  const trailer = Buffer.alloc(chunks * BLOB_CHUNK_BYTES);
  for (let i = 0; i < trailer.length; i += 1) trailer[i] = (i * 31 + (i >>> 8)) & 0xff;
  return Buffer.concat([pngBuffer(r, g, b), trailer]);
}

/** Returns to the island from inside a building (no-op when already outside). */
export async function toIsland(page: Page): Promise<void> {
  const back = page.getByRole('button', { name: /Island/ });
  if (await panel(page).evaluate((el) => getComputedStyle(el).pointerEvents === 'auto').catch(() => false)) {
    await back.click();
    await expectOnIsland(page);
  }
}

/**
 * Enters a building from the island. A raised building goes through its door card; an empty plot
 * opens straight onto the "Raise" prompt, which is accepted when `raise` is set.
 */
export async function enterSection(page: Page, id: SectionId, raise = true): Promise<void> {
  await toIsland(page);
  await page.locator(`[data-bld="${id}"] button`).dispatchEvent('click');
  const cta = id === 'hearth' ? 'Take a seat' : 'Step inside';
  const door = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: cta }) });
  const raiseBtn = page.getByRole('button', { name: /^\s*Raise /i });
  await expect(door.or(raiseBtn).first()).toBeVisible();
  if (await door.isVisible()) await door.getByRole('button', { name: cta }).click();
  else if (raise) {
    await raiseBtn.click();
    await expect(page.getByText(/up in .*Everyone can see it now/)).toBeVisible();
  }
  await expectInside(page);
}

/** Opens the Invite dialog, creates an invite and returns its code. Needs the island view. */
export async function createInviteCode(page: Page, opts: { max?: string } = {}): Promise<string> {
  await toIsland(page);
  await page.getByRole('button', { name: 'Invite people' }).click();
  const dlg = page.getByRole('dialog', { name: /Invite people to/ });
  if (opts.max) await dlg.getByLabel(/Most/).fill(opts.max);
  await dlg.getByRole('button', { name: 'Create invite' }).click();
  const code = await dlg.getByLabel('Invite code').inputValue();
  expect(code.length).toBeGreaterThan(20);
  await dlg.getByRole('button', { name: 'Close' }).click();
  return code;
}

/** Joins with a pasted code through the rail's join dialog; resolves when the new Space's island is up. */
export async function joinWithCode(page: Page, code: string, spaceName: string): Promise<void> {
  await toIsland(page);
  await page.getByRole('button', { name: 'Join a Space with an invite' }).click();
  const dlg = page.getByRole('dialog', { name: 'Join a Space' });
  await dlg.getByLabel('Invite link or code').fill(code);
  await dlg.getByRole('button', { name: 'Join Space' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(spaceName, { timeout: 60_000 });
}

/** Two booted users in their own browser contexts, on devhosts A and B. */
export async function twoUsers(browser: Browser, names: [string, string] = ['Ada Tester', 'Bo Tester']): Promise<{ a: Page; b: Page; errors: { expectClean(): void }[]; close(): Promise<void> }> {
  const ctxs = await Promise.all([0, 1].map(() => browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, baseURL: UI_URL, permissions: ['clipboard-read', 'clipboard-write'] })));
  const [a, b] = await Promise.all(ctxs.map((c) => c.newPage()));
  const errors = [watchErrors(a), watchErrors(b)];
  // Together, not one after the other: under software GL the first page's late shader compiles would otherwise stall the second page's boot (measured: 36 s together vs 70 s in turn on 4 vCPUs).
  await Promise.all([bootApp(a, DEVHOST_A, names[0], false, false), bootApp(b, DEVHOST_B, names[1], false, false)]);
  return { a, b, errors, close: async () => { await Promise.all(ctxs.map((c) => c.close())); } };
}

/** A creates a Space and B joins it through a real invite code. */
export async function sharedSpace(a: Page, b: Page, name: string): Promise<void> {
  await toIsland(a);
  await a.getByRole('button', { name: 'New Space' }).click();
  await createSpace(a, name, 'Shared in tests');
  const code = await createInviteCode(a);
  await joinWithCode(b, code, name);
}

/** Space settings dialog (admins: members, roles, invites). Needs the island view. */
export async function openSpaceSettings(page: Page, tab?: 'General' | 'Members' | 'Invites' | 'Safety'): Promise<Locator> {
  await toIsland(page);
  await page.getByRole('button', { name: 'Space settings' }).click();
  const dlg = page.getByRole('dialog').filter({ has: page.getByText('Space settings') });
  if (tab) await dlg.getByRole('tab', { name: tab }).click();
  return dlg;
}

/** Posts a chat message in the open channel. */
export async function say(page: Page, text: string): Promise<void> {
  await page.getByLabel('Message', { exact: true }).fill(text);
  await page.keyboard.press('Enter');
}

/** Raven letters can arrive at any time now that they are real; dismiss one if present. */
export async function dismissLetter(page: Page): Promise<void> {
  const btn = page.getByRole('button', { name: 'Dismiss' });
  if (await btn.isVisible()) await btn.click();
}

interface Fixtures {
  /** Auto fixture: asserts a clean console on every watched page after each test. */
  consoleClean: void;
  /** User A, booted against the first devhost with every gate passed. */
  app: Page;
  /** Name User A chose in the profile step. */
  userName: string;
}

export const test = base.extend<Fixtures>({
  reducedMotion: 'reduce',
  // Applied to every spec: any console or page error on any watched page fails the test during which it appeared.
  consoleClean: [async ({}, run) => { await run(); for (const w of [...watches]) w.expectClean(); }, { auto: true }],
  userName: ['Ada Tester', { option: true }],
  app: async ({ page, userName }, run) => {
    const errors = watchErrors(page);
    await bootApp(page, DEVHOST_A, userName);
    await run(page);
    errors.expectClean();
  },
});

/** A second user on the second devhost in its own browser context, for multi-user specs. */
export async function secondUser(context: BrowserContext, who = 'Bo Tester'): Promise<Page> {
  const browser = context.browser();
  if (!browser) throw new Error('browser is required for a second context');
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, baseURL: UI_URL });
  const page = await ctx.newPage();
  await bootApp(page, DEVHOST_B, who);
  return page;
}
