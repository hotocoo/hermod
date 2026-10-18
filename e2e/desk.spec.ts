import type { Page } from '@playwright/test';
import { test, expect, twoUsers, enterSection, unique, DEVHOST_A, DEVHOST_B } from './fixtures';
import { freshDevhosts } from './devhosts';

/** Every spec file starts on three empty devhosts, so no spec depends on state a former one left. */
test.beforeAll(async () => { test.setTimeout(180_000); await freshDevhosts(); });

/**
 * Help Desk (docs/ARCHITECTURE.md 11.1) with two real users: A is the admin agent, B a guest requester who joined through a guest invite.
 * Both run against real devhosts (real Core and P2P sync); setup uses the same invoke API the UI uses.
 */
test.describe.configure({ mode: 'serial' });

const invoke = async <T,>(host: string, cmd: string, args: Record<string, unknown>): Promise<T> => {
  const res = await fetch(`${host}/invoke/${cmd}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) });
  if (!res.ok) throw new Error(`${cmd}: ${await res.text()}`);
  return (await res.json()) as T;
};

let users: Awaited<ReturnType<typeof twoUsers>>;
let a: Page;
let b: Page;
let spaceId = '';
const space = unique('Counting');
const subject = unique('Printer jam');
const secondSubject = unique('Login loop');
const internalText = unique('internal-secret');
const publicText = unique('public-reply');

const row = (p: Page, text: string) => p.getByTestId('ticket-row').filter({ hasText: text });
const detail = (p: Page) => p.getByTestId('ticket-detail');

test.beforeAll(async ({ browser }) => {
  users = await twoUsers(browser);
  ({ a, b } = users);
  const created = await invoke<{ label: string }>(DEVHOST_A, 'space_create', { name: space, tagline: 'desk e2e', kind: 'Team' });
  spaceId = created.label;
  await invoke(DEVHOST_A, 'event_append', { spaceId, body: { t: 'section.raise', section: 'desk' } });
  const invite = await invoke<{ code: string }>(DEVHOST_A, 'invite_create', { spaceId, expiresIn: null, maxUses: null, role: 'guest' });
  await invoke(DEVHOST_B, 'invite_accept', { code: invite.code });
  for (const p of [a, b]) {
    await p.getByRole('navigation', { name: 'Spaces' }).getByRole('button', { name: space }).click();
    await expect(p.getByRole('heading', { level: 1 })).toHaveText(space, { timeout: 60_000 });
    // The guest's heading comes from the invite; wait until the raised building has synced too.
    await expect(p.locator('[data-bld="desk"]')).toContainText('Counting House', { timeout: 60_000 });
    await enterSection(p, 'desk', false);
    await expect(p.getByTestId('desk-root')).toBeVisible();
  }
});
test.afterAll(async () => { await users.close(); });

test('admin sets a service promise; guest creates a ticket that the agent sees', async () => {
  await a.getByTestId('desk-settings-open').click();
  await a.getByTestId('sla-first-normal').fill('60');
  await a.getByTestId('sla-resolve-normal').fill('480');
  await a.getByTestId('save-config').click();
  await expect(a.getByTestId('desk-settings')).toBeHidden();

  await b.getByTestId('new-ticket').click();
  await b.getByTestId('nt-subject').fill(subject);
  await b.getByTestId('nt-body').fill('The office printer jams on every second page.');
  await b.getByTestId('nt-submit').click();
  await expect(detail(b).getByTestId('ticket-subject')).toHaveText(subject);

  await expect(row(a, subject)).toBeVisible({ timeout: 60_000 });
  await row(a, subject).click();
  await expect(detail(a).getByTestId('ticket-subject')).toHaveText(subject);
  await expect(detail(a).getByTestId('sla-badge')).toBeVisible();
});

test('agent assigns self, writes an internal note and a public reply; the guest only sees the reply', async () => {
  await detail(a).getByTestId('take-ticket').click();
  await expect(detail(a).getByTestId('prop-assignee')).not.toHaveValue('');

  await a.getByTestId('mode-internal').click();
  await a.getByTestId('composer-input').fill(internalText);
  await a.getByTestId('composer-send').click();
  await expect(detail(a).getByText(internalText)).toBeVisible();

  await a.getByTestId('mode-reply').click();
  await a.getByTestId('composer-input').fill(publicText);
  await a.getByTestId('composer-send').click();

  await expect(detail(b).getByText(publicText)).toBeVisible({ timeout: 60_000 });
  await expect(b.getByText(internalText)).toHaveCount(0);
  await expect(detail(b).getByTestId('comment')).toHaveCount(1);
  // The guest has no agent controls and no SLA.
  await expect(b.getByTestId('properties')).toHaveCount(0);
  await expect(b.getByTestId('sla-badge')).toHaveCount(0);
});

test('a second ticket from the agent stays invisible to the guest', async () => {
  await a.getByTestId('new-ticket').click();
  await a.getByTestId('nt-subject').fill(secondSubject);
  await a.getByTestId('nt-submit').click();
  await expect(detail(a).getByTestId('ticket-subject')).toHaveText(secondSubject);
  await expect(a.getByTestId('stat-open')).toHaveText('2');
  await expect(b.getByTestId('ticket-row')).toHaveCount(1);
  await expect(row(b, secondSubject)).toHaveCount(0);
});

test('search finds the ticket for the agent and respects guest visibility', async () => {
  await a.getByTestId('desk-search').fill(publicText);
  await expect(row(a, subject)).toBeVisible();
  await expect(row(a, secondSubject)).toHaveCount(0);
  await a.getByTestId('desk-search').fill(internalText);
  await expect(row(a, subject)).toBeVisible();
  await a.getByTestId('desk-search').fill('');

  // The core index itself (what the palette uses): the agent finds internal text, the guest does not.
  const hits = (host: string, q: string) => invoke<{ kind: string; id: string }[]>(host, 'search_query', { q, space: spaceId, kinds: ['ticket'], limit: 20 });
  await expect.poll(async () => (await hits(DEVHOST_A, internalText)).length, { timeout: 30_000 }).toBe(1);
  expect((await hits(DEVHOST_B, internalText)).length).toBe(0);
  await expect.poll(async () => (await hits(DEVHOST_B, publicText)).length, { timeout: 30_000 }).toBe(1);
});

test('a macro solves a ticket with a reply; the requester is asked for a rating', async () => {
  await a.getByTestId('desk-settings-open').click();
  await a.getByTestId('macro-name').fill('Wrap up');
  await a.getByTestId('macro-comment').fill('Fixed on our side, closing this out.');
  await a.getByRole('combobox', { name: 'Set status' }).selectOption('solved');
  await a.getByTestId('macro-save').click();
  await expect(a.getByTestId('macro-row').filter({ hasText: 'Wrap up' })).toBeVisible();
  await a.getByRole('dialog', { name: 'Desk settings' }).getByRole('button', { name: 'Close' }).click();

  await a.getByTestId('desk-status').selectOption('all');
  await row(a, subject).click();
  await a.getByTestId('macro-button').click();
  await a.getByTestId('macro-item').filter({ hasText: 'Wrap up' }).click();
  await expect(detail(a).getByTestId('ticket-status')).toHaveText('Solved');
  await expect(detail(a).getByText('Fixed on our side, closing this out.')).toBeVisible();

  await b.getByTestId('desk-status').selectOption('all');
  await row(b, subject).click();
  await expect(b.getByTestId('csat-prompt')).toBeVisible({ timeout: 60_000 });
  await b.getByRole('button', { name: '5 out of 5' }).click();
  await b.getByTestId('csat-send').click();
  await expect(b.getByTestId('csat-prompt')).toHaveCount(0);
  await expect(detail(a).getByTestId('csat-result')).toContainText('Rated 5 out of 5', { timeout: 60_000 });
});

test('merging closes the duplicate and moves it under the kept ticket', async () => {
  await a.getByTestId('desk-status').selectOption('all');
  await row(a, secondSubject).click();
  await a.getByTestId('merge-button').click();
  await a.getByTestId('merge-into').selectOption({ index: 0 });
  await a.getByTestId('merge-confirm').click();
  await expect(row(a, secondSubject)).toHaveCount(0);
  await row(a, subject).click();
  await expect(detail(a).getByText(/Merged here: #\d+/)).toBeVisible();
  users.errors.forEach((e) => e.expectClean());
});
