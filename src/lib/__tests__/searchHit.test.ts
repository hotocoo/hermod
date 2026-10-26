import { describe, expect, it } from 'vitest';
import { HIT_CLOSE, HIT_OPEN, splitHit, toggleKind } from '../searchHit';

describe('splitHit', () => {
  it('splits on core markers and keeps hostile markup as text', () => {
    const t = `a <b>x</b> ${HIT_OPEN}kiln${HIT_CLOSE} z`;
    expect(splitHit(t, 'q')).toEqual([{ text: 'a <b>x</b> ', hit: false }, { text: 'kiln', hit: true }, { text: ' z', hit: false }]);
  });
  it('falls back to the first case-insensitive query match', () => {
    expect(splitHit('Hello World', 'wor')).toEqual([{ text: 'Hello ', hit: false }, { text: 'Wor', hit: true }, { text: 'ld', hit: false }]);
  });
  it('returns plain text when nothing matches and nothing for empty text', () => {
    expect(splitHit('abc', 'zz')).toEqual([{ text: 'abc', hit: false }]);
    expect(splitHit('', 'zz')).toEqual([]);
  });
});

describe('toggleKind', () => {
  it('adds then removes without mutating', () => {
    const base = ['doc'] as const;
    expect(toggleKind(base, 'card')).toEqual(['doc', 'card']);
    expect(toggleKind(base, 'doc')).toEqual([]);
    expect(base).toEqual(['doc']);
  });
});
