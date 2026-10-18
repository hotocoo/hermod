import { describe, expect, it } from 'vitest';
import { PLOT_IDS } from './config';
import { generateVillagePlan } from './plan';
import { groupPlacements } from './placements';

const all3 = Object.fromEntries(PLOT_IDS.map((s) => [s, 3]));
const plan = generateVillagePlan({ seed: 'ashgrove', tier: 5, levels: all3, houses: Array.from({ length: 70 }, (_, i) => ({ user_id: 'u' + i, plot_index: i })) });

describe('hedge runs', () => {
  const runs = plan.walls.filter((w) => w.kind === 'hedge');
  const hedges = groupPlacements(plan, () => 0).filter((g) => /\/hedge_\d\.glb$/.test(g.url)).flatMap((g) => g.list);

  it('plan has hedge runs', () => expect(runs.length).toBeGreaterThan(0));
  it('lays one hedge per 1.1 units along every run, long axis along the run', () => {
    const total = runs.reduce((s, w) => s + w.pts.slice(1).reduce((a, p, i) => a + Math.hypot(p.x - w.pts[i].x, p.z - w.pts[i].z), 0), 0);
    expect(hedges.length).toBeGreaterThanOrEqual(Math.floor(total / 1.1));
    expect(hedges.length).toBeLessThanOrEqual(Math.ceil(total / 1.1) + runs.length * 2);
    for (const h of hedges) expect(Number.isFinite(h.yaw) && Number.isFinite(h.x) && Number.isFinite(h.z)).toBe(true);
  });
  it('every placement sits on a run', () => {
    for (const h of hedges) expect(Math.min(...runs.flatMap((w) => w.pts.map((p) => Math.hypot(p.x - h.x, p.z - h.z))))).toBeLessThan(1.2);
  });
});
