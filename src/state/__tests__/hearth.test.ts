import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import { COPY } from '../../config/copy';
import { MEDIA } from '../../config/media';
import { useMediaRt } from '../mediaRt';
import { createCallSlice } from '../slices/call';
import { hearthVm } from '../vm/hearth';
import type { Ctx } from '../vm/context';
import type { AppStore } from '../types';
import type { Seed } from '../../lib/data/types';

const sendEphemeral = vi.fn(async () => undefined);
vi.mock('../../lib/bridge', async (orig) => ({ ...(await orig<typeof import('../../lib/bridge')>()), getBridge: () => ({ sendEphemeral }) }));

const ME = 'me';
const people = (n: number) => Array.from({ length: n }, (_, i) => (i === 0 ? ME : `p${i}`));
const seedWith = (inRoom: string[], share: Record<string, boolean> = {}): Seed => ({
  spaces: [{ id: 'sp' }], people: { [ME]: { name: 'Ada Tester', i: 'AT', role: '' } },
  collections: { rooms: { sp: { name: 'Hearth', topic: '', inRoom, cams: {}, share } } },
} as unknown as Seed);
const ctx = (seed: Seed): Ctx => ({
  s: { me: { user_id: ME }, call: null, space: 'sp', spaces: [{ id: 'sp', name: 'Sp' }], section: 'hearth', speaking: null, talking: {}, stageBig: false, noteDraft: '' } as unknown as AppStore,
  seed, I: () => null,
} as unknown as Ctx);

describe('hearth lobby at the mesh cap (H-014)', () => {
  const max = MEDIA.call.maxParticipants;
  it('is not full one below the cap', () => {
    const h = hearthVm(ctx(seedWith(people(max - 1)))).hearth;
    expect(h?.full).toBe(false);
    expect(h?.fullLine).toBe('');
  });
  it('is full at the cap and explains why', () => {
    const h = hearthVm(ctx(seedWith(people(max)))).hearth;
    expect(h?.full).toBe(true);
    expect(h?.fullLine).toBe(COPY.hearthFull(max));
  });
});

describe('screen share leads the grid (H-004)', () => {
  it('puts the sharing person first, before the rest in room order', () => {
    const tiles = hearthVm(ctx(seedWith(people(3), { p2: true }))).tiles;
    expect(tiles.map((t) => t.id)).toEqual(['p2', ME, 'p1']);
    expect(tiles[0]).toMatchObject({ share: true, noCam: false });
  });
});

describe('raise hand and quick reactions are ephemeral room signals (H-011)', () => {
  const SIG = MEDIA.call.signal;
  const [THUMBS] = SIG.reactions;
  const store = () => create<AppStore>()((set, get, api) => ({
    ...createCallSlice(set, get, api), me: { user_id: ME }, space: 'sp',
  }) as unknown as AppStore);
  const inCall = () => { const s = store(); s.setState({ call: { space: 'sp', room: '', at: 0, muted: false, cam: false, share: false } }); return s; };

  beforeEach(() => { vi.useFakeTimers(); sendEphemeral.mockClear(); useMediaRt.setState({ hands: {}, reactions: {} }); });
  afterEach(() => vi.useRealTimers());

  it('a peer reaction shows on their tile and fades after reactionMs', () => {
    inCall().getState().noteHearthSignal('bo', 'sp', { room: '', react: THUMBS });
    expect(useMediaRt.getState().reactions).toEqual({ bo: THUMBS });
    vi.advanceTimersByTime(SIG.reactionMs - 1);
    expect(useMediaRt.getState().reactions.bo).toBe(THUMBS);
    vi.advanceTimersByTime(1);
    expect(useMediaRt.getState().reactions).toEqual({});
  });

  it('a peer hand goes up and down', () => {
    const s = inCall().getState();
    s.noteHearthSignal('bo', 'sp', { room: '', hand: true });
    expect(useMediaRt.getState().hands).toEqual({ bo: true });
    s.noteHearthSignal('bo', 'sp', { room: '', hand: false });
    expect(useMediaRt.getState().hands).toEqual({});
  });

  it('ignores signals from another space, another room, myself, unknown reactions, or while not in a call', () => {
    const s = inCall().getState();
    s.noteHearthSignal('bo', 'other', { room: '', hand: true });
    s.noteHearthSignal('bo', 'sp', { room: 'voice-x', hand: true });
    s.noteHearthSignal(ME, 'sp', { room: '', hand: true });
    s.noteHearthSignal('bo', 'sp', { room: '', react: 'not-a-reaction' });
    store().getState().noteHearthSignal('bo', 'sp', { room: '', hand: true });
    expect(useMediaRt.getState()).toMatchObject({ hands: {}, reactions: {} });
  });

  it('my reaction shows locally and goes out as an ephemeral hearth.signal for this room', async () => {
    await inCall().getState().callReact(THUMBS);
    expect(useMediaRt.getState().reactions).toEqual({ [ME]: THUMBS });
    expect(sendEphemeral).toHaveBeenCalledWith('sp', SIG.kind, { room: '', react: THUMBS });
  });
});

describe('meeting clock', () => {
  /** Minutes the meeting has been running when the view is built. */
  const RUNNING_MIN = 7;
  it('counts from the epoch-ms start time the core sends', () => {
    const now = Date.UTC(2026, 9, 27, 12, 0, 0); const at = now - RUNNING_MIN * 60_000;
    const seed = { spaces: [{ id: 'sp' }], people: { [ME]: { name: 'Ada Tester', i: 'AT', role: '' } }, collections: { rooms: { sp: { name: 'Hearth', topic: '', inRoom: [ME], cams: {}, meeting: { topic: 'Market prep', at, notes: [] } } }, agenda: [] } } as unknown as Seed;
    const c = ctx(seed); (c.s as unknown as { call: unknown; now: number }).call = { space: 'sp', room: 'sp', at, muted: false, cam: false, share: false }; (c.s as unknown as { now: number }).now = now;
    expect(hearthVm(c).call?.meetElapsed).toBe(`0${RUNNING_MIN}:00`);
  });
});
