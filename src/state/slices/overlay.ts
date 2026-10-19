import type { StateCreator } from 'zustand';
import { LIMITS, SEARCH_MIN_CHARS, TOAST_MS, STORAGE_KEYS } from '../../config/app';
import { COPY } from '../../config/copy';
import { errorMessage, getBridge, type SearchHit } from '../../lib/bridge';
import { parseSearchQuery } from '../../lib/messaging/searchQuery';
import { writeFlag } from '../../lib/storage';
import { pickAndStore } from '../../lib/upload';
import { seedOf } from '../helpers';
import { buildingIds } from '../selectors';
import { paletteResults } from '../palette';
import { renderPostcard } from '../postcard';
import { effectiveProfile } from '../profile';
import { getTown } from '../townPort';
import { timer } from '../timers';
import { TIMING } from '../../config/app';
import type { AppStore, OverlaySlice } from '../types';

const ONB_LAST = 3;

export const createOverlaySlice: StateCreator<AppStore, [], [], OverlaySlice> = (set, get) => ({
  drawer: null, palette: false, q: '', pi: 0, hits: [], toast: null,
  profile: false, profEdit: false, prof: null, profTab: 'posts', onb: 0,

  toggleDrawer: (id) => set((s) => ({ drawer: s.drawer === id ? null : id })),
  closeDrawer: () => set({ drawer: null }),

  openPalette: () => set({ palette: true, q: '', pi: 0 }),
  closePalette: () => set({ palette: false }),
  togglePalette: () => set((s) => ({ palette: !s.palette, q: '', pi: 0 })),
  setQ: (q) => {
    set({ q, pi: 0 });
    const text = q.trim();
    if (text.length < SEARCH_MIN_CHARS) { timer.clear('search'); set({ hits: [] }); return; }
    // Full-text search over decrypted content runs in the core (FTS5); debounced so typing stays smooth.
    timer.after('search', TIMING.searchDebounceMs, () => {
      const pq = parseSearchQuery(text);
      const filtered = !!(pq.from || pq.in || pq.has || pq.before || pq.after);
      // from:, in:, has:, before:, after: run over the message fold (docs/MESSAGING.md 3.20); plain text goes to full-text search.
      (filtered
        ? getBridge().messagesSearch(pq.q, { ...pq, limit: LIMITS.searchHits }).then((r) => r.map((h): SearchHit => ({ kind: 'message', space_id: h.space_id, channel_id: h.channel_id, id: h.id, title: '', snippet: h.text, by: h.by, ts: h.ts })))
        : getBridge().searchQuery(text, { limit: LIMITS.searchHits }))
        .then((hits) => { if (get().q.trim() === text) set({ hits }); })
        .catch(() => { if (get().q.trim() === text) set({ hits: [] }); });
    });
  },
  setPi: (pi) => set({ pi }),
  runResult: (i) => {
    const s = get(); const r = paletteResults(s, seedOf(get))[i];
    if (!r) return;
    r.go();
    set({ palette: false });
  },

  showToast: (text, ms = TOAST_MS.standard, kind) => {
    set({ toast: { text, id: Date.now(), kind } });
    timer.after('toast', ms, () => set({ toast: null }));
  },

  stepOnb: (n) => {
    timer.clear('tour');
    const town = getTown();
    town?.hover(null);
    if (n > ONB_LAST) { set({ onb: 0 }); writeFlag(STORAGE_KEYS.welcomed); return; }
    set({ onb: n, drawer: null });
    if (n === 2 && town) {
      const ids = buildingIds(seedOf(get)); let i = 0;
      town.hover(ids[0]);
      timer.every('tour', TIMING.tourStepMs, () => { i = (i + 1) % ids.length; getTown()?.hover(ids[i]); });
    }
  },
  replayWelcome: () => set({ drawer: null, onb: 1 }),

  openProfile: () => set({ profile: true, drawer: null }),
  closeProfile: () => set({ profile: false, profEdit: false, prof: null }),
  toggleEditProf: async () => {
    const s = get();
    if (!s.profEdit) { set({ profEdit: true, prof: effectiveProfile(s) }); return; }
    const p = effectiveProfile(s);
    try {
      const me = await getBridge().profileSet({ name: p.name.trim(), bio: p.bio.trim(), avatar: s.me?.avatar });
      set({ me, profEdit: false, prof: null });
      await get().refresh();
      get().showToast(COPY.profileSaved, TOAST_MS.profileSaved);
    } catch (e) { get().showToast(errorMessage(e), undefined, 'error'); }
  },
  setAvatar: async () => {
    const s = get(); const me = s.me; if (!me) return;
    try {
      const pic = (await pickAndStore('image/*', false))[0]; if (!pic) return;
      const p = effectiveProfile(s);
      set({ me: await getBridge().profileSet({ name: p.name.trim() || me.name, bio: p.bio, initials: me.initials, avatar: pic.blob }) });
      await get().refresh();
    } catch (e) { get().showToast(errorMessage(e), undefined, 'error'); }
  },
  setProfName: (name) => set((s) => ({ prof: { ...effectiveProfile(s), name } })),
  setProfBio: (bio) => set((s) => ({ prof: { ...effectiveProfile(s), bio } })),
  setProfTab: (profTab) => set({ profTab }),

  savePostcard: (name) => {
    const town = getTown();
    if (!town) return;
    const s = get();
    void town.snapshotStill().catch(() => town.snapshot()).then((url) => renderPostcard(url, name, `${s.period} · ${s.wx} · Hermóðr`))
      .then(() => get().showToast(COPY.postcardSaved, TOAST_MS.postcard))
      .catch((e) => get().showToast(errorMessage(e), undefined, 'error'));
  },
});
