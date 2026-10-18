import type { StateCreator } from 'zustand';
import { STORAGE_KEYS, TIMING } from '../../config/app';
import { readString } from '../../lib/storage';
import { repository } from '../../lib/data/repository';
import type { Seed, Space } from '../../lib/data/types';
import { coll } from '../dataTypes';
import { diffArrivals } from '../arrivals';
import { runArcadeAuto } from '../arcadeAuto';
import { deliverArcadeNotices, diffArcadeNotices } from '../arcadeNotify';
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
      ch: sel.ch, snap: sel.snap, line: sel.line, seen: {},
      msgs: coll(seed, 'messages'), board: coll(seed, 'workboards'), skein: coll(seed, 'skein'),
      rook: coll(seed, 'inbox'), events: coll(seed, 'events'), pinboards: boards,
      boardSel: boards.some((b) => b.id === s.boardSel) ? s.boardSel : (boards[0]?.id ?? ''),
      docSel: docs.some((d) => d.id === s.docSel) ? s.docSel : (docs[0]?.id ?? ''),
      now: Date.now(),
    });
    if (prev) {
      get().receive(diffArrivals(prev, seed, get().me?.user_id ?? '', get().blocked));
      deliverDeskNotices(get(), diffDeskNotices(prev, seed, get().me?.user_id ?? ''));
      deliverArcadeNotices(get(), diffArcadeNotices(prev, seed, get().me?.user_id ?? ''));
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

  refreshSoon: () => timer.after('snapshot', TIMING.snapshotDebounceMs, () => { get().refresh().catch((e) => get().showToast(String(e), undefined, 'error')); }),
});
