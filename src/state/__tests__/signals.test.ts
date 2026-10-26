import { describe, expect, it } from 'vitest';
import { notePresence, type PresenceMap } from '../presence';
import { visitorCount } from '../signals';

describe('gallery visitors from presence (T-015)', () => {
  const members = ['me', 'a', 'b', 'c'];
  it('is zero when no member has a live beacon', () => expect(visitorCount(members, {}, 'me', 4)).toBe(0));
  it('counts only online members other than me', () => {
    let p = notePresence({}, 'a', false, 1);
    p = notePresence(p, 'b', true, 1); // away
    p = notePresence(p, 'me', false, 1);
    p = notePresence(p, 'stranger', false, 1); // not a member
    expect(visitorCount(members, p, 'me', 4)).toBe(1);
  });
  it('caps at the seats the lawn has and ignores duplicates', () => {
    let p: PresenceMap = {};
    for (const id of members) p = notePresence(p, id, false, 1);
    expect(visitorCount([...members, 'a'], p, 'me', 2)).toBe(2);
    expect(visitorCount([...members, 'a'], p, 'me', 9)).toBe(3);
  });
});
