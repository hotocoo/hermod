import { describe, expect, it } from 'vitest';
import type { Seed } from '../../lib/data/types';
import type { DeskView, Ticket } from '../deskTypes';
import { counts, fmtSpan, listTickets, matchesFilter, slaBadge } from '../vm/desk';

const NOW = 1_800_000_000_000;
const MIN = 60_000;

const ticket = (o: Partial<Ticket> & { id: string; number: number }): Ticket => ({
  subject: 's', body: '', status: 'open', priority: 'normal', queue: 'q', requester: 'u1', assignee: null, assigned_by: null, tags: [], fields: {}, created: NOW - 60 * MIN,
  updated: NOW - 30 * MIN, due: null, att: [], comments: [], links: [], csat: null, merged_into: null, merged_from: [], sla: null, ...o,
});
const sla = (o: Partial<NonNullable<Ticket['sla']>>): NonNullable<Ticket['sla']> => ({ first_due: NOW + 10 * MIN, resolve_due: NOW + 100 * MIN, first_responded: null, resolved_at: null, paused: false, breached: false, overdue: false, ...o });
const desk = (tickets: Ticket[]): DeskView => ({
  config: { queues: [{ queue_id: 'q', name: 'Support', desc: '' }], fields: [], sla: [], business_hours: null, csat: true }, agent: true, admin: true, agents: ['me'], tickets, views: [], macros: [], stats: null,
});
const seed = { people: { u1: { name: 'Una', i: 'U', role: '' }, me: { name: 'Me', i: 'M', role: '' } } } as unknown as Seed;

describe('slaBadge', () => {
  it('counts down to the first reply, then to the solution', () => {
    expect(slaBadge(ticket({ id: 'a', number: 1, sla: sla({}) }), NOW)).toMatchObject({ tone: 'soon', label: 'reply in 10m 00s' });
    expect(slaBadge(ticket({ id: 'a', number: 1, sla: sla({ first_responded: NOW - MIN }) }), NOW)).toMatchObject({ tone: 'ok', label: 'solve in 1h 40m' });
  });
  it('shows lateness, pause and the final result', () => {
    expect(slaBadge(ticket({ id: 'a', number: 1, sla: sla({ first_due: NOW - 5 * MIN }) }), NOW)).toMatchObject({ tone: 'late', label: 'reply 5m 00s late' });
    expect(slaBadge(ticket({ id: 'a', number: 1, status: 'on_hold', sla: sla({ paused: true }) }), NOW)?.tone).toBe('paused');
    expect(slaBadge(ticket({ id: 'a', number: 1, status: 'solved', sla: sla({ breached: true }) }), NOW)?.tone).toBe('missed');
    expect(slaBadge(ticket({ id: 'a', number: 1, status: 'solved', sla: sla({}) }), NOW)?.tone).toBe('done');
    expect(slaBadge(ticket({ id: 'a', number: 1 }), NOW)).toBeNull();
  });
  it('formats spans', () => {
    expect(fmtSpan(65_000)).toBe('1m 05s');
    expect(fmtSpan(3 * 3600_000 + 5 * MIN)).toBe('3h 05m');
    expect(fmtSpan(-2 * 86_400_000 - 4 * 3600_000)).toBe('2d 4h');
  });
});

describe('listTickets', () => {
  const tickets = [
    ticket({ id: 'a', number: 1, subject: 'Printer jam', assignee: 'me', updated: NOW - 3 * MIN }),
    ticket({ id: 'b', number: 2, subject: 'Login loop', priority: 'urgent', updated: NOW - 2 * MIN }),
    ticket({ id: 'c', number: 3, status: 'solved', subject: 'Old', updated: NOW - MIN }),
    ticket({ id: 'd', number: 4, merged_into: 'a' }),
  ];
  const run = (o: Partial<Parameters<typeof listTickets>[3]> = {}) => listTickets(desk(tickets), 'me', seed, { scope: 'all', status: 'active', sort: 'updated', text: '', matchIds: null, ...o }).map((t) => t.id);
  it('hides solved and merged tickets by default and sorts by recency', () => expect(run()).toEqual(['b', 'a']));
  it('scopes to mine and unassigned', () => { expect(run({ scope: 'mine' })).toEqual(['a']); expect(run({ scope: 'unassigned' })).toEqual(['b']); });
  it('sorts by priority and filters by text', () => {
    expect(run({ sort: 'priority' })).toEqual(['b', 'a']);
    expect(run({ text: 'printer' })).toEqual(['a']);
    expect(run({ status: 'solved' })).toEqual(['c']);
  });
  it('counts per scope and queue', () => {
    expect(counts(desk(tickets), 'me')).toMatchObject({ all: 2, mine: 1, unassigned: 1, byQueue: { q: 2 } });
  });
  it('applies saved-view filters', () => {
    const f = { status: [], priority: ['urgent'], queue: [], assignee: [], tags: [] };
    expect(tickets.filter((t) => matchesFilter(t, f, seed.people)).map((t) => t.id)).toEqual(['b']);
  });
});
