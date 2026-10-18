/** Help Desk view model: pure reads over the `desk` collection (scopes, saved views, filtering, sorting, SLA display). No store access. */
import type { Seed } from '../../lib/data/types';
import { coll } from '../dataTypes';
import { isTerminal, type DeskView, type Ticket, type TicketPriority, type ViewFilter } from '../deskTypes';
import { personOf } from '../selectors';

export type DeskSort = 'updated' | 'created' | 'priority' | 'sla';
/** `all`, `mine` (assigned to me), `unassigned`, `overdue`, `requested` (made by me), `queue:<id>` or `view:<id>`. */
export type DeskScope = string;
export type StatusMode = 'active' | 'all' | 'solved';

export const deskOf = (seed: Seed | null, space: string): DeskView | null => (seed ? ((coll(seed, 'desk') ?? {})[space] ?? null) : null);

const PRIORITY_RANK: Record<TicketPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const DAY_MS = 86_400_000;

/** Tickets that count as live work: not merged away, not solved or closed. */
export const isActive = (t: Ticket): boolean => !t.merged_into && !isTerminal(t.status);

/** Next SLA moment that still matters for sorting and display; `null` when paused, done or there is no policy. */
export function nextDue(t: Ticket): number | null {
  const s = t.sla;
  if (!s || isTerminal(t.status)) return null;
  if (s.first_responded == null) return s.first_due;
  return s.resolve_due;
}

export type SlaTone = 'ok' | 'soon' | 'late' | 'paused' | 'done' | 'missed';
export interface SlaBadgeData { tone: SlaTone; label: string; ms: number | null }
const SOON_MS = 15 * 60_000;

/** Compact duration: `4m 12s`, `2h 05m`, `3d 4h`. */
export function fmtSpan(ms: number): string {
  const a = Math.abs(Math.floor(ms / 1000));
  if (a < 3600) return `${Math.floor(a / 60)}m ${String(a % 60).padStart(2, '0')}s`;
  if (a < 86_400) return `${Math.floor(a / 3600)}h ${String(Math.floor((a % 3600) / 60)).padStart(2, '0')}m`;
  return `${Math.floor(a / 86_400)}d ${Math.floor((a % 86_400) / 3600)}h`;
}

/** What the SLA badge shows for a ticket at `now`. Agents only (guests get no SLA). */
export function slaBadge(t: Ticket, now: number): SlaBadgeData | null {
  const s = t.sla;
  if (!s || t.merged_into) return null;
  if (isTerminal(t.status)) return { tone: s.breached ? 'missed' : 'done', label: s.breached ? 'SLA missed' : 'SLA met', ms: null };
  if (s.paused && !s.overdue) return { tone: 'paused', label: 'SLA paused', ms: null };
  const due = nextDue(t);
  if (due == null) return null;
  const ms = due - now;
  const what = s.first_responded == null ? 'reply' : 'solve';
  if (ms < 0) return { tone: 'late', label: `${what} ${fmtSpan(ms)} late`, ms };
  return { tone: ms <= SOON_MS ? 'soon' : 'ok', label: `${what} in ${fmtSpan(ms)}`, ms };
}

export function matchesFilter(t: Ticket, f: ViewFilter, people: Seed['people']): boolean {
  if (f.status.length && !f.status.includes(t.status)) return false;
  if (f.priority.length && !f.priority.includes(t.priority)) return false;
  if (f.queue.length && !f.queue.includes(t.queue)) return false;
  if (f.assignee.length && !f.assignee.includes(t.assignee ?? '')) return false;
  if (f.tags.length && !f.tags.every((x) => t.tags.includes(x))) return false;
  if (f.text?.trim() && !textOf(t, people).includes(f.text.trim().toLowerCase())) return false;
  return true;
}

/** Lower-cased searchable text of a ticket: number, subject, body, requester name, tags and visible comments. */
export function textOf(t: Ticket, people: Seed['people']): string {
  const who = people[t.requester]?.name ?? '';
  return `#${t.number} ${t.subject} ${t.body} ${who} ${t.tags.join(' ')} ${t.comments.map((c) => c.body).join(' ')}`.toLowerCase();
}

export interface ListOptions { scope: DeskScope; status: StatusMode; sort: DeskSort; text: string; matchIds: ReadonlySet<string> | null }

export function listTickets(desk: DeskView, me: string, seed: Seed, o: ListOptions): Ticket[] {
  const view = o.scope.startsWith('view:') ? desk.views.find((v) => v.id === o.scope.slice(5)) : undefined;
  const q = o.text.trim().toLowerCase();
  const out = desk.tickets.filter((t) => {
    if (t.merged_into) return false;
    if (o.status === 'active' ? isTerminal(t.status) : o.status === 'solved' ? !isTerminal(t.status) : false) return false;
    if (o.scope === 'mine' && t.assignee !== me) return false;
    if (o.scope === 'unassigned' && t.assignee) return false;
    if (o.scope === 'requested' && t.requester !== me) return false;
    if (o.scope === 'overdue' && !t.sla?.overdue) return false;
    if (o.scope.startsWith('queue:') && t.queue !== o.scope.slice(6)) return false;
    if (view && !matchesFilter(t, view.filter, seed.people)) return false;
    if (q) return o.matchIds ? o.matchIds.has(t.id) || textOf(t, seed.people).includes(q) : textOf(t, seed.people).includes(q);
    return true;
  });
  return out.sort(comparator(o.sort));
}

function comparator(sort: DeskSort): (a: Ticket, b: Ticket) => number {
  switch (sort) {
    case 'created': return (a, b) => b.created - a.created;
    case 'priority': return (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || b.updated - a.updated;
    case 'sla': return (a, b) => (nextDue(a) ?? Infinity) - (nextDue(b) ?? Infinity) || b.updated - a.updated;
    default: return (a, b) => b.updated - a.updated;
  }
}

export interface DeskCounts { all: number; mine: number; unassigned: number; overdue: number; requested: number; byQueue: Record<string, number> }

export function counts(desk: DeskView, me: string): DeskCounts {
  const live = desk.tickets.filter(isActive);
  const byQueue: Record<string, number> = {};
  live.forEach((t) => { byQueue[t.queue] = (byQueue[t.queue] ?? 0) + 1; });
  return {
    all: live.length, mine: live.filter((t) => t.assignee === me).length, unassigned: live.filter((t) => !t.assignee).length,
    overdue: live.filter((t) => t.sla?.overdue).length, requested: live.filter((t) => t.requester === me).length, byQueue,
  };
}

export const queueName = (desk: DeskView, id: string): string => desk.config.queues.find((q) => q.queue_id === id)?.name ?? (id || 'General');
export const ticketById = (desk: DeskView, id: string | null): Ticket | null => (id ? (desk.tickets.find((t) => t.id === id) ?? null) : null);

/** Agents that can take a ticket (members and above, from the projection). */
export const agentChoices = (desk: DeskView, seed: Seed, me: string): { id: string; name: string }[] =>
  desk.agents.map((k) => ({ id: k, name: k === me ? `${personOf(seed, k).name} (me)` : personOf(seed, k).name }));

export const ageLabel = (ts: number, now: number): string => {
  const d = now - ts;
  if (d < 60_000) return 'now';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m`;
  if (d < DAY_MS) return `${Math.floor(d / 3_600_000)}h`;
  return `${Math.floor(d / DAY_MS)}d`;
};
