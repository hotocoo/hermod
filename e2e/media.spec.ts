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
 * Proves FEATURES H-002, H-003, H-004, H-005, H-009, H-011, H-013, V-002..V-005, V-011, V-013, V-015, F-001 (video).
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

  test('a shared screen shows on both sides with the camera off and leads the grid', async () => {
    // --use-fake-ui-for-media-stream answers the screen picker with Chromium's fake monitor, so sharing always starts here.
    await a.getByRole('button', { name: 'Share screen' }).click();
    await expect(a.getByRole('button', { name: 'Stop sharing' })).toBeVisible({ timeout: 15_000 });
    // Camera is off here: the screen alone must show on the peer, and on the sharer's own tile.
    const tile = `[data-testid="tile"][data-user="${aId}"]`;
    await expect(b.locator(`${tile}[data-share="true"][data-cam="false"]`)).toBeVisible({ timeout: 30_000 });
    await expect(a.locator(`${tile}[data-share="true"]`)).toBeVisible();
    await expect.poll(() => b.locator(`${tile} video`).evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30_000 }).toBeGreaterThan(0);
    // The shared screen is the spotlight: first tile on both sides.
    for (const p of [a, b]) await expect(p.getByTestId('tile').first()).toHaveAttribute('data-user', aId);
    await a.getByRole('button', { name: 'Stop sharing' }).click();
    await expect(b.locator(`${tile}[data-share="false"]`)).toBeVisible({ timeout: 30_000 });
    await expect(a.getByRole('button', { name: 'Share screen' })).toBeVisible({ timeout: 15_000 });
  });

  test('raise hand shows on the peer and lowers again', async () => {
    const tile = b.locator(`[data-testid="tile"][data-user="${aId}"]`);
    await a.getByRole('button', { name: 'Raise hand' }).click();
    await expect(tile).toHaveAttribute('data-hand', 'true', { timeout: 30_000 });
    await a.getByRole('button', { name: 'Lower hand' }).click();
    await expect(tile).toHaveAttribute('data-hand', 'false', { timeout: 30_000 });
  });

  test('a quick reaction shows on the peer tile and fades on its own', async () => {
    const tile = b.locator(`[data-testid="tile"][data-user="${aId}"]`);
    await a.getByRole('button', { name: 'React 👍' }).click();
    await expect(tile).toHaveAttribute('data-react', '👍', { timeout: 30_000 });
    // Ephemeral: nothing clears it but the fade timer (MEDIA.call.signal.reactionMs).
    await expect(tile).not.toHaveAttribute('data-react', /./, { timeout: 30_000 });
  });

  test('a poor link shows the "Poor connection" banner on that peer tile', async () => {
    // B's real stats are rewritten to a slow round trip, so the production stats poll classifies A's link as poor.
    await b.evaluate(() => {
      for (const pc of (window as unknown as { __pcs: RTCPeerConnection[] }).__pcs) {
        const real = RTCPeerConnection.prototype.getStats.bind(pc);
        (pc as unknown as { getStats: () => Promise<unknown[]> }).getStats = async () => {
          const rows: Record<string, unknown>[] = [];
          (await real()).forEach((r: Record<string, unknown>) => rows.push(r.type === 'candidate-pair' ? { ...r, currentRoundTripTime: 5 } : r));
          return rows;
        };
      }
    });
    const tile = b.locator(`[data-testid="tile"][data-user="${aId}"]`);
    await expect(tile).toHaveAttribute('data-quality', 'poor', { timeout: 30_000 });
    await expect(tile.getByRole('status')).toHaveText('Poor connection');
    await b.evaluate(() => { for (const pc of (window as unknown as { __pcs: RTCPeerConnection[] }).__pcs) delete (pc as unknown as { getStats?: unknown }).getStats; });
    await expect(tile).not.toHaveAttribute('data-quality', 'poor', { timeout: 30_000 });
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

  test('an ICE failure that outlasts every restart tells the person why there is no connection', async () => {
    // Loopback never fails ICE, so B's link to A is made to report `failed` until PeerLink gives up (MEDIA.call.iceRestartMax restarts).
    // Comfortably more state changes than the restarts PeerLink tries before it reports `failed`.
    const failures = 8;
    await b.evaluate((n) => {
      for (const pc of (window as unknown as { __pcs: RTCPeerConnection[] }).__pcs) {
        if (pc.connectionState !== 'connected') continue;
        Object.defineProperty(pc, 'connectionState', { get: () => 'failed', configurable: true });
        for (let i = 0; i < n; i++) pc.onconnectionstatechange?.(new Event('connectionstatechange'));
      }
    }, failures);
    await expect(b.getByText(/Could not connect directly to this person/)).toBeVisible({ timeout: 15_000 });
    // Still in the call: the failure is reported, not turned into a silent hang-up.
    await expect(b.getByRole('button', { name: /^Leave/ })).toBeVisible();
    // The real state shows again, so the leave check below reads what the browser reports.
    await b.evaluate(() => { for (const pc of (window as unknown as { __pcs: RTCPeerConnection[] }).__pcs) delete (pc as unknown as { connectionState?: unknown }).connectionState; });
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
    const noteTitle = unique('Live host note');
    await enterSection(a, 'feed', false);
    await enterSection(b, 'feed', false);
    // V-014 needs a post by the host to find under Following afterwards.
    await a.getByRole('button', { name: 'New post' }).click();
    await a.getByRole('radiogroup', { name: 'Kind of post' }).getByText('Note', { exact: true }).click();
    await a.getByLabel('Title (required)').fill(noteTitle);
    await a.getByLabel('Note (required)').fill('posted before going live');
    await a.getByRole('button', { name: 'Publish' }).click();
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

    // V-012: a line from each side shows in the live chat of both viewers, and the box clears after sending.
    const chat = (p: Page) => p.getByRole('complementary', { name: 'Live chat' });
    const fromViewer = unique('hello from the viewer');
    const fromHost = unique('hello from the host');
    await b.getByLabel('Live chat message').fill(fromViewer);
    await b.getByLabel('Live chat message').press('Enter');
    await expect(b.getByLabel('Live chat message')).toHaveValue('');
    for (const p of [a, b]) await expect(chat(p).getByText(fromViewer)).toBeVisible({ timeout: 30_000 });
    await a.getByLabel('Live chat message').fill(fromHost);
    await a.getByLabel('Live chat message').press('Enter');
    for (const p of [a, b]) await expect(chat(p).getByText(fromHost)).toBeVisible({ timeout: 30_000 });

    // V-014: the viewer follows the host from the live byline, and the host's posts land under Following.
    await expect(b.getByRole('button', { name: 'Follow', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await b.getByRole('button', { name: 'Follow', exact: true }).click();
    await expect(b.getByRole('button', { name: 'Following', exact: true })).toHaveAttribute('aria-pressed', 'true');

    await a.getByRole('button', { name: 'End live' }).click();
    await expect(b.getByRole('heading', { name: 'Nobody is live' })).toBeVisible({ timeout: 60_000 });
    await tab(b, 'For you'); // the Following filter lives in the feed, not on the Live page
    await tab(b, 'Following');
    await expect(b.getByRole('article', { name: noteTitle })).toBeVisible({ timeout: 30_000 });
  });
});

test.describe('video on demand', () => {
  const title = unique('Demo reel');
  const vtt = 'WEBVTT\n\n00:00.000 --> 00:02.000\nHello from the captions\n';
  /** Start of the "Middle" chapter typed below, in seconds. */
  const middleAt = 1;

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
    await dlg.getByLabel(/^Chapters/).fill(`0:00 Intro\n0:0${middleAt} Middle`);
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
    // chapter jump: the click seeks synchronously, so one immediate read proves the seek (playback alone could not reach it yet)
    await middle.click();
    expect(await player.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThanOrEqual(middleAt);
    await expect(middle).toHaveAttribute('aria-current', 'true', { timeout: 15_000 });
    await expect(b.getByRole('button', { name: /Intro/ })).not.toHaveAttribute('aria-current');
  });
});

/** Publishes a short clip as a video post from `page` (the open feed building, For you tab). */
async function publishClip(page: Page, title: string): Promise<void> {
  const clip = await recordClip(page);
  await enterSection(page, 'feed', false);
  await tab(page, 'For you');
  await page.getByRole('button', { name: /New post/ }).first().click();
  const dlg = page.getByRole('dialog', { name: /New post/ });
  await dlg.locator('label.seg-opt', { hasText: 'Video' }).click();
  await chooseWith(page, () => dlg.getByRole('button', { name: 'Choose a video' }).click(), { name: 'clip.webm', mimeType: 'video/webm', buffer: clip });
  await expect(dlg.getByText(/clip\.webm/)).toBeVisible({ timeout: 30_000 });
  await dlg.getByLabel(/^Title/).fill(title);
  await dlg.getByRole('button', { name: 'Publish' }).click();
  await expect(dlg).toBeHidden({ timeout: 60_000 });
}

test.describe('video player (V-001, V-006..V-010)', () => {
  const first = unique('Newer reel');
  const second = unique('Older reel');
  /** Titles carry a unique suffix; 'Demo reel' is the video the earlier test published. */
  const player = (p: Page, title: string) => p.locator(`video[aria-label^="${title}"]`);
  const library = async (p: Page) => {
    await enterSection(p, 'feed', false);
    await tab(p, 'Watch');
    if (await p.getByRole('button', { name: 'All videos' }).isVisible()) await p.getByRole('button', { name: 'All videos' }).click();
  };
  const open = async (p: Page, title: string) => {
    await library(p);
    await p.getByRole('button', { name: new RegExp(title) }).first().click({ timeout: 60_000 });
    await expect(player(p, title)).toBeVisible();
  };

  test('V-001: the gallery tab strip lists every tab and the chosen tab is kept when the building is left and re-entered', async () => {
    await enterSection(b, 'feed', false);
    // The first tablist is the section switcher in the header; the second is the building's tab strip.
    const strip = panel(b).getByRole('tablist').nth(1);
    for (const name of ['For you', 'Watch', 'Live', 'Stories', 'Boards']) await expect(strip.getByRole('tab', { name, exact: true })).toBeVisible();
    await tab(b, 'Stories');
    await expect(strip.getByRole('tab', { name: 'Stories', exact: true })).toHaveAttribute('aria-selected', 'true');
    await toIsland(b);
    await enterSection(b, 'feed', false);
    await expect(strip.getByRole('tab', { name: 'Stories', exact: true })).toHaveAttribute('aria-selected', 'true');
    await tab(b, 'Live');
    await toIsland(b);
    await enterSection(b, 'feed', false);
    await expect(strip.getByRole('tab', { name: 'Live', exact: true })).toHaveAttribute('aria-selected', 'true');
    // The Docs and Calendar tabs of the strip live in the Board building.
    await enterSection(b, 'board');
    for (const name of ['Docs', 'Calendar']) await expect(panel(b).getByRole('tablist').nth(1).getByRole('tab', { name, exact: true })).toBeVisible();
  });

  test('V-006: the speed chip cycles 1, 1.25, 1.5, 2, 0.5 and the video really plays at that rate', async () => {
    await open(b, 'Demo reel');
    const rate = () => player(b, 'Demo reel').evaluate((v: HTMLVideoElement) => v.playbackRate);
    for (const [label, value] of [['1.25', 1.25], ['1.5', 1.5], ['2', 2], ['0.5', 0.5], ['1', 1]] as const) {
      await b.getByRole('button', { name: /^Playback speed/ }).click();
      await expect(b.getByRole('button', { name: `Playback speed ${label}×` })).toBeVisible();
      expect(await rate()).toBe(value);
    }
  });

  test('V-007: theater mode widens the player and toggles back, locally', async () => {
    const box = () => player(b, 'Demo reel').evaluate((v) => v.getBoundingClientRect().width);
    const before = await box();
    await b.getByRole('button', { name: 'Theater' }).click();
    await expect.poll(box).toBeGreaterThan(before);
    await b.getByRole('button', { name: 'Theater' }).click();
    await expect.poll(box).toBe(before);
    // Local: A's own player is not affected by B's toggle.
    await b.getByRole('button', { name: 'Theater' }).click();
    await open(a, 'Demo reel');
    const aBefore = await player(a, 'Demo reel').evaluate((v) => v.getBoundingClientRect().width);
    expect(aBefore).toBeLessThan(await box());
    await b.getByRole('button', { name: 'Theater' }).click();
  });

  test('V-010: a like on the video shows for both viewers and toggles off', async () => {
    const like = (p: Page) => p.getByRole('button', { name: 'Like' });
    await expect(like(b)).toHaveAttribute('aria-pressed', 'false');
    await like(b).click();
    await expect(like(b)).toHaveAttribute('aria-pressed', 'true');
    await expect(like(b)).toContainText('1');
    await expect(like(a)).toContainText('1', { timeout: 60_000 });
    await expect(like(a)).toHaveAttribute('aria-pressed', 'false');
    await like(b).click();
    await expect(like(a)).toContainText('0', { timeout: 60_000 });
  });

  test('V-009: Down and Up move between shorts', async () => {
    await publishClip(a, first);
    await library(b);
    // Newest short first: the row is ordered like the library.
    await expect(b.getByRole('button', { name: new RegExp(first) })).toBeVisible({ timeout: 60_000 });
    await b.getByRole('button', { name: new RegExp(first) }).first().click();
    await expect(player(b, first)).toBeVisible();
    await b.keyboard.press('ArrowDown');
    await expect(player(b, 'Demo reel')).toBeVisible();
    await b.keyboard.press('ArrowUp');
    await expect(player(b, first)).toBeVisible();
    // The first short has none before it: Up stays put.
    await b.keyboard.press('ArrowUp');
    await expect(player(b, first)).toBeVisible();
    // Moving to another short starts it playing (the Pause control shows).
    await b.keyboard.press('ArrowDown');
    await expect(player(b, 'Demo reel')).toBeVisible();
    await expect(b.getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 30_000 });
  });

  test('V-008: Up next lists the other videos and the next one plays when this one ends', async () => {
    await publishClip(a, second);
    await open(b, first);
    // `first` is newer than Demo reel and `second` is newest of all, so the order is second, first, Demo reel.
    await expect(b.getByText('Up next')).toBeVisible();
    await expect(b.getByRole('button', { name: new RegExp('Demo reel') }).first()).toBeVisible();
    await b.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(player(b, 'Demo reel')).toBeVisible({ timeout: 60_000 });
    await expect(b.getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 30_000 });
  });
});

test.describe('calendar join (V-031)', () => {
  test('"Join in the Hearth" on an event enters the Hearth and starts the meeting with its title and agenda', async () => {
    const title = unique('Kiln sync');
    const [item1, item2] = [unique('check vents'), unique('order clay')];
    await enterSection(a, 'board');
    await tab(a, 'Calendar');
    await a.getByRole('button', { name: /New meeting/ }).first().click();
    await a.getByLabel('Title (required)').fill(title);
    await a.getByLabel('Note').fill(`${item1}\n${item2}`);
    await a.getByRole('button', { name: 'Add to calendar' }).click();
    await expect(a.getByRole('heading', { name: title })).toBeVisible();
    await a.getByRole('button', { name: /Join in the Hearth/ }).click();
    // The Hearth opens with the call up and the event's own title and note lines as agenda items.
    await expect(a.getByText(title).first()).toBeVisible({ timeout: 60_000 });
    await expect(a.getByRole('button', { name: new RegExp(item1) })).toBeVisible({ timeout: 30_000 });
    await expect(a.getByRole('button', { name: new RegExp(item2) })).toBeVisible();
    // B sees the same meeting from the room, over the real P2P sync.
    await enterSection(b, 'hearth', false);
    await expect(b.getByText(title).first()).toBeVisible({ timeout: 60_000 });
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
