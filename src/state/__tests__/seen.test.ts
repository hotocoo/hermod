import { describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import { createChatSlice } from '../slices/chat';
import { keepSeen } from '../slices/core';
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
