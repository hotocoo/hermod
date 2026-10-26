import type { StateCreator } from 'zustand';
import { STORAGE_KEYS, TIMING } from '../../config/app';
import { COPY } from '../../config/copy';
import { errorMessage } from '../../lib/bridge';
import { readString } from '../../lib/storage';
import { repository } from '../../lib/data/repository';
import type { Seed, Space } from '../../lib/data/types';
import { coll } from '../dataTypes';
import { diffArrivals } from '../arrivals';
import { runArcadeAuto } from '../arcadeAuto';
import { deliverArcadeNotices, diffArcadeNotices } from '../arcadeNotify';
import { deliverCalNotices, diffMeetingNotices } from '../calendarNotify';
import { deliverDeskNotices, diffDeskNotices } from '../deskNotify';
import { channelsOf, isHomeSpace } from '../selectors';
import { timer } from '../timers';
import type { AppStore, CoreSlice } from '../types';

/** Space to show: the one already open, else the last opened one, else Home, else the first. */
export function pickSpace(spaces: Space[], current: string): string {
  const has = (id: string | null) => !!id && spaces.some((x) => x.id === id);
  if (has(current)) return current;
  const last = readString(STORAGE_KEYS.lastSpace);
  if (has(last)) return last as string;
  return (spaces.find(isHomeSpace) ?? spaces[0])?.id ?? '';
}

/** Local "seen" marks stay until the snapshot itself shows unread 0 for that chat, so a re-read racing the read mark cannot flash the count back. */
export function keepSeen(seen: Record<string, boolean>, seed: Seed): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const key of Object.keys(seen)) {
    const i = key.indexOf('/');
    if (channelsOf(seed, key.slice(0, i)).some((c) => c.id === key.slice(i + 1) && (c.unread ?? 0) > 0)) out[key] = true;
  }
  return out;
}

/** Per-Space selections, kept while they still exist in the new snapshot. */
function selections(seed: Seed, s: AppStore) {
  const ch: Record<string, string> = {}; const snap: Record<string, string> = {}; const line: Record<string, string> = {};
  const skein = coll(seed, 'skein');
  seed.spaces.forEach((sp) => {
    const list = channelsOf(seed, sp.id);
    const keep = s.ch[sp.id];
    ch[sp.id] = keep && list.some((c) => c.id === keep) ? keep : (sp.defaultChannel ?? list[0]?.id ?? '');
    const snaps = skein[sp.id]?.snaps ?? [];
    snap[sp.id] = snaps.some((x) => x.id === s.snap[sp.id]) ? s.snap[sp.id] : (snaps[0]?.id ?? '');
    line[sp.id] = s.line[sp.id] ?? 'all';
  });
  return { ch, snap, line };
}

let inFlight: Promise<void> | null = null;
let again = false;

export const createCoreSlice: StateCreator<AppStore, [], [], CoreSlice> = (set, get) => ({
  seed: null,

  apply: (seed) => {
    const s = get(); const prev = s.seed;
    const sel = selections(seed, s);
    const docs = coll(seed, 'docs'); const boards = coll(seed, 'pinboards');
    const space = pickSpace(seed.spaces, s.space);
    set({
      seed, ready: true, spaces: seed.spaces, space,
      section: s.seed ? s.section : 'chat',
      ch: sel.ch, snap: sel.snap, line: sel.line, seen: keepSeen(s.seen, seed),
      msgs: coll(seed, 'messages'), board: coll(seed, 'workboards'), skein: coll(seed, 'skein'),
      rook: coll(seed, 'inbox'), events: coll(seed, 'events'), pinboards: boards,
      boardSel: boards.some((b) => b.id === s.boardSel) ? s.boardSel : (boards[0]?.id ?? ''),
      docSel: docs.some((d) => d.id === s.docSel) ? s.docSel : (docs[0]?.id ?? ''),
      now: Date.now(),
    });
    if (prev) {
      // R-006: messages that a schedule timer just sent are mine but still fly a raven.
      // E-002: an admin removing me here is announced once, when the flag first appears.
      const wasRemoved = new Map(prev.spaces.map((x) => [x.id, !!x.removed]));
      for (const x of seed.spaces) {
        if (x.removed && !wasRemoved.get(x.id)) get().showToast(COPY.removedFromSpace(x.name));
      }
      const mine = new Set((get().scheduled ?? []).map((i) => (i.body as { msg_id?: string } | null)?.msg_id).filter((x): x is string => !!x));
      get().receive(diffArrivals(prev, seed, get().me?.user_id ?? '', get().blocked, mine));
      deliverDeskNotices(get(), diffDeskNotices(prev, seed, get().me?.user_id ?? ''));
      deliverArcadeNotices(get(), diffArcadeNotices(prev, seed, get().me?.user_id ?? ''));
      deliverCalNotices(get(), diffMeetingNotices(prev, seed, get().me?.user_id ?? ''));
    }
    runArcadeAuto(get());
  },

  /** Re-reads the snapshot. Concurrent calls coalesce into one trailing re-read, so bursts of `changed` cost one fetch. */
  refresh: () => {
    if (inFlight) { again = true; return inFlight; }
    inFlight = (async () => {
      try {
        do {
          again = false;
          get().apply(await repository.load());
        } while (again);
      } finally { inFlight = null; }
    })();
    return inFlight;
  },

  refreshSoon: () => timer.after('snapshot', TIMING.snapshotDebounceMs, () => { get().refresh().catch((e) => get().showToast(errorMessage(e), undefined, 'error')); }),
});
