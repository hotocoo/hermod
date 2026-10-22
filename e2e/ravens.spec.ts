import type { Page } from '@playwright/test';
import { test, expect, twoUsers, sharedSpace, enterSection, say, toIsland, unique } from './fixtures';
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

// R-001: a real message.post from another Space brings a raven letter (reduced motion lands it at once).
test('a message posted by B in another Space brings A a raven letter', async () => {
  await enterSection(b, 'chat');
  await toIsland(a);
  // The rail lists Home first: A leaves the shared Space so B's post is "from another space".
  await a.getByRole('navigation', { name: 'Spaces' }).first().getByRole('button').first().click();
  await say(b, 'raven mail for Ada');
  const letter = a.locator('[data-obstacle]').filter({ hasText: 'A raven from' });
  await expect(letter).toContainText('Bo Tester', { timeout: 30_000 });
  await expect(letter).toContainText('raven mail for Ada');
});
