/**
 * Town controller: callbacks for creating the scene, the state-to-scene diff (`sync`), DOM theming, and
 * convenience wiring. Framework agnostic; call from a React effect.
 *
 *   const handlers = townHandlers(store);            // pass to the scene factory
 *   const town = await createTown({ mount, overlay, reduced, ...handlers });
 *   const stop = attachTown(town, store);            // boot + live diffing; call stop() on unmount
 */
import { STORAGE_KEYS, TIMING } from '../config/app';
import { applyGrain, applyTextScale, applyTheme } from '../lib/theme';
import { readString } from '../lib/storage';
import { pickPrefs, savePrefs } from '../lib/prefs';
import { hasSection, curSpace } from './selectors';
import { sceneSignals } from './signals';
import { townInfo } from './slices/nav';
import { startEffects } from './effects';
import { timer } from './timers';
import { asPick, asSection, setTown, type TownPort } from './townPort';
import type { AppStore, StoreLike } from './types';
import type { PickId, SkyInfo } from '../scene/types';

export { startTimers } from './appTimers';
export { attachKeyboard } from './keyboard';
export { startEffects } from './effects';

/** Scene callbacks (the options the prototype passed to HermodTown.create). */
export function townHandlers(store: StoreLike) {
  const g = store.getState;
  return {
    blocked: () => !!g().palette,
    onPick: (id: PickId | null, x?: number, y?: number) => g().pick(id, x, y),
    onHover: (id: string | null) => g().setHot(id),
    onSky: (sky: SkyInfo) => g().onSky(sky),
    onFlash: () => g().onFlash(),
    onIsle: (id: string) => g().sailTo(id),
    onRaven: (k: 'here' | 'away') => g().onRaven(k),
    onArchi: (on: boolean) => { if (on !== g().archi) g().toggleArchi(); },
  };
}

interface Prev { space: string; section: string; theme: string; call: boolean; toast: AppStore['toast'] }
const snapshot = (s: AppStore): Prev => ({ space: s.space, section: s.section, theme: s.theme, call: !!s.call, toast: s.toast });

/** Keep <html> theme attributes and the grain variable in step with state. Returns cleanup. */
export function attachShell(store: StoreLike): () => void {
  const apply = (s: AppStore) => { applyTheme(s.theme, s.themePalette); applyGrain(s.grain); };
  apply(store.getState());
  applyTextScale(Number(readString(STORAGE_KEYS.textScale)) || 100);
  return store.subscribe((s, p) => {
    if (s.theme !== p.theme || s.themePalette !== p.themePalette || s.grain !== p.grain) apply(s);
    if (JSON.stringify(pickPrefs(s)) !== JSON.stringify(pickPrefs(p))) savePrefs(pickPrefs(s));
  });
}

/** Boot the scene from state, then mirror state changes into it. Returns cleanup (disposes the town). */
export function attachTown(town: TownPort, store: StoreLike): () => void {
  setTown(town);
  const get = store.getState; const set = store.setState;
  const keys = { unread: '', perch: '', hints: '', room: '', info: '' };
  let prev: Prev = snapshot(get());

  const pushSignals = (s: AppStore) => {
    const seed = s.seed; if (!seed) return;
    const sig = sceneSignals(s, seed);
    const uk = JSON.stringify({ chat: sig.unread });
    if (uk !== keys.unread) { keys.unread = uk; town.setUnread({ chat: sig.unread }); }
    const pk = JSON.stringify(sig.perch);
    if (pk !== keys.perch) { keys.perch = pk; town.setPerched(sig.perch.here, sig.perch.away); }
    const hk = JSON.stringify(sig.hints);
    if (hk !== keys.hints) { keys.hints = hk; town.setHints(sig.hints); }
    const rk = `${sig.room.n}:${sig.room.me}:${sig.room.speak}`;
    if (rk !== keys.room) { keys.room = rk; town.setRoom(sig.room.n, sig.room.me, sig.room.speak); }
  };

  /** Island growth, member cottages and sections change with the log: push them whenever they differ (a newly raised section animates). */
  const pushSpaceInfo = (s: AppStore, sameSpace: boolean) => {
    const info = townInfo(s);
    const k = JSON.stringify([info.id, info.sections, info.growth, info.people, info.name, info.arcade, info.map_style]);
    if (k === keys.info) return;
    const prev = keys.info ? (JSON.parse(keys.info) as [string, string[]]) : null;
    keys.info = k;
    // A section is only "raised" within the same island: a different Space (e.g. just joined) is a full rebuild.
    const raised = sameSpace && prev && prev[0] === info.id ? info.sections.find((x) => !prev[1].includes(x)) : undefined;
    town.setSpace(info, raised ? { raise: raised } : undefined);
  };

  const sync = () => {
    const s = get(); const ps = prev; prev = snapshot(s);
    if (ps.space !== s.space) {
      keys.info = '';
      if (s.inside) set({ inside: false, panelReady: false });
      town.focus(null);
      set({ veil: Date.now() });
      timer.after('veil', TIMING.veilMs, () => set({ veil: 0 }));
    } else if (ps.section !== s.section && s.inside) {
      if (hasSection(curSpace(s), s.section)) {
        s.paintInside(s.section);
        set({ enterVeil: Date.now() });
        timer.after('enterVeil', TIMING.enterVeilMs, () => get().forceUpdate());
        town.enter(asSection(s.section));
      } else town.focus(asPick(s.section));
    }
    if (ps.theme !== s.theme) {
      if (!s.themeBySky) town.setTheme(s.theme === 'dark');
      set({ themeBySky: false });
    }
    town.setCovered(s.inside && s.panelReady);
    pushSpaceInfo(s, ps.space === s.space);
    pushSignals(get());
    if (ps.call !== !!s.call) town.setFire(!!s.call);
    if (s.toast && s.toast !== ps.toast && s.toast.kind === 'weave') town.burst();
  };

  const s0 = get();
  town.setTheme(s0.theme === 'dark', true);
  keys.info = JSON.stringify([townInfo(s0).id, townInfo(s0).sections, townInfo(s0).growth, townInfo(s0).people, townInfo(s0).name, townInfo(s0).arcade, townInfo(s0).map_style]);
  town.setSpace(townInfo(s0));
  town.setFire(!!s0.call);
  pushSignals(s0);
  set({ town: 'ok' });
  prev = snapshot(get());
  const unsub = store.subscribe(sync);
  return () => { unsub(); town.dispose(); setTown(null); };
}

/** Everything that runs for the life of the app, minus the scene: DOM theming, effects. Returns cleanup. */
export function startShell(store: StoreLike): () => void {
  const stops = [attachShell(store), startEffects(store)];
  return () => stops.forEach((f) => f());
}
