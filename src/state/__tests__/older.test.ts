import { describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import { createMessagingSlice } from '../slices/messaging';
import { prependOlder, pruneOlder } from '../slices/messaging/helpers';
import type { AppStore } from '../types';

const messagesPage = vi.fn();
vi.mock('../../lib/bridge', async (orig) => ({ ...(await orig<typeof import('../../lib/bridge')>()), getBridge: () => ({ messagesPage }) }));

const m = (id: string, lp?: number) => ({ id, ext: lp ? { lp } : undefined }) as never;

describe('older pages', () => {
  it('loadOlder fetches one page for concurrent calls and never doubles messages', async () => {
    let release: (v: unknown) => void = () => undefined;
    messagesPage.mockReturnValueOnce(new Promise((r) => { release = r; }));
    const store = create<AppStore>()((set, get, api) => ({ ...createMessagingSlice(set, get, api), msgs: { 'sp/a': [m('c', 30)] }, showToast: vi.fn() }) as unknown as AppStore);
    const first = store.getState().loadOlder('sp/a');
    const second = await store.getState().loadOlder('sp/a');
    expect(second).toBe(false);
    release({ messages: [m('a', 10), m('b', 20)], has_more: true });
    expect(await first).toBe(true);
    expect(messagesPage).toHaveBeenCalledTimes(1);
    expect(store.getState().older['sp/a'].map((x) => x.id)).toEqual(['a', 'b']);
  });
  it('prependOlder skips ids already held', () => {
    expect(prependOlder([m('b'), m('c')], [m('a'), m('b')]).map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });
  it('pruneOlder keeps only the open chat, minus what the snapshot now holds', () => {
    const out = pruneOlder({ 'sp/a': [m('a'), m('b')], 'sp/z': [m('z')] }, { 'sp/a': true, 'sp/z': false }, { 'sp/a': [m('b')] }, 'sp/a');
    expect(out.older['sp/a'].map((x) => x.id)).toEqual(['a']);
    expect(Object.keys(out.older)).toEqual(['sp/a']);
    expect(out.olderMore).toEqual({ 'sp/a': true });
    expect(pruneOlder({ 'sp/z': [m('z')] }, { 'sp/z': true }, {}, 'sp/a')).toEqual({ older: {}, olderMore: {} });
  });
});
