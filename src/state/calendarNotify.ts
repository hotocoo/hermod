/** Calendar reminders (FEATURES V-032) and meeting-start notices (N-001). Pure schedule and diff, plus one delivery function. */
import { NOTIFY } from '../config/app';
import { COPY } from '../config/copy';
import type { Seed } from '../lib/data/types';
import { coll, type CalEvent } from './dataTypes';
import { allowedForSpace, getNotifySettings, sendNotification, type NotifyKind, type NotifyTarget } from './notify';
import { isHomeSpace, roomMeeting } from './selectors';
import type { AppStore } from './types';

export interface CalNotice { kind: NotifyKind; key: string; sp: string; title: string; body: string; target: NotifyTarget }

const MIN_MS = 60_000;
const HOUR_MS = 3_600_000;
const fired = new Set<string>();

/** Events (weekly, Mon to Fri, start in hours) that I am part of and that begin within `leadMin` minutes, once per occurrence (`seen` holds the keys already reported). */
export function dueReminders(events: CalEvent[], now: Date, me: string, leadMin: number, seen: ReadonlySet<string>): CalNotice[] {
  if (!me) return [];
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekday = (now.getDay() + 6) % 7; // Mon = 0; unlike todayIndex this is not clamped, so weekends match nothing
  const out: CalNotice[] = [];
  for (const ev of events) {
    if (ev.d !== weekday || !(ev.going || ev.people.includes(me))) continue;
    const left = day.getTime() + ev.s * HOUR_MS - now.getTime();
    const key = `${ev.spaceId ?? ''}/${ev.id}@${day.getTime()}`;
    if (left <= 0 || left > leadMin * MIN_MS || seen.has(key)) continue;
    out.push({ kind: 'reminder', key, sp: ev.spaceId ?? '', title: COPY.reminderTitle(ev.t), body: COPY.reminderBody(Math.ceil(left / MIN_MS), ev.where), target: { sp: ev.spaceId ?? '', ev: ev.id } });
  }
  return out;
}

/** Meetings that started in a Space I belong to between two snapshots, unless I am already in the room. */
export function diffMeetingNotices(prev: Seed, next: Seed, me: string): CalNotice[] {
  if (!me) return [];
  const out: CalNotice[] = [];
  for (const sp of next.spaces) {
    const m = roomMeeting(next, sp.id);
    if (!m || isHomeSpace(sp) || roomMeeting(prev, sp.id)?.at === m.at || coll(next, 'rooms')[sp.id]?.inRoom.includes(me)) continue;
    out.push({ kind: 'meeting', key: `${sp.id}@${m.at}`, sp: sp.id, title: COPY.meetingNoticeTitle(m.topic), body: COPY.meetingNoticeBody(sp.name), target: { sp: sp.id, hearth: true } });
  }
  return out;
}

/** In-app toast while the window has focus, an OS notification (honouring the toggle, mute and Do Not Disturb) otherwise. */
export function deliverCalNotices(s: AppStore, notices: CalNotice[]): void {
  for (const n of notices) {
    if (fired.has(n.key)) continue;
    fired.add(n.key);
    if (typeof document !== 'undefined' && document.hasFocus()) { s.showToast(`${n.title}: ${n.body}`.slice(0, 140)); continue; }
    const settings = getNotifySettings();
    if (!settings || !allowedForSpace(settings, n.sp, n.kind)) continue;
    sendNotification(n.title, n.body, n.target);
  }
}

/** Reminders now due for me, across every Space. */
export const checkReminders = (s: AppStore, now = new Date()): void => {
  if (s.seed) deliverCalNotices(s, dueReminders(s.events, now, s.me?.user_id ?? '', NOTIFY.reminderLeadMin, fired));
};
