import type { StateCreator } from 'zustand';
import { RAVEN_BURST_MAX, TIMING } from '../../config/app';
import { getBridge } from '../../lib/bridge';
import { appendEvent, guarded } from '../act';
import type { Arrival } from '../arrivals';
import { withKey } from '../helpers';
import { channelUnread, channelsOf, curSpace, personOf } from '../selectors';
import { notifyArrival } from '../notify';
import { isMuted } from './messaging/helpers';
import { getTown } from '../townPort';
import { timer } from '../timers';
import type { AppStore, RavenSlice } from '../types';

export const createRavenSlice: StateCreator<AppStore, [], [], RavenSlice> = (set, get) => ({
  rook: [], letter: null,

  /** Real arrivals from other people (new messages, letters). Ravens only fly for what is not already on screen. */
  receive: (arrivals) => {
    const s0 = get(); const seed = s0.seed;
    if (!seed || !arrivals.length) return;
    const viewing = (a: Arrival) => s0.inside && s0.section === 'chat' && s0.space === a.sp && s0.ch[a.sp] === a.ch;
    const fresh = arrivals.filter((a) => !viewing(a));
    if (!fresh.length) return;
    set((st) => {
      const incoming = { ...st.incoming };
      fresh.forEach((a) => { const k = `${a.sp}/${a.ch}`; incoming[k] = (incoming[k] ?? 0) + 1; });
      return { incoming };
    });
    fresh.forEach((a) => notifyArrival(get(), a));
    const s = get();
    const loud = fresh.filter((a) => !isMuted(s.prefs.muted, `${a.sp}/${a.ch}`)); // a muted chat sends no raven either
    if (!s.ravens || s.photo || s.onb || !loud.length) return;
    const last = loud.slice(-RAVEN_BURST_MAX).pop() as Arrival;
    const L = personOf(seed, last.by);
    const deliver = () => {
      set({ letter: { by: last.by, from: L.name, text: last.text, sp: last.sp, ch: last.ch, id: Date.now() } });
      timer.after('letter', TIMING.letterMs, () => set({ letter: null }));
    };
    const town = getTown();
    if (last.sp === s.space && town && !s.archi) town.sendRaven(s.inside && s.section !== 'chat' ? 'search' : 'chat', deliver);
    else deliver();
  },

  openRook: (r) => {
    set({ drawer: null, letter: null });
    const go = () => { set((st) => ({ ch: withKey(st.ch, r.sp, r.ch) })); get().enterBuilding('chat'); };
    if (get().archi) get().toggleArchi();
    if (r.sp !== get().space) { set({ space: r.sp }); timer.after('openRook', TIMING.openRookDelayMs, go); } else go();
  },

  markRookRead: async () => {
    const s = get();
    const unread = s.rook.filter((r) => !r.read);
    await guarded(get, () => Promise.all(unread.map((r) => getBridge().readMark(r.sp, r.ch))));
    await s.refresh();
  },
  readLetter: () => {
    const L = get().letter;
    if (L) get().openRook({ sp: L.sp, ch: L.ch });
  },
  dismissLetter: () => set({ letter: null }),

  onRaven: (kind) => {
    const s = get();
    if (kind === 'away') { if (!s.archi) set({ drawer: 'rook' }); return; }
    const seed = s.seed; if (!seed) return;
    const keys = Object.keys(s.incoming).filter((k) => k.startsWith(`${s.space}/`));
    const chans = channelsOf(seed, curSpace(s).id);
    const ch = keys.length ? keys[keys.length - 1].split('/')[1] : (chans.find((c) => channelUnread(s, c) > 0) ?? chans[0])?.id;
    if (ch) set((x) => ({ ch: withKey(x.ch, s.space, ch), letter: null }));
    timer.after('enterChat', TIMING.enterChatDelayMs, () => get().enterBuilding('chat'));
  },

  sendLetter: async (toSpace, channel, text) => {
    const s = get();
    return appendEvent(get, s.space, { t: 'letter.send', to_space: toSpace, channel_id: channel, text });
  },
});
