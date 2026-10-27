/** OS-facing behaviour: notifications (N-001, N-004), dock badge (N-003), idle presence (P-004). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOME_KIND, NOTIFY, PRESENCE } from '../../config/app';
import type { NotifySettings } from '../../lib/bridge';
import type { Seed } from '../../lib/data/types';
import { startBridgeSync } from '../bridgeSync';
import { arrivalKind, notifyArrivals, openNotifyTarget, setNotifySettings } from '../notify';
import { startPresence } from '../presenceSend';
import type { AppStore, StoreLike } from '../types';

const notifySend = vi.fn(async () => undefined);
const badgeSet = vi.fn(async () => undefined);
const sendEphemeral = vi.fn(async () => undefined);
vi.mock('../../lib/bridge', async (orig) => ({
  ...(await orig<typeof import('../../lib/bridge')>()),
  getBridge: () => ({
    notifySend, badgeSet, sendEphemeral,
    on: () => () => undefined,
    nodeStatus: async () => ({ running: true }),
    outboxStatus: async () => ({ pending: 0 }),
    notifySettingsGet: async () => ({}),
  }),
}));

const ALL_ON: NotifySettings = { enabled: true, dm: true, mention: true, meeting: true, reminder: true, muted_spaces: [], muted_channels: [], dnd_until: null, dnd_schedule: { enabled: false, from_hour: 0, to_hour: 0 } };
const arrival = (o: Record<string, unknown> = {}) => ({ kind: 'message' as const, by: 'bo', sp: 'sp', ch: 'gen', text: 'hi', id: 'm1', mentionsMe: true, ...o });
const seed = { people: { bo: { name: 'Bo', i: 'B', role: '' } }, spaces: [], collections: {} } as unknown as Seed;
const notifyStore = (extra: Record<string, unknown> = {}) => ({ seed, spaces: [{ id: 'sp', kind: 'Team' }], prefs: { muted: {} }, ...extra }) as unknown as AppStore;

afterEach(() => { notifySend.mockClear(); badgeSet.mockClear(); sendEphemeral.mockClear(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('N-001 OS notification while the window is unfocused', () => {
  beforeEach(() => setNotifySettings(ALL_ON));
  it('shows one for a mention when the window is not focused, none when it is', () => {
    vi.stubGlobal('document', { hasFocus: () => false });
    notifyArrivals(notifyStore(), [arrival()]);
    expect(notifySend).toHaveBeenCalledWith('Bo', 'hi', 'sp', 'gen');
    notifySend.mockClear();
    vi.stubGlobal('document', { hasFocus: () => true });
    notifyArrivals(notifyStore(), [arrival()]);
    expect(notifySend).not.toHaveBeenCalled();
  });
  it('a DM in the home space notifies, a plain channel message does not', () => {
    vi.stubGlobal('document', { hasFocus: () => false });
    const home = notifyStore({ spaces: [{ id: 'sp', kind: HOME_KIND }] });
    notifyArrivals(home, [arrival({ mentionsMe: false })]);
    expect(notifySend).toHaveBeenCalledTimes(1);
    notifySend.mockClear();
    notifyArrivals(notifyStore(), [arrival({ mentionsMe: false })]);
    expect(notifySend).not.toHaveBeenCalled();
  });
  it('focusing the window right after one opens its target, once; a stale focus does not', () => {
    vi.stubGlobal('document', { hasFocus: () => false });
    const goChannel = vi.fn();
    const s = { goChannel } as unknown as AppStore;
    const now = Date.now();
    notifyArrivals(notifyStore(), [arrival()]);
    openNotifyTarget(s, now + 1);
    expect(goChannel).toHaveBeenCalledWith('sp', 'gen');
    openNotifyTarget(s, now + 2);
    expect(goChannel).toHaveBeenCalledTimes(1);
    notifyArrivals(notifyStore(), [arrival()]);
    openNotifyTarget(s, Date.now() + NOTIFY.clickWindowMs + 1);
    expect(goChannel).toHaveBeenCalledTimes(1);
  });
});

describe('N-004 notification settings gate each kind', () => {
  const a = (mentionsMe: boolean) => arrival({ mentionsMe }) as never;
  it('the DM switch gates DMs and the mention switch gates mentions, independently', () => {
    expect(arrivalKind({ ...ALL_ON, dm: false }, undefined, a(false), true)).toBeNull();
    expect(arrivalKind({ ...ALL_ON, dm: false }, undefined, a(true), true)).toBe('mention');
    expect(arrivalKind({ ...ALL_ON, mention: false }, undefined, a(true), false)).toBeNull();
    expect(arrivalKind(ALL_ON, undefined, a(false), true)).toBe('dm');
  });
  it('the master switch, a muted space or channel, and Do Not Disturb silence everything', () => {
    expect(arrivalKind({ ...ALL_ON, enabled: false }, undefined, a(true), false)).toBeNull();
    expect(arrivalKind({ ...ALL_ON, muted_spaces: ['sp'] }, undefined, a(true), false)).toBeNull();
    expect(arrivalKind({ ...ALL_ON, muted_channels: ['sp/gen'] }, undefined, a(true), false)).toBeNull();
    expect(arrivalKind({ ...ALL_ON, dnd_until: Date.now() + 60_000 }, undefined, a(true), false)).toBeNull();
  });
});

describe('N-003 dock badge follows unread', () => {
  const seedWith = (unread: Record<string, number>) => ({
    spaces: Object.keys(unread).map((id) => ({ id })),
    collections: { channels: Object.fromEntries(Object.entries(unread).map(([id, n]) => [id, [{ id: 'gen', unread: n }]])) },
  }) as unknown as Seed;
  it('sets the summed unread of every Space, and clears it when everything is seen', () => {
    let listener: (s: AppStore, p: AppStore) => void = () => undefined;
    let state = { seed: null, seen: {} } as unknown as AppStore;
    const store = { getState: () => state, setState: () => undefined, subscribe: (l: typeof listener) => { listener = l; return () => undefined; } } as unknown as StoreLike;
    const stop = startBridgeSync(store);
    state = { seed: seedWith({ a: 2, b: 3 }), seen: {} } as unknown as AppStore;
    listener(state, state);
    expect(badgeSet).toHaveBeenLastCalledWith(5);
    state = { ...state, seen: { 'a/gen': 1 } } as unknown as AppStore;
    listener(state, state);
    expect(badgeSet).toHaveBeenLastCalledWith(3);
    state = { ...state, seen: { 'a/gen': 1, 'b/gen': 1 } } as unknown as AppStore;
    listener(state, state);
    expect(badgeSet).toHaveBeenLastCalledWith(0);
    stop();
  });
});

describe('P-004 idle detection', () => {
  it('sends away after idleMs without input, and online again on the next input', () => {
    vi.useFakeTimers();
    const handlers = new Map<string, () => void>();
    vi.stubGlobal('window', { addEventListener: (e: string, h: () => void) => handlers.set(e, h), removeEventListener: () => undefined });
    const state = { sweepPresence: () => undefined, privacy: { presence: true }, node: { running: true }, spaces: [{ id: 'sp', kind: 'Team' }] } as unknown as AppStore;
    const stop = startPresence({ getState: () => state } as unknown as StoreLike);
    const lastAway = () => (sendEphemeral.mock.calls.at(-1) as unknown as [string, string, { away: boolean }])[2].away;
    expect(lastAway()).toBe(false);
    vi.advanceTimersByTime(PRESENCE.idleMs - PRESENCE.checkMs);
    expect(sendEphemeral.mock.calls.every((c) => (c as unknown as [string, string, { away: boolean }])[2].away === false)).toBe(true);
    vi.advanceTimersByTime(PRESENCE.checkMs * 2);
    expect(lastAway()).toBe(true);
    handlers.get(PRESENCE.inputEvents[0])?.();
    expect(lastAway()).toBe(false);
    stop();
  });
});
