/** OS notifications for arrivals while the window is unfocused: DMs and mentions (FEATURES N-001), honouring mute and Do Not Disturb. */
import { getBridge, type NotifySettings } from '../lib/bridge';
import type { Arrival } from './arrivals';
import { isHomeSpace, personOf } from './selectors';
import type { AppStore } from './types';

let settings: NotifySettings | null = null;
export const setNotifySettings = (n: NotifySettings): void => { settings = n; };
export const getNotifySettings = (): NotifySettings | null => settings;

/** Mute, Do Not Disturb and the master switch for something addressed to me in a space (no channel). */
export function allowedForSpace(n: NotifySettings, sp: string): boolean {
  return allowed(n, { sp, ch: '' }, 'mention');
}

function allowed(n: NotifySettings, a: Pick<Arrival, 'sp' | 'ch'>, kind: 'dm' | 'mention'): boolean {
  if (!n.enabled || !n[kind]) return false;
  if (n.muted_spaces.includes(a.sp) || n.muted_channels.includes(`${a.sp}/${a.ch}`)) return false;
  if (n.dnd_until && n.dnd_until > Date.now()) return false;
  const sch = n.dnd_schedule;
  if (sch.enabled) {
    const h = new Date().getHours();
    const inside = sch.from_hour <= sch.to_hour ? h >= sch.from_hour && h < sch.to_hour : h >= sch.from_hour || h < sch.to_hour;
    if (inside) return false;
  }
  return true;
}

export function notifyArrival(s: AppStore, a: Arrival): void {
  if (!settings || !s.seed || typeof document === 'undefined' || document.hasFocus()) return;
  const sp = s.spaces.find((x) => x.id === a.sp);
  const kind: 'dm' | 'mention' | null = a.mentionsMe ? 'mention' : (sp && isHomeSpace(sp) ? 'dm' : null);
  if (!kind || !allowed(settings, a, kind)) return;
  getBridge().notifySend(personOf(s.seed, a.by).name, a.text, a.sp, a.ch).catch(() => { /* a failed OS notification must never disturb the app */ });
}
