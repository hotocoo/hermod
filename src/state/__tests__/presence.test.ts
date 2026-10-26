import { describe, expect, it } from 'vitest';
import { PRESENCE } from '../../config/app';
import { dropPresence, isIdle, lastSeenLabel, notePresence, noteSeen, statusOf, sweepPresence } from '../presence';

const T = PRESENCE.ttlMs;

describe('presence reducers', () => {
  it('records online then away for the same peer, newest wins', () => {
    let m = notePresence({}, 'u1', false, 100);
    expect(statusOf(m, 'u1')).toBe('online');
    m = notePresence(m, 'u1', true, 200);
    expect(statusOf(m, 'u1')).toBe('away');
    expect(m.u1.at).toBe(200);
  });
  it('is offline (null) for an unseen peer', () => expect(statusOf({}, 'nobody')).toBeNull());
  it('expires entries older than the ttl and keeps fresh ones', () => {
    const m = { old: { at: 0, away: false }, fresh: { at: T, away: true } };
    const out = sweepPresence(m, T, T);
    expect(Object.keys(out)).toEqual(['fresh']);
  });
  it('returns the same object when nothing expired', () => {
    const m = notePresence({}, 'u1', false, 1000);
    expect(sweepPresence(m, 1000 + T - 1, T)).toBe(m);
  });
  it('does not mutate its input', () => {
    const m = notePresence({}, 'u1', false, 0);
    sweepPresence(m, T * 2, T);
    expect(statusOf(m, 'u1')).toBe('online');
  });
  it('is idle only after idleMs without input', () => {
    expect(isIdle(0, PRESENCE.idleMs - 1, PRESENCE.idleMs)).toBe(false);
    expect(isIdle(0, PRESENCE.idleMs, PRESENCE.idleMs)).toBe(true);
  });
});

describe('last seen and offline packets (M-026)', () => {
  it('an offline packet drops the live entry', () => {
    let m = notePresence({}, 'u1', false, 100);
    expect(statusOf(m, 'u1')).toBe('online');
    m = dropPresence(m, 'u1');
    expect(statusOf(m, 'u1')).toBeNull();
    expect(dropPresence(m, 'u1')).toBe(m); // no entry: same object, no re-render
  });

  it('keeps the last seen time past the ttl sweep', () => {
    let seen = noteSeen({}, 'u1', 1000);
    const live = sweepPresence(notePresence({}, 'u1', false, 1000), 1000 + T + 1, T);
    expect(Object.keys(live)).toHaveLength(0);
    seen = noteSeen(seen, 'u1', 1000);
    expect(seen.u1).toBe(1000);
  });

  it('labels last seen as a time today and a date earlier', () => {
    const now = new Date(2026, 9, 26, 14, 2, 0).getTime();
    expect(lastSeenLabel(new Date(2026, 9, 26, 13, 40).getTime(), now)).toBe('Last seen 13:40');
    expect(lastSeenLabel(new Date(2026, 9, 24, 9, 5).getTime(), now)).toBe('Last seen Oct 24');
    expect(lastSeenLabel(undefined, now)).toBeNull();
  });
});
