/** Help Desk notifications: assigned to me, a reply on one of my tickets, and an SLA that is about to breach. Pure diffs plus one delivery function. */
import { getBridge } from '../lib/bridge';
import type { Seed } from '../lib/data/types';
import { coll } from './dataTypes';
import { isTerminal } from './deskTypes';
import { allowedForSpace, getNotifySettings } from './notify';
import { personOf } from './selectors';
import type { AppStore } from './types';
import { nextDue, slaBadge } from './vm/desk';

export interface DeskNotice { sp: string; ticket: string; kind: 'assigned' | 'reply' | 'sla'; title: string; body: string }

const SLA_SOON_MS = 15 * 60_000;
const notified = new Set<string>();

/** What changed for `me` between two snapshots. */
export function diffDeskNotices(prev: Seed, next: Seed, me: string): DeskNotice[] {
  if (!me) return [];
  const before = coll(prev, 'desk'); const after = coll(next, 'desk');
  const out: DeskNotice[] = [];
  for (const sp of Object.keys(after)) {
    const old = new Map((before[sp]?.tickets ?? []).map((t) => [t.id, t]));
    for (const t of after[sp].tickets) {
      const o = old.get(t.id);
      if (t.assignee === me && t.assigned_by !== me && o && o.assignee !== me) {
        out.push({ sp, ticket: t.id, kind: 'assigned', title: `Assigned to you: #${t.number}`, body: t.subject });
      }
      if (!o || (t.assignee !== me && t.requester !== me)) continue;
      const seen = new Set(o.comments.map((c) => c.id));
      for (const c of t.comments) {
        if (seen.has(c.id) || c.by === me) continue;
        out.push({ sp, ticket: t.id, kind: 'reply', title: `${personOf(next, c.by).name} on #${t.number}`, body: c.body });
      }
    }
  }
  return out;
}

/** Tickets of mine whose next SLA moment is within 15 minutes (each reported once per due time). */
export function slaSoonNotices(seed: Seed, me: string, now: number): DeskNotice[] {
  if (!me) return [];
  const out: DeskNotice[] = [];
  const all = coll(seed, 'desk');
  for (const sp of Object.keys(all)) {
    for (const t of all[sp].tickets) {
      const due = nextDue(t);
      if (t.assignee !== me || due == null || isTerminal(t.status) || t.sla?.paused) continue;
      const left = due - now;
      const key = `${t.id}:${due}`;
      if (left <= 0 || left > SLA_SOON_MS || notified.has(key)) continue;
      notified.add(key);
      out.push({ sp, ticket: t.id, kind: 'sla', title: `SLA soon: #${t.number}`, body: `${slaBadge(t, now)?.label ?? ''} · ${t.subject}` });
    }
  }
  return out;
}

/** In-app toast while the window has focus, an OS notification (honouring mute and Do Not Disturb) otherwise. */
export function deliverDeskNotices(s: AppStore, notices: DeskNotice[]): void {
  for (const n of notices.slice(0, 3)) {
    if (typeof document !== 'undefined' && document.hasFocus()) {
      s.showToast(`${n.title}: ${n.body}`.slice(0, 140));
      continue;
    }
    const settings = getNotifySettings();
    if (!settings || !allowedForSpace(settings, n.sp)) continue;
    getBridge().notifySend(n.title, n.body, n.sp, '').catch(() => { /* a failed OS notification must never disturb the app */ });
  }
}
