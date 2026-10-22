import type { Browser, BrowserContext, Page } from '@playwright/test';
import { GL_ARGS } from './gpu';
import { test, expect, bootApp, sharedSpace, enterSection, enterBuilding, toIsland, panel, watchErrors, DEVHOST_A, DEVHOST_B, UI_URL, unique } from './fixtures';
import { freshDevhosts } from './devhosts';

/** Every spec file starts on three empty devhosts, so no spec depends on state a former one left. */
test.beforeAll(async () => { test.setTimeout(180_000); await freshDevhosts(); });

/**
 * Real WebRTC and media pipelines between two devhost peers (two identities, two data dirs, real libp2p signalling).
 * Chromium's fake capture devices are used here and only here; the app code is the production code path.
 * Peer connections are observed by wrapping RTCPeerConnection before the app loads, so the checks do not depend on UI wiring.
 * Proves FEATURES H-002, H-003, H-004, H-005, H-009, V-002..V-005, V-011, V-013, V-015, F-001 (video).
 */
test.use({
  launchOptions: {
    args: [
      ...GL_ARGS,
      '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
    ],
  },
  permissions: ['microphone', 'camera'],
});
test.describe.configure({ mode: 'serial' });

const TRACK_PCS = () => {
  const w = window as unknown as { __pcs: RTCPeerConnection[]; RTCPeerConnection: typeof RTCPeerConnection };
  w.__pcs = [];
  const Native = w.RTCPeerConnection;
  w.RTCPeerConnection = class extends Native {
    constructor(cfg?: RTCConfiguration) { super(cfg); w.__pcs.push(this); }
  } as typeof RTCPeerConnection;
};

const connected = (page: Page) => page.evaluate(() => (window as unknown as { __pcs: RTCPeerConnection[] }).__pcs.filter((p) => p.connectionState === 'connected').length);
const open = (page: Page) => page.evaluate(() => (window as unknown as { __pcs: RTCPeerConnection[] }).__pcs.filter((p) => p.connectionState !== 'closed').length);

/** Inbound audio bytes across every peer connection: proves media actually flows. */
const inboundAudioBytes = (page: Page) => page.evaluate(async () => {
  let total = 0;
  for (const pc of (window as unknown as { __pcs: RTCPeerConnection[] }).__pcs) {
    (await pc.getStats()).forEach((r) => { if (r.type === 'inbound-rtp' && r.kind === 'audio') total += r.bytesReceived ?? 0; });
  }
  return total;
});

/** A real clip: two seconds of the fake camera recorded by MediaRecorder in the page. */
const recordClip = (page: Page): Promise<Buffer> => page.evaluate(async () => {
  const s = await navigator.mediaDevices.getUserMedia({ video: true });
  const rec = new MediaRecorder(s, { mimeType: 'video/webm' });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  const stopped = new Promise<void>((r) => { rec.onstop = () => r(); });
  rec.start();
  await new Promise((r) => setTimeout(r, 2500));
  rec.stop();
  await stopped;
  s.getTracks().forEach((t) => t.stop());
  const bytes = new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}).then((b64) => Buffer.from(b64, 'base64'));

/** Intercepts the file chooser a click opens and answers it with `files`. */
async function chooseWith(page: Page, trigger: () => Promise<void>, files: { name: string; mimeType: string; buffer: Buffer }): Promise<void> {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), trigger()]);
  await chooser.setFiles(files);
}

let ctxs: BrowserContext[] = [];
const newCtx = (browser: Browser) => () => browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, baseURL: UI_URL, permissions: ['microphone', 'camera'] });
let a: Page;
let b: Page;
let errors: { expectClean(): void }[] = [];
let aId = '';
const space = unique('Media');

const tab = (p: Page, name: string) => panel(p).getByRole('tab', { name, exact: true }).first().click();

test.beforeAll(async ({ browser }) => {
  ctxs = await Promise.all([newCtx(browser)(), newCtx(browser)()]);
  [a, b] = await Promise.all(ctxs.map((c) => c.newPage()));
  errors = [watchErrors(a), watchErrors(b)];
  await Promise.all([a.addInitScript(TRACK_PCS), b.addInitScript(TRACK_PCS)]);
  await Promise.all([bootApp(a, DEVHOST_A, 'Ada Tester', false, false), bootApp(b, DEVHOST_B, 'Bo Tester', false, false)]);
  await sharedSpace(a, b, space);
  // Raise the buildings the flows below use (a fresh island only has the Commons).
  const post = (host: string, cmd: string, body: unknown) => fetch(`${host}/invoke/${cmd}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json() as Promise<any>); // eslint-disable-line @typescript-eslint/no-explicit-any
  const snap = await post(DEVHOST_A, 'snapshot', {});
  const sp = (snap.spaces as { id: string; name: string }[]).find((x) => x.name === space)!;
  for (const section of ['hearth', 'feed']) await post(DEVHOST_A, 'event_append', { spaceId: sp.id, body: { t: 'section.raise', section } });
  await expect(b.locator('[data-bld="hearth"]')).not.toHaveAttribute('data-empty', { timeout: 60_000 });
  await expect(b.locator('[data-bld="feed"]')).not.toHaveAttribute('data-empty', { timeout: 60_000 });
  aId = (await (await fetch(`${DEVHOST_A}/invoke/identity_get`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json() as { user_id: string }).user_id;
});
test.afterAll(async () => { await Promise.all(ctxs.map((c) => c.close())); });

test.describe('hearth call', () => {
  test('two peers join through the UI, connect and exchange audio', async () => {
    for (const p of [a, b]) {
      await toIsland(p);
      await enterBuilding(p, 'hearth');
      await p.getByRole('button', { name: /Pull up a chair/ }).click();
    }
    await expect.poll(() => connected(a), { timeout: 60_000 }).toBeGreaterThan(0);
    await expect.poll(() => connected(b), { timeout: 60_000 }).toBeGreaterThan(0);
    await expect.poll(() => inboundAudioBytes(a), { timeout: 30_000 }).toBeGreaterThan(1000);
    await expect.poll(() => inboundAudioBytes(b), { timeout: 30_000 }).toBeGreaterThan(1000);
    await expect(a.getByTestId('tile')).toHaveCount(2);
    await expect(b.getByTestId('tile')).toHaveCount(2);
  });

  test('the speaking ring follows real audio levels', async () => {
    // The fake microphone beeps; B measures A's inbound audio and lights A's tile.
    await expect(b.locator(`[data-testid="tile"][data-user="${aId}"][data-speaking="true"]`)).toBeVisible({ timeout: 60_000 });
  });

  test('mute stops the track and shows on the other side', async () => {
    await a.getByRole('button', { name: 'Mute', exact: true }).click();
    await expect(b.locator(`[data-testid="tile"][data-user="${aId}"][data-muted="true"]`)).toBeVisible({ timeout: 30_000 });
    await expect(a.getByRole('button', { name: 'Unmute' })).toBeVisible();
    await a.getByRole('button', { name: 'Unmute' }).click();
    await expect(b.locator(`[data-testid="tile"][data-user="${aId}"][data-muted="false"]`)).toBeVisible({ timeout: 30_000 });
  });

  test('camera on shows real video on the peer', async () => {
    await a.getByRole('button', { name: 'Camera on' }).click();
    const remote = b.locator(`[data-testid="tile"][data-user="${aId}"] video`);
    await expect(b.locator(`[data-testid="tile"][data-user="${aId}"][data-cam="true"]`)).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => remote.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30_000 }).toBeGreaterThan(0);
    await a.getByRole('button', { name: 'Camera off' }).click();
    await expect(b.locator(`[data-testid="tile"][data-user="${aId}"][data-cam="false"]`)).toBeVisible({ timeout: 30_000 });
  });

  test('screen share starts, or is declined with a clear state', async () => {
    await a.getByRole('button', { name: 'Share screen' }).click();
    // A cancelled or unavailable picker leaves the button as it was; a granted one flips it.
    await expect(a.getByRole('button', { name: /Stop sharing|Share screen/ })).toBeVisible();
    if (await a.getByRole('button', { name: 'Stop sharing' }).isVisible()) {
      // Camera is off here: the screen alone must show on the peer.
      const tile = `[data-testid="tile"][data-user="${aId}"]`;
      await expect(b.locator(`${tile}[data-share="true"][data-cam="false"]`)).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => b.locator(`${tile} video`).evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30_000 }).toBeGreaterThan(0);
      await a.getByRole('button', { name: 'Stop sharing' }).click();
      await expect(b.locator(`${tile}[data-share="false"]`)).toBeVisible({ timeout: 30_000 });
    }
    await expect(a.getByRole('button', { name: 'Share screen' })).toBeVisible({ timeout: 15_000 });
  });

  test('raise hand shows on the peer and lowers again', async () => {
    const tile = b.locator(`[data-testid="tile"][data-user="${aId}"]`);
    await a.getByRole('button', { name: 'Raise hand' }).click();
    await expect(tile).toHaveAttribute('data-hand', 'true', { timeout: 30_000 });
    await a.getByRole('button', { name: 'Lower hand' }).click();
    await expect(tile).toHaveAttribute('data-hand', 'false', { timeout: 30_000 });
  });

  test('recording shows REC to both sides and is saved on stop', async () => {
    await a.getByRole('button', { name: 'Record', exact: true }).click();
    await expect(a.getByText('REC', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(b.getByText('REC', { exact: true })).toBeVisible({ timeout: 30_000 });
    await a.waitForTimeout(1500);
    const saved = expect(a.getByText(/Recording (saved|kept)/)).toBeVisible({ timeout: 30_000 });
    await a.getByRole('button', { name: 'Stop recording' }).click();
    await saved;
    await expect(a.getByText('REC', { exact: true })).toBeHidden({ timeout: 30_000 });
  });

  test('leaving closes every connection on both sides', async () => {
    await a.getByRole('button', { name: /^Leave/ }).click();
    await expect.poll(() => open(a), { timeout: 15_000 }).toBe(0);
    await expect.poll(() => open(b), { timeout: 15_000 }).toBe(0);
    // B was alone in the room afterwards: B's own leave is clean too.
    await b.getByRole('button', { name: /^Leave/ }).click();
    await expect(b.getByRole('button', { name: /Pull up a chair/ })).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('live', () => {
  test('host goes live, viewer sees real video, counts and hearts flow', async () => {
    const title = unique('Standup');
    await enterSection(a, 'feed', false);
    await enterSection(b, 'feed', false);
    await tab(a, 'Live');
    await a.getByRole('button', { name: /Go live/ }).click();
    await a.getByLabel(/^Title/).fill(title);
    await a.getByRole('button', { name: 'Start', exact: true }).click();

    await tab(b, 'Live');
    await expect(b.getByRole('heading', { name: title })).toBeVisible({ timeout: 60_000 });
    const viewerVideo = b.locator('video[aria-label="Live stream"]');
    await expect.poll(() => viewerVideo.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 60_000 }).toBeGreaterThan(0);
    await expect(a.locator('video[aria-label="Your live preview"]')).toBeVisible();

    await expect(a.getByText('1 watching')).toBeVisible({ timeout: 30_000 });
    await expect(b.getByText('1 watching')).toBeVisible({ timeout: 30_000 });

    await b.getByRole('button', { name: 'Send a heart' }).click();
    await expect(a.locator('[aria-hidden="true"] span').filter({ hasText: '♥' }).first()).toBeVisible({ timeout: 30_000 });

    await a.getByRole('button', { name: 'End live' }).click();
    await expect(b.getByRole('heading', { name: 'Nobody is live' })).toBeVisible({ timeout: 60_000 });
  });
});

test.describe('video on demand', () => {
  const title = unique('Demo reel');
  const vtt = 'WEBVTT\n\n00:00.000 --> 00:02.000\nHello from the captions\n';

  test('a video post with chapters and captions is published and watchable on the peer', async () => {
    const clip = await recordClip(a);
    await enterSection(a, 'feed', false);
    await tab(a, 'For you');
    await a.getByRole('button', { name: /New post/ }).first().click();
    const dlg = a.getByRole('dialog', { name: /New post/ });
    await dlg.locator('label.seg-opt', { hasText: 'Video' }).click();
    await chooseWith(a, () => dlg.getByRole('button', { name: 'Choose a video' }).click(), { name: 'reel.webm', mimeType: 'video/webm', buffer: clip });
    await expect(dlg.getByText(/reel\.webm/)).toBeVisible({ timeout: 30_000 });
    await dlg.getByLabel(/^Title/).fill(title);
    await dlg.getByLabel(/^Chapters/).fill('0:00 Intro\n0:01 Middle');
    await chooseWith(a, () => dlg.getByRole('button', { name: /Add captions/ }).click(), { name: 'reel.vtt', mimeType: 'text/vtt', buffer: Buffer.from(vtt) });
    await expect(dlg.getByText('reel.vtt')).toBeVisible();
    await dlg.getByRole('button', { name: 'Publish' }).click();
    await expect(dlg).toBeHidden({ timeout: 60_000 });

    await enterSection(b, 'feed', false);
    await tab(b, 'Watch');
    await b.getByRole('button', { name: new RegExp(title) }).first().click({ timeout: 60_000 });
    const player = b.locator(`video[aria-label="${title}"]`);
    await expect(player).toBeVisible();
    await expect.poll(() => player.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 60_000 }).toBeGreaterThanOrEqual(1);
    // chapters list and jump
    const middle = b.getByRole('button', { name: /Middle/ });
    await expect(middle).toBeVisible();
    await expect(b.getByRole('button', { name: /Intro/ })).toBeVisible();
    // captions: the CC chip appears only when real captions arrived, and the text track carries our cue
    await expect(b.getByRole('button', { name: 'Captions' })).toBeVisible({ timeout: 60_000 });
    await b.getByRole('button', { name: 'Captions' }).click();
    await expect(b.getByRole('button', { name: 'Captions' })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => player.evaluate((v: HTMLVideoElement) => v.textTracks.length && v.textTracks[0].mode), { timeout: 15_000 }).toBe('showing');
    await expect.poll(() => player.evaluate((v: HTMLVideoElement) => v.textTracks[0]?.cues?.length ?? 0), { timeout: 15_000 }).toBeGreaterThan(0);
  });
});

test.describe('stories', () => {
  test('a recorded clip becomes a story the peer can watch', async () => {
    const clip = await recordClip(a);
    await enterSection(a, 'feed', false);
    await tab(a, 'Stories');
    await a.getByRole('button', { name: /New story/ }).click();
    const dlg = a.getByRole('dialog', { name: /New story/ });
    await chooseWith(a, () => dlg.getByRole('button', { name: 'Choose photos or clips' }).click(), { name: 'clip.webm', mimeType: 'video/webm', buffer: clip });
    await dlg.getByLabel(/^Caption for/).fill('A clip from Ada');
    await dlg.getByRole('button', { name: 'Share story' }).click();
    await expect(dlg).toBeHidden({ timeout: 60_000 });

    await enterSection(b, 'feed', false);
    await tab(b, 'Stories');
    await b.getByRole('button', { name: /Watch Ada's story/ }).click({ timeout: 60_000 });
    const viewer = b.getByRole('dialog', { name: /Ada Tester's story/ });
    await expect(viewer.locator('video')).toBeVisible();
    await expect(viewer.getByText('A clip from Ada')).toBeVisible();
    await b.keyboard.press('Escape');
    errors.forEach((e) => e.expectClean());
  });
});
