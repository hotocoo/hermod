import { describe, expect, it } from 'vitest';
import { PLOTS, POND_POS, SIGN } from '@/config/scene';
import { COTTAGE, PLOT_IDS, RINGS, plotRadius } from './config';
import { edgeAt, generateVillagePlan, type VillageInput, type VillagePlan } from './plan';
import { inPoly, polyDist, obbOverlap } from '../../site/geo';

const all3 = Object.fromEntries(PLOT_IDS.map((s) => [s, 3]));
const houses = (n: number) => Array.from({ length: n }, (_, i) => ({ user_id: 'u' + i, plot_index: i }));
const input = (tier: number, extra: Partial<VillageInput> = {}): VillageInput => ({ seed: 'ashgrove', tier, levels: all3, houses: houses(70), ...extra });

function reach(plan: VillagePlan): Set<string> {
  const adj = new Map<string, string[]>(); plan.nodes.forEach((n) => adj.set(n.id, []));
  plan.edges.forEach((e) => { adj.get(e.a)?.push(e.b); adj.get(e.b)?.push(e.a); });
  const seen = new Set<string>(['plaza']); const st = ['plaza'];
  while (st.length) for (const n of adj.get(st.pop()!) ?? []) if (!seen.has(n)) { seen.add(n); st.push(n); }
  return seen;
}
const key = (p: VillagePlan) => ({
  nodes: new Map(p.nodes.map((n) => [n.id, JSON.stringify(n)])), edges: new Map(p.edges.map((e) => [e.id, JSON.stringify(e)])),
  cottages: new Map(p.cottages.map((c) => [c.userId, JSON.stringify(c)])), areas: new Map(p.areas.map((a) => [a.id, JSON.stringify(a)])),
});

describe('village plan', () => {
  it('is deterministic', { timeout: 30_000 }, () => {
    for (let t = 1; t <= 5; t++) expect(JSON.stringify(generateVillagePlan(input(t)))).toBe(JSON.stringify(generateVillagePlan(input(t))));
    expect(JSON.stringify(generateVillagePlan(input(3)))).not.toBe(JSON.stringify(generateVillagePlan(input(3, { seed: 'other' }))));
  });
  it('keeps plots, signpost and pond exactly where the config puts them', () => {
    const p = generateVillagePlan(input(1));
    for (const id of PLOT_IDS) { expect(p.plots[id].x).toBe(PLOTS[id].x); expect(p.plots[id].z).toBe(PLOTS[id].z); expect(p.plots[id].yaw).toBe(Math.atan2(-PLOTS[id].x, -PLOTS[id].z)); }
    expect(p.sign.x).toBe(SIGN.x); expect(p.sign.z).toBe(SIGN.z);
    const pond = p.waters.find((w) => w.id === 'pond')!; expect([pond.x, pond.z]).toEqual([POND_POS.x, POND_POS.z]);
    expect(p.cameras.home.dist).toBe(46);
  });
  it('tier n is a subset of tier n+1 (ids and geometry)', () => {
    for (let t = 1; t < 5; t++) {
      const a = key(generateVillagePlan(input(t))), b = key(generateVillagePlan(input(t + 1)));
      for (const f of ['nodes', 'edges', 'cottages', 'areas'] as const) for (const [id, v] of a[f]) expect(b[f].get(id), `${f} ${id} tier ${t}`).toBe(v);
    }
  });
  it('adds districts per tier', () => {
    const ids = (t: number) => generateVillagePlan(input(t)).areas.map((a) => a.id);
    expect(ids(1)).toContain('green'); expect(ids(1)).not.toContain('market'); expect(ids(2)).toContain('market'); expect(ids(3)).toContain('fish');
    expect(generateVillagePlan(input(3)).waters.some((w) => w.id === 'basin')).toBe(true); expect(generateVillagePlan(input(2)).waters.some((w) => w.id === 'basin')).toBe(false);
    { const p3 = generateVillagePlan(input(3)); expect(p3.inlet).not.toBeNull(); const inl = p3.waters.find((w) => w.id === 'inlet')!; const far = Math.max(...inl.poly.map((q) => Math.hypot(q.x, q.z))); const rim = edgeAt(p3.edge, inl.x, inl.z); expect(far).toBeGreaterThan(rim - 0.1); expect(generateVillagePlan(input(2)).inlet).toBeNull(); }
    expect(generateVillagePlan(input(4)).stream).not.toBeNull(); expect(ids(5)).toContain('festival');
    expect(generateVillagePlan(input(5)).placements.some((q) => q.kind === 'lighthouse')).toBe(true);
  });
  it('connects every door, area, harbour and cottage to the plaza', () => {
    for (let t = 1; t <= 5; t++) {
      const p = generateVillagePlan(input(t)); const r = reach(p);
      for (const n of p.nodes) expect(r.has(n.id), `node ${n.id} tier ${t}`).toBe(true);
      for (const id of PLOT_IDS) expect(r.has('door:' + id)).toBe(true);
      expect(r.has('door:search') && r.has('door:pond')).toBe(true);
      for (const c of p.cottages) expect(r.has(c.node), c.node).toBe(true);
      for (const a of p.areas) expect(r.has(a.node), a.id).toBe(true);
      if (t >= 3) expect(r.has('quay:n')).toBe(true);
    }
  });
  it('has no cottage overlapping plots, water, the plaza or lanes, and keeps every item inside the coast', () => {
    for (let t = 1; t <= 5; t++) {
      const p = generateVillagePlan(input(t)); expect(p.cottages.length).toBeGreaterThanOrEqual(t === 1 ? 5 : 10);
      for (const c of p.cottages) {
        for (const id of PLOT_IDS) expect(Math.hypot(c.x - PLOTS[id].x, c.z - PLOTS[id].z), `${c.userId} vs ${id}`).toBeGreaterThan(plotRadius(id) + 0.6);
        for (const w of p.waters) expect(inPoly(c, w.poly), c.userId + ' in ' + w.id).toBe(false);
        expect(Math.hypot(c.x, c.z)).toBeGreaterThan(p.plaza.r + 1);
        for (const e of p.edges) if (e.kind !== 'plaza' && e.kind !== 'spur') expect(polyDist(c, e.pts), `${c.userId} vs ${e.id}`).toBeGreaterThan(COTTAGE.hd * 1.1 + e.w / 2 - 0.05);
        expect(Math.hypot(c.x, c.z)).toBeLessThan(edgeAt(p.edge, c.x, c.z) - 1.0);
        for (const d of p.cottages) if (d !== c) expect(obbOverlap({ x: c.x, z: c.z, hw: COTTAGE.hw, hd: COTTAGE.hd, yaw: c.yaw }, { x: d.x, z: d.z, hw: COTTAGE.hw, hd: COTTAGE.hd, yaw: d.yaw })).toBe(false);
      }
      for (const n of p.nodes) expect(Math.hypot(n.x, n.z), n.id).toBeLessThan(edgeAt(p.edge, n.x, n.z) + 0.01);
      for (const a of p.areas) expect(Math.hypot(a.x, a.z) + a.r, a.id).toBeLessThan(edgeAt(p.edge, a.x, a.z));
      for (const q of p.placements) if (q.kind !== 'lighthouse') expect(Math.hypot(q.x, q.z), `${q.kind}`).toBeLessThan(edgeAt(p.edge, q.x, q.z) + 0.2);
      for (const w of p.walls) for (const q of w.pts) expect(Math.hypot(q.x, q.z)).toBeLessThan(edgeAt(p.edge, q.x, q.z));
    }
  });
  it('respects ring capacity and reports omitted houses', () => {
    const cap = RINGS.reduce((s, r) => s + r.cap, 0); const p = generateVillagePlan(input(5, { houses: houses(cap + 10) }));
    expect(p.cottages.length + p.omittedHouses).toBe(cap + 10);
  });
});
