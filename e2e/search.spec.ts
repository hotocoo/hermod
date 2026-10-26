import type { Page } from '@playwright/test';
import { test, expect, twoUsers, sharedSpace, enterSection, openPalette, say, unique } from './fixtures';
import { freshDevhosts } from './devhosts';

/** Every spec file starts on three empty devhosts. */
test.beforeAll(async () => { test.setTimeout(180_000); await freshDevhosts(); });

/** S-002: full search results page, kind and Space filters, jump to a non-message hit. */
test.describe.configure({ mode: 'serial' });

let users: Awaited<ReturnType<typeof twoUsers>>;
let a: Page;
const space = unique('Seekers');
const word = `quill${Date.now().toString(36)}`;
const doc = `${word} manual`;
const sync = { timeout: 60_000 };

test.beforeAll(async ({ browser }) => {
  users = await twoUsers(browser);
  ({ a } = users);
  await sharedSpace(users.a, users.b, space);
  await enterSection(a, 'board');
  await a.getByRole('tab', { name: 'Docs', exact: true }).last().click();
  await a.getByRole('button', { name: /New doc|Create a doc/ }).first().click();
  await a.getByLabel('Title (required)').fill(doc);
  await a.getByLabel('Kind of document').fill('Notes');
  await a.getByRole('button', { name: 'Create doc' }).click();
  await expect(a.getByRole('heading', { name: doc })).toBeVisible();
  await enterSection(a, 'chat');
  await say(a, `${word} in a message`);
});
test.afterAll(async () => { await users?.close(); });

test('See all results opens the results page; kind chips filter it (S-002)', async () => {
  const input = await openPalette(a);
  await input.fill(word);
  await a.getByRole('option', { name: /See all results/ }).click(sync);
  const page = a.getByRole('dialog', { name: 'Search results' });
  await expect(page).toBeVisible();
  const list = page.getByRole('list', { name: 'Results' });
  await expect(list.getByRole('button', { name: new RegExp(doc) })).toBeVisible(sync);
  await expect(list.getByRole('button', { name: /in a message/ })).toBeVisible(sync);

  await page.getByRole('button', { name: 'Docs', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Docs', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(list.getByRole('button', { name: /in a message/ })).toHaveCount(0, sync);
  await expect(list.getByRole('button', { name: new RegExp(doc) })).toBeVisible();
});

test('a doc hit jumps to the Docs tab with the doc selected (S-002)', async () => {
  await enterSection(a, 'chat');
  await a.keyboard.press('Control+k');
  await a.getByPlaceholder(/Search people, channels/).fill(word);
  await a.getByRole('option', { name: /See all results/ }).click(sync);
  const page = a.getByRole('dialog', { name: 'Search results' });
  await page.getByRole('button', { name: 'Docs', exact: true }).click();
  await page.getByRole('list', { name: 'Results' }).getByRole('button', { name: new RegExp(doc) }).click(sync);
  await expect(page).toHaveCount(0);
  await expect(a.getByRole('heading', { name: doc })).toBeVisible(sync);
});
