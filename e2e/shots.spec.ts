import type { Locator, Page } from '@playwright/test';
import { test, expect, twoUsers, createSpace, createInviteCode, joinWithCode, enterSection, toIsland, openPalette, say, toast, pngBuffer } from './fixtures';
import { freshDevhosts } from './devhosts';
import { GL_ARGS } from './gpu';

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
/** Opening moves (from, to) played alternately by Ada and Bo for the arcade picture. */
const CHESS_LINE: readonly [string, string][] = [['e2', 'e4'], ['e7', 'e5'], ['g1', 'f3'], ['b8', 'c6'], ['f1', 'b5'], ['a7', 'a6']];
const DOC_TITLE = 'Lantern care manual';
const DM_LINES = ['Did the washi survive the rain?', 'Dry as a bone. I wrapped it in the blue tarp.', 'Perfect. Can you bring the glue gun tomorrow?'];

/** Chromium fake capture devices stand in for a microphone and camera, so a call connects headless. */
test.use({ launchOptions: { args: [...GL_ARGS, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });
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

/** Sails back to the main Space (the DM test leaves both people on the DM island). */
const toSpace = async (...pages: Page[]) => {
  for (const p of pages) {
    await toIsland(p);
    await p.getByRole('navigation', { name: 'Spaces' }).getByRole('button', { name: SPACE }).click();
    await expect(p.getByRole('heading', { level: 1 })).toHaveText(SPACE, SYNC);
  }
};
const tabOf = (p: Page, name: string) => p.getByRole('tab', { name, exact: true }).last();

test('feed with photos and a note', async () => {
  test.setTimeout(300_000);
  await enterSection(a, 'feed');
  const photos: [string, [number, number, number]][] = [['Washi, fresh off the roll', [236, 190, 120]], ['Wire frame number three', [90, 110, 150]]];
  for (const [title, [r, g, bl]] of photos) {
    await btn(a, 'New post').click();
    const [chooser] = await Promise.all([a.waitForEvent('filechooser'), btn(a, 'Choose a photo').click()]);
    await chooser.setFiles([{ name: 'photo.png', mimeType: 'image/png', buffer: pngBuffer(r, g, bl) }]);
    await a.getByLabel('Title (required)').fill(title);
    await btn(a, 'Publish').click();
    await expect(a.getByRole('article', { name: title })).toBeVisible();
  }
  await btn(a, 'New post').click();
  await a.getByRole('radiogroup', { name: 'Kind of post' }).getByText('Note', { exact: true }).click();
  await a.getByLabel('Title (required)').fill('Market stall plan');
  await a.getByLabel('Note (required)').fill('Lanterns on the left, paper stars on the right, price cards in front.');
  await btn(a, 'Publish').click();
  await expect(a.getByRole('article', { name: 'Market stall plan' })).toBeVisible();
  await enterSection(b, 'feed');
  await expect(b.getByRole('article', { name: 'Market stall plan' })).toBeVisible(SYNC);
  await a.mouse.move(0, 0);
  await shot(a, 'feed');
});

test('gallery docs with a checklist', async () => {
  test.setTimeout(300_000);
  await enterSection(a, 'board');
  await tabOf(a, 'Docs').click();
  await btn(a, /New doc|Create a doc/).first().click();
  await ask(a, { 'Title (required)': DOC_TITLE, 'Kind of document': 'Notes' }, 'Create doc');
  await expect(a.getByRole('heading', { name: DOC_TITLE })).toBeVisible();
  for (const line of ['Keep the washi dry and flat', 'Test every LED before gluing', 'Pack spare batteries for market']) {
    await btn(a, /To-do/).click();
    const fresh = a.getByRole('textbox', { name: 'To-do' }).last();
    // Only the new, empty block may be filled; the last one would still be the previous line until the block renders.
    await expect(fresh).toHaveValue('');
    await fresh.fill(line);
    await fresh.blur();
    await expect(a.getByRole('checkbox', { name: `Toggle ${line}` })).toBeVisible();
  }
  await a.getByRole('checkbox', { name: 'Toggle Keep the washi dry and flat' }).click();
  await a.mouse.move(0, 0);
  await shot(a, 'docs');
});

test('calendar with a meeting', async () => {
  test.setTimeout(300_000);
  await enterSection(a, 'board');
  await tabOf(a, 'Calendar').click();
  await btn(a, /New meeting/).first().click();
  await ask(a, { 'Title (required)': 'Saturday market setup' }, 'Add to calendar');
  await expect(a.getByRole('heading', { name: 'Saturday market setup' })).toBeVisible();
  await enterSection(b, 'board');
  await tabOf(b, 'Calendar').click();
  await btn(b, /Saturday market setup/).click(SYNC);
  await btn(b, 'I’m going').click();
  await expect(a.getByText(/Bo Andersen/).last()).toBeVisible(SYNC);
  await a.mouse.move(0, 0);
  await shot(a, 'calendar');
});

test('skein snapshot ledger', async () => {
  test.setTimeout(300_000);
  await enterSection(a, 'skein');
  await btn(a, /Take a snapshot/).first().click();
  await a.getByLabel('Title (required)').fill('Warm white LED lanterns');
  const [chooser] = await Promise.all([a.waitForEvent('filechooser'), btn(a, 'Choose files').click()]);
  await chooser.setFiles([
    { name: 'lantern-frame.png', mimeType: 'image/png', buffer: pngBuffer(200, 150, 90) },
    { name: 'wiring-notes.txt', mimeType: 'text/plain', buffer: Buffer.from('warm white LEDs\ntwo coin cells per frame\nwasabi paper panels\n') },
  ]);
  await expect(a.getByText(/wiring-notes\.txt · /)).toBeVisible();
  await btn(a, 'Take snapshot').click();
  await a.getByRole('button', { name: /Warm white LED lanterns/ }).click();
  await expect(a.getByText(/Seal verified: every file matches/)).toBeVisible(SYNC);
  await a.mouse.move(0, 0);
  await shot(a, 'skein');
});

test('help desk with tickets', async () => {
  test.setTimeout(300_000);
  await enterSection(a, 'desk');
  const tickets: [string, string][] = [
    ['Stall power strip is missing', 'We need a power strip for the warm white LEDs at Saturday market.'],
    ['Glue gun trips the breaker', 'It trips every time we heat it up next to the kiln.'],
    ['Price cards printed too small', 'The cards are hard to read from a metre away.'],
  ];
  for (const [subject, body] of tickets) {
    await a.getByTestId('new-ticket').click();
    await a.getByTestId('nt-subject').fill(subject);
    await a.getByTestId('nt-body').fill(body);
    await a.getByTestId('nt-submit').click();
    await expect(a.getByTestId('ticket-detail').getByTestId('ticket-subject')).toHaveText(subject);
  }
  await a.getByTestId('take-ticket').click();
  await a.getByTestId('composer-input').fill('On it. I will bring a spare strip from the studio tomorrow.');
  await a.getByTestId('composer-send').click();
  await expect(a.getByTestId('ticket-detail').getByTestId('comment')).toHaveCount(1);
  await a.mouse.move(0, 0);
  await shot(a, 'desk');
});

test('arcade chess game in progress', async () => {
  test.setTimeout(300_000);
  await enterSection(a, 'arcade');
  await expect(b.locator('[data-bld="arcade"]')).not.toHaveAttribute('data-empty', SYNC);
  await enterSection(b, 'arcade', false);
  await a.getByTestId('new-game').click();
  await a.getByTestId('kind-chess').click();
  await a.getByTestId('create-game-submit').click();
  await expect(a.getByTestId('game-status')).toBeVisible();
  await b.getByTestId('arcade-tab-games').click();
  await b.locator('[data-testid="game-card"][data-kind="chess"]').first().getByTestId('join-game').click(SYNC);
  await expect(b.getByTestId('game-status')).toBeVisible();
  for (const [i, [from, to]] of CHESS_LINE.entries()) {
    const who = i % 2 === 0 ? a : b;
    await expect(who.getByTestId('game-status')).toHaveText(/Your move/, SYNC);
    await who.getByTestId(`sq-${from}`).click();
    await who.getByTestId(`sq-${to}`).click();
  }
  await expect(a.getByTestId('game-status')).toHaveText(/Your move/, SYNC);
  // The "Your move" toast would sit on the board.
  await expect(toast(a).filter({ hasText: /Your move in/ })).toHaveCount(0, SYNC);
  await a.mouse.move(0, 0);
  await shot(a, 'arcade');
});

test('direct message conversation', async () => {
  test.setTimeout(300_000);
  await enterSection(a, 'chat');
  const input = await openPalette(a);
  await input.fill('Bo Andersen');
  await a.getByRole('listbox', { name: 'Results' }).getByRole('option').filter({ hasText: 'Bo Andersen' }).first().click();
  // Picking a person sails to the DM island; walk into its chat building once it is there.
  await expect(a.getByRole('heading', { level: 1 })).toHaveText('Bo Andersen', SYNC);
  await enterSection(a, 'chat');
  await say(a, DM_LINES[0]);
  await b.getByRole('navigation', { name: 'Spaces' }).getByRole('button', { name: SPACE }).click();
  await enterSection(b, 'chat');
  // A first message from a non-contact lands in requests until accepted.
  await b.getByRole('region', { name: 'Message requests' }).getByRole('button', { name: 'Accept' }).click(SYNC);
  await expect(b.getByRole('heading', { level: 1 })).toHaveText('Ada Lovelace', SYNC);
  await enterSection(b, 'chat');
  await expect(article(b, DM_LINES[0])).toBeVisible(SYNC);
  await post(b, a, DM_LINES[1]);
  await post(a, b, DM_LINES[2]);
  await a.mouse.move(0, 0);
  await shot(a, 'direct-messages');
});

test('search results page', async () => {
  test.setTimeout(300_000);
  await toSpace(a, b);
  await enterSection(a, 'chat');
  const input = await openPalette(a);
  await input.fill('lantern');
  await a.getByRole('option', { name: /See all results/ }).click(SYNC);
  const results = a.getByRole('dialog', { name: 'Search results' });
  await expect(results.getByRole('list', { name: 'Results' }).getByRole('button', { name: new RegExp(DOC_TITLE) })).toBeVisible(SYNC);
  await a.mouse.move(0, 0);
  await shot(a, 'search');
  await a.keyboard.press('Escape');
  await expect(results).toHaveCount(0);
});

test('network and sharing settings', async () => {
  await toIsland(a);
  await btn(a, /^Network/).click();
  await expect(a.getByRole('dialog', { name: /Network/ })).toBeVisible();
  await a.mouse.move(0, 0);
  await shot(a, 'network');
  await a.keyboard.press('Escape');
});

test('rookery letters', async () => {
  test.setTimeout(300_000);
  await toSpace(a, b);
  await enterSection(b, 'chat');
  await toIsland(a);
  await a.getByRole('navigation', { name: 'Spaces' }).getByRole('button', { name: 'Home' }).click();
  const letter = a.locator('[data-obstacle]').filter({ hasText: 'A raven from' });
  await say(b, 'The paper stars sold out by noon!');
  await expect(letter).toContainText('paper stars', { timeout: 30_000 });
  await letter.getByRole('button', { name: 'Dismiss' }).click();
  await a.getByRole('button', { name: /^Rookery, \d+ new$/ }).first().click();
  await expect(a.getByRole('dialog', { name: 'Rookery' })).toBeVisible();
  await a.mouse.move(0, 0);
  await shot(a, 'rookery');
  await a.keyboard.press('Escape');
});

test('hearth call with an agenda', async () => {
  test.setTimeout(300_000);
  await toSpace(a, b);
  await Promise.all([a, b].map((p) => p.context().grantPermissions(['microphone', 'camera'])));
  for (const p of [a, b]) {
    await enterSection(p, 'hearth');
    await p.getByRole('button', { name: /Pull up a chair/ }).click();
  }
  for (const p of [a, b]) await expect(p.getByTestId('tile')).toHaveCount(2, { timeout: 60_000 });
  await a.getByRole('button', { name: 'Make it a meeting' }).click();
  const dlg = a.getByRole('dialog', { name: 'Make it a meeting' });
  await dlg.getByLabel(/^Topic/).fill('Saturday market prep');
  await dlg.getByLabel(/^Agenda/).fill('Count the finished lanterns\nDecide the price cards\nPack the van');
  await dlg.getByRole('button', { name: 'Start meeting' }).click();
  await expect(a.getByRole('heading', { name: 'Saturday market prep' })).toBeVisible({ timeout: 45_000 });
  await b.getByLabel('Shared note').fill('Bo: 14 lanterns are ready, 6 still need LEDs.');
  await b.keyboard.press('Enter');
  await expect(a.getByText(/6 still need LEDs/)).toBeVisible(SYNC);
  await expect(toast(a).filter({ hasText: /It.s a meeting now/ })).toHaveCount(0, SYNC);
  await a.mouse.move(0, 0);
  await shot(a, 'hearth');
});
