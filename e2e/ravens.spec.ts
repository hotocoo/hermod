import type { Page } from '@playwright/test';
import { test, expect, twoUsers, sharedSpace, enterSection, expectInside, expectOnIsland, panel, say, toIsland, unique } from './fixtures';
import { freshDevhosts } from './devhosts';

/** Every spec file starts on three empty devhosts, so no spec depends on state a former one left. */
test.beforeAll(async () => { test.setTimeout(180_000); await freshDevhosts(); });
test.describe.configure({ mode: 'serial' });

let users: Awaited<ReturnType<typeof twoUsers>>;
let a: Page;
let b: Page;
const space = unique('Roost');

test.beforeAll(async ({ browser }) => {
  users = await twoUsers(browser);
  ({ a, b } = users);
  await sharedSpace(a, b, space);
});
test.afterAll(async () => { await users.close(); });

// R-001: a real message.post from another Space brings a raven letter (the fixtures run reduced motion, so it lands at once; the flight itself is unit-tested in src/scene/__tests__/ravens.test.ts).
test('a message posted by B in another Space brings A a raven letter', async () => {
  await enterSection(b, 'chat');
  await toIsland(a);
  // A leaves the shared Space for Home, so B's post is "from another space".
  await a.getByRole('navigation', { name: 'Spaces' }).getByRole('button', { name: 'Home' }).click();
  await say(b, 'raven mail for Ada');
  const letter = a.locator('[data-obstacle]').filter({ hasText: 'A raven from' });
  await expect(letter).toContainText('Bo Tester', { timeout: 30_000 });
  await expect(letter).toContainText('raven mail for Ada');
});

const letterOn = (p: Page) => p.locator('[data-obstacle]').filter({ hasText: 'A raven from' });
const goHome = (p: Page) => p.getByRole('navigation', { name: 'Spaces' }).getByRole('button', { name: 'Home' }).click();
/** B posts while A is on the Home island; resolves once A's letter for it is up (letters fade after TIMING.letterMs, so act at once). */
async function letterFor(text: string) {
  await say(b, text);
  await expect(letterOn(a)).toContainText(text, { timeout: 30_000 });
}

// R-003: the letter overlay's two buttons. Dismiss only closes it; Read opens the chat the raven came from.
test('a letter is dismissed, and the next one is read straight into its chat', async () => {
  await letterFor(unique('dismiss me'));
  await letterOn(a).getByRole('button', { name: 'Dismiss' }).click();
  await expect(letterOn(a)).toBeHidden();
  await expectOnIsland(a); // nothing opened

  const text = unique('read me, Ada');
  await letterFor(text);
  await letterOn(a).getByRole('button', { name: 'Read' }).click();
  await expect(letterOn(a)).toBeHidden();
  await expectInside(a);
  // The message itself, not the aria-live toast that announces it on arrival.
  await expect(panel(a).getByRole('article').filter({ hasText: text })).toBeVisible({ timeout: 30_000 });
});

// R-004: the rookery button counts unread ravens, the drawer lists them, "Mark all as read" clears the count, an entry opens its chat.
test('the rookery lists what the ravens brought and marks it all read', async () => {
  await toIsland(a);
  await goHome(a);
  const text = unique('rookery note');
  await letterFor(text);
  await letterOn(a).getByRole('button', { name: 'Dismiss' }).click();

  const rookBtn = a.getByRole('button', { name: /^Rookery, \d+ new$/ }).first();
  await expect(rookBtn).toHaveAccessibleName(/^Rookery, [1-9]\d* new$/, { timeout: 30_000 });
  await rookBtn.click();
  const drawer = a.getByRole('dialog', { name: 'Rookery' });
  const entry = drawer.getByRole('button').filter({ hasText: text });
  await expect(entry).toContainText('Bo Tester');
  await drawer.getByRole('button', { name: 'Mark all as read' }).click();
  await expect(drawer.getByRole('button', { name: 'Mark all as read' })).toBeHidden({ timeout: 30_000 });
  await expect(rookBtn).toHaveAccessibleName('Rookery, 0 new');
  await expect(entry).toBeVisible(); // read entries stay listed

  await entry.click();
  await expect(drawer).toBeHidden();
  await expectInside(a);
  // The message itself, not the aria-live toast that announces it on arrival.
  await expect(panel(a).getByRole('article').filter({ hasText: text })).toBeVisible({ timeout: 30_000 });
});

// R-006: the scheduler sends on its own, so the send flies a raven even though it is the sender's own message.
test('a scheduled send flies a raven when it goes out (R-006)', async () => {
  test.setTimeout(240_000);
  await expect(async () => { await enterSection(a, 'chat'); }).toPass({ timeout: 90_000 });
  const text = unique('scheduled raven');
  await a.getByLabel('Message', { exact: true }).fill(text);
  await a.getByRole('button', { name: 'Schedule message' }).click();
  const dlg = a.getByRole('dialog', { name: 'Schedule message' });
  const at = new Date(Date.now() + 15_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  await dlg.locator('#sched-at').fill(`${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`);
  await dlg.getByRole('button', { name: 'Schedule', exact: true }).click();
  // A waits on the island: the raven arrives when the message goes out.
  await goHome(a);
  await expect(letterOn(a)).toContainText(text, { timeout: 90_000 });
});
