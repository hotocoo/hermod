import { afterEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import { TIMING } from '../../config/app';
import { createCoreSlice } from '../slices/core';
import { createMessagingSlice } from '../slices/messaging';
import { threadToLoad } from '../selectors';
import { createOverlaySlice } from '../slices/overlay';
import type { AppStore } from '../types';

const messagesPage = vi.fn();
const searchQuery = vi.fn();
const load = vi.fn();
vi.mock('../../lib/bridge', async (orig) => ({ ...(await orig<typeof import('../../lib/bridge')>()), getBridge: () => ({ messagesPage, searchQuery }) }));
vi.mock('../../lib/data/repository', () => ({ repository: { load: (...a: unknown[]) => load(...a) } }));

const m = (id: string, lp: number, text = id) => ({ id, text, ext: { lp } }) as never;

describe('older pages follow edits', () => {
  afterEach(() => messagesPage.mockReset());
  const mk = (older: unknown[]) => create<AppStore>()((set, get, api) => ({ ...createMessagingSlice(set, get, api), msgs: { 'sp/a': [m('c', 30)] }, older: { 'sp/a': older }, showToast: vi.fn() }) as unknown as AppStore);

  it('refreshOlder re-requests the held range just above the window and swaps in current views', async () => {
    messagesPage.mockResolvedValueOnce({ messages: [m('a', 10, 'a edited'), m('b', 20)], has_more: false, first_lp: 10, last_lp: 20 });
    const store = mk([m('a', 10), m('b', 20)]);
    await store.getState().refreshOlder('sp/a');
    expect(messagesPage).toHaveBeenCalledWith('sp', 'a', 30, 2);
    expect(store.getState().older['sp/a'].map((x) => (x as { text: string }).text)).toEqual(['a edited', 'b']);
  });
  it('keeps what is shown when the re-request fails', async () => {
    messagesPage.mockRejectedValueOnce(new Error('down'));
    const store = mk([m('a', 10)]);
    await store.getState().refreshOlder('sp/a');
    expect(store.getState().older['sp/a']).toHaveLength(1);
  });
});

describe('thread root above the window', () => {
  afterEach(() => messagesPage.mockReset());
  it('ensureLoaded pages older history in until the root is loaded', async () => {
    const full = Array.from({ length: 150 }, (_, i) => m(`n${i}`, 1000 + i));
    messagesPage
      .mockResolvedValueOnce({ messages: [m('x', 900)], has_more: true, first_lp: 900, last_lp: 900 })
      .mockResolvedValueOnce({ messages: [m('root', 800)], has_more: false, first_lp: 800, last_lp: 800 });
    const store = create<AppStore>()((set, get, api) => ({ ...createMessagingSlice(set, get, api), msgs: { 'sp/a': full }, older: {}, olderMore: {}, showToast: vi.fn() }) as unknown as AppStore);
    expect(await store.getState().ensureLoaded('sp/a', 'root')).toBe(true);
    expect(store.getState().older['sp/a'].map((x) => (x as { id: string }).id)).toEqual(['root', 'x']);
  });
  it('waits for a scroll-triggered loadOlder already in flight, then still finds the root', async () => {
    const full = Array.from({ length: 150 }, (_, i) => m(`n${i}`, 1000 + i));
    let land: (v: unknown) => void = () => undefined;
    messagesPage.mockReturnValueOnce(new Promise((r) => { land = r; }));
    const store = create<AppStore>()((set, get, api) => ({ ...createMessagingSlice(set, get, api), msgs: { 'sp/a': full }, older: {}, olderMore: {}, showToast: vi.fn() }) as unknown as AppStore);
    const scroll = store.getState().loadOlder('sp/a');
    const ensured = store.getState().ensureLoaded('sp/a', 'root');
    land({ messages: [m('root', 900)], has_more: true, first_lp: 900, last_lp: 900 });
    await scroll;
    expect(await ensured).toBe(true);
    expect(messagesPage).toHaveBeenCalledTimes(1);
  });
  it('gives up when history ends without the root', async () => {
    messagesPage.mockResolvedValueOnce({ messages: [], has_more: false, first_lp: 0, last_lp: 0 });
    const store = create<AppStore>()((set, get, api) => ({ ...createMessagingSlice(set, get, api), msgs: { 'sp/a': [m('c', 30)] }, older: {}, olderMore: { 'sp/a': true }, showToast: vi.fn() }) as unknown as AppStore);
    expect(await store.getState().ensureLoaded('sp/a', 'gone')).toBe(false);
  });
});

describe('errors are reported, not swallowed', () => {
  afterEach(() => { vi.useRealTimers(); searchQuery.mockReset(); load.mockReset(); });
  it('a failing search toasts errorMessage once and keeps the previous hits', async () => {
    searchQuery.mockRejectedValueOnce(new Error('index offline'));
    const showToast = vi.fn();
    const store = create<AppStore>()((set, get, api) => ({ ...createOverlaySlice(set, get, api), q: 'kiln', searchSpace: '', searchKinds: [], modal: null, hits: [{ id: 'old' }], showToast }) as unknown as AppStore);
    store.getState().setSearchSpace('');
    await vi.waitFor(() => expect(showToast).toHaveBeenCalledTimes(1));
    expect(showToast).toHaveBeenCalledWith('index offline', undefined, 'error');
    expect(store.getState().hits).toEqual([{ id: 'old' }]);
  });
  it('refreshSoon toasts errorMessage of a failed re-read', async () => {
    vi.useFakeTimers();
    load.mockRejectedValueOnce(new Error('core busy'));
    const showToast = vi.fn();
    const store = create<AppStore>()((set, get, api) => ({ ...createCoreSlice(set, get, api), showToast }) as unknown as AppStore);
    store.getState().refreshSoon();
    await vi.advanceTimersByTimeAsync(TIMING.snapshotDebounceMs + 1);
    expect(showToast).toHaveBeenCalledWith('core busy', undefined, 'error');
  });
});

describe('thread root effect decision', () => {
  it('asks to load only an open thread whose root is missing', () => {
    expect(threadToLoad('t1', false)).toBe('t1');
    expect(threadToLoad('t1', true)).toBeNull();
    expect(threadToLoad(null, false)).toBeNull();
  });
});
