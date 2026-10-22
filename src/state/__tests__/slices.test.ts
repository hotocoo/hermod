import { describe, expect, it } from 'vitest';
import { SLICES, useAppStore } from '../store';

describe('store slices', () => {
  it('never define the same key twice (a later slice would silently replace the earlier one)', () => {
    const api = [useAppStore.setState, useAppStore.getState, useAppStore] as unknown as Parameters<(typeof SLICES)[number]>;
    const owner = new Map<string, number>(); const clashes: string[] = [];
    SLICES.forEach((make, i) => Object.keys(make(...api)).forEach((k) => { if (owner.has(k)) clashes.push(`${k} (slices ${owner.get(k)} and ${i})`); else owner.set(k, i); }));
    expect(clashes).toEqual([]);
  });
});
