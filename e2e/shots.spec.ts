import type { Locator, Page } from '@playwright/test';
import { test, expect, twoUsers, createSpace, createInviteCode, joinWithCode, enterSection, toIsland, openPalette, say, toast } from './fixtures';
import { freshDevhosts } from './devhosts';

/**
 * README and site screenshots, taken headless from the real app: two devhosts, real P2P sync, content typed through the UI.
 * Opt-in only (`npm run shots`): it writes into docs/screenshots and is not part of the test suite.
 */
const SHOTS_DIR = 'docs/screenshots';
/** JPEG keeps the 3D town readable at a fraction of the PNG size, so the history stays small. */
const SHOT_QUALITY = 86;
/** Lets the scene settle (labels placed, camera eased) before a capture. */
const SETTLE_MS = 2_500;
const SYNC = { timeout: 60_000 };
const SPACE = 'Lantern Makers';
const TAGLINE = 'Paper, wire and late nights';

test.skip(!process.env.SHOTS, 'screenshots run only with SHOTS=1 (npm run shots)');
test.describe.configure({ mode: 'serial' });

let users: Awaited<ReturnType<typeof twoUsers>>;
let a: Page;
let b: Page;

const article = (p: Page, text: string): Locator => p.getByRole('article').filter({ hasText: text });
const btn = (p: Page, name: string | RegExp) => p.getByRole('button', { name });
const shot = async (p: Page, name: string) => {
  // Transient chrome (a toast, someone typing) is not part of the picture.
  await expect(toast(p).filter({ hasText: /Everyone can see it now/ })).toHaveCount(0, SYNC);
  await expect(p.getByText(/ is typing/)).toBeHidden(SYNC);
  await p.waitForTimeout(SETTLE_MS);
  await p.screenshot({ path: `${SHOTS_DIR}/${name}.jpg`, type: 'jpeg', quality: SHOT_QUALITY });
};
/** `from` says a line and `to` must receive it, so both sides of the conversation are real synced messages. */
const post = async (from: Page, to: Page, text: string) => {
  await say(from, text);
  await expect(article(to, text)).toBeVisible(SYNC);
};
async function ask(p: Page, fields: Record<string, string>, submit: string): Promise<void> {
  for (const [label, value] of Object.entries(fields)) await p.getByLabel(label).fill(value);
  await btn(p, submit).click();
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(600_000);
  await freshDevhosts();
  users = await twoUsers(browser, ['Ada Lovelace', 'Bo Andersen']);
  ({ a, b } = users);
  await toIsland(a);
  await btn(a, 'New Space').click();
  await createSpace(a, SPACE, TAGLINE);
  await joinWithCode(b, await createInviteCode(a), SPACE);
});
test.afterAll(async () => { await users.close(); });

test('chat between two peers', async () => {
  test.setTimeout(300_000);
  await enterSection(a, 'chat');
  await enterSection(b, 'chat');
  await post(a, b, 'The new washi arrived this morning. It holds a crease far better than the last batch.');
  await post(b, a, 'Great. I can bend the wire frames tonight if you cut the panels.');
  await post(a, b, 'Deal. Twelve lanterns for the market on Saturday?');
  const last = 'Twelve it is. I will bring the warm white LEDs.';
  await post(b, a, last);
  await article(a, last).getByRole('button', { name: 'Add reaction' }).click();
  const picker = a.getByRole('dialog', { name: 'Emoji' });
  await picker.getByPlaceholder('Search emoji').fill('heart');
  await picker.getByRole('button').first().dispatchEvent('click');
  await expect(article(b, last).getByRole('button', { name: /, 1$/ })).toBeVisible(SYNC);
  await a.mouse.move(0, 0);
  await shot(a, 'chat');
});

test('board with real cards', async () => {
  test.setTimeout(300_000);
  await enterSection(a, 'board');
  await a.getByRole('tab', { name: 'Board', exact: true }).last().click();
  await btn(a, /Create the first board|New column/).first().click();
  await ask(a, { 'Name (required)': 'Saturday market' }, 'Create board');
  const col = (name: string) => a.getByRole('region', { name, exact: true });
  for (const [title, tag] of [['Cut washi panels', 'paper'], ['Bend wire frames', 'wire'], ['Print price cards', 'stall']] as const) {
    await col('To do').getByRole('button', { name: /Add a card/ }).click();
    await ask(a, { 'Title (required)': title, Tag: tag }, 'Add card');
    await expect(col('To do').getByText(title)).toBeVisible();
  }
  await col('To do').getByRole('button', { name: 'Move Bend wire frames to another column' }).click();
  await a.getByRole('menuitem', { name: 'Doing' }).click();
  await expect(col('Doing').getByText('Bend wire frames')).toBeVisible();
  await shot(a, 'board');
});

test('town with raised buildings', async () => {
  test.setTimeout(300_000);
  await enterSection(a, 'feed');
  await toIsland(a);
  await a.mouse.move(0, 0);
  await shot(a, 'town');
});

test('command palette', async () => {
  await toIsland(a);
  const input = await openPalette(a);
  await input.fill('lantern');
  await shot(a, 'palette');
  await a.keyboard.press('Escape');
});

test('every island', async () => {
  await toIsland(b);
  await b.keyboard.press('m');
  await shot(b, 'islands');
  await b.keyboard.press('Escape');
});
