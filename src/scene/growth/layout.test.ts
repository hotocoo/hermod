import { describe, expect, it } from 'vitest';
import { GROWTH } from '@/config/scene';
import { layoutIsland, resolveGrowth } from './layout';

const SECTIONS = ['chat', 'feed', 'board'] as const;
const growthFor = (tier: number) => ({
  members: 3, active7d: 2, tier, radius: GROWTH.coreRadiusByTier[tier - 1],
  houses: [{ user_id: 'u0', plot_index: 0 }, { user_id: 'u1', plot_index: 1 }, { user_id: 'u2', plot_index: 2 }],
  buildings: { chat: 3, feed: 2 },
});

describe('island growth reaches the scene plan (T-002)', () => {
  it('gives every core tier radius its own, strictly growing scene radius within the clamp', () => {
    const radii = [1, 2, 3, 4, 5].map((t) => resolveGrowth(growthFor(t), SECTIONS).radius);
    for (let i = 1; i < radii.length; i++) expect(radii[i]).toBeGreaterThan(radii[i - 1]);
    expect(radii[0]).toBe(GROWTH.minRadius);
    expect(radii[4]).toBe(GROWTH.maxRadius);
  });
  it('carries tier, building levels and member cottages into the island layout', () => {
    const state = resolveGrowth(growthFor(4), SECTIONS);
    expect(state.levels.chat).toBe(3);
    expect(state.levels.feed).toBe(2);
    expect(state.levels.board).toBe(1);
    const lay = layoutIsland('ashgrove', state);
    expect(lay.tier).toBe(4);
    expect(lay.R).toBe(state.radius);
    expect(lay.houses.map((h) => h.userId).sort()).toEqual(['u0', 'u1', 'u2']);
  });
});
