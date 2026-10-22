import type { Page } from '@playwright/test';
import { GL_ARGS } from './gpu';
import { test, expect, twoUsers, sharedSpace, enterSection, say, unique, pngBuffer, openPalette } from './fixtures';
import { freshDevhosts } from './devhosts';

/** Every spec file starts on three empty devhosts, so no spec depends on state a former one left. */
test.beforeAll(async () => { test.setTimeout(180_000); await freshDevhosts(); });

/**
 * Messaging parity (docs/MESSAGING.md): two real devhosts (two identities, two data dirs) in one Space,
 * synced over the real P2P stack. Chromium's fake capture devices stand in for a microphone and camera.
 */
test.use({
  launchOptions: {
    args: [
      ...GL_ARGS,
      '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
    ],
  },
});
test.describe.configure({ mode: 'serial' });

let users: Awaited<ReturnType<typeof twoUsers>>;
let a: Page;
let b: Page;
const space = unique('Quay');

const msg = (page: Page, text: string | RegExp) => page.getByRole('article').filter({ hasText: text });
/** Hover a message and press one of its action buttons. */
async function act(page: Page, text: string | RegExp, label: string): Promise<void> {
  const art = msg(page, text).first();
  await art.hover();
  await art.getByRole('button', { name: label }).click();
}
async function chatMenu(page: Page, item: string | RegExp): Promise<void> {
  await page.getByRole('button', { name: 'Chat options' }).click();
  await page.getByRole('menuitem', { name: item }).or(page.getByRole('button', { name: item })).first().click();
}
async function newChannel(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'New channel' }).click();
  await page.getByLabel(/^Name/).fill(name);
  await page.getByRole('button', { name: 'Create channel' }).click();
  await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
}
const openChannel = (page: Page, name: string) => page.getByRole('navigation', { name: 'Channels' }).getByRole('button', { name }).click();
async function setChannel(page: Page, fill: (dlg: ReturnType<Page['getByRole']>) => Promise<void>): Promise<void> {
  await chatMenu(page, 'Channel settings');
  const dlg = page.getByRole('dialog', { name: 'Channel settings' });
  await fill(dlg);
  await dlg.getByRole('button', { name: 'Save' }).click();
  await expect(dlg).toBeHidden();
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  users = await twoUsers(browser, ['Ada Tester', 'Bo Tester']);
  ({ a, b } = users);
  await sharedSpace(a, b, space);
  // Entering is a canvas-driven transition; retry the whole gesture if a click lands mid-animation.
  for (const p of [a, b]) await expect(async () => { await enterSection(p, 'chat'); }).toPass({ timeout: 90_000 });
});
test.afterAll(async () => { await users?.close(); });

test('markdown, code blocks and spoilers render, raw HTML stays text', async () => {
  await say(a, '**bold move** and ||plot twist|| <b>raw</b>');
  const m = msg(b, 'bold move');
  await expect(m.locator('strong')).toHaveText('bold move', { timeout: 30_000 });
  const spoiler = m.getByRole('button', { name: /Spoiler, press to reveal/ });
  await expect(spoiler).toBeVisible();
  await spoiler.click();
  await expect(m.getByRole('button', { name: 'Spoiler', exact: true })).toContainText('plot twist');
  await expect(m).toContainText('<b>raw</b>');
  await a.getByLabel('Message', { exact: true }).fill('```ts\nconst answer = 42;\n```');
  await a.keyboard.press('Enter');
  await expect(msg(b, 'answer').locator('pre')).toContainText('const answer = 42;', { timeout: 30_000 });
});

test('reply with an inline quote reaches the other side, and the quote jumps back', async () => {
  await say(b, 'original thought from Bo');
  await expect(msg(a, 'original thought from Bo')).toBeVisible({ timeout: 30_000 });
  await act(a, 'original thought from Bo', 'Reply with quote');
  await expect(a.getByText(/Replying to Bo Tester/)).toBeVisible();
  await say(a, 'answering that');
  const reply = msg(b, 'answering that');
  await expect(reply.getByRole('button', { name: /Quoted message from Bo Tester/ })).toBeVisible({ timeout: 30_000 });
  await expect(a.getByText(/Replying to/)).toBeHidden();
});

test('edit history, delete for me and delete for everyone', async () => {
  await say(a, 'first draft text');
  await expect(msg(b, 'first draft text')).toBeVisible({ timeout: 30_000 });
  await act(a, 'first draft text', 'Edit message');
  await a.getByRole('textbox', { name: 'Edit message' }).fill('second draft text');
  await a.getByRole('article').filter({ has: a.getByRole('textbox', { name: 'Edit message' }) }).getByRole('button', { name: 'Save', exact: true }).click();
  const edited = msg(b, 'second draft text');
  await expect(edited).toBeVisible({ timeout: 30_000 });
  await edited.getByRole('button', { name: 'edited' }).click();
  await expect(edited.getByRole('list', { name: 'Edit history' })).toContainText('first draft text');

  await say(a, 'only gone for Bo');
  await expect(msg(b, 'only gone for Bo')).toBeVisible({ timeout: 30_000 });
  await act(b, 'only gone for Bo', 'Delete for me');
  await b.getByRole('dialog').getByRole('button', { name: 'Delete for me' }).click();
  await expect(msg(b, 'only gone for Bo')).toHaveCount(0);
  await expect(msg(a, 'only gone for Bo')).toBeVisible();

  await say(a, 'gone for everyone');
  await expect(msg(b, 'gone for everyone')).toBeVisible({ timeout: 30_000 });
  await act(a, 'gone for everyone', 'Delete for everyone');
  await a.getByRole('dialog').getByRole('button', { name: /^Delete/ }).click();
  await expect(b.getByText(/Removed by Ada Tester/)).toBeVisible({ timeout: 30_000 });
});

test('pins appear in the header list and jump', async () => {
  await say(a, 'pin me please');
  await expect(msg(b, 'pin me please')).toBeVisible({ timeout: 30_000 });
  await act(a, 'pin me please', 'Pin');
  await expect(msg(b, 'pin me please').getByText('pinned')).toBeVisible({ timeout: 30_000 });
  await b.getByRole('button', { name: /Pinned messages \(1\)/ }).click();
  await expect(b.getByRole('list', { name: 'Pinned messages' })).toContainText('pin me please');
  await b.getByRole('button', { name: /Pinned messages \(1\)/ }).click();
  await expect(b.getByRole('list', { name: 'Pinned messages' })).toHaveCount(0);
});

test('any emoji reacts, and the other side sees the count', async () => {
  await say(a, 'react to this');
  await expect(msg(b, 'react to this')).toBeVisible({ timeout: 30_000 });
  await msg(b, 'react to this').getByRole('button', { name: 'Add reaction' }).click();
  await b.getByRole('dialog', { name: 'Emoji' }).getByPlaceholder('Search emoji').fill('rocket');
  await b.getByRole('dialog', { name: 'Emoji' }).getByRole('button', { name: /rocket/i }).first().click();
  await expect(msg(a, 'react to this').getByRole('button', { name: /🚀, 1/ })).toBeVisible({ timeout: 30_000 });
});

test('forward to another channel keeps the label', async () => {
  await newChannel(a, 'side');
  await openChannel(a, 'general').catch(() => undefined);
  await say(a, 'forward this one');
  await act(a, 'forward this one', 'Forward');
  const dlg = a.getByRole('dialog', { name: 'Forward message' });
  await dlg.getByLabel(/side in/).check();
  await dlg.getByRole('button', { name: /^Forward/ }).click();
  await openChannel(b, 'side');
  const fw = msg(b, 'forward this one');
  await expect(fw.getByText(/Forwarded from/)).toBeVisible({ timeout: 30_000 });
  await openChannel(b, 'general');
});

test('disappearing timer shows a countdown, view once hides the media', async () => {
  await a.getByLabel('Disappearing timer').selectOption({ label: 'Timer 1 hour' });
  await say(a, 'this will vanish');
  await expect(msg(b, 'this will vanish').getByTitle('Disappearing message')).toBeVisible({ timeout: 30_000 });
  await a.getByLabel('Disappearing timer').selectOption({ label: 'No timer' });

  await a.getByRole('button', { name: 'View once' }).click();
  await a.locator('input[type=file]').first().setInputFiles({ name: 'secret.png', mimeType: 'image/png', buffer: pngBuffer(200, 40, 40) });
  await expect(a.getByRole('list', { name: 'Attached' })).toContainText('secret.png');
  await say(a, 'look once');
  await expect(msg(b, 'look once').getByRole('button', { name: /View once, tap to open/ })).toBeVisible({ timeout: 30_000 });
  await expect(msg(b, 'look once').getByRole('img', { name: 'View once' })).toHaveCount(0);
  await msg(b, 'look once').getByRole('button', { name: /View once, tap to open/ }).click();
  await expect(msg(b, 'look once').getByRole('img', { name: 'View once' })).toBeVisible();
  await expect(msg(a, 'look once')).toContainText(/opened by 1/, { timeout: 30_000 });
});

test('a voice message records with the fake microphone and plays on the other side', async () => {
  await a.getByRole('button', { name: 'Voice message' }).click();
  await expect(a.getByText(/Recording voice message/)).toBeVisible();
  await a.waitForTimeout(1500);
  await a.getByRole('status').filter({ hasText: /Recording voice message/ }).getByRole('button', { name: 'Send', exact: true }).click();
  await expect(b.getByRole('button', { name: 'Play voice message' })).toBeVisible({ timeout: 40_000 });
  await expect(b.getByRole('slider', { name: 'Seek' })).toBeVisible();
});

test('read receipts are opt in and show two ticks once the peer reads', async () => {
  for (const p of [a, b]) {
    await p.getByRole('button', { name: 'Privacy and chat settings' }).click();
    const dlg = p.getByRole('dialog', { name: 'Privacy and chat settings' });
    const receipts = dlg.getByRole('switch', { name: /Send read receipts/ });
    // The setting lives in the devhost's store, so it can already be on when a run reuses the host.
    if ((await receipts.getAttribute('aria-checked')) !== 'true') await receipts.click();
    await expect(receipts).toHaveAttribute('aria-checked', 'true');
    await dlg.getByRole('button', { name: 'Done' }).click();
  }
  await say(a, 'did you read this');
  await expect(msg(a, 'did you read this').getByLabel(/Read by/)).toBeVisible({ timeout: 40_000 });
});

test('typing indicator shows for the other person', async () => {
  await b.getByLabel('Message', { exact: true }).pressSequentially('hmm', { delay: 30 });
  await expect(a.getByText(/Bo is typing/)).toBeVisible({ timeout: 15_000 });
  await b.getByLabel('Message', { exact: true }).fill('');
});

test('presence dot shows on the other person\'s messages', async () => {
  // The dot sits on the other person's avatar, so A needs a message from Bo in view.
  await say(b, 'here and online');
  await expect(msg(a, 'here and online')).toBeVisible({ timeout: 30_000 });
  // Beacons go out every PRESENCE.everyMs (20 s); the first may precede the space list, so allow two intervals.
  await expect(msg(a, 'here and online').getByRole('img', { name: 'online' })).toBeVisible({ timeout: 50_000 });
});

test('slowmode drops a second post from a member inside the window', async () => {
  // A channel of its own: in #general Bo's earlier posts may be inside the 15 s window, which would drop 'slow one' too.
  await newChannel(a, 'quiet');
  await openChannel(b, 'quiet');
  await setChannel(a, async (dlg) => { await dlg.getByLabel(/Slowmode/).fill('15'); });
  await expect(b.getByText(/Slowmode: one message every 15s/)).toBeVisible({ timeout: 30_000 });
  await say(b, 'slow one');
  await expect(msg(a, 'slow one')).toBeVisible({ timeout: 30_000 });
  await say(b, 'slow two');
  await say(a, 'admin marker');
  await expect(msg(b, 'admin marker')).toBeVisible({ timeout: 30_000 });
  await expect(msg(a, 'slow two')).toHaveCount(0);
  await setChannel(a, async (dlg) => { await dlg.getByLabel(/Slowmode/).fill('0'); });
  await openChannel(a, 'general');
  await openChannel(b, 'general');
});

test('announcement channels let only admins post, forum channels take titled posts', async () => {
  await newChannel(a, 'news');
  await setChannel(a, async (dlg) => { await dlg.getByLabel(/^Type/).selectOption('announcement'); });
  await openChannel(b, 'news');
  await expect(b.getByText(/Only admins can post here/)).toBeVisible({ timeout: 30_000 });
  await say(a, 'launch day');
  await expect(msg(b, 'launch day')).toBeVisible({ timeout: 30_000 });

  await newChannel(a, 'ideas');
  await setChannel(a, async (dlg) => { await dlg.getByLabel(/^Type/).selectOption('forum'); await dlg.getByLabel(/Forum tags/).fill('design, rust'); });
  await openChannel(b, 'ideas');
  await b.getByLabel('Post title').fill('Idea: offline maps');
  await b.getByLabel('Message', { exact: true }).fill('We could cache tiles.');
  await b.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(a.getByRole('heading', { name: /Idea: offline maps/ })).toBeVisible({ timeout: 30_000 });
  await openChannel(a, 'general');
  await openChannel(b, 'general');
});

test('search filters narrow by sender and kind', async () => {
  await say(a, 'ledger https://example.org/report');
  await expect(msg(b, 'ledger')).toBeVisible({ timeout: 30_000 });
  await b.keyboard.press('Control+k');
  const input = b.getByPlaceholder(/Search people, channels/);
  await input.fill('from:Ada has:link ledger');
  await expect(b.getByRole('dialog').getByText(/ledger/).first()).toBeVisible({ timeout: 15_000 });
  await input.fill('from:Bo has:link ledger');
  await expect(b.getByRole('dialog').getByText(/ledger https/)).toHaveCount(0);
  await b.keyboard.press('Escape');
});

test('scheduling lists the message and cancel removes it', async () => {
  await a.getByLabel('Message', { exact: true }).fill('for later');
  await a.getByRole('button', { name: 'Schedule message' }).click();
  const dlg = a.getByRole('dialog', { name: 'Schedule message' });
  await dlg.getByRole('button', { name: 'Schedule', exact: true }).click();
  await a.getByRole('button', { name: 'Chat options' }).click();
  await a.getByRole('button', { name: 'Scheduled messages' }).click();
  const list = a.getByRole('list', { name: 'Scheduled messages' });
  await expect(list).toContainText('for later');
  await list.getByRole('button', { name: 'Cancel' }).first().click();
  await expect(a.getByRole('list', { name: 'Scheduled messages' })).toHaveCount(0);
  await a.keyboard.press('Escape');
});

test('a direct message from a non-contact lands in requests until accepted', async () => {
  await a.getByRole('button', { name: 'New message or contacts' }).click();
  const dlg = a.getByRole('dialog', { name: 'Messages and contacts' });
  await dlg.getByLabel(/Bo Tester/).check();
  await dlg.getByRole('button', { name: 'Start chat' }).click();
  await expect(b.getByRole('region', { name: 'Message requests' })).toContainText('Ada Tester', { timeout: 60_000 });
  await b.getByRole('region', { name: 'Message requests' }).getByRole('button', { name: 'Accept' }).click();
  await expect(b.getByRole('region', { name: 'Message requests' })).toHaveCount(0, { timeout: 30_000 });
});

test('my contact code renders as a QR code and a link', async () => {
  await enterSection(a, 'chat');
  await a.getByRole('button', { name: 'New message or contacts' }).click();
  const dlg = a.getByRole('dialog', { name: 'Messages and contacts' });
  await dlg.getByRole('tab', { name: 'My code' }).click();
  await expect(dlg.getByRole('img', { name: /contact code as a QR code/ })).toBeVisible({ timeout: 30_000 });
  expect((await dlg.getByLabel('Link').inputValue()).length).toBeGreaterThan(20);
  await a.keyboard.press('Escape');
  // Not asserting a clean console here: another workstream's missing room assets log "Room provider failed" errors on every building.
});

test('palette person opens a real DM that syncs to that person (A-003)', async () => {
  await enterSection(a, 'chat');
  const input = await openPalette(a);
  await input.fill('Bo Tester');
  await a.getByRole('listbox', { name: 'Results' }).getByRole('option').filter({ hasText: 'Bo Tester' }).first().click();
  const nav = a.getByRole('navigation', { name: 'Channels' });
  // The row carries the other person's name, so DMs with different people tell apart.
  await expect(nav.getByRole('button', { name: /Bo Tester/ }).first()).toHaveAttribute('aria-current', 'page', { timeout: 60_000 });
  await expect(nav.getByRole('button', { name: 'Direct message' })).toHaveCount(0);
});

test('pin, mute and archive a chat from its menu; folders filter the list (M-032 to M-035)', async () => {
  const chan = unique('zlist').replace(/\s/g, '-');
  const other = unique('alist').replace(/\s/g, '-');
  // The former test left A in the DM Space; this one lists the shared Space's channels next to the DM row.
  await a.getByRole('navigation', { name: 'Spaces' }).getByRole('button', { name: space }).click();
  await enterSection(a, 'chat');
  await newChannel(a, other);
  await newChannel(a, chan);
  const nav = a.getByRole('navigation', { name: 'Channels' });
  const row = nav.getByRole('button', { name: chan });
  const order = async () => { const names = await nav.getByRole('button').allTextContents(); return names.findIndex((n) => n.includes(chan)) - names.findIndex((n) => n.includes(other)); };
  expect(await order(), 'created later and sorted after before pinning').toBeGreaterThan(0);

  await chatMenu(a, 'Pin chat');
  await a.getByRole('button', { name: 'Chat options' }).click();
  await expect(a.getByRole('button', { name: 'Unpin chat' })).toBeVisible();
  await a.keyboard.press('Escape');
  await expect.poll(order, 'a pinned chat sorts first').toBeLessThan(0);

  await chatMenu(a, 'Mute for 1 hour');
  await expect(a.getByRole('heading', { level: 2, name: chan })).toContainText('muted');
  await chatMenu(a, 'Unmute');
  await expect(a.getByRole('heading', { level: 2, name: chan })).not.toContainText('muted');

  await a.getByRole('button', { name: 'Privacy and chat settings' }).click();
  const priv = a.getByRole('dialog', { name: 'Privacy and chat settings' });
  await priv.getByLabel('Folder name').fill('Work');
  await priv.getByRole('button', { name: 'Add folder' }).click();
  await priv.getByLabel('Folder name').fill('Pairs');
  await priv.getByRole('button', { name: 'Add folder' }).click();
  await priv.getByRole('button', { name: 'Done' }).click();
  const folders = a.getByRole('group', { name: 'Folders' });
  await chatMenu(a, 'Add to Work');
  await folders.getByRole('button', { name: 'Work' }).click();
  await expect(row).toBeVisible();
  await expect(nav.getByRole('button', { name: other })).toHaveCount(0);
  await expect(nav.getByRole('button', { name: /Bo Tester/ })).toHaveCount(0);
  await folders.getByRole('button', { name: 'All' }).click();
  await expect(nav.getByRole('button', { name: other })).toBeVisible();

  await chatMenu(a, 'Archive chat');
  await expect(row).toHaveCount(0);
  await a.getByRole('button', { name: /Show archived/ }).click();
  await expect(row).toBeVisible();

  // A DM Space row follows the same folder and archive rules (A-003 with M-032, M-033).
  const dmRow = nav.getByRole('button', { name: /Bo Tester/ }).first();
  await dmRow.click();
  // A DM row is a Space row: it switches Space and leaves the building, so the chat is entered again.
  await enterSection(a, 'chat');
  await chatMenu(a, 'Add to Pairs');
  await folders.getByRole('button', { name: 'Pairs' }).click();
  await expect(dmRow).toBeVisible();
  await folders.getByRole('button', { name: 'Work' }).click();
  await expect(dmRow).toHaveCount(0);
  await folders.getByRole('button', { name: 'All' }).click();
  const hideArchived = a.getByRole('button', { name: /Hide archived/ });
  if (await hideArchived.count()) await hideArchived.click();
  await chatMenu(a, 'Archive chat');
  await expect(dmRow).toHaveCount(0);
  await a.getByRole('button', { name: /Show archived/ }).click();
  await expect(dmRow).toBeVisible();
});
