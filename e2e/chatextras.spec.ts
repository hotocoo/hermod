import type { Page } from '@playwright/test';
import { test, expect, twoUsers, sharedSpace, enterSection, say, unique, pngBuffer } from './fixtures';
import { freshDevhosts } from './devhosts';

test.beforeAll(async () => { test.setTimeout(180_000); await freshDevhosts(); });

/** Chat extras with two real peers in one Space: custom emoji, stickers, media gallery and automations (M-012, M-013, M-018, M-052). */
test.describe.configure({ mode: 'serial' });

let users: Awaited<ReturnType<typeof twoUsers>>;
let a: Page;
let b: Page;
const space = unique('Cove');

const msg = (page: Page, text: string | RegExp) => page.getByRole('article').filter({ hasText: text });
async function chatMenu(page: Page, item: string | RegExp): Promise<void> {
  await page.getByRole('button', { name: 'Chat options' }).click();
  await page.getByRole('menuitem', { name: item }).or(page.getByRole('button', { name: item })).first().click();
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  users = await twoUsers(browser, ['Ada Tester', 'Bo Tester']);
  ({ a, b } = users);
  await sharedSpace(a, b, space);
  for (const p of [a, b]) await expect(async () => { await enterSection(p, 'chat'); }).toPass({ timeout: 90_000 });
});
test.afterAll(async () => { users.errors.forEach((e) => e.expectClean()); await users.close(); });

/** Re-enters the chat on both peers (earlier tests may have left a modal or another section open). */
async function backToChat(): Promise<void> {
  for (const p of [a, b]) {
    await p.keyboard.press('Escape');
    await expect(async () => { await enterSection(p, 'chat'); }).toPass({ timeout: 90_000 });
  }
}

// M-012: a custom emoji added from the picker is listed for the Space, inserts as :name: and renders as an image on the peer.
test('a custom emoji added from the picker renders as an image on the peer (M-012)', async () => {
  test.setTimeout(240_000);
  await backToChat();
  const name = `e${Date.now().toString(36)}`;
  await a.getByRole('button', { name: 'Emoji', exact: true }).click();
  const picker = a.getByRole('dialog', { name: 'Emoji' });
  await picker.getByRole('tab', { name: 'Custom' }).click();
  await picker.getByTestId('emoji-file').setInputFiles({ name: `${name}.png`, mimeType: 'image/png', buffer: pngBuffer(20, 160, 90) });
  await picker.getByRole('button', { name, exact: true }).click();
  await expect(a.getByLabel('Message', { exact: true })).toHaveValue(`:${name}:`);
  await a.keyboard.press('Enter');
  for (const p of [a, b]) await expect(p.getByRole('article').getByRole('img', { name: `:${name}:` }).last()).toBeVisible({ timeout: 45_000 });
});

// M-013: a sticker added to the Space pack sends as a sticker message the peer sees.
test('a sticker added to the Space pack reaches the other side (M-013)', async () => {
  test.setTimeout(240_000);
  await backToChat();
  const name = `st${Date.now().toString(36)}`;
  await a.getByRole('button', { name: 'Stickers and GIFs' }).click();
  const panel = a.getByRole('dialog', { name: 'Stickers and GIFs' });
  await panel.locator('input[type=file]').setInputFiles({ name: `${name}.png`, mimeType: 'image/png', buffer: pngBuffer(200, 120, 20) });
  await panel.getByRole('button', { name, exact: true }).click();
  await expect(panel).toBeHidden();
  await expect(b.getByRole('article').getByRole('img', { name: 'Sticker' }).last()).toBeVisible({ timeout: 45_000 });
  // The pack is Space state: B lists the sticker too.
  await b.getByRole('button', { name: 'Stickers and GIFs' }).click();
  await expect(b.getByRole('dialog', { name: 'Stickers and GIFs' }).getByRole('button', { name, exact: true })).toBeVisible();
  await b.keyboard.press('Escape');
});

// M-018: Chat options, Media, files and links lists the chat's photos and links, and Jump goes to the message.
test('the chat media gallery lists a photo and a link and jumps to the message (M-018)', async () => {
  test.setTimeout(240_000);
  await backToChat();
  const file = `gal${Date.now().toString(36)}.png`;
  const chooser = a.waitForEvent('filechooser');
  await a.getByRole('button', { name: 'Attach files' }).click();
  await (await chooser).setFiles({ name: file, mimeType: 'image/png', buffer: pngBuffer(90, 30, 200) });
  await expect(a.getByRole('list', { name: 'Attached' }).getByText(file)).toBeVisible();
  await a.getByLabel('Message', { exact: true }).fill(`photo ${file}`);
  await a.keyboard.press('Enter');
  const link = `https://example.org/${file.replace('.png', '')}`;
  await say(a, `see ${link}`);
  await expect(msg(b, link).first()).toBeVisible({ timeout: 45_000 });
  for (const p of [a, b]) {
    await chatMenu(p, 'Media, files and links');
    const dlg = p.getByRole('dialog', { name: 'Media, files and links' });
    await expect(dlg.getByRole('img', { name: file })).toBeVisible({ timeout: 30_000 });
    await dlg.getByRole('tab', { name: 'Links' }).click();
    const row = dlg.getByRole('listitem').filter({ hasText: link });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Jump' }).click();
    await expect(dlg).toBeHidden();
  }
});

// M-052: an admin's keyword rule answers a peer's message; the reply is marked as an automation and reaches both sides.
test('a keyword automation replies to the peer and shows the auto badge (M-052)', async () => {
  test.setTimeout(240_000);
  await backToChat();
  const word = `kw${Date.now().toString(36)}`;
  const answer = `answer-${word}`;
  await chatMenu(a, 'Channel settings');
  const dlg = a.getByRole('dialog', { name: 'Channel settings' });
  await dlg.getByLabel('Rule name').fill('Echo rule');
  await dlg.getByLabel('Keywords, comma separated').fill(word);
  await dlg.getByLabel('Reply text').fill(answer);
  await dlg.getByRole('button', { name: 'Add rule' }).click();
  await expect(dlg.getByText(`Echo rule: on ${word} reply ${answer}`)).toBeVisible();
  await dlg.getByRole('button', { name: 'Cancel' }).click();
  await say(b, `question ${word}`);
  for (const p of [a, b]) {
    const reply = msg(p, answer).first();
    await expect(reply).toBeVisible({ timeout: 60_000 });
    await expect(reply.getByText('auto', { exact: true })).toBeVisible();
  }
  // Remove the rule so it does not answer later specs.
  await chatMenu(a, 'Channel settings');
  const again = a.getByRole('dialog', { name: 'Channel settings' });
  await again.getByRole('button', { name: 'Delete' }).click();
  await expect(again.getByText(`Echo rule: on ${word}`)).toBeHidden();
  await again.getByRole('button', { name: 'Cancel' }).click();
});
