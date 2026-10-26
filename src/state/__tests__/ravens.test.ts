import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import { TIMING } from '../../config/app';
import { RAVEN } from '../../config/scene';
import { appendEvent } from '../act';
import { diffArrivals } from '../arrivals';
import { sceneSignals } from '../signals';
import { createChatSlice } from '../slices/chat';
import { createRavenSlice } from '../slices/ravens';
import { MUTE_FOREVER } from '../slices/messaging/helpers';
import { setTown, type TownPort } from '../townPort';
import type { AppStore } from '../types';
import type { Seed } from '../../lib/data/types';

const readMark = vi.fn(async () => undefined);
vi.mock('../../lib/bridge', async (orig) => ({ ...(await orig<typeof import('../../lib/bridge')>()), getBridge: () => ({ eventAppend: async () => undefined, readMark }) }));

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
    ...createRavenSlice(set, get, api), seed, space: 'home', ch: {}, inside: false, section: 'chat', incoming: {}, ravens: true, photo: false, onb: 0, archi: false, prefs: { muted: {} }, ...extra,
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
  it('counts a raven letter before the core unread lands', () => expect(perch(0, { incoming: { 'sp/gen': 1 } })).toBe(1));
  it('counts one arrival once when the letter and the core unread both show it', () => expect(perch(1, { incoming: { 'sp/gen': 1 } })).toBe(1));
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
  it('after any message.post, not only the composer (sticker, poll, forum, forward, icebreaker)', async () => {
    const t = town(); setTown(t as unknown as TownPort);
    const get = () => storeWith().getState();
    await appendEvent(get, 'sp', { t: 'message.post', channel_id: 'gen', msg_id: 'm1', text: '', attachments: [], ext: { kind: 'sticker', sticker: 's' } });
    expect(t.flyOut).toHaveBeenCalledTimes(1);
    await appendEvent(get, 'sp', { t: 'reaction.toggle', target_id: 'm1', label: 'x' });
    expect(t.flyOut).toHaveBeenCalledTimes(1);
  });
  it('not for an empty draft or with ravens off', async () => {
    const t = town(); setTown(t as unknown as TownPort);
    await storeWith({ drafts: { 'sp/gen': '  ' } }).getState().send();
    await storeWith({ ravens: false }).getState().send();
    expect(t.flyOut).not.toHaveBeenCalled();
  });
});

describe('letter overlay: read, dismiss, fade (R-003)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { setTown(null); vi.useRealTimers(); });
  const next = seedWith({ 'sp/gen': [{ id: 'm1', by: BO, text: 'come see' }] });
  const landed = () => {
    const enterBuilding = vi.fn();
    const store = create<AppStore>()((set, get, api) => ({
      ...createRavenSlice(set, get, api), seed: next, space: 'sp', ch: {}, inside: false, section: 'chat', incoming: {}, ravens: true, photo: false, onb: 0, archi: false,
      prefs: { muted: {} }, drawer: null, enterBuilding,
    }) as unknown as AppStore);
    store.getState().receive(diffArrivals(seedWith({}), next, ME, {}));
    expect(store.getState().letter).toMatchObject({ from: 'Bo Tester', text: 'come see', sp: 'sp', ch: 'gen' });
    return { store, enterBuilding };
  };

  it('Read opens the chat channel the letter came from', () => {
    const { store, enterBuilding } = landed();
    store.getState().readLetter();
    expect(store.getState().letter).toBeNull();
    expect(store.getState().ch).toEqual({ sp: 'gen' });
    expect(enterBuilding).toHaveBeenCalledWith('chat');
  });
  it('Dismiss closes it without opening anything', () => {
    const { store, enterBuilding } = landed();
    store.getState().dismissLetter();
    expect(store.getState().letter).toBeNull();
    expect(enterBuilding).not.toHaveBeenCalled();
  });
  it('closes on its own after letterMs', () => {
    const { store } = landed();
    vi.advanceTimersByTime(TIMING.letterMs - 1);
    expect(store.getState().letter).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(store.getState().letter).toBeNull();
  });
});

describe('rookery mark all read (R-004)', () => {
  beforeEach(() => readMark.mockClear());
  it('marks every unread, unmuted entry read in the core, then refreshes', async () => {
    const refresh = vi.fn(async () => undefined);
    const rook = [
      { sp: 'sp', ch: 'gen', read: false }, { sp: 'sp', ch: 'old', read: true }, { sp: 'sp', ch: 'quiet', read: false }, { sp: 'home', ch: 'dm', read: false },
    ];
    const store = create<AppStore>()((set, get, api) => ({
      ...createRavenSlice(set, get, api), rook, prefs: { muted: { 'sp/quiet': MUTE_FOREVER } }, refresh, showToast: vi.fn(),
    }) as unknown as AppStore);
    await store.getState().markRookRead();
    expect(readMark.mock.calls).toEqual([['sp', 'gen'], ['home', 'dm']]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it('says why when the core refuses, and still refreshes', async () => {
    readMark.mockRejectedValueOnce(new Error('core offline'));
    const showToast = vi.fn(); const refresh = vi.fn(async () => undefined);
    const store = create<AppStore>()((set, get, api) => ({
      ...createRavenSlice(set, get, api), rook: [{ sp: 'sp', ch: 'gen', read: false }], prefs: { muted: {} }, refresh, showToast,
    }) as unknown as AppStore);
    await store.getState().markRookRead();
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('core offline'), undefined, 'error');
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe('scheduled sends fly a raven (R-006)', () => {
  it('includes my own message only when its id was scheduled', () => {
    const prev = seedWith({});
    const next = seedWith({ 'sp/gen': [{ id: 'm1', by: ME, text: 'scheduled out' }, { id: 'm2', by: ME, text: 'typed now' }] });
    expect(diffArrivals(prev, next, ME, {})).toHaveLength(0);
    const arrivals = diffArrivals(prev, next, ME, {}, new Set(['m1']));
    expect(arrivals).toHaveLength(1);
    expect(arrivals[0]).toMatchObject({ kind: 'message', by: ME, id: 'm1' });
  });
});
