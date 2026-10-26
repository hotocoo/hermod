import type { Locator, Page } from '@playwright/test';
import { test, expect, twoUsers, sharedSpace, enterSection, say, unique, pngBuffer, multiChunkPng, BLOB_CHUNK_BYTES, openSpaceSettings, DEVHOST_B } from './fixtures';
import { freshDevhosts } from './devhosts';

/** Every spec file starts on three empty devhosts, so no spec depends on state a former one left. */
test.beforeAll(async () => { test.setTimeout(180_000); await freshDevhosts(); });

/**
 * Chat features with two real users (two devhosts, real P2P sync). Covers FEATURES A-005 threads, A-006 reactions,
 * A-008/W-009 attachments, A-002 channels, A-011 edit, A-012 delete, A-013/S-001 search, A-014 mentions,
 * E-007 block, U-005 palette, U-006 shortcuts.
 */
test.describe.configure({ mode: 'serial' });

let users: Awaited<ReturnType<typeof twoUsers>>;
let a: Page;
let b: Page;
/** Whole chunks in the multi-chunk range test blob: enough that a mid-file seek lands in a chunk neither first nor last. */
const MULTI_CHUNK_COUNT = 4;
const space = unique('Chatters');

const article = (p: Page, text: string): Locator => p.getByRole('article').filter({ hasText: text });
const invoke = async <T,>(host: string, cmd: string, args: Record<string, unknown> = {}): Promise<T> => {
  const res = await fetch(`${host}/invoke/${cmd}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) });
  if (!res.ok) throw new Error(`${cmd}: ${await res.text()}`);
  return (await res.json()) as T;
};
/** `from` says a line and `to` must receive it; keeps authors alternating so every message shows its byline. */
const post = async (from: Page, to: Page, text: string) => {
  await say(from, text);
  await expect(article(to, text)).toBeVisible({ timeout: 45_000 });
};

test.beforeAll(async ({ browser }) => {
  users = await twoUsers(browser);
  ({ a, b } = users);
  await sharedSpace(a, b, space);
  await enterSection(a, 'chat');
  await enterSection(b, 'chat');
});
test.afterAll(async () => { await users.close(); });

test('threads: replies from both users, count matches on both peers (A-005)', async () => {
  const root = unique('thread-root');
  await post(a, b, root);
  await article(a, root).getByRole('button', { name: 'Reply in the margin' }).click();
  await a.getByRole('textbox', { name: 'Reply in the margin' }).fill('first reply from Ada');
  await a.keyboard.press('Enter');
  await expect(article(b, root).getByText('1 reply in the margin')).toBeVisible({ timeout: 45_000 });
  await article(b, root).getByText('1 reply in the margin').click();
  const pane = b.getByRole('region', { name: 'Thread' });
  await expect(pane.getByText('first reply from Ada')).toBeVisible();
  await b.getByRole('textbox', { name: 'Reply in the margin' }).fill('second reply from Bo');
  await b.keyboard.press('Enter');
  await expect(article(a, root).getByText('2 replies in the margin')).toBeVisible({ timeout: 45_000 });
  await expect(article(b, root).getByText('2 replies in the margin')).toBeVisible();
  await a.getByRole('button', { name: 'Close thread' }).click();
  await b.getByRole('button', { name: 'Close thread' }).click();
});

// M-042: the thread list shows open and archived threads of the channel; Archive and Reopen send thread.state and sync to the other peer.
test('thread list: archive and reopen a thread (M-042)', async () => {
  const root = unique('thread-list-root');
  await post(a, b, root);
  await article(a, root).getByRole('button', { name: 'Reply in the margin' }).click();
  await a.getByRole('textbox', { name: 'Reply in the margin' }).fill('reply for the list');
  await a.keyboard.press('Enter');
  await a.getByRole('button', { name: 'Close thread' }).click();
  // Only the thread root's author or an admin may archive (core authz), so Ada acts and Bo watches the state sync.
  await a.getByRole('button', { name: /^Threads \(/ }).click();
  await b.getByRole('button', { name: /^Threads \(/ }).click();
  const listOf = (p: Page) => p.getByRole('region', { name: 'Threads' });
  const rowOf = (p: Page) => listOf(p).getByRole('listitem').filter({ hasText: root });
  await expect(rowOf(b)).toContainText('1 reply', { timeout: 45_000 });
  await rowOf(a).getByRole('button', { name: 'Archive' }).click();
  await expect(rowOf(a)).toBeHidden({ timeout: 30_000 });
  await expect(rowOf(b)).toBeHidden({ timeout: 45_000 });
  await listOf(a).getByRole('tab', { name: /^Archived/ }).click();
  await listOf(b).getByRole('tab', { name: /^Archived/ }).click();
  await expect(rowOf(a)).toBeVisible({ timeout: 30_000 });
  await expect(rowOf(b)).toBeVisible({ timeout: 45_000 });
  await rowOf(a).getByRole('button', { name: 'Reopen' }).click();
  await expect(rowOf(a)).toBeHidden({ timeout: 30_000 });
  await expect(rowOf(b)).toBeHidden({ timeout: 45_000 });
  await listOf(a).getByRole('tab', { name: /^Open/ }).click();
  await listOf(b).getByRole('tab', { name: /^Open/ }).click();
  await expect(rowOf(a)).toBeVisible({ timeout: 30_000 });
  await expect(rowOf(b)).toBeVisible({ timeout: 45_000 });
  await a.keyboard.press('Escape');
  await b.keyboard.press('Escape');
});

test('reactions: toggle twice returns to zero, synced both ways (A-006)', async () => {
  const text = unique('react-me');
  await post(b, a, text);
  await article(a, text).getByRole('button', { name: 'Add reaction' }).click();
  const picker = a.getByRole('dialog', { name: 'Emoji' });
  await picker.getByPlaceholder('Search emoji').fill('heart');
  // The hovering message toolbar overlaps the picker cells; click the cell itself, not the pointer position.
  await picker.getByRole('button').first().dispatchEvent('click');
  const chip = (p: Page) => article(p, text).getByRole('button', { name: /, \d+$/ });
  await expect(chip(a)).toHaveAccessibleName(/, 1$/);
  await expect(chip(b)).toHaveAccessibleName(/, 1$/, { timeout: 45_000 });
  await chip(b).click();
  await expect(chip(a)).toHaveAccessibleName(/, 2$/, { timeout: 45_000 });
  await chip(b).click();
  await expect(chip(a)).toHaveAccessibleName(/, 1$/, { timeout: 45_000 });
  await chip(a).click();
  await expect(chip(a)).toHaveCount(0);
  await expect(chip(b)).toHaveCount(0, { timeout: 45_000 });
});

test('edit shows an edited mark with history; delete leaves a tombstone on both peers (A-011, A-012)', async () => {
  const text = unique('edit-me');
  await post(b, a, unique('filler'));
  await post(a, b, text);
  await article(a, text).hover();
  await article(a, text).getByRole('button', { name: 'Edit message' }).click();
  const fixed = `${text} fixed`;
  await a.getByRole('textbox', { name: 'Edit message' }).fill(fixed);
  await a.keyboard.press('Enter');
  for (const p of [a, b]) await expect(article(p, fixed).getByRole('button', { name: 'edited' })).toBeVisible({ timeout: 45_000 });
  await article(b, fixed).getByRole('button', { name: 'edited' }).click();
  await expect(b.getByRole('list', { name: 'Edit history' }).getByText(text, { exact: false })).toBeVisible();

  await article(a, fixed).hover();
  await article(a, fixed).getByRole('button', { name: 'Delete for everyone' }).click();
  await a.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(a.getByText('Removed by you').last()).toBeVisible();
  await expect(b.getByText('Removed by Ada Tester').last()).toBeVisible({ timeout: 45_000 });
  await expect(article(b, fixed)).toHaveCount(0);
});

test('mentions: autocomplete suggests the member and B sees the highlight (A-014)', async () => {
  const tag = unique('ping');
  await a.getByLabel('Message', { exact: true }).fill('hey @B');
  const list = a.getByRole('listbox', { name: 'Mention someone' });
  await expect(list.getByRole('option', { name: /Bo Tester/ })).toBeVisible();
  await a.keyboard.press('Enter');
  await expect(a.getByLabel('Message', { exact: true })).toHaveValue('hey @Bo ');
  await a.getByLabel('Message', { exact: true }).pressSequentially(tag);
  await a.keyboard.press('Enter');
  await expect(article(b, tag).locator('mark.mention')).toHaveText('@Bo', { timeout: 45_000 });
  await expect(article(a, tag).locator('mark.mention')).toHaveText('@Bo');
});

test('attachments: A sends an image, B fetches it from /blob with a persisted image mime (A-008, W-009)', async () => {
  const name = `${Date.now().toString(36)}.png`;
  const chooser = a.waitForEvent('filechooser');
  await a.getByRole('button', { name: 'Attach files' }).click();
  await (await chooser).setFiles({ name, mimeType: 'image/png', buffer: pngBuffer(200, 60, 40) });
  await expect(a.getByRole('list', { name: 'Attached' }).getByText(name)).toBeVisible();
  await a.getByLabel('Message', { exact: true }).fill(`look ${name}`);
  await a.keyboard.press('Enter');
  const img = (p: Page) => p.getByRole('article').getByRole('img', { name });
  await expect(img(a)).toBeVisible({ timeout: 30_000 });
  await expect(img(b)).toBeVisible({ timeout: 60_000 });
  const src = await img(b).getAttribute('src');
  expect(src).toContain(`${DEVHOST_B}/blob/`);
  await expect.poll(async () => (await b.request.get(src!)).status(), { timeout: 60_000 }).toBe(200);
  const res = await b.request.get(src!);
  expect(res.headers()['content-type']).toMatch(/^image\/png/);
  await expect.poll(() => img(b).evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 30_000 }).toBeGreaterThan(0);
});

test('blob range: B seeks into a file only A holds and gets a 206 with the matching Content-Range (G-005)', async () => {
  const name = `${Date.now().toString(36)}-range.png`;
  const png = pngBuffer(20, 160, 90);
  const chooser = a.waitForEvent('filechooser');
  await a.getByRole('button', { name: 'Attach files' }).click();
  await (await chooser).setFiles({ name, mimeType: 'image/png', buffer: png });
  await expect(a.getByRole('list', { name: 'Attached' }).getByText(name)).toBeVisible();
  await a.getByLabel('Message', { exact: true }).fill(`seek ${name}`);
  await a.keyboard.press('Enter');
  const img = b.getByRole('article').getByRole('img', { name });
  await expect(img).toBeVisible({ timeout: 60_000 });
  const src = (await img.getAttribute('src'))!;
  const tail = 8;
  await expect.poll(async () => (await b.request.get(src, { headers: { Range: `bytes=-${tail}` } })).status(), { timeout: 60_000 }).toBe(206);
  const res = await b.request.get(src, { headers: { Range: `bytes=-${tail}` } });
  expect(res.headers()['content-range']).toBe(`bytes ${png.length - tail}-${png.length - 1}/${png.length}`);
  expect(await res.body()).toEqual(png.subarray(png.length - tail));
});

test('blob range: B seeks mid-file in a multi-chunk file only A holds and gets a 206 with the matching Content-Range (G-005)', async () => {
  const name = `${Date.now().toString(36)}-range-multi.png`;
  const png = multiChunkPng(20, 160, 90, MULTI_CHUNK_COUNT);
  const chooser = a.waitForEvent('filechooser');
  await a.getByRole('button', { name: 'Attach files' }).click();
  await (await chooser).setFiles({ name, mimeType: 'image/png', buffer: png });
  await expect(a.getByRole('list', { name: 'Attached' }).getByText(name)).toBeVisible();
  await a.getByLabel('Message', { exact: true }).fill(`seek ${name}`);
  await a.keyboard.press('Enter');
  const img = b.getByRole('article').getByRole('img', { name });
  await expect(img).toBeVisible({ timeout: 60_000 });
  const src = (await img.getAttribute('src'))!;
  const tail = 8;
  // A window straddling a chunk boundary deep inside the file, not at either end.
  const mid = BLOB_CHUNK_BYTES * 2 - tail / 2;
  await expect.poll(async () => (await b.request.get(src, { headers: { Range: `bytes=${mid}-${mid + tail - 1}` } })).status(), { timeout: 60_000 }).toBe(206);
  const midRes = await b.request.get(src, { headers: { Range: `bytes=${mid}-${mid + tail - 1}` } });
  expect(midRes.headers()['content-range']).toBe(`bytes ${mid}-${mid + tail - 1}/${png.length}`);
  expect(await midRes.body()).toEqual(png.subarray(mid, mid + tail));
  await expect.poll(async () => (await b.request.get(src, { headers: { Range: `bytes=-${tail}` } })).status(), { timeout: 60_000 }).toBe(206);
  const res = await b.request.get(src, { headers: { Range: `bytes=-${tail}` } });
  expect(res.headers()['content-range']).toBe(`bytes ${png.length - tail}-${png.length - 1}/${png.length}`);
  expect(await res.body()).toEqual(png.subarray(png.length - tail));
});

test('search finds message text in the palette and renders hostile text as plain text (A-013, S-001, U-005)', async () => {
  const word = `kiln${Date.now().toString(36)}`;
  const hostile = `<img src=x onerror="window.__xss=1"> <b>bold</b> ${word}`;
  await post(b, a, unique('filler'));
  await post(a, b, hostile);
  await expect(article(b, word).locator('img[src="x"], b')).toHaveCount(0);
  await expect(article(b, word)).toContainText('<img src=x');

  await b.keyboard.press('Control+k');
  const input = b.getByPlaceholder(/Search people, channels/);
  await input.fill(word);
  const results = b.getByRole('listbox', { name: 'Results' });
  const hit = results.getByRole('option').filter({ hasText: word }).first();
  await expect(hit).toBeVisible({ timeout: 45_000 });
  await expect(hit).toContainText('<img');
  await expect(results.locator('img, b')).toHaveCount(0);
  await expect(hit.locator('mark')).not.toHaveCount(0);
  expect(await b.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  await b.keyboard.press('Escape');
});

test('shortcut list opens with ? and from the palette (U-006, U-005)', async () => {
  await b.locator('body').click({ position: { x: 5, y: 5 } });
  await b.keyboard.press('?');
  const dlg = b.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByRole('cell', { name: 'Search everything' })).toBeVisible();
  await b.keyboard.press('Escape');
  await expect(dlg).toBeHidden();

  await b.keyboard.press('Control+k');
  await b.getByPlaceholder(/Search people, channels/).fill('shortcuts');
  await b.getByRole('listbox', { name: 'Results' }).getByRole('option').first().click();
  await expect(dlg).toBeVisible();
  await b.keyboard.press('Escape');
});

let chanName = '';
test('channels: A creates one, B switches to it and messages sync inside it (A-001, A-002)', async () => {
  const chan = `qa-${Date.now().toString(36)}`;
  chanName = chan;
  await a.getByRole('button', { name: 'New channel' }).click();
  await a.getByLabel(/^Name/).fill(chan);
  await a.getByLabel(/^Topic/).fill('for the channel spec');
  await a.getByRole('button', { name: 'Create channel' }).click();
  await expect(a.getByRole('navigation', { name: 'Channels' }).getByRole('button', { name: chan })).toHaveAttribute('aria-current', 'page');
  await a.getByLabel('Message', { exact: true }).waitFor();
  const nav = b.getByRole('navigation', { name: 'Channels' });
  await nav.getByRole('button', { name: chan }).click({ timeout: 45_000 });
  await expect(nav.getByRole('button', { name: chan })).toHaveAttribute('aria-current', 'page');
  const line = unique('in-channel');
  await post(b, a, line);
  await post(a, b, `${line} back`);
  await expect(b.getByLabel('Message', { exact: true })).toHaveAttribute('placeholder', `Write to #${chan}`);
});

// G-008: unread rides the Space rail, clears when the channel is read, and the clear survives a reload.
test('unread badges appear on the rail and clear on read, across reload', async () => {
  await expect(async () => { await enterSection(a, 'chat'); }).toPass({ timeout: 90_000 });
  await a.getByRole('navigation', { name: 'Channels' }).getByRole('button', { name: 'general' }).click();
  // The rail badge marks spaces you are NOT in, so B waits on the Home island.
  await b.getByRole('navigation', { name: 'Spaces' }).getByRole('button', { name: 'Home' }).click();
  // Precondition: the two nodes are actually connected, or the message cannot arrive.
  await expect(async () => {
    const st = await invoke<{ peers: number }>(DEVHOST_B, 'node_status');
    expect(st.peers, 'B should see A as a peer').toBeGreaterThan(0);
  }).toPass({ timeout: 60_000 });
  const text = unique('badge me');
  await say(a, text);
  const railBtn = b.getByRole('navigation', { name: 'Spaces' }).getByRole('button', { name: space });
  await expect(railBtn.locator('[class*=unreadBadge]')).toHaveText('1', { timeout: 45_000 });
  // B reads the channel.
  await railBtn.click();
  await expect(async () => { await enterSection(b, 'chat'); }).toPass({ timeout: 90_000 });
  await b.getByRole('navigation', { name: 'Channels' }).getByRole('button', { name: 'general' }).click();
  // The core must hold the marker: general's unread drops to zero in B's own store.
  await expect(async () => {
    const snap = await invoke<{ spaces: { id: string; name: string }[]; collections: { channels: Record<string, { id: string; name: string; unread?: number }[]> } }>(DEVHOST_B, 'snapshot');
    const sp = snap.spaces.find((x) => x.name === space)?.id ?? '';
    const gen = snap.collections.channels[sp]?.find((c) => c.name === 'general');
    // The seed omits `unread` when it is zero.
    expect(gen ? (gen.unread ?? 0) : -1, 'general unread in B core').toBe(0);
  }).toPass({ timeout: 20_000 });
  // The badge hides while the Space is active, so verify the read from the Home island:
  // the marker must be in the core, not just in the open view.
  await b.getByRole('navigation', { name: 'Spaces' }).getByRole('button', { name: 'Home' }).click();
  await expect(railBtn.locator('[class*=unreadBadge]')).toHaveCount(0, { timeout: 45_000 });
  // A reload must agree with the core: no badge returns.
  await b.reload();
  await expect(b.getByRole('navigation', { name: 'Spaces' })).toBeVisible({ timeout: 60_000 });
  await b.getByRole('navigation', { name: 'Spaces' }).getByRole('button', { name: 'Home' }).click();
  await expect(railBtn.locator('[class*=unreadBadge]')).toHaveCount(0);
});

// A-018: the composer emoji picker is keyboard operable end to end.
test('the emoji picker searches, inserts with the keyboard and closes on Escape', async () => {
  await expect(async () => { await enterSection(a, 'chat'); }).toPass({ timeout: 90_000 });
  await a.getByLabel('Message', { exact: true }).fill('');
  await a.getByRole('button', { name: 'Emoji', exact: true }).click();
  const picker = a.getByRole('dialog', { name: 'Emoji' });
  await expect(picker.getByLabel('Search emoji')).toBeFocused();
  await picker.getByLabel('Search emoji').fill('cat');
  await a.keyboard.press('Tab'); // search to the first result cell
  await a.keyboard.press('Enter'); // pick it into the draft
  await expect(a.getByLabel('Message', { exact: true })).toHaveValue(/[\u{1F300}-\u{1FAFF}]/u);
  await a.keyboard.press('Escape');
  await expect(picker).toBeHidden();
});

test('block: B blocks A, A messages collapse for B, survives reload, since is recorded, unblock restores (E-007)', async () => {
  // The unread test left B on the Home island; the member list to block from is the shared Space's.
  await b.getByRole('navigation', { name: 'Spaces' }).getByRole('button', { name: space }).click();
  const dlg = await openSpaceSettings(b, 'Members');
  await dlg.getByRole('row', { name: /Ada Tester/ }).getByRole('button', { name: 'Block' }).click();
  await expect(dlg.getByRole('row', { name: /Ada Tester/ }).getByRole('button', { name: 'Unblock' })).toBeVisible();
  await dlg.getByRole('button', { name: 'Close' }).click();
  const list = await invoke<{ user_id: string; name: string; since: number }[]>(DEVHOST_B, 'block_list');
  expect(list).toHaveLength(1);
  expect(list[0].name).toContain('Ada');
  expect(list[0].since).toBeGreaterThan(Date.now() / 1000 - 600);

  await enterSection(b, 'chat');
  // A was left on the island by the unread test; the composer needs A inside.
  await expect(async () => { await enterSection(a, 'chat'); }).toPass({ timeout: 90_000 });
  const hidden = unique('hidden-text');
  await say(a, hidden);
  await expect(b.getByRole('article', { name: 'Message from a blocked person, hidden' }).last()).toBeVisible({ timeout: 45_000 });
  await expect(b.locator('p.mdp', { hasText: hidden })).toHaveCount(0);

  await b.reload();
  await expect(b.getByRole('navigation', { name: 'Spaces' })).toBeVisible({ timeout: 60_000 });
  await b.getByRole('navigation', { name: 'Spaces' }).getByRole('button', { name: space }).click();
  // The blocked message went to general (the default channel), so reopen the Space and stay there.
  await enterSection(b, 'chat');
  await expect(b.getByRole('article', { name: 'Message from a blocked person, hidden' }).last()).toBeVisible({ timeout: 45_000 });
  await b.getByRole('button', { name: 'Show' }).last().click();
  await expect(b.locator('p.mdp', { hasText: hidden })).toBeVisible();

  const dlg2 = await openSpaceSettings(b, 'Members');
  await dlg2.getByRole('row', { name: /Ada Tester/ }).getByRole('button', { name: 'Unblock' }).click();
  await expect(dlg2.getByRole('row', { name: /Ada Tester/ }).getByRole('button', { name: 'Block' })).toBeVisible();
  await dlg2.getByRole('button', { name: 'Close' }).click();
  expect(await invoke(DEVHOST_B, 'block_list')).toHaveLength(0);
  users.errors.forEach((e) => e.expectClean());
});

test('long history: a palette hit jumps to a message folded out of the window, and Show earlier keeps the viewport anchored (S-002, A-017)', async () => {
  test.setTimeout(420_000);
  const total = 170; // the window is 150 messages; own-device appends skip the slow peer sync
  const word = `quarry${Date.now().toString(36)}`;
  const snap = await invoke<{ spaces: { id: string; name: string }[]; collections: { channels: Record<string, { id: string; name: string }[]> } }>(DEVHOST_B, 'snapshot');
  const sp = snap.spaces.find((s) => s.name === space)!.id;
  const channel_id = snap.collections.channels[sp].find((c) => c.name === chanName)!.id;
  for (let i = 0; i < total; i++) {
    await invoke(DEVHOST_B, 'event_append', { spaceId: sp, body: { t: 'message.post', channel_id, msg_id: `bulk-${Date.now().toString(36)}-${i}`, text: i === 0 ? `${word} first of the long history` : `long history ${i}`, attachments: [] } });
  }
  await enterSection(b, 'chat');
  await b.getByRole('navigation', { name: 'Channels' }).getByRole('button', { name: chanName }).click(); // the blocked-person test left Bo in general
  await expect(b.locator(`article:has-text("long history ${total - 1}")`)).toBeVisible({ timeout: 60_000 });
  await expect(article(b, word)).toHaveCount(0);

  await b.keyboard.press('Control+k');
  await b.getByPlaceholder(/Search people, channels/).fill(word);
  await b.getByRole('listbox', { name: 'Results' }).getByRole('option').filter({ hasText: `${word} first of the long history` }).first().click({ timeout: 45_000 }); // the "See all results" row carries the word too and shows before the hit arrives
  await expect(article(b, word)).toBeInViewport({ timeout: 15_000 });

  // Reopen the channel so the window folds again, then widen it from the top.
  const nav = b.getByRole('navigation', { name: 'Channels' });
  await nav.getByRole('button', { name: 'general' }).click();
  await nav.getByRole('button', { name: chanName }).click();
  const log = b.getByRole('log', { name: 'Messages' });
  await expect(article(b, word)).toHaveCount(0); // folded again once the jump has finished
  await expect(b.getByRole('button', { name: /Show earlier messages \(\d+\)/ })).toBeVisible();
  await b.waitForTimeout(1000); // the arrival scroll-to-bottom steps (20, 260, 700 ms) must be over before scrolling to the top
  const edgeId = await b.getByRole('article').first().getAttribute('id');
  await log.evaluate((el) => { el.scrollTop = 0; }); // reaching the top widens the window
  await expect(article(b, word)).toHaveCount(1);
  await expect(b.locator(`[id="${edgeId}"]`)).toBeInViewport();
});
