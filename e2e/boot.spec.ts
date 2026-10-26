import { test, expect, createSpace, unique, DEVHOST_A, DEVHOST_FRESH, bootApp, watchErrors, enterBuilding } from './fixtures';
import { freshDevhosts } from './devhosts';

/** Every spec file starts on three empty devhosts, so no spec depends on state a former one left. */
test.beforeAll(async () => { test.setTimeout(180_000); await freshDevhosts(); });

test.describe('boot', () => {
  test('shows the created space, the canvas and the building labels', async ({ app }) => {
    const name = unique('Harbour');
    await app.getByRole('button', { name: 'New Space' }).click();
    await createSpace(app, name, 'Test space');
    await expect(app.locator('canvas')).toBeVisible();
    for (const id of ['chat', 'hearth', 'feed', 'board', 'skein', 'search']) {
      await expect(app.locator(`[data-bld="${id}"]`)).toBeAttached();
    }
    await expect(app.getByRole('navigation', { name: 'Spaces' })).toBeVisible();
  });

  test('buildings are one Tab stop, arrows cycle focus, Enter opens the door card, Esc goes back (X-002)', async ({ app }) => {
    await app.getByRole('button', { name: 'New Space' }).click();
    await createSpace(app, unique('Keys'));
    const buttons = app.locator('[data-bld] > button');
    await expect(buttons.first()).toBeAttached();
    await buttons.first().focus();
    await expect(buttons.first()).toBeFocused();
    await app.keyboard.press('ArrowRight');
    await expect(buttons.nth(1)).toBeFocused();
    await app.keyboard.press('ArrowLeft');
    await expect(buttons.first()).toBeFocused();
    await app.keyboard.press('ArrowLeft');
    await expect(buttons.last()).toBeFocused();
    await app.keyboard.press('Enter');
    await app.keyboard.press('Escape');
    await expect(app.locator('canvas')).toBeVisible();
    await expect(buttons.last()).toBeAttached();
  });

  test('space rail switches between spaces the user created', async ({ app }) => {
    const first = unique('Alpha'); const second = unique('Beta');
    const nav = app.getByRole('navigation', { name: 'Spaces' });
    const title = app.getByRole('heading', { level: 1 });
    await app.getByRole('button', { name: 'New Space' }).click();
    await createSpace(app, first);
    await app.getByRole('button', { name: 'New Space' }).click();
    await createSpace(app, second);
    await nav.getByRole('button', { name: first }).click();
    await expect(title).toHaveText(first);
    await nav.getByRole('button', { name: 'Home' }).click();
    await expect(title).toHaveText('Home');
    await nav.getByRole('button', { name: second }).click();
    await expect(title).toHaveText(second);
  });

  test('a brand-new space starts empty: the chat has no messages', async ({ app }) => {
    await app.getByRole('button', { name: 'New Space' }).click();
    await createSpace(app, unique('Quiet'));
    await enterBuilding(app, 'chat');
    await expect(app.getByText(/It’s quiet in/)).toBeVisible();
  });

  test('a message posted by the user is stored and shown', async ({ app }) => {
    await app.getByRole('button', { name: 'New Space' }).click();
    await createSpace(app, unique('Talk'));
    await enterBuilding(app, 'chat');
    await app.getByLabel('Message', { exact: true }).fill('hello from the e2e suite');
    await app.keyboard.press('Enter');
    await expect(app.getByText('hello from the e2e suite')).toBeVisible();
    await app.reload();
    await bootApp(app, DEVHOST_A, 'Ada Tester');
    await expect(app.getByRole('navigation', { name: 'Spaces' })).toBeVisible();
  });
});

test.describe('terms gate', () => {
  test('a fresh install must accept both checkboxes before continuing', async ({ page }) => {
    const errors = watchErrors(page);
    await page.addInitScript(() => localStorage.clear());
    await page.goto(`/?devhost=${encodeURIComponent(DEVHOST_FRESH)}`);
    const cont = page.getByRole('button', { name: /^Continue/ });
    await expect(cont).toBeDisabled();
    await page.getByRole('checkbox', { name: /accept the Terms of Use/i }).check();
    await expect(cont).toBeDisabled();
    await page.getByRole('checkbox', { name: /share .*resources/i }).check();
    await expect(cont).toBeEnabled();
    errors.expectClean();
  });
});

test.describe('onboarding', () => {
  test('the welcome tour steps through and Skip remembers', async ({ page }) => {
    await page.addInitScript(() => localStorage.removeItem('hermodr.welcomed'));
    await bootApp(page, DEVHOST_A, 'Ada Tester', true);
    await expect(page.getByText('Welcome · 1 of 3')).toBeVisible({ timeout: 40_000 });
    await page.getByRole('button', { name: /^Next/ }).click();
    await expect(page.getByText('Welcome · 2 of 3')).toBeVisible();
    await page.getByRole('button', { name: 'Skip' }).click();
    await expect(page.getByText(/Welcome · \d of 3/)).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('hermodr.welcomed'))).toBeTruthy();
  });
});
