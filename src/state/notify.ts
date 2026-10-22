/** OS notifications for arrivals while the window is unfocused: DMs and mentions (FEATURES N-001), honouring mute and Do Not Disturb. */
import { DM_KIND, NOTIFY } from '../config/app';
import { getBridge, type NotifySettings } from '../lib/bridge';
import type { Arrival } from './arrivals';
import { isMuted } from './slices/messaging/helpers';
import { isHomeSpace, personOf } from './selectors';
import type { AppStore } from './types';

let settings: NotifySettings | null = null;
export const setNotifySettings = (n: NotifySettings): void => { settings = n; };
export const getNotifySettings = (): NotifySettings | null => settings;

/** Mute, Do Not Disturb and the master switch for something addressed to me in a space (no channel). */
export function allowedForSpace(n: NotifySettings, sp: string, kind: NotifyKind = 'mention'): boolean {
  return allowed(n, { sp, ch: '' }, kind);
}

/** Settings toggle that gates each kind of OS notification. */
export type NotifyKind = 'dm' | 'mention' | 'meeting' | 'reminder';
/** Where clicking a notification takes the app: a channel, a calendar event or the Hearth of a space. */
export interface NotifyTarget { sp: string; ch?: string; ev?: string; hearth?: boolean }

let pending: { at: number; target: NotifyTarget } | null = null;

/** Show an OS notification and remember its target. Desktop notifications give no click callback, so the next window focus within NOTIFY.clickWindowMs counts as the click (see `openNotifyTarget`). */
export function sendNotification(title: string, body: string, target: NotifyTarget): void {
  pending = { at: Date.now(), target };
  getBridge().notifySend(title, body, target.sp, target.ch ?? '').catch(() => { /* a failed OS notification must never disturb the app */ });
}

/** Focus the app on the target of the last notification, once, if it was shown moments ago. */
export function openNotifyTarget(s: AppStore, now = Date.now()): void {
  const p = pending; pending = null;
  if (!p || now - p.at > NOTIFY.clickWindowMs) return;
  const t = p.target;
  if (t.ch) s.goChannel(t.sp, t.ch);
  else { s.goSpace(t.sp); if (t.hearth) s.goSection('hearth'); else if (t.ev) { s.goSection('board'); s.selectEvent(t.ev); } }
}

function allowed(n: NotifySettings, a: Pick<Arrival, 'sp' | 'ch'>, kind: NotifyKind): boolean {
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

/** Which OS notification (if any) an arrival earns: none for a chat I muted (MESSAGING 3.16, @everyone included), else a DM or a mention that the settings allow. */
export function arrivalKind(n: NotifySettings, muted: Record<string, number> | undefined, a: Arrival, home: boolean): 'dm' | 'mention' | null {
  if (isMuted(muted, `${a.sp}/${a.ch}`)) return null;
  const kind = a.mentionsMe ? 'mention' : (home ? 'dm' : null);
  return kind && allowed(n, a, kind) ? kind : null;
}

export function notifyArrival(s: AppStore, a: Arrival): void {
  if (!settings || !s.seed || typeof document === 'undefined' || document.hasFocus()) return;
  const sp = s.spaces.find((x) => x.id === a.sp);
  if (!arrivalKind(settings, s.prefs.muted, a, !!sp && (isHomeSpace(sp) || sp.kind === DM_KIND))) return;
  sendNotification(personOf(s.seed, a.by).name, a.text, { sp: a.sp, ch: a.ch });
}
