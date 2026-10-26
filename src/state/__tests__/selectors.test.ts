import { describe, expect, it } from 'vitest';
import type { Seed } from '@/lib/data/types';
import { displayName, nicksIn, withNicks } from '../selectors';

const seed = {
  people: { u1: { name: 'Ada Okafor', i: 'AO', role: 'member' }, u2: { name: 'Bea Quist', i: 'BQ', role: 'member' } },
  collections: { messaging: { spaces: { sp1: { nicks: { u1: 'Skipper' } } }, dmRequests: [] } },
} as unknown as Seed;

describe('Space nicknames (M-048)', () => {
  it('prefers the Space nickname over the profile name', () => {
    expect(displayName(seed, 'sp1', 'u1')).toBe('Skipper');
    expect(displayName(seed, 'sp2', 'u1')).toBe('Ada Okafor');
    expect(displayName(seed, 'sp1', 'u2')).toBe('Bea Quist');
  });

  it('merges nicks into the people map without touching other Spaces', () => {
    const merged = withNicks(seed, 'sp1');
    expect(merged.u1.name).toBe('Skipper');
    expect(merged.u1.i).toBe('AO');
    expect(merged.u2.name).toBe('Bea Quist');
    expect(seed.people.u1.name).toBe('Ada Okafor');
  });

  it('is empty when a Space has no messaging view', () => {
    expect(nicksIn(seed, 'nope')).toEqual({});
  });
});
