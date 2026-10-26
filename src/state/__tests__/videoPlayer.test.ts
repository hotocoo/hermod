import { beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import { MEDIA } from '../../config/app';
import type { Seed } from '../../lib/data/types';
import { createMediaSlice } from '../slices/media';
import type { AppStore } from '../types';

const eventAppend = vi.fn(async () => undefined);
vi.mock('../../lib/bridge', async (orig) => ({ ...(await orig<typeof import('../../lib/bridge')>()), getBridge: () => ({ eventAppend }) }));

const video = (id: string, spaceId = 'sp') => ({ id, spaceId, title: id });
const seed = () => ({
  spaces: [{ id: 'sp' }], people: {},
  collections: { media: { videos: [video('v1'), video('v2'), video('v3')], shorts: [video('v2'), video('v3')], captions: [], stories: [], live: { id: 'l1', spaceId: 'sp2', chat: [] } } },
}) as unknown as Seed;
const store = () => create<AppStore>()((set, get, api) => ({
  ...createMediaSlice(set, get, api), seed: seed(), me: { user_id: 'me' }, space: 'sp', refresh: vi.fn(async () => undefined), showToast: vi.fn(),
}) as unknown as AppStore);

beforeEach(() => { eventAppend.mockClear(); });

describe('V-006 playback speed cycle', () => {
  it('walks 1, 1.25, 1.5, 2, 0.5 and back to 1', () => {
    const s = store();
    const seen = [s.getState().speed];
    for (let i = 0; i < 5; i += 1) { s.getState().cycleSpeed(); seen.push(s.getState().speed); }
    expect(seen).toEqual([1, 1.25, 1.5, 2, 0.5, 1]);
  });
  it('only offers the five speeds of the spec', () => {
    expect(new Set(Object.values(MEDIA.speedCycle))).toEqual(new Set([0.5, 1, 1.25, 1.5, 2]));
  });
});

describe('V-007 theater mode', () => {
  it('toggles locally without touching the bridge', () => {
    const s = store();
    s.getState().toggleTheater();
    expect(s.getState().theater).toBe(true);
    s.getState().toggleTheater();
    expect(s.getState().theater).toBe(false);
    expect(eventAppend).not.toHaveBeenCalled();
  });
});

describe('V-008 autoplay the next video', () => {
  it('playVideo opens the video and asks for playback; a plain open stays paused', () => {
    const s = store();
    s.getState().openVideo('v1');
    expect(s.getState()).toMatchObject({ vid: 'v1', vidAuto: false });
    s.getState().playVideo('v2');
    expect(s.getState()).toMatchObject({ vid: 'v2', vidAuto: true });
    s.getState().openVideo('v3');
    expect(s.getState().vidAuto).toBe(false);
  });
});

describe('V-009 shorts move with the arrow keys', () => {
  it('stepShort goes to the next and previous short and stops at the ends, playing', () => {
    const s = store();
    s.getState().openShort(0);
    expect(s.getState().vid).toBe('v2');
    s.getState().stepShort(1);
    expect(s.getState()).toMatchObject({ vid: 'v3', vidAuto: true });
    s.getState().stepShort(1);
    expect(s.getState().vid).toBe('v3');
    s.getState().stepShort(-1);
    expect(s.getState().vid).toBe('v2');
    s.getState().stepShort(-1);
    expect(s.getState().vid).toBe('v2');
  });
  it('does nothing when the open video is not a short', () => {
    const s = store();
    s.getState().openVideo('v1');
    s.getState().stepShort(1);
    expect(s.getState().vid).toBe('v1');
  });
});

describe('V-010 like a video', () => {
  it('appends like.toggle for the open video in its own Space', async () => {
    const s = store();
    s.getState().openVideo('v1');
    await s.getState().likeVid();
    expect(eventAppend).toHaveBeenCalledWith('sp', { t: 'like.toggle', target_id: 'v1' });
  });
});

describe('V-012 live chat', () => {
  it('appends live.chat to the live Space and clears the draft', async () => {
    const s = store();
    s.getState().setLiveDraft('  hi all ');
    await s.getState().sendLive();
    expect(eventAppend).toHaveBeenCalledWith('sp2', { t: 'live.chat', live_id: 'l1', text: 'hi all' });
    expect(s.getState().liveDraft).toBe('');
  });
  it('sends nothing for a blank draft', async () => {
    const s = store();
    s.getState().setLiveDraft('   ');
    await s.getState().sendLive();
    expect(eventAppend).not.toHaveBeenCalled();
  });
});
