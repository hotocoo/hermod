/**
 * Lived-in layer of the sanctuary plan: props, stepping stones, harbour, ground cover and cottage variants.
 * Pure and deterministic. Everything is placed against static features only (never against tier dependent ones), so a tier n
 * scene is a subset of tier n+1 with identical positions.
 */
import { rng } from '../rng';
import { COVER, COTTAGE_VARIANTS, DECOR_R, DECOR_SPECS, HARBOR, RIVERS, STEP_STONES, TEMENOS, TIER_RADIUS, type DecorKind, type DecorSpec, type V2 } from './config';
import { along, hyp, inPoly, obbDist, polyDist, polyLen, spline, type Obb } from './geo';

export interface SiteDecor { id: string; kind: DecorKind; x: number; z: number; yaw: number; s: number; tier: number }
export interface SiteCover { kind: 'flowers' | 'thyme' | 'grass'; x: number; z: number; s: number; yaw: number; tier: number }
export interface DecorInput {
  seed: string;
  /** Tier independent: all master obstacles including the xystos. */
  obstacles: readonly Obb[];
  /** Static path polylines (all tiers) with half widths. */
  lines: readonly { pts: readonly V2[]; hw: number }[];
  /** Every quarter slot of every ring. */
  slots: readonly V2[];
  plaza: { x: number; z: number; r: number };
  /** Coast of tier t (index t-1). */
  edges: readonly (readonly number[])[];
  edgeAt: (edge: readonly number[], x: number, z: number) => number;
  /** Planned landmarks that exist at some tier (centre + radius) so ground cover stays off them. */
  landmarks: readonly Obb[];
  /** Override the spec list (tests). */
  specs?: readonly DecorSpec[];
}
const q = (n: number): number => Math.round(n * 1000) / 1000;
export const hashStr = (s: string): number => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
/** Cottage variant, awning and garden flags for a member (stable per user id). */
export function cottageStyle(userId: string): { variant: number; awning: boolean; garden: boolean } {
  const h = hashStr(userId); return { variant: h % COTTAGE_VARIANTS, awning: ((h >>> 5) & 3) === 0, garden: ((h >>> 8) & 3) < 2 };
}

const AXIS_HALF = 1.6;

export function buildDecor(inp: DecorInput): { decor: SiteDecor[]; cover: SiteCover[] } {
  const R = rng(inp.seed + 'decor'); const out: SiteDecor[] = [];
  const edgeOf = (tier: number) => inp.edges[tier - 1];
  const insideIsland = (p: V2, tier: number, pad: number) => hyp(p, { x: 0, z: 0 }) < inp.edgeAt(edgeOf(tier), p.x, p.z) - pad;
  const free = (p: V2, kind: DecorKind, tier: number, zone: 'inside' | 'out' | 'coast'): boolean => {
    const r = DECOR_R[kind];
    if (!insideIsland(p, tier, zone === 'coast' ? 0.15 + r * 0.5 : 0.5 + r * 0.5)) return false;
    const inT = inPoly(p, TEMENOS.poly);
    if (zone === 'inside' && (!inT || polyDist(p, TEMENOS.poly, true) < 0.7 + r)) return false;
    if (zone !== 'inside' && (inT || polyDist(p, TEMENOS.poly, true) < 0.9 + r)) return false;
    if (Math.abs(p.x) < AXIS_HALF && p.z > -1 && p.z < 11) return false;
    if (inp.obstacles.some((o) => obbDist(o, p) < r * 0.4 + 0.1)) return false;
    if (inp.lines.some((l) => polyDist(p, l.pts) < l.hw + r * 0.6 + 0.05)) return false;
    if (RIVERS.some((rv) => polyDist(p, rv.pts) < rv.w / 2 + r + 0.5)) return false;
    if (hyp(p, inp.plaza) < inp.plaza.r + 0.5 + r) return false;
    if (inp.slots.some((s) => hyp(p, s) < (zone === 'coast' ? 0.9 : 1.5) + r * 0.5)) return false;
    if (out.some((d) => hyp(p, d) < DECOR_R[d.kind] + r)) return false;
    return true;
  };
  const yawFor = (mode: 'face' | 'free' | 'axis' | undefined, p: V2): number => {
    if (mode === 'face') return Math.atan2(-p.x, -(p.z - 3.0)); // toward the hearth
    if (mode === 'axis') return Math.round(R() * 2) * (Math.PI / 2);
    return R() * Math.PI * 2;
  };
  (inp.specs ?? DECOR_SPECS).forEach((sp, si) => {
    let placed = 0;
    for (let t = 0; t < 240 && placed < sp.n; t++) {
      let c: V2;
      if (sp.zone === 'coast') {
        const a = sp.at.x + (R() - 0.5) * 2 * (sp.spread / 8); const e = inp.edgeAt(edgeOf(sp.tier), Math.cos(a), Math.sin(a)); const rr = e - sp.at.z - R() * 0.5;
        c = { x: Math.cos(a) * rr, z: Math.sin(a) * rr };
      } else { const a = R() * Math.PI * 2, d = Math.sqrt(R()) * sp.spread; c = { x: sp.at.x + Math.cos(a) * d, z: sp.at.z + Math.sin(a) * d }; }
      if (!free(c, sp.kind, sp.tier, sp.zone)) continue;
      const sr = sp.s ? sp.s[0] + R() * (sp.s[1] - sp.s[0]) : 0.92 + R() * 0.16;
      out.push({ id: `${sp.kind}:${si}:${placed}`, kind: sp.kind, x: q(c.x), z: q(c.z), yaw: q(yawFor(sp.yaw, c)), s: q(sr), tier: sp.tier }); placed++;
    }
  });

  // stepping stones across the kladeos
  const kl = RIVERS.find((r) => r.id === STEP_STONES.river);
  if (kl) {
    const line = spline(kl.pts, 8); const len = polyLen(line);
    STEP_STONES.at.forEach((f, i) => {
      const a = along(line, f * len); const nx = Math.cos(a.yaw), nz = -Math.sin(a.yaw);
      for (let k = 0; k < STEP_STONES.span; k++) { const o = ((k - (STEP_STONES.span - 1) / 2) * (kl.w + 0.9)) / (STEP_STONES.span - 1) * 1.0; out.push({ id: `step:${i}:${k}`, kind: 'step_stone', x: q(a.x + nx * o + (R() - 0.5) * 0.1), z: q(a.z + nz * o + (R() - 0.5) * 0.1), yaw: q(R() * 6.28), s: q(0.9 + R() * 0.3), tier: STEP_STONES.tier }); }
    });
  }

  // harbour (tier 5 coast): mole along the arc, boats, huts, quay props
  {
    const e5 = edgeOf(HARBOR.tier); const [a0, a1] = HARBOR.arc; const pts: V2[] = [];
    for (let i = 0; i <= 24; i++) { const a = a0 + ((a1 - a0) * i) / 24; const e = inp.edgeAt(e5, Math.cos(a), Math.sin(a)) + HARBOR.moleOut; pts.push({ x: Math.cos(a) * e, z: Math.sin(a) * e }); }
    const len = polyLen(pts); const n = Math.floor(len / HARBOR.moleStep);
    for (let i = 0; i < n; i++) { const p = along(pts, (i + 0.5) * HARBOR.moleStep); out.push({ id: `mole:${i}`, kind: 'mole_seg', x: q(p.x), z: q(p.z), yaw: q(p.yaw), s: 1, tier: HARBOR.tier }); }
    const inside = (a: number, off: number): V2 => { const e = inp.edgeAt(e5, Math.cos(a), Math.sin(a)) + off; return { x: Math.cos(a) * e, z: Math.sin(a) * e }; };
    for (let i = 0; i < HARBOR.boats; i++) { const a = a0 + 0.25 + ((a1 - a0 - 0.5) * (i + R() * 0.4)) / HARBOR.boats; const p = inside(a, 0.9 + R() * 0.6); out.push({ id: `boat:${i}`, kind: i % 2 ? 'boat_b' : 'boat_a', x: q(p.x), z: q(p.z), yaw: q(Math.atan2(Math.cos(a), Math.sin(a)) + (R() - 0.5) * 0.5), s: q(0.9 + R() * 0.2), tier: HARBOR.tier }); }
    HARBOR.huts.forEach((h, i) => { const a = Math.PI / 2 + h.x * 0.1; const p = inside(a, -2.4 - R() * 0.5); out.push({ id: `hut:${i}`, kind: 'hut', x: q(p.x), z: q(p.z), yaw: q(Math.atan2(-p.x, -p.z)), s: 1, tier: HARBOR.tier }); });
    for (let i = 0; i < HARBOR.quayProps; i++) { const a = a0 + 0.3 + R() * (a1 - a0 - 0.6); const p = inside(a, -0.9 - R() * 0.6); const kinds: DecorKind[] = ['amphora_stack', 'net_rack', 'bollard', 'woodpile']; const k = kinds[i % kinds.length]; if (Math.abs(p.x) > 2.6 && !inp.lines.some((l) => polyDist(p, l.pts) < l.hw + 0.5) && !inp.obstacles.some((o) => obbDist(o, p) < 1) && !out.some((d) => hyp(p, d) < DECOR_R[d.kind] + DECOR_R[k])) out.push({ id: `quay:${i}`, kind: k, x: q(p.x), z: q(p.z), yaw: q(R() * 6.28), s: q(0.95 + R() * 0.15), tier: HARBOR.tier }); }
  }

  // ground cover: wildflower banks, thyme on the dry hill, grass clumps along walls; keeps off paths, buildings, quarter slots
  const cover: SiteCover[] = []; const Rc = rng(inp.seed + 'cover'); const capMax = COVER.cap[COVER.cap.length - 1];
  for (let t = 0; cover.length < capMax && t < capMax * 14; t++) {
    const a = Rc() * Math.PI * 2, rr = (COVER.inner + Rc() * (1 - COVER.inner)) * TIER_RADIUS[0] * (1 + Rc() * 0.7); const p = { x: Math.cos(a) * rr, z: Math.sin(a) * rr };
    const tier = 1 + Math.min(4, Math.floor(Math.max(0, hyp(p, { x: 0, z: 0 }) - TIER_RADIUS[0] * 0.6) / 2.4) + (Rc() < 0.25 ? 1 : 0)); const tt = Math.min(5, tier);
    if (!insideIsland(p, tt, 1.0)) continue; if (inPoly(p, TEMENOS.poly) && Rc() < 0.8) continue; if (Math.abs(p.x) < AXIS_HALF && p.z > -1 && p.z < 11) continue;
    if (inp.obstacles.some((o) => obbDist(o, p) < 0.5) || inp.landmarks.some((o) => obbDist(o, p) < 0.5)) continue;
    if (inp.lines.some((l) => polyDist(p, l.pts) < l.hw + 0.3)) continue; if (RIVERS.some((rv) => polyDist(p, rv.pts) < rv.w / 2 + 0.2)) continue;
    if (hyp(p, inp.plaza) < inp.plaza.r + 0.4 || inp.slots.some((s) => hyp(p, s) < 1.3) || out.some((d) => d.kind !== 'rock_c' && hyp(p, d) < DECOR_R[d.kind] * 0.9)) continue;
    const m = Rc(); cover.push({ kind: m < 0.4 ? 'flowers' : m < 0.65 ? 'thyme' : 'grass', x: q(p.x), z: q(p.z), s: q(0.8 + Rc() * 0.7), yaw: q(Rc() * 6.28), tier: tt });
  }
  // honour the per tier cap while keeping the subset property: keep the first `cap` entries of each tier cumulative
  const kept: SiteCover[] = []; const counts = [0, 0, 0, 0, 0, 0];
  for (const c of cover.sort((x, y) => x.tier - y.tier)) { let ok = true; for (let t = c.tier; t <= 5; t++) if (counts[t] >= COVER.cap[t - 1]) ok = false; if (!ok) continue; for (let t = c.tier; t <= 5; t++) counts[t]++; kept.push(c); }
  return { decor: out, cover: kept };
}
