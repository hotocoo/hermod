import { describe, expect, it } from 'vitest';
import type { Seed } from '../../lib/data/types';
import { diffMeetingNotices, dueReminders } from '../calendarNotify';
import type { CalEvent } from '../dataTypes';

const ev = (o: Partial<CalEvent>): CalEvent => ({ id: 'e1', spaceId: 's1', d: 2, s: 10, e: 11, t: 'Standup', where: 'The Hearth', note: '', people: ['me'], ...o });
const wed = (h: number, m = 0) => new Date(2026, 0, 7, h, m); // 2026-01-07 is a Wednesday (d = 2)
const LEAD = 5;

describe('dueReminders', () => {
  it('fires inside the lead window and reports minutes left', () => {
    const r = dueReminders([ev({})], wed(9, 56), 'me', LEAD, new Set());
    expect(r).toHaveLength(1);
    expect(r[0].body).toContain('4 min');
    expect(r[0].target).toEqual({ sp: 's1', ev: 'e1' });
  });
  it('waits until the window opens and stops after the start', () => {
    expect(dueReminders([ev({})], wed(9, 50), 'me', LEAD, new Set())).toEqual([]);
    expect(dueReminders([ev({})], wed(10, 1), 'me', LEAD, new Set())).toEqual([]);
  });
  it('fires once per occurrence, again next week', () => {
    const [first] = dueReminders([ev({})], wed(9, 56), 'me', LEAD, new Set());
    expect(dueReminders([ev({})], wed(9, 57), 'me', LEAD, new Set([first.key]))).toEqual([]);
    const next = new Date(2026, 0, 14, 9, 56);
    expect(dueReminders([ev({})], next, 'me', LEAD, new Set([first.key]))).toHaveLength(1);
  });
  it('skips other days, events I am not part of, and weekends', () => {
    expect(dueReminders([ev({ d: 3 })], wed(9, 56), 'me', LEAD, new Set())).toEqual([]);
    expect(dueReminders([ev({ people: [] })], wed(9, 56), 'me', LEAD, new Set())).toEqual([]);
    expect(dueReminders([ev({ people: [], going: true })], wed(9, 56), 'me', LEAD, new Set())).toHaveLength(1);
    expect(dueReminders([ev({ d: 4 })], new Date(2026, 0, 10, 9, 56), 'me', LEAD, new Set())).toEqual([]);
  });
  it('handles half-hour starts', () => {
    expect(dueReminders([ev({ s: 10.5 })], wed(10, 27), 'me', LEAD, new Set())).toHaveLength(1);
  });
});

const seed = (meeting: { topic: string; at: number } | undefined, inRoom: string[] = []) => ({
  spaces: [{ id: 's1', name: 'Studio', kind: 'Team' }, { id: 'h', name: 'Home', kind: 'Personal' }],
  collections: { rooms: { s1: { name: 'Hearth', inRoom, cams: {}, topic: '', meeting: meeting && { ...meeting, notes: [] } } } },
}) as unknown as Seed;

describe('diffMeetingNotices', () => {
  it('reports a meeting that just started', () => {
    const r = diffMeetingNotices(seed(undefined), seed({ topic: 'Plan', at: 5 }), 'me');
    expect(r).toHaveLength(1);
    expect(r[0].target).toEqual({ sp: 's1', hearth: true });
  });
  it('ignores a running meeting, one I am in, and a missing identity', () => {
    expect(diffMeetingNotices(seed({ topic: 'Plan', at: 5 }), seed({ topic: 'Plan', at: 5 }), 'me')).toEqual([]);
    expect(diffMeetingNotices(seed(undefined), seed({ topic: 'Plan', at: 5 }, ['me']), 'me')).toEqual([]);
    expect(diffMeetingNotices(seed(undefined), seed({ topic: 'Plan', at: 5 }), '')).toEqual([]);
  });
});
