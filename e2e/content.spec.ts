import type { Locator, Page } from '@playwright/test';
import { test, expect, twoUsers, sharedSpace, enterSection, unique, pngBuffer, type SectionId } from './fixtures';
import { freshDevhosts } from './devhosts';

/** Every spec file starts on three empty devhosts, so no spec depends on state a former one left. */
test.beforeAll(async () => { test.setTimeout(180_000); await freshDevhosts(); });

/**
 * Feed, gallery (stories, pinboards), work (board, docs, calendar) and skein with two real users (two devhosts, real P2P sync).
 * Files go through the real file chooser into the real blob store; nothing is stubbed.
 */
test.describe.configure({ mode: 'serial' });

let users: Awaited<ReturnType<typeof twoUsers>>;
let a: Page;
let b: Page;
const space = unique('Studio');

const tab = (p: Page, name: string) => p.getByRole('tab', { name, exact: true }).last();
const btn = (p: Page, name: string | RegExp) => p.getByRole('button', { name });
/** Playwright scrolls hidden overflow containers to reach targets; reset them so the next building opens in place. */
const go = async (p: Page, id: SectionId) => {
  await p.evaluate(() => document.querySelectorAll('*').forEach((el) => { if (el.scrollTop || el.scrollLeft) { el.scrollTop = 0; el.scrollLeft = 0; } }));
  await enterSection(p, id);
};
const sync = { timeout: 60_000 };

/** Clicks `trigger` and feeds the file chooser it opens. */
async function choose(p: Page, trigger: Locator, files: { name: string; mimeType: string; buffer: Buffer }[]): Promise<void> {
  const [chooser] = await Promise.all([p.waitForEvent('filechooser'), trigger.click()]);
  await chooser.setFiles(files);
}

/** Fills the one text-input dialog (store.ask) by field label and submits. */
async function ask(p: Page, fields: Record<string, string>, submit: string): Promise<void> {
  for (const [label, value] of Object.entries(fields)) await p.getByLabel(label).fill(value);
  await btn(p, submit).click();
}

test.beforeAll(async ({ browser }) => {
  users = await twoUsers(browser);
  ({ a, b } = users);
  await sharedSpace(a, b, space);
  // A raises every building used here; B enters once they have synced.
  for (const id of ['feed', 'board', 'skein'] as const) await go(a, id);
});
test.afterAll(async () => {
  users.errors.forEach((e) => e.expectClean());
  await users.close();
});

test.describe('feed (F-001..F-005, F-009)', () => {
  const photoTitle = unique('Sunrise');
  const noteTitle = unique('Kiln log');
  const noteText = unique('fired at cone six');

  test('A publishes a photo and a note; B sees both and the photo blob loads over /blob', async () => {
    await go(a, 'feed');
    await btn(a, 'New post').click();
    await choose(a, btn(a, 'Choose a photo'), [{ name: 'sunrise.png', mimeType: 'image/png', buffer: pngBuffer(240, 120, 40) }]);
    await expect(a.getByText(/sunrise\.png · /)).toBeVisible();
    await a.getByLabel('Title (required)').fill(photoTitle);
    await btn(a, 'Publish').click();
    await expect(a.getByRole('article', { name: photoTitle })).toBeVisible();

    await btn(a, 'New post').click();
    await a.getByRole('radiogroup', { name: 'Kind of post' }).getByText('Note', { exact: true }).click();
    await a.getByLabel('Title (required)').fill(noteTitle);
    await a.getByLabel('Note (required)').fill(noteText);
    await btn(a, 'Publish').click();
    await expect(a.getByRole('article', { name: noteTitle })).toContainText(noteText);

    await go(b, 'feed');
    const photo = b.getByRole('article', { name: photoTitle });
    await expect(photo).toBeVisible(sync);
    await expect(b.getByRole('article', { name: noteTitle })).toContainText(noteText, sync);
    // The image is fetched from A's blob store through the node: it must decode to real pixels.
    await expect.poll(() => photo.locator('img').evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth), sync).toBeGreaterThan(0);
  });

  test('likes and saves: counts agree on both peers, Saved is per user', async () => {
    const onB = b.getByRole('article', { name: photoTitle });
    await onB.getByRole('button', { name: /^Like, 0/ }).click();
    await expect(onB.getByRole('button', { name: /^Like, 1/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(a.getByRole('article', { name: photoTitle }).getByRole('button', { name: /^Like, 1/ })).toBeVisible(sync);
    await onB.getByRole('button', { name: 'Like, 1' }).click();
    await expect(a.getByRole('article', { name: photoTitle }).getByRole('button', { name: /^Like, 0/ })).toBeVisible(sync);

    await onB.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(onB.getByRole('button', { name: 'Saved', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await tab(b, 'Saved').click();
    await expect(b.getByRole('article', { name: photoTitle })).toBeVisible();
    await expect(b.getByRole('article', { name: noteTitle })).toHaveCount(0);
    await tab(a, 'Saved').click();
    await expect(a.getByRole('article', { name: photoTitle })).toHaveCount(0);
    await expect(a.getByText(/Nothing here yet/)).toBeVisible();
    await tab(a, 'For you').click();
    await tab(b, 'For you').click();
  });

  test('Follow filters the Following tab', async () => {
    const onB = b.getByRole('article', { name: noteTitle });
    await expect(onB.getByRole('button', { name: 'Follow', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await tab(b, 'Following').click();
    await expect(b.getByText(/Nothing here yet/)).toBeVisible();
    await tab(b, 'For you').click();
    await onB.getByRole('button', { name: 'Follow', exact: true }).click();
    await expect(onB.getByRole('button', { name: 'Following', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await tab(b, 'Following').click();
    await expect(b.getByRole('article', { name: noteTitle })).toBeVisible();
    await tab(b, 'For you').click();
  });

  test('the photo opens in the lightbox and Escape closes it', async () => {
    await b.getByRole('button', { name: `Open ${photoTitle}` }).click();
    const box = b.getByRole('dialog');
    await expect(box.locator('img').first()).toBeVisible();
    await b.keyboard.press('Escape');
    await expect(box).toBeHidden();
  });

  test('B comments on A\'s post and both see it; A deletes the post and it leaves both feeds (F-007, F-008)', async () => {
    const title = unique('Doomed note');
    const comment = unique('lovely glaze');
    await btn(a, 'New post').click();
    await a.getByRole('radiogroup', { name: 'Kind of post' }).getByText('Note', { exact: true }).click();
    await a.getByLabel('Title (required)').fill(title);
    await a.getByLabel('Note (required)').fill('short lived');
    await btn(a, 'Publish').click();
    const onA = a.getByRole('article', { name: title });
    const onB = b.getByRole('article', { name: title });
    await expect(onB).toBeVisible(sync);

    await onB.getByRole('button', { name: 'Comment', exact: true }).click();
    await onB.getByLabel('Add a comment').fill(comment);
    await onB.getByRole('button', { name: 'Post', exact: true }).click();
    await expect(onB.getByText(comment)).toBeVisible();
    await expect(onA.getByRole('button', { name: '1 comment' })).toBeVisible(sync);
    await onA.getByRole('button', { name: '1 comment' }).click();
    await expect(onA.getByText(comment)).toBeVisible();

    await onA.getByRole('button', { name: 'Delete this post' }).click();
    await a.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(onA).toHaveCount(0);
    await expect(onB).toHaveCount(0, sync);
  });
});

test.describe('stories (V-016, V-017)', () => {
  const first = unique('Low tide');
  const second = unique('Back at the pier');

  test('A shares a two item story; B sees the ring, steps through, and it auto-advances', async () => {
    await go(a, 'feed');
    await tab(a, 'Stories').click();
    await btn(a, 'New story').click();
    await choose(a, btn(a, 'Choose photos or clips'), [
      { name: 'tide.png', mimeType: 'image/png', buffer: pngBuffer(20, 90, 200) },
      { name: 'pier.png', mimeType: 'image/png', buffer: pngBuffer(30, 160, 90) },
    ]);
    const caps = a.getByLabel(/^Caption for/);
    await expect(caps).toHaveCount(2);
    await caps.nth(0).fill(first);
    await caps.nth(1).fill(second);
    await btn(a, 'Share story').click();
    await expect(a.getByRole('button', { name: "Watch Ada's story" })).toBeVisible();

    await go(b, 'feed');
    await tab(b, 'Stories').click();
    await btn(b, "Watch Ada's story").click(sync);
    const viewer = b.getByRole('dialog', { name: "Ada Tester's story" });
    await expect(viewer.getByText(first)).toBeVisible();
    await expect(viewer.locator('img')).toHaveCount(1);
    await expect.poll(() => viewer.locator('img').evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth), sync).toBeGreaterThan(0);
    await viewer.getByRole('button', { name: 'Next' }).click();
    await expect(viewer.getByText(second)).toBeVisible();
    await viewer.getByRole('button', { name: 'Previous' }).click();
    await expect(viewer.getByText(first)).toBeVisible();
    // Timer driven advance (about 5 s per item), no click.
    await expect(viewer.getByText(second)).toBeVisible({ timeout: 20_000 });
    await b.keyboard.press('Escape');
    await expect(viewer).toBeHidden();
  });
});

test.describe('pinboards (V-019, V-020)', () => {
  const board = unique('Glazes');
  const pin = unique('Celadon test');

  test('A makes a board and pins an image; B sees the board and the pin', async () => {
    await go(a, 'feed');
    await tab(a, 'Boards').click();
    await btn(a, 'New board').click();
    await ask(a, { Name: board }, 'Create board');
    await btn(a, new RegExp(board)).click();
    await expect(a.getByRole('heading', { name: board })).toBeVisible();
    await choose(a, btn(a, /Add pin/), [{ name: 'celadon.png', mimeType: 'image/png', buffer: pngBuffer(150, 200, 170) }]);
    await ask(a, { Title: pin }, 'Pin it');
    await expect(a.getByRole('button', { name: `Open ${pin}` })).toBeVisible();

    await go(b, 'feed');
    await tab(b, 'Boards').click();
    await btn(b, new RegExp(board)).click(sync);
    await expect(b.getByRole('heading', { name: board })).toBeVisible();
    const img = b.getByRole('button', { name: `Open ${pin}` }).locator('img');
    await expect(img).toBeVisible(sync);
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth), sync).toBeGreaterThan(0);
  });
});

test.describe('docs (V-021..V-024)', () => {
  const doc = unique('Kiln manual');
  const todo = unique('check the vents');
  const fromA = unique('A wrote this');
  const fromB = unique('B wrote this');

  const values = (p: Page) => p.locator('textarea').evaluateAll((els) => els.map((e) => (e as HTMLTextAreaElement).value));

  test('A creates a doc with a to-do; B sees it and toggles the checkbox for both', async () => {
    await go(a, 'board');
    await tab(a, 'Docs').click();
    await btn(a, /New doc|Create a doc/).first().click();
    await ask(a, { 'Title (required)': doc, 'Kind of document': 'Notes' }, 'Create doc');
    await expect(a.getByRole('heading', { name: doc })).toBeVisible();
    await btn(a, /To-do/).click();
    await a.getByRole('textbox', { name: 'To-do' }).fill(todo);
    await a.getByRole('textbox', { name: 'To-do' }).blur();
    await expect(a.getByRole('checkbox', { name: `Toggle ${todo}` })).toHaveAttribute('aria-checked', 'false');

    await go(b, 'board');
    await tab(b, 'Docs').click();
    await btn(b, new RegExp(doc)).click(sync);
    const onB = b.getByRole('checkbox', { name: `Toggle ${todo}` });
    await expect(onB).toBeVisible(sync);
    await onB.click();
    await expect(a.getByRole('checkbox', { name: `Toggle ${todo}` })).toHaveAttribute('aria-checked', 'true', sync);
  });

  test('concurrent lines from both users merge without loss', async () => {
    await Promise.all([btn(a, /Paragraph/).click(), btn(b, /Paragraph/).click()]);
    // Both blanks exist on both peers before anyone types, so block n is the same block on each page and the two edits hit different lines.
    const paragraphs = (p: Page) => p.getByRole('textbox', { name: 'Paragraph' });
    for (const p of [a, b]) await expect(paragraphs(p)).toHaveCount(2, sync);
    const write = async (p: Page, n: number, text: string) => { await paragraphs(p).nth(n).fill(text); await paragraphs(p).nth(n).blur(); };
    await Promise.all([write(a, 0, fromA), write(b, 1, fromB)]);
    for (const p of [a, b]) {
      await expect.poll(() => values(p), sync).toEqual(expect.arrayContaining([todo, fromA, fromB]));
    }
  });

  test('V-027: B edits A\'s line in place and A removes a line; both peers agree', async () => {
    const paragraphs = (p: Page) => p.getByRole('textbox', { name: 'Paragraph' });
    const indexOf = async (p: Page, text: string) => {
      const i = (await paragraphs(p).evaluateAll((els) => els.map((e) => (e as HTMLTextAreaElement).value))).indexOf(text);
      expect(i, `"${text}" is a paragraph`).toBeGreaterThanOrEqual(0);
      return i;
    };
    const edited = unique('B reworded this');
    const onB = paragraphs(b).nth(await indexOf(b, fromA));
    await onB.fill(edited);
    await onB.blur();
    for (const p of [a, b]) await expect.poll(() => values(p), sync).toEqual(expect.arrayContaining([edited]));
    for (const p of [a, b]) await expect.poll(() => values(p), sync).not.toEqual(expect.arrayContaining([fromA]));

    await btn(a, 'Remove paragraph').nth(await indexOf(a, fromB)).click();
    for (const p of [a, b]) {
      await expect.poll(() => values(p), sync).not.toEqual(expect.arrayContaining([fromB]));
      await expect.poll(() => values(p), sync).toEqual(expect.arrayContaining([todo, edited]));
    }
  });
});

test.describe('calendar (V-028..V-030)', () => {
  const title = unique('Glaze review');

  test('A creates a meeting; B RSVPs and both see the attendee', async () => {
    await go(a, 'board');
    await tab(a, 'Calendar').click();
    await btn(a, /New meeting/).first().click();
    await ask(a, { 'Title (required)': title }, 'Add to calendar');
    await expect(a.getByRole('heading', { name: title })).toBeVisible();

    await go(b, 'board');
    await tab(b, 'Calendar').click();
    await btn(b, new RegExp(title)).click(sync);
    await expect(b.getByRole('heading', { name: title })).toBeVisible();
    await btn(b, 'I’m going').click();
    await expect(b.getByRole('button', { name: /Going, tap to undo/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(b.getByText(/Bo Tester/).last()).toBeVisible();
    await expect(a.getByText(/Bo Tester/).last()).toBeVisible(sync);
  });

  test('A edits the meeting, B sees the new title; A cancels it and it leaves both calendars (V-033)', async () => {
    const renamed = unique('Glaze retro');
    await btn(a, 'Edit meeting').click();
    await a.getByLabel('Title (required)').fill(renamed);
    await a.getByLabel('Where').fill('The Kiln');
    await btn(a, /^Save$/).click();
    await expect(a.getByRole('heading', { name: renamed })).toBeVisible();
    await expect(b.getByRole('button', { name: new RegExp(renamed) })).toBeVisible(sync);
    await b.getByRole('button', { name: new RegExp(renamed) }).click();
    // B is a member, not the author or an admin: the core would drop their edit, so the buttons are hidden.
    await expect(b.getByRole('button', { name: 'Edit meeting' })).toHaveCount(0);
    await expect(b.getByRole('button', { name: 'Cancel meeting' })).toHaveCount(0);

    await btn(a, 'Cancel meeting').click();
    await a.getByRole('dialog').getByRole('button', { name: 'Cancel meeting' }).click();
    await expect(a.getByRole('button', { name: new RegExp(renamed) })).toHaveCount(0);
    await expect(b.getByRole('button', { name: new RegExp(renamed) })).toHaveCount(0, sync);
  });
});

test.describe('board (B-001..B-005, B-007)', () => {
  const card = unique('Order clay');
  const colName = 'Review';
  const col = (p: Page, name: string) => p.getByRole('region', { name, exact: true });

  test('A creates the board, a column and a card; B sees them', async () => {
    await go(a, 'board');
    await tab(a, 'Board').click();
    // An empty workbench offers either button; both open the New board dialog.
    await btn(a, /Create the first board|New column/).first().click();
    await ask(a, { 'Name (required)': unique('Sprint') }, 'Create board');
    await btn(a, /New column/).click();
    await ask(a, { 'Name (required)': colName }, 'Add column');
    await expect(col(a, colName)).toBeVisible();
    await col(a, 'To do').getByRole('button', { name: /Add a card/ }).click();
    await ask(a, { 'Title (required)': card, Tag: 'ops' }, 'Add card');
    await expect(col(a, 'To do').getByText(card)).toBeVisible();

    await go(b, 'board');
    await tab(b, 'Board').click();
    await expect(col(b, 'To do').getByText(card)).toBeVisible(sync);
    await expect(col(b, colName)).toBeVisible();
  });

  test('keyboard move menu moves the card; the peer sees it', async () => {
    await col(b, 'To do').getByRole('button', { name: `Move ${card} to another column` }).click();
    await b.getByRole('menuitem', { name: 'Doing' }).click();
    await expect(col(b, 'Doing').getByText(card)).toBeVisible();
    await expect(col(a, 'Doing').getByText(card)).toBeVisible(sync);
  });

  test('drag and drop moves the card', async () => {
    await col(a, 'Doing').getByText(card).dragTo(col(a, 'Done'));
    await expect(col(a, 'Done').getByText(card)).toBeVisible();
    await expect(col(b, 'Done').getByText(card)).toBeVisible(sync);
  });

  test('two users moving the same card at once converge on one column', async () => {
    await Promise.all([
      (async () => { await col(a, 'Done').getByRole('button', { name: `Move ${card} to another column` }).click(); await a.getByRole('menuitem', { name: 'Doing' }).click(); })(),
      (async () => { await col(b, 'Done').getByRole('button', { name: `Move ${card} to another column` }).click(); await b.getByRole('menuitem', { name: colName }).click(); })(),
    ]);
    const where = async (p: Page) => {
      for (const name of ['To do', 'Doing', 'Done', colName]) if (await col(p, name).getByText(card).count()) return name;
      return '';
    };
    await expect.poll(async () => { const [x, y] = [await where(a), await where(b)]; return x !== '' && x !== 'Done' && x === y; }, sync).toBe(true); // 'Done' is where the card started: agreeing there only means neither move has landed yet
    const settled = await where(a);
    await a.waitForTimeout(2_000);
    expect([await where(a), await where(b)]).toEqual([settled, settled]);
  });

  test('assign and due date show on the peer; delete removes the card for both (B-006)', async () => {
    await a.getByRole('button', { name: `Edit ${card}` }).click();
    await a.getByLabel('Assigned to').selectOption({ label: 'Bo Tester' });
    await a.getByLabel('Due').fill('2030-01-31');
    await btn(a, /^Save$/).click();
    const onB = b.locator('div').filter({ hasText: card }).filter({ hasText: 'Due 2030-01-31' }).last();
    await expect(onB).toContainText('Bo Tester', sync);

    await a.getByRole('button', { name: `Delete ${card}` }).click();
    await a.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(a.getByText(card)).toHaveCount(0);
    await expect(b.getByText(card)).toHaveCount(0, sync);
  });
});

test.describe('skein (K-001..K-003, K-006, K-007)', () => {
  const first = unique('Initial palette');
  const line = unique('warmer');
  const onLine = unique('Warm lanterns');

  test('A takes a snapshot from a picked file; B sees it in the ledger', async () => {
    await go(a, 'skein');
    await btn(a, /Take a snapshot/).first().click();
    await a.getByLabel('Title (required)').fill(first);
    await choose(a, btn(a, 'Choose files'), [{ name: 'palette.txt', mimeType: 'text/plain', buffer: Buffer.from('ink\nclay\nglaze\n') }]);
    await expect(a.getByText(/palette\.txt · /)).toBeVisible();
    await btn(a, 'Take snapshot').click();
    await expect(a.getByRole('button', { name: new RegExp(first) })).toBeVisible();

    await go(b, 'skein');
    await expect(b.getByRole('button', { name: new RegExp(first) })).toBeVisible(sync);
    await b.getByRole('button', { name: new RegExp(first) }).click();
    await expect(b.getByRole('heading', { name: first })).toBeVisible();
    await expect(b.getByText('palette.txt').first()).toBeVisible(); // named in the file list and again in the diff header
  });

  test('A starts a line, snapshots on it, and weaves it into main; both ledgers show the weave', async () => {
    await btn(a, /New line/).click();
    await ask(a, { 'Name (required)': line, 'What is it for': 'a warmer look' }, 'Start line');
    await expect(btn(a, new RegExp(line))).toBeVisible();
    await btn(a, /Take a snapshot/).first().click();
    await a.getByLabel('Title (required)').fill(onLine);
    await expect(a.getByLabel('Line')).toHaveValue(/.+/);
    await a.getByLabel('Line').selectOption({ label: line });
    await choose(a, btn(a, 'Choose files'), [{ name: 'lantern.txt', mimeType: 'text/plain', buffer: Buffer.from('amber\n') }]);
    await btn(a, 'Take snapshot').click();
    await expect(a.getByText('Ready to Weave')).toBeVisible();

    // B sees the line and the pending weave before it happens.
    await expect(btn(b, new RegExp(line))).toBeVisible(sync);
    await expect(b.getByText('Ready to Weave')).toBeVisible(sync);

    await a.getByRole('button', { name: 'Weave', exact: true }).click();
    await expect(a.getByText('Ready to Weave')).toBeHidden();
    // The weave is a snapshot on main; the ledger only lists the picked line, so look at All lines.
    for (const p of [a, b]) await btn(p, /^All lines/).click();
    await expect(a.getByRole('button', { name: /Wove .* into main/ })).toBeVisible();
    await expect(b.getByRole('button', { name: /Wove .* into main/ })).toBeVisible(sync);
    await expect(b.getByText('Ready to Weave')).toBeHidden(sync);
  });
});
