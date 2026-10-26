import { afterEach, describe, expect, it, vi } from 'vitest';
import { NOTIFY } from '../../config/app';
import { COPY } from '../../config/copy';
import type { Seed } from '../../lib/data/types';
import { diffArrivals } from '../arrivals';
import { notifyArrivals, setNotifySettings } from '../notify';
import type { AppStore } from '../types';

const notifySend = vi.fn(async () => undefined);
vi.mock('../../lib/bridge', async (orig) => ({ ...(await orig<typeof import('../../lib/bridge')>()), getBridge: () => ({ notifySend }) }));

const ME = 'me'; const BO = 'bo'; const SINCE = 1_000_000;
type M = { id: string; by: string; text: string; ts?: number };
const seedWith = (messages: Record<string, M[]>, unread?: number): Seed => ({
  spaces: [{ id: 'home' }, { id: 'sp' }], people: { [ME]: { name: 'Ada', i: 'A', role: '' }, [BO]: { name: 'Bo', i: 'B', role: '' } },
  collections: { messages, channels: unread === undefined ? {} : { sp: [{ id: 'gen', ...(unread ? { unread } : {}) }] }, rooms: {}, feed: {}, letters: {} },
} as unknown as Seed);
const many = (n: number, ts: number): M[] => Array.from({ length: n }, (_, i) => ({ id: `m${i}`, by: BO, text: `old ${i}`, ts }));

describe('backfill is not an arrival', () => {
  const prev = seedWith({ 'sp/gen': [] });
  it('300 messages sent before the session started raise nothing', () => {
    expect(diffArrivals(prev, seedWith({ 'sp/gen': many(300, SINCE - 1) }), ME, {}, undefined, SINCE)).toHaveLength(0);
  });
  it('300 messages at or below the read watermark (unread 0) raise nothing', () => {
    expect(diffArrivals(prev, seedWith({ 'sp/gen': many(300, SINCE + 5) }, 0), ME, {}, undefined, SINCE)).toHaveLength(0);
  });
  it('only the newest `unread` messages above the watermark count', () => {
    const out = diffArrivals(prev, seedWith({ 'sp/gen': many(300, SINCE + 5) }, 2), ME, {}, undefined, SINCE);
    expect(out.map((a) => a.id)).toEqual(['m298', 'm299']);
  });
  it('a live message after the session start still arrives', () => {
    expect(diffArrivals(prev, seedWith({ 'sp/gen': many(1, SINCE + 1) }, 1), ME, {}, undefined, SINCE)).toHaveLength(1);
  });
  it('an unchanged channel list yields nothing', () => {
    const same = seedWith({ 'sp/gen': many(3, SINCE + 1) }, 3);
    expect(diffArrivals(same, same, ME, {}, undefined, SINCE)).toHaveLength(0);
  });
});

describe('OS notifications per apply', () => {
  afterEach(() => { notifySend.mockClear(); vi.unstubAllGlobals(); });
  it('caps at NOTIFY.burstMax and folds the rest into one summary', () => {
    setNotifySettings({ enabled: true, dm: true, mention: true, muted_spaces: [], muted_channels: [], dnd_until: 0, dnd_schedule: { enabled: false, from_hour: 0, to_hour: 0 } } as never);
    vi.stubGlobal('document', { hasFocus: () => false });
    const arrivals = Array.from({ length: 300 }, (_, i) => ({ kind: 'message' as const, by: BO, sp: 'home', ch: 'gen', text: `t${i}`, id: `m${i}`, mentionsMe: true }));
    const store = { seed: seedWith({}), spaces: [{ id: 'home', kind: 'home' }], prefs: { muted: {} } } as unknown as AppStore;
    notifyArrivals(store, arrivals);
    expect(notifySend).toHaveBeenCalledTimes(NOTIFY.burstMax + 1);
    expect(notifySend).toHaveBeenLastCalledWith(COPY.notifyMoreTitle, COPY.notifyMore(300 - NOTIFY.burstMax), 'home', 'gen');
  });
});
