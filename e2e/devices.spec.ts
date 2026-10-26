import type { Page } from '@playwright/test';
import { test, expect, bootApp, DEVHOST_A, DEVHOST_FRESH, UI_URL } from './fixtures';
import { freshDevhosts } from './devhosts';

test.beforeAll(async () => { test.setTimeout(180_000); await freshDevhosts(); });

/** D-001: link a second device with a code, see both in Settings, revoke it. A is the first device, FRESH the new one. */

const settings = async (page: Page) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'App settings' }).click();
  const dlg = page.getByRole('dialog', { name: /App settings/ });
  await dlg.getByRole('tab', { name: 'Identity' }).click();
  return dlg;
};

test('a code links a second device that shows as one identity, and revoke ends it', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctxA = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, baseURL: UI_URL });
  const ctxB = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, baseURL: UI_URL });
  const [a, b] = [await ctxA.newPage(), await ctxB.newPage()];
  try {
    await bootApp(a, DEVHOST_A, 'Ada Tester', false, false);
    await bootApp(b, DEVHOST_FRESH, 'Throwaway', false, false);
    // A shows a one-time code (QR plus text).
    let da = await settings(a);
    await expect(da.getByRole('heading', { name: 'Your devices' })).toBeVisible();
    await da.getByRole('button', { name: 'Link a device' }).click();
    await expect(da.getByRole('img', { name: 'QR code for linking a device' }).or(da.getByRole('alert'))).toBeVisible();
    const code = await da.locator('#device-link-code').inputValue();
    expect(code.length).toBeGreaterThan(100);

    // The new device accepts it and comes back as the same identity.
    const db = await settings(b);
    await db.getByLabel('Code from the other device').fill(code);
    await db.getByRole('button', { name: 'Link this device' }).click();
    await b.getByRole('dialog', { name: 'Replace this device’s data?' }).getByRole('button', { name: 'Link and replace' }).click();
    await bootApp(b, DEVHOST_FRESH, 'unused', false, false);
    const db2 = await settings(b);
    const userB = await db2.getByLabel('User id').inputValue();
    await a.keyboard.press('Escape');
    da = await settings(a);
    await expect(da.getByLabel('User id')).toHaveValue(userB);
    await expect(db2.getByText('(this device)')).toBeVisible();
    await expect(db2.getByText('Only the first device can link or revoke devices.')).toBeVisible();

    // A lists both and revokes the linked one.
    await a.keyboard.press('Escape');
    da = await settings(a);
    await expect(da.getByRole('list', { name: 'Your devices' }).getByRole('listitem')).toHaveCount(2);
    await da.getByRole('button', { name: /^Revoke device / }).click();
    await a.getByRole('dialog', { name: 'Revoke this device?' }).getByRole('button', { name: 'Revoke' }).click();
    await expect(da.getByText('(revoked)')).toBeVisible();
    await expect(da.getByRole('button', { name: /^Revoke device / })).toHaveCount(0);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});
