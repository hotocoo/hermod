import type { StateCreator } from 'zustand';
import { COPY } from '../../config/copy';
import { LAYOUT, STORAGE_KEYS, TIMING } from '../../config/app';
import { writeString } from '../../lib/storage';
import { appendEvent } from '../act';
import { panelWidth } from '../geometry';
import { arcadeHints } from '../arcadeHints';
import { asPick, asSection, getTown, type TownSpaceInfo } from '../townPort';
import { paintRows } from '../paint';
import { seedOf, spaceOf, withKey } from '../helpers';
import { curSpace, hasSection, personOf, sectionPlace } from '../selectors';
import { timer } from '../timers';
import type { AppStore, NavSlice } from '../types';

/** Space data for the scene: sections, island growth and member names (initials for cottage labels) from the projection. */
export const townInfo = (s: AppStore): TownSpaceInfo => {
  const sp = curSpace(s);
  const people: Record<string, { name: string; initials: string }> = {};
  (sp.growth?.houses ?? []).forEach((h) => {
    const p = s.seed ? personOf(s.seed, h.user_id) : null;
    if (p) people[h.user_id] = { name: p.name, initials: p.i };
  });
  return { id: sp.id, name: sp.name, sections: sp.sections.slice(), online: sp.online, growth: sp.growth, map_style: sp.mapStyle, people, arcade: arcadeHints(s.seed, sp.id) };
};

/** No "show earlier" widening: the default window. */
const EMPTY_CHAT_WIN = { key: '', extra: 0 };

export const createNavSlice: StateCreator<AppStore, [], [], NavSlice> = (set, get) => ({
  spaces: [], space: '', section: 'chat', ch: {}, thread: null, overview: false, idxPinned: false,
  inside: false, door: null, panelReady: false, clipX: 0, clipY: 0, enterVeil: 0,
  galTab: 'feed', shopTab: 'board', feedTab: 'foryou', rev: 0,

  forceUpdate: () => set((s) => ({ rev: s.rev + 1 })),

  goSpace: (id) => set((s) => {
    const sp = spaceOf(s.spaces, id);
    writeString(STORAGE_KEYS.lastSpace, sp.id);
    return { space: id, section: hasSection(sp, s.section) ? s.section : sp.sections[0], thread: null, overview: false, idxPinned: false };
  }),
  goSection: (sec) => set({ section: sec, thread: null, overview: false, idxPinned: false }),
  selectSection: (sec) => set({ section: sec, thread: null }),
  goChannel: (sp, id) => set((s) => ({
    space: sp, section: 'chat', ch: withKey(s.ch, sp, id), thread: null, overview: false, idxPinned: false,
    seen: withKey(s.seen, `${sp}/${id}`, true),
    chatWin: s.chatWin.key === `${sp}/${id}` ? s.chatWin : EMPTY_CHAT_WIN, // leaving a channel folds it back to the newest window
  })),

  sailTo: (id) => {
    set({ archi: false });
    getTown()?.setArchipelago(false);
    if (!id || id === get().space) return;
    timer.after('sail', TIMING.sailDelayMs, () => {
      const sp = spaceOf(get().spaces, id);
      writeString(STORAGE_KEYS.lastSpace, sp.id);
      set({ space: id, section: sp.sections[0], thread: null });
    });
  },

  pick: (id, x = 0, y = 0) => {
    const s = get();
    if (id == null) {
      if (s.inside) s.exit(); else if (s.door) s.backFromDoor();
      return;
    }
    const town = getTown();
    if (id !== 'search' && hasSection(curSpace(s), id) && town && !s.inside) {
      if (s.door === id) { s.enterBuilding(id); return; }
      set({ door: id, section: asSection(id), thread: null, overview: false, drawer: null, letter: null });
      town.approach(asSection(id));
      timer.after('paint', TIMING.paintDelayMs, () => get().paintInside(id));
      return;
    }
    if (id === 'search') { set({ palette: true, q: '', pi: 0 }); return; }
    const pw = s.panelW();
    set({
      inside: true, section: asSection(id), thread: null, overview: false,
      // The pick point can be projected mid camera move (far off screen); keep the reveal origin on the panel so it always opens.
      clipX: Math.min(Math.max(Math.round(x - (window.innerWidth - LAYOUT.panelInsetPx - pw)), 0), pw),
      clipY: Math.min(Math.max(Math.round(y - LAYOUT.panelInsetPx), 0), window.innerHeight), panelReady: true,
    });
    town?.focus(asPick(id));
  },

  clickBuilding: (id) => {
    const p = getTown()?.screenPos(id) ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    get().pick(id, p.x, p.y);
  },

  /** List view (keyboard and screen readers): a raised building opens at once, there is no door card to approach. */
  openBuilding: (id) => {
    const s = get();
    if (id !== 'search' && hasSection(curSpace(s), id) && getTown() && !s.inside) s.enterBuilding(id);
    else s.clickBuilding(id);
  },

  exit: () => {
    set({ inside: false, thread: null, door: null });
    getTown()?.leave();
    timer.after('panel', TIMING.panelCloseMs, () => { if (!get().inside) set({ panelReady: false }); });
  },

  backFromDoor: () => { set({ door: null }); getTown()?.focus(null); },

  paintInside: (id) => {
    const town = getTown(); const seed = get().seed;
    if (!town || !seed) return;
    const rows = paintRows(get(), seed, id);
    if (rows) town.paintInterior(asSection(id), rows);
  },

  enterBuilding: (id) => {
    const town = getTown();
    if (!town) return;
    get().paintInside(id);
    set({ door: null, section: asSection(id), thread: null, overview: false, enterVeil: Date.now() });
    timer.after('enterVeil', TIMING.enterVeilMs, () => get().forceUpdate());
    town.enter(asSection(id), () => {
      const pw = get().panelW();
      set({
        inside: true, panelReady: true,
        clipX: Math.round(pw * LAYOUT.clipOriginXFrac), clipY: Math.round(window.innerHeight * LAYOUT.clipOriginYFrac),
      });
    });
  },

  raise: () => {
    const s = get(); const sp = curSpace(s); const id = s.section;
    if (hasSection(sp, id)) return;
    void appendEvent(get, sp.id, { t: 'section.raise', section: id }).then((ok) => {
      if (ok) get().showToast(COPY.raised(sectionPlace(seedOf(get), id), sp.name));
    });
  },

  panelW: () => panelWidth(window.innerWidth),

  setGalTab: (id) => set({ galTab: id, vid: null }),
  setShopTab: (id) => set({ shopTab: id }),
  setFeedTab: (feedTab) => set({ feedTab }),
  pinIdx: () => set({ idxPinned: true }),
  unpinIdx: () => set({ idxPinned: false }),
  togglePin: () => set((s) => ({ idxPinned: !s.idxPinned })),
  openOverview: () => set({ overview: true, thread: null }),

});
