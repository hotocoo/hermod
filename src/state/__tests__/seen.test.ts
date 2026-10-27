import { describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import { createChatSlice } from '../slices/chat';
import { keepSeen } from '../slices/core';
import { createMediaSlice } from '../slices/media';
import { feedNew } from '../selectors';
import type { AppStore } from '../types';

const readMark = vi.fn();
vi.mock('../../lib/bridge', async (orig) => ({ ...(await orig<typeof import('../../lib/bridge')>()), getBridge: () => ({ readMark }) }));

const seedWith = (unread: number) => ({ collections: { channels: { sp: [{ id: 'a', unread }] } }, spaces: [{ id: 'sp' }] }) as never;

describe('seen marks', () => {
  it('keepSeen holds a mark while the snapshot still shows unread, drops it at zero or for a gone chat', () => {
    expect(keepSeen({ 'sp/a': true }, seedWith(3))).toEqual({ 'sp/a': true });
    expect(keepSeen({ 'sp/a': true }, seedWith(0))).toEqual({});
    expect(keepSeen({ 'sp/gone': true }, seedWith(3))).toEqual({});
  });
  it('markSeen rolls the mark back when readMark fails', async () => {
    readMark.mockRejectedValueOnce(new Error('nope'));
    const showToast = vi.fn();
    const store = create<AppStore>()((set, get, api) => ({ ...createChatSlice(set, get, api), showToast, refresh: vi.fn() }) as unknown as AppStore);
    store.getState().markSeen('sp/a', 1);
    expect(store.getState().seen).toEqual({ 'sp/a': true });
    await vi.waitFor(() => expect(showToast).toHaveBeenCalledWith('nope', undefined, 'error'));
    expect(store.getState().seen).toEqual({});
  });
});

describe('feed badge (F-006)', () => {
  const post = (id: string, by: string) => ({ id, by });
  const feedSeed = (posts: ReturnType<typeof post>[]) => ({ collections: { feed: { sp: posts } }, spaces: [{ id: 'sp' }] }) as never;
  const mk = (seed: never) => create<AppStore>()((set, get, api) => ({ ...createMediaSlice(set, get, api), seed, me: { user_id: 'me' } }) as unknown as AppStore);

  it('counts other people\'s unseen posts, not my own, and clears once the Feed is opened', () => {
    const seed = feedSeed([post('p1', 'bo'), post('p2', 'me'), post('p3', 'bo')]);
    const store = mk(seed);
    expect(feedNew(store.getState(), seed, 'sp')).toBe(2);
    store.getState().markFeedSeen('sp');
    expect(feedNew(store.getState(), seed, 'sp')).toBe(0);
  });

  it('a post that arrives after the Feed was opened badges again', () => {
    const store = mk(feedSeed([post('p1', 'bo')]));
    store.getState().markFeedSeen('sp');
    const later = feedSeed([post('p1', 'bo'), post('p4', 'bo')]);
    expect(feedNew(store.getState(), later, 'sp')).toBe(1);
  });
});
