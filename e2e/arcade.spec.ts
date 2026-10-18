import type { Page } from '@playwright/test';
import { test, expect, twoUsers, sharedSpace, enterSection, unique, type SectionId } from './fixtures';
import { freshDevhosts } from './devhosts';

/** Every spec file starts on three empty devhosts, so no spec depends on state a former one left. */
test.beforeAll(async () => { test.setTimeout(180_000); await freshDevhosts(); });

/** Two real devhost users in one Space playing through the Games Hall. No mocks: moves go through the real fold. */
const ARCADE = 'arcade' as SectionId;
const hall = (p: Page) => p.getByTestId('arcade');
const tab = (p: Page, id: string) => hall(p).getByTestId(`arcade-tab-${id}`).click();

async function setup(browser: Parameters<typeof twoUsers>[0]) {
  const u = await twoUsers(browser);
  await sharedSpace(u.a, u.b, unique('Hall'));
  await enterSection(u.a, ARCADE);
  await enterSection(u.b, ARCADE, false).catch(() => undefined);
  await expect(hall(u.a)).toBeVisible();
  await expect(hall(u.b)).toBeVisible({ timeout: 60_000 });
  return u;
}

async function create(p: Page, kind: string) {
  await p.getByTestId('new-game').click();
  await p.getByTestId(`kind-${kind}`).click();
  await p.getByTestId('create-game-submit').click();
  await expect(p.getByTestId('game-status')).toBeVisible();
}

async function joinFirst(p: Page, kind: string) {
  await tab(p, 'games');
  const card = p.locator(`[data-testid="game-card"][data-kind="${kind}"]`).first();
  await expect(card).toBeVisible({ timeout: 60_000 });
  await card.getByTestId('join-game').click();
  await expect(p.getByTestId('game-status')).toBeVisible();
}

const sq = (p: Page, n: string) => p.getByTestId(`sq-${n}`);
async function play(p: Page, from: string, to: string) {
  await sq(p, from).click();
  await sq(p, to).click();
}

test.describe('arcade', () => {
  test('chess: scholar mate, illegal move rejected, result and elo on both sides', async ({ browser }) => {
    const { a, b, errors, close } = await setup(browser);
    await create(a, 'chess');
    await joinFirst(b, 'chess');
    await expect(a.getByTestId('game-status')).toHaveText(/Your move/, { timeout: 60_000 });

    // illegal: a pawn cannot jump three squares; the click selects nothing legal and no move is made
    await sq(a, 'e2').click();
    await sq(a, 'e5').click();
    await expect(a.getByTestId('game-status')).toHaveText(/Your move/);

    const line: [Page, string, string][] = [[a, 'e2', 'e4'], [b, 'e7', 'e5'], [a, 'd1', 'h5'], [b, 'b8', 'c6'], [a, 'f1', 'c4'], [b, 'g8', 'f6'], [a, 'h5', 'f7']];
    for (const [who, from, to] of line) {
      await expect(who.getByTestId('game-status')).toHaveText(/Your move/, { timeout: 60_000 });
      await play(who, from, to);
    }
    await expect(a.getByTestId('game-status')).toHaveText(/You won \(checkmate\)/, { timeout: 60_000 });
    await expect(b.getByTestId('game-status')).toHaveText(/won \(checkmate\)/, { timeout: 60_000 });

    for (const [p, elo] of [[a, '1212'], [b, '1188']] as const) {
      await tab(p, 'board');
      await expect(p.getByTestId('board-chess')).toContainText(elo);
    }
    errors.forEach((e) => e.expectClean());
    await close();
  });

  test('connect four: vertical win', async ({ browser }) => {
    const { a, b, close } = await setup(browser);
    await create(a, 'connect4');
    await joinFirst(b, 'connect4');
    for (const [who, col] of [[a, 0], [b, 1], [a, 0], [b, 1], [a, 0], [b, 1], [a, 0]] as const) {
      await expect(who.getByTestId(`c4-col-${col}`)).toBeEnabled({ timeout: 60_000 });
      await who.getByTestId(`c4-col-${col}`).click();
    }
    await expect(a.getByTestId('game-status')).toHaveText(/You won \(four in row\)/, { timeout: 60_000 });
    await close();
  });

  test('poll: create, vote, results, anonymous', async ({ browser }) => {
    const { a, b, close } = await setup(browser);
    await tab(a, 'polls');
    await a.getByTestId('new-poll').click();
    await a.getByTestId('poll-q').fill('Lunch?');
    await a.getByTestId('poll-o0').fill('Pho');
    await a.getByTestId('poll-o1').fill('Tacos');
    await a.getByLabel(/Anonymous/).check();
    await a.getByTestId('poll-submit').click();
    await tab(b, 'polls');
    const card = b.getByTestId('poll-card').first();
    await expect(card).toContainText('Lunch?', { timeout: 60_000 });
    await card.getByTestId('poll-vote-1').click();
    await expect(a.getByTestId('poll-card').first().getByTestId('poll-count-1')).toHaveText('1', { timeout: 60_000 });
    await expect(a.getByTestId('poll-card').first()).toContainText('anonymous');
    await close();
  });

  test('kudos wall', async ({ browser }) => {
    const { a, b, close } = await setup(browser);
    await tab(a, 'kudos');
    const peer = a.getByTestId('kudos-to');
    await expect(async () => { expect(await peer.locator('option').count()).toBeGreaterThan(1); }).toPass({ timeout: 60_000 });
    await peer.selectOption({ index: 1 });
    await a.getByTestId('kudos-reason').fill('Great demo');
    await a.getByTestId('kudos-send').click();
    await tab(b, 'kudos');
    await expect(b.getByTestId('kudos-item').first()).toContainText('Great demo', { timeout: 60_000 });
    await close();
  });

  test('pictionary: strokes travel over ephemeral gossip', async ({ browser }) => {
    // Ephemeral gossip needs the gossipsub mesh to form first; the test waits on real peer status, not a sleep.
    const { a, b, close } = await setup(browser);
    await create(a, 'pictionary');
    await joinFirst(b, 'pictionary');
    await a.getByTestId('pict-start').click({ timeout: 60_000 });
    const drawer = (await a.getByTestId('pict-word').first().isVisible({ timeout: 20_000 }).catch(() => false)) ? a : b;
    const guesser = drawer === a ? b : a;
    await drawer.getByTestId('pict-word').first().click();
    const box = await drawer.getByTestId('pict-canvas').boundingBox();
    expect(box).not.toBeNull();
    await drawer.mouse.move(box!.x + 60, box!.y + 60);
    await drawer.mouse.down();
    for (let i = 0; i < 12; i += 1) await drawer.mouse.move(box!.x + 60 + i * 20, box!.y + 60 + i * 12, { steps: 2 });
    await drawer.mouse.up();
    await expect(guesser.getByTestId('pict-word-shown')).toContainText('_', { timeout: 30_000 });
    // the guesser's canvas received strokes: some pixel is no longer fully transparent
    await expect(async () => {
      const painted = await guesser.getByTestId('pict-canvas').evaluate((c: HTMLCanvasElement) => c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 === 3 && v > 0));
      expect(painted).toBe(true);
    }).toPass({ timeout: 30_000 });
    await close();
  });
});
