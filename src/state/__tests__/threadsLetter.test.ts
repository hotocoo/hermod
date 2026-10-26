import { beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import { createMessagingSlice } from '../slices/messaging';
import { splitThreads } from '../slices/messaging/helpers';
import { createRavenSlice } from '../slices/ravens';
import type { AppStore } from '../types';

const eventAppend = vi.fn(async () => undefined);
vi.mock('../../lib/bridge', async (orig) => ({ ...(await orig<typeof import('../../lib/bridge')>()), getBridge: () => ({ eventAppend }) }));

const store = () => create<AppStore>()((set, get, api) => ({
  ...createMessagingSlice(set, get, api), ...createRavenSlice(set, get, api), space: 'sp', refresh: async () => undefined, showToast: vi.fn(),
}) as unknown as AppStore);

beforeEach(() => eventAppend.mockClear());

describe('thread list (M-042)', () => {
  it('splits threads into open and archived, keeping order', () => {
    const list = [{ id: 'a', archived: false }, { id: 'b', archived: true }, { id: 'c', archived: false }];
    expect(splitThreads(list)).toEqual({ open: [list[0], list[2]], archived: [list[1]] });
  });
  it('is empty for a channel without threads', () => {
    expect(splitThreads(undefined)).toEqual({ open: [], archived: [] });
  });
  it('archive and reopen send thread.state to the Space of the thread', async () => {
    const s = store().getState();
    await s.setThreadState('sp', 'm1', true);
    await s.setThreadState('sp', 'm1', false);
    expect(eventAppend).toHaveBeenNthCalledWith(1, 'sp', { t: 'thread.state', msg_id: 'm1', archived: true });
    expect(eventAppend).toHaveBeenNthCalledWith(2, 'sp', { t: 'thread.state', msg_id: 'm1', archived: false });
  });
});

describe('letter composer (R-005)', () => {
  it('sendLetter appends letter.send addressed to the other Space and channel', async () => {
    expect(await store().getState().sendLetter('other', 'gen', 'hello')).toBe(true);
    expect(eventAppend).toHaveBeenCalledWith('sp', { t: 'letter.send', to_space: 'other', channel_id: 'gen', text: 'hello' });
  });
});
