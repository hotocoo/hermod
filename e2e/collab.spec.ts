import type { Page } from '@playwright/test';
import { test, expect, twoUsers, sharedSpace, enterSection, say, unique, openSpaceSettings } from './fixtures';
import { freshDevhosts, stopDevhost, startDevhost } from './devhosts';

/** Every spec file starts on three empty devhosts, so no spec depends on state a former one left. */
test.beforeAll(async () => { test.setTimeout(180_000); await freshDevhosts(); });

/** Two real users (two devhosts, two identities) in one Space, synced over the real P2P stack on localhost. */
test.describe.configure({ mode: 'serial' });

let users: Awaited<ReturnType<typeof twoUsers>>;
let a: Page;
let b: Page;
const space = unique('Harbor');

const msg = (page: Page, text: string) => page.getByRole('article').filter({ hasText: text });

test.beforeAll(async ({ browser }) => {
  users = await twoUsers(browser);
  ({ a, b } = users);
  await sharedSpace(a, b, space);
});
test.afterAll(async () => { await users.close(); });

test('the real invite flow joins B, and the island grows by one cottage', async () => {
  await expect(a.locator('[data-house]')).toHaveCount(2, { timeout: 60_000 });
  await expect(b.locator('[data-house]')).toHaveCount(2, { timeout: 60_000 });
  const dlg = await openSpaceSettings(a, 'Members');
  await expect(dlg.getByRole('row', { name: /Bo Tester/ })).toBeVisible({ timeout: 30_000 });
  await expect(dlg.getByRole('row', { name: /Ada Tester \(you\)/ })).toContainText('owner');
  await dlg.getByRole('button', { name: 'Close' }).click();
});

test('messages sync both ways in real time', async () => {
  await enterSection(a, 'chat');
  await enterSection(b, 'chat');
  await say(b, 'hello from Bo over p2p');
  await expect(msg(a, 'hello from Bo over p2p')).toBeVisible({ timeout: 30_000 });
  await say(a, 'hi Bo, Ada here');
  await expect(msg(b, 'hi Bo, Ada here')).toBeVisible({ timeout: 30_000 });
  await b.reload();
  await expect(b.getByRole('navigation', { name: 'Spaces' })).toBeVisible();
});

/** The pill wait (60 s) plus the drain wait (90 s) outlast the default per-test timeout. */
const OFFLINE_TEST_MS = 240_000;

test('offline-first: a message sent while the peer is gone shows a sync pill, then drains on reconnect', async () => {
  test.setTimeout(OFFLINE_TEST_MS);
  const text = unique('sent while Bo was away');
  const pill = a.getByRole('status').filter({ hasText: /to sync|saved here/ });
  // B leaves its page before its host dies, so the dropped event stream is not counted as an app error.
  const bUrl = b.url();
  await b.goto('about:blank');
  await stopDevhost(1);
  await say(a, text);
  await expect(msg(a, text)).toBeVisible();
  await expect(pill).toContainText(/1 change/, { timeout: 60_000 });
  await startDevhost(1);
  await expect(pill).toHaveCount(0, { timeout: 90_000 });
  await b.goto(bUrl);
  await enterSection(b, 'chat');
  await expect(msg(b, text)).toBeVisible({ timeout: 60_000 });
});
