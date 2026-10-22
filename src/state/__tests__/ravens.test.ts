import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import { RAVEN } from '../../config/scene';
import { diffArrivals } from '../arrivals';
import { sceneSignals } from '../signals';
import { createChatSlice } from '../slices/chat';
import { createRavenSlice } from '../slices/ravens';
import { setTown, type TownPort } from '../townPort';
import type { AppStore } from '../types';
import type { Seed } from '../../lib/data/types';

vi.mock('../../lib/bridge', async (orig) => ({ ...(await orig<typeof import('../../lib/bridge')>()), getBridge: () => ({ eventAppend: async () => undefined }) }));

const ME = 'me'; const BO = 'bo';
const seedWith = (messages: Record<string, { id: string; by: string; text: string }[]>, channels: Record<string, { id: string; unread?: number }[]> = {}): Seed => ({
  spaces: [{ id: 'home' }, { id: 'sp' }], people: { [ME]: { name: 'Ada Tester', i: 'AT', role: '' }, [BO]: { name: 'Bo Tester', i: 'BT', role: '' } },
  collections: { messages, channels, rooms: {}, feed: {}, letters: {} },
} as unknown as Seed);

const town = () => ({ sendRaven: vi.fn(), flyIn: vi.fn((_: string, cb?: () => void) => { cb?.(); return true; }), flyOut: vi.fn(() => true) });

describe('ravens fly for real arrivals (R-001)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { setTown(null); vi.useRealTimers(); });
  const storeWith = (seed: Seed, extra: Partial<AppStore> = {}) => create<AppStore>()((set, get, api) => ({
    ...createRavenSlice(set, get, api), seed, space: 'home', ch: {}, inside: false, section: 'chat', incoming: {}, ravens: true, photo: false, onb: 0, archi: false, ...extra,
  }) as unknown as AppStore);

  it('a message.post from someone in another Space flies a raven to the signpost, then opens the letter', () => {
    const prev = seedWith({}); const next = seedWith({ 'sp/gen': [{ id: 'm1', by: BO, text: 'hello from afar' }] });
    const arrivals = diffArrivals(prev, next, ME, {});
    expect(arrivals).toHaveLength(1);
    const t = town(); setTown(t as unknown as TownPort);
    const store = storeWith(next); store.getState().receive(arrivals);
    expect(t.flyIn).toHaveBeenCalledWith('search', expect.any(Function));
    expect(t.sendRaven).not.toHaveBeenCalled();
    expect(store.getState().letter).toMatchObject({ from: 'Bo Tester', text: 'hello from afar', sp: 'sp' });
  });

  it('holds the letter until the raven lands', () => {
    const next = seedWith({ 'sp/gen': [{ id: 'm1', by: BO, text: 'hi' }] });
    const t = town(); t.flyIn.mockImplementation(() => true); setTown(t as unknown as TownPort);
    const store = storeWith(next); store.getState().receive(diffArrivals(seedWith({}), next, ME, {}));
    expect(store.getState().letter).toBeNull();
    t.flyIn.mock.calls[0][1]?.(); expect(store.getState().letter?.text).toBe('hi');
  });

  it('flies nothing for my own message, with ravens off, or for what is already on screen', () => {
    const next = seedWith({ 'sp/gen': [{ id: 'm1', by: ME, text: 'mine' }] });
    expect(diffArrivals(seedWith({}), next, ME, {})).toHaveLength(0);
    const theirs = seedWith({ 'sp/gen': [{ id: 'm2', by: BO, text: 'x' }] });
    const t = town(); setTown(t as unknown as TownPort);
    storeWith(theirs, { ravens: false }).getState().receive(diffArrivals(seedWith({}), theirs, ME, {}));
    storeWith(theirs, { space: 'sp', ch: { sp: 'gen' }, inside: true }).getState().receive(diffArrivals(seedWith({}), theirs, ME, {}));
    expect(t.flyIn).not.toHaveBeenCalled();
  });
});

describe('perched raven count equals unread (R-002)', () => {
  const state = (over: Partial<AppStore>) => ({ space: 'sp', spaces: [{ id: 'sp', sections: ['chat'] }], ch: {}, seen: {}, incoming: {}, feedSeen: {}, board: {}, skein: {}, inside: false, section: 'chat', call: null, speaking: null, me: { user_id: ME }, ...over }) as unknown as AppStore;
  const perch = (unread: number, over: Partial<AppStore> = {}) => sceneSignals(state(over), seedWith({}, { sp: [{ id: 'gen', unread }] })).perch.here;

  it('is one raven per unread message', () => { expect(perch(0)).toBe(0); expect(perch(1)).toBe(1); expect(perch(2)).toBe(2); });
  it('counts raven letters from other people too', () => expect(perch(1, { incoming: { 'sp/gen': 1 } })).toBe(2));
  it('is capped by RAVEN.maxHere', () => expect(perch(RAVEN.maxHere + 4)).toBe(RAVEN.maxHere));
  it('is zero while reading the chat', () => expect(perch(3, { inside: true, section: 'chat' })).toBe(0));
});

describe('a sent message flies a raven off (R-006)', () => {
  afterEach(() => setTown(null));
  const storeWith = (over: Partial<AppStore> = {}) => create<AppStore>()((set, get, api) => ({
    ...createChatSlice(set, get, api), space: 'sp', ch: { sp: 'gen' }, drafts: { 'sp/gen': 'hello' }, seed: seedWith({}), ravens: true, archi: false, photo: false,
    compose: { quote: null, viewOnce: false, ttl: 0, preview: null, previewFor: '', previewOff: false }, refresh: async () => undefined, showToast: vi.fn(), ...over,
  }) as unknown as AppStore);

  it('after message.post succeeds', async () => {
    const t = town(); setTown(t as unknown as TownPort);
    await storeWith().getState().send();
    expect(t.flyOut).toHaveBeenCalledWith('chat');
  });
  it('not for an empty draft or with ravens off', async () => {
    const t = town(); setTown(t as unknown as TownPort);
    await storeWith({ drafts: { 'sp/gen': '  ' } }).getState().send();
    await storeWith({ ravens: false }).getState().send();
    expect(t.flyOut).not.toHaveBeenCalled();
  });
});
