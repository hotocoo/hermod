import type { Browser, BrowserContext, Page } from '@playwright/test';
import { GL_ARGS } from './gpu';
import { test, expect, bootApp, sharedSpace, enterBuilding, toIsland, panel, goTab, watchErrors, DEVHOST_A, DEVHOST_B, UI_URL, unique } from './fixtures';
import { freshDevhosts } from './devhosts';

test.beforeAll(async () => { test.setTimeout(180_000); await freshDevhosts(); });

/**
 * Meetings in the Hearth (two real peers, Chromium fake capture devices): start with agenda, toggle, shared notes,
 * local stage view and back-to-call pill, device pickers, and the wrap-up card on end.
 * Proves FEATURES H-006, H-007, H-008, H-010, H-012, A-009.
 */
test.use({ launchOptions: { args: [...GL_ARGS, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] }, permissions: ['microphone', 'camera'] });
test.describe.configure({ mode: 'serial' });

let ctxs: BrowserContext[] = [];
const newCtx = (browser: Browser) => browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, baseURL: UI_URL, permissions: ['microphone', 'camera'] });
let a: Page;
let b: Page;
let errors: { expectClean(): void }[] = [];
const space = unique('Meet');
const topic = unique('Standup');
const items = ['Review the plan', 'Pick a date'];
const noteText = unique('Decision');

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  ctxs = await Promise.all([newCtx(browser), newCtx(browser)]);
  [a, b] = await Promise.all(ctxs.map((c) => c.newPage()));
  errors = [watchErrors(a), watchErrors(b)];
  await Promise.all([bootApp(a, DEVHOST_A, 'Ada Tester', false, false), bootApp(b, DEVHOST_B, 'Bo Tester', false, false)]);
  await sharedSpace(a, b, space);
  const post = (host: string, cmd: string, body: unknown) => fetch(`${host}/invoke/${cmd}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json() as Promise<any>); // eslint-disable-line @typescript-eslint/no-explicit-any
  const snap = await post(DEVHOST_A, 'snapshot', {});
  const sp = (snap.spaces as { id: string; name: string }[]).find((x) => x.name === space)!;
  for (const section of ['hearth', 'chat']) await post(DEVHOST_A, 'event_append', { spaceId: sp.id, body: { t: 'section.raise', section } });
  await expect(b.locator('[data-bld="hearth"]')).not.toHaveAttribute('data-empty', { timeout: 60_000 });
});
test.afterAll(async () => { await Promise.all(ctxs.map((c) => c.close())); });

const stage = (p: Page) => p.locator('[data-stage]');

test.describe('meeting', () => {
  test('A makes the call a meeting with an agenda and B sees topic and agenda (H-006)', async () => {
    for (const p of [a, b]) {
      await toIsland(p);
      await enterBuilding(p, 'hearth');
      await p.getByRole('button', { name: /Pull up a chair/ }).click();
    }
    for (const p of [a, b]) await expect(p.getByTestId('tile')).toHaveCount(2, { timeout: 60_000 });
    await a.getByRole('button', { name: 'Make it a meeting' }).click();
    const dlg = a.getByRole('dialog', { name: 'Make it a meeting' });
    await dlg.getByLabel(/^Topic/).fill(topic);
    await dlg.getByLabel(/^Agenda/).fill(items.join('\n'));
    await dlg.getByRole('button', { name: 'Start meeting' }).click();
    for (const p of [a, b]) {
      await expect(p.getByRole('heading', { name: topic })).toBeVisible({ timeout: 45_000 });
      for (const it of items) await expect(p.getByRole('button', { name: new RegExp(it) })).toBeVisible();
      await expect(p.getByText('0 of 2')).toBeVisible();
    }
  });

  test('toggling an agenda item shows on both sides and toggles back (H-007)', async () => {
    await b.getByRole('button', { name: new RegExp(items[0]) }).click();
    for (const p of [a, b]) await expect(p.getByText('1 of 2')).toBeVisible({ timeout: 45_000 });
    await a.getByRole('button', { name: new RegExp(items[0]) }).click();
    for (const p of [a, b]) await expect(p.getByText('0 of 2')).toBeVisible({ timeout: 45_000 });
    await a.getByRole('button', { name: new RegExp(items[1]) }).click();
    for (const p of [a, b]) await expect(p.getByText('1 of 2')).toBeVisible({ timeout: 45_000 });
  });

  test('a shared note shows for everyone with its author (H-008)', async () => {
    await b.getByLabel('Shared note').fill(noteText);
    await b.keyboard.press('Enter');
    for (const p of [a, b]) {
      const note = p.getByText(noteText);
      await expect(note).toBeVisible({ timeout: 45_000 });
      await expect(p.getByText(/^Bo · /)).toBeVisible();
    }
    await expect(b.getByLabel('Shared note')).toHaveValue('');
  });

  test('the stage size toggle is local and the call pill brings you back (H-010)', async () => {
    await expect(stage(a)).toHaveAttribute('data-stage', 'small');
    await a.getByRole('button', { name: 'Bigger stage' }).click();
    await expect(stage(a)).toHaveAttribute('data-stage', 'big');
    await expect(a.getByRole('button', { name: 'Smaller stage' })).toHaveAttribute('aria-pressed', 'true');
    await expect(stage(b)).toHaveAttribute('data-stage', 'small');
    // Away from the Hearth the call keeps running and a pill offers the way back.
    await toIsland(a);
    const pill = a.getByRole('button', { name: new RegExp(`${space} · \\d\\d:\\d\\d`) });
    await expect(pill).toBeVisible();
    await pill.click();
    await expect(panel(a).getByRole('heading', { name: topic })).toBeVisible();
    await expect(stage(a)).toHaveAttribute('data-stage', 'big');
    await a.getByRole('button', { name: 'Smaller stage' }).click();
    await expect(stage(a)).toHaveAttribute('data-stage', 'small');
  });

  test('ending the meeting posts a wrap-up card with title, duration and notes to the channel (A-009)', async () => {
    await a.getByRole('button', { name: 'Leave', exact: true }).click();
    await expect(a.getByRole('button', { name: /Pull up a chair/ })).toBeVisible({ timeout: 30_000 });
    for (const p of [a, b]) {
      await goTab(p, 'Chat');
      const card = p.getByText('Meeting notes', { exact: true }).locator('..');
      await expect(card.getByText(topic)).toBeVisible({ timeout: 45_000 });
      await expect(card.getByText(/^\S.* · 1 notes · agenda 1\/2$/)).toBeVisible();
    }
    await b.getByRole('button', { name: 'Leave', exact: true }).click().catch(() => undefined);
  });
});

test.describe('audio and video settings', () => {
  test('Settings lists the devices and a chosen microphone persists across a reload (H-012)', async () => {
    const open = async (p: Page) => {
      await toIsland(p);
      await p.getByRole('button', { name: 'Settings', exact: true }).click();
      await p.getByRole('button', { name: 'App settings' }).click();
      const dlg = p.getByRole('dialog', { name: /App settings/ });
      await dlg.getByRole('tab', { name: 'Audio and video' }).click();
      return dlg;
    };
    let dlg = await open(a);
    const mic = dlg.getByLabel('Microphone');
    // System default plus at least one real (fake-capture) device, and likewise for camera and speaker.
    await expect.poll(async () => mic.locator('option').count()).toBeGreaterThan(1);
    await expect.poll(async () => dlg.getByLabel('Camera').locator('option').count()).toBeGreaterThan(1);
    await expect.poll(async () => dlg.getByLabel('Speaker').locator('option').count()).toBeGreaterThan(0);
    const choice = await mic.locator('option').nth(1).getAttribute('value');
    expect(choice).toBeTruthy();
    await mic.selectOption(choice!);
    await a.reload();
    await bootApp(a, DEVHOST_A, 'Ada Tester', false, false);
    dlg = await open(a);
    await expect(dlg.getByLabel('Microphone')).toHaveValue(choice!);
    errors.forEach((e) => e.expectClean());
  });
});
