import { describe, expect, it } from 'vitest';
import { QUARTER, SITE_SECTIONS, type SiteSectionId } from './config';
import { edgeAt, generateSitePlan, type SiteInput, type SitePlan } from './plan';
import { hyp, inPoly, obbContains, obbOverlap, polyDist, type Obb } from './geo';
import { TEMENOS } from './config';

const all3 = Object.fromEntries(SITE_SECTIONS.map((s) => [s, 3])) as Record<SiteSectionId, number>;
const houses = (n: number) => Array.from({ length: n }, (_, i) => ({ user_id: 'u' + i, plot_index: i }));
const input = (tier: number, extra: Partial<SiteInput> = {}): SiteInput => ({ seed: 'ashgrove', tier, levels: all3, houses: houses(40), ...extra });
const obb = (p: { x: number; z: number; fw: number; fd: number; yaw: number }): Obb => ({ x: p.x, z: p.z, hw: p.fw / 2, hd: p.fd / 2, yaw: p.yaw });

function connected(plan: SitePlan): Set<string> {
  const adj = new Map<string, string[]>(); plan.nodes.forEach((n) => adj.set(n.id, []));
  plan.edges.forEach((e) => { adj.get(e.a)?.push(e.b); adj.get(e.b)?.push(e.a); });
  const seen = new Set<string>(['gate']); const stack = ['gate'];
  while (stack.length) { for (const n of adj.get(stack.pop()!) ?? []) if (!seen.has(n)) { seen.add(n); stack.push(n); } }
  return seen;
}

describe('site plan', () => {
  it('is deterministic', () => {
    for (let t = 1; t <= 5; t++) expect(JSON.stringify(generateSitePlan(input(t)))).toBe(JSON.stringify(generateSitePlan(input(t))));
    expect(JSON.stringify(generateSitePlan(input(3)))).not.toBe(JSON.stringify(generateSitePlan(input(3, { seed: 'other' }))));
  });
  it('places every raised section, inside the temenos, even at tier 1', () => {
    for (let t = 1; t <= 5; t++) {
      const p = generateSitePlan(input(t));
      for (const id of SITE_SECTIONS) {
        const pl = p.plots[id]; expect(pl.raised).toBe(true);
        expect(inPoly(pl, TEMENOS.poly)).toBe(true);
        expect(hyp(pl, { x: 0, z: 0 })).toBeLessThan(edgeAt(p.edge, pl.x, pl.z) - 1);
      }
    }
    expect(generateSitePlan({ seed: 'a', tier: 1, levels: {} }).plots.chat.raised).toBe(false);
  });
  it('has no overlapping plots, landmarks or cottages (even at max level)', () => {
    for (let t = 1; t <= 5; t++) {
      const p = generateSitePlan(input(t)); const boxes = [...p.plotList.map((pl) => ({ id: pl.id, o: obb(pl) })), ...p.landmarks.filter((l) => l.kind !== 'propylon').map((l) => ({ id: l.id, o: { x: l.x, z: l.z, hw: l.w / 2, hd: l.d / 2, yaw: l.yaw } }))];
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(obbOverlap(boxes[i].o, boxes[j].o), boxes[i].id + ' x ' + boxes[j].id).toBe(false);
      for (const c of p.cottages) {
        const co = { x: c.x, z: c.z, hw: QUARTER.cottage.w / 2, hd: QUARTER.cottage.d / 2, yaw: c.yaw };
        for (const b of boxes) expect(obbOverlap(co, b.o), 'cottage ' + c.plotIndex + ' x ' + b.id).toBe(false);
        expect(p.plotList.some((pl) => obbContains(obb(pl), c))).toBe(false);
        expect(hyp(c, { x: 0, z: 0 })).toBeLessThan(edgeAt(p.edge, c.x, c.z) - 0.9);
      }
      for (let i = 0; i < p.cottages.length; i++) for (let j = i + 1; j < p.cottages.length; j++) expect(hyp(p.cottages[i], p.cottages[j])).toBeGreaterThan(2.2);
    }
  });
  it('connects every plot, landmark door and cottage to the gate', () => {
    for (let t = 1; t <= 5; t++) {
      const p = generateSitePlan(input(t)); const seen = connected(p);
      for (const pl of p.plotList) expect(seen.has(pl.node), pl.id + ' tier ' + t).toBe(true);
      for (const c of p.cottages) expect(seen.has(c.node), c.node + ' tier ' + t).toBe(true);
      for (const n of p.nodes) expect(seen.has(n.id), n.id + ' tier ' + t).toBe(true);
    }
  });
  it('places most members once the island has a quarter ring', () => {
    for (let t = 3; t <= 5; t++) { const p = generateSitePlan(input(t, { houses: houses(12) })); expect(p.cottages.length, 'tier ' + t).toBeGreaterThanOrEqual(8); }
  });
  it('grows monotonically: tier n is a subset of tier n+1 with identical positions', () => {
    for (let t = 1; t < 5; t++) {
      const a = generateSitePlan(input(t)), b = generateSitePlan(input(t + 1));
      for (const id of SITE_SECTIONS) expect(a.plots[id]).toEqual(b.plots[id]);
      const bl = new Map(b.landmarks.map((l) => [l.id, l] as const)); a.landmarks.forEach((l) => expect(bl.get(l.id)).toEqual(l));
      const bc = new Map(b.cottages.map((c) => [c.plotIndex, c] as const)); a.cottages.forEach((c) => expect(bc.get(c.plotIndex)).toEqual(c));
      const be = new Set(b.edges.map((e) => e.id)); a.edges.filter((e) => e.id !== 'landing-shore' && !e.id.startsWith('cottage:') && !e.id.startsWith('landing-r:') && !e.id.startsWith('door:hostel')).forEach((e) => expect(be.has(e.id), e.id).toBe(true));
      expect(b.cottages.length).toBeGreaterThanOrEqual(a.cottages.length); expect(b.capacity).toBeGreaterThanOrEqual(a.capacity);
      expect(b.R).toBeGreaterThan(a.R);
    }
  });
  it('adds the rings in order: altar+stoa+gate, terrace, river, stadium, harbor', () => {
    const k = (t: number) => { const p = generateSitePlan(input(t)); return { temple: p.landmarks.some((l) => l.kind === 'temple'), river: p.rivers.length, stadium: p.landmarks.some((l) => l.kind === 'stadium'), piers: p.piers.length }; };
    expect(k(1)).toEqual({ temple: false, river: 0, stadium: false, piers: 0 });
    expect(k(2).temple).toBe(true); expect(k(2).river).toBe(0);
    expect(k(3).river).toBe(2); expect(k(3).stadium).toBe(false);
    expect(k(4).stadium).toBe(true); expect(k(4).piers).toBe(1);
    expect(k(5).piers).toBe(3);
  });
  it('keeps the axis clear of trees and reports quarter capacity', () => {
    for (let t = 1; t <= 5; t++) { const p = generateSitePlan(input(t)); expect(p.trees.some((tr) => Math.abs(tr.x) < 1.8 && tr.z > -1 && tr.z < 11)).toBe(false); expect(p.capacity).toBeGreaterThan(0); }
  });
  it('nests the lived-in layer: decor and cover at tier n reappear unchanged at tier n+1', () => {
    for (let t = 1; t < 5; t++) {
      const a = generateSitePlan(input(t)), b = generateSitePlan(input(t + 1));
      const bd = new Map(b.decor.map((d) => [d.id, d] as const)); a.decor.forEach((d) => expect(bd.get(d.id), d.id).toEqual(d));
      const bc = new Set(b.cover.map((c) => `${c.x},${c.z}`)); a.cover.forEach((c) => expect(bc.has(`${c.x},${c.z}`)).toBe(true));
    }
  });
  it('keeps decor off buildings, paths and rivers and inside the island', () => {
    for (const t of [1, 3, 5]) {
      const p = generateSitePlan(input(t)); const obbs = [...p.plotList.map((pl) => obb(pl)), ...p.landmarks.map((l) => ({ x: l.x, z: l.z, hw: l.w / 2, hd: l.d / 2, yaw: l.yaw }))];
      for (const d of p.decor) {
        if (d.kind === 'step_stone' || d.kind === 'mole_seg') continue;
        for (const o of obbs) expect(obbOverlap({ x: d.x, z: d.z, hw: 0.05, hd: 0.05, yaw: 0 }, o), d.id).toBe(false);
        for (const e of p.edges) if (e.kind !== 'bridge' && !e.id.startsWith('cottage:')) expect(polyDist(d, e.pts), d.id + ' on ' + e.id).toBeGreaterThan(e.w / 2 * 0.5);
        if (d.kind !== 'boat_a' && d.kind !== 'boat_b') expect(hyp(d, { x: 0, z: 0 }), d.id).toBeLessThan(edgeAt(p.edge, d.x, d.z) + 3);
      }
    }
  });
  it('has props at tier 1 and a harbour, xystos and market only when the tier allows', () => {
    const kinds = (t: number) => new Set(generateSitePlan(input(t)).decor.map((d) => d.kind));
    expect(kinds(1).has('well')).toBe(true); expect(kinds(1).has('boat_a')).toBe(false); expect(kinds(4).has('boat_a')).toBe(false); expect(kinds(5).has('boat_a')).toBe(true);
    expect(kinds(3).has('stall')).toBe(true); expect(kinds(2).has('stall')).toBe(false); expect(kinds(3).has('step_stone')).toBe(true);
    expect(generateSitePlan(input(3)).landmarks.some((l) => l.kind === 'xystos')).toBe(false); expect(generateSitePlan(input(4)).landmarks.some((l) => l.kind === 'xystos')).toBe(true);
    for (const c of generateSitePlan(input(5)).cottages) { expect(c.variant).toBeGreaterThanOrEqual(0); expect(c.variant).toBeLessThan(6); }
  });
});
