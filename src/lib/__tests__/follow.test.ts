import { beforeEach, describe, expect, it } from 'vitest';
import { isFollowing, toggleFollow } from '../follow';

// Node has no localStorage; the storage helpers swallow the miss, so back it with a Map.
const store = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
};

describe('follow list (F-005, V-014)', () => {
  beforeEach(() => store.clear());

  it('toggles a host id on and off', () => {
    expect(isFollowing('host1')).toBe(false);
    toggleFollow('host1');
    expect(isFollowing('host1')).toBe(true);
    expect(isFollowing('host2')).toBe(false);
    toggleFollow('host1');
    expect(isFollowing('host1')).toBe(false);
  });
});
