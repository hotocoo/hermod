/**
 * Pure, deterministic plan for one Space's village island (organic lanes, greens, market square, harbour lagoon, craft quarter, festival green).
 * Same input -> same plan (JSON equal). The full topology (every tier) is generated once from the seed; the requested tier only filters it,
 * so tier n is a subset of tier n+1 (ids and geometry equal) except coast-bound items (coast wobble, lobes), which follow that tier's coast.
 * Section plots, signpost and pond sit exactly where src/config/scene.ts puts them.
 */
import { fbm } from '../../noise';
import { rng } from '../../rng';
import { clamp, hyp, polyDist, polyLen, segDist, along, spline } from '../../site/geo';
import type { SectionId } from '@/lib/data/types';
import {
  AREAS, BASIN, BEACHES, CAMERAS, COAST, COTTAGE, DOOR_DIST, HAMLETS, HILLS, LANE_PROPS, LOBES, MAX_TIER, PLAZA, PLOTS, PLOT_IDS, POND, RING, RINGS, SIGNPOST, STREAM, TIER_R, TREES, plotRadius, plotYaw,
  type AreaKind, type V2,
} from './config';

export interface VillageInput {
  seed: string;
  /** Island tier 1..5. */
  tier: number;
  /** Level per section 0..3 (0 or missing: empty foundation). */
  levels: Partial<Record<SectionId, number>>;
  houses: readonly { user_id: string; plot_index: number }[];
  /** 0 spring, 1 summer, 2 autumn, 3 winter; the caller derives it from the date. */
  season?: number;
}
export interface VPlot { id: SectionId; x: number; z: number; yaw: number; level: number; raised: boolean; door: V2; node: string }
export interface VNode { id: string; x: number; z: number; tier: number }
export type VEdgeKind = 'spoke' | 'link' | 'lane' | 'quay' | 'bridge' | 'spur' | 'plaza';
export interface VEdge { id: string; a: string; b: string; kind: VEdgeKind; w: number; pts: V2[]; tier: number }
export interface VArea { id: string; kind: AreaKind; x: number; z: number; r: number; tier: number; yaw: number; w: number; d: number; node: string }
export interface VCottage { userId: string; plotIndex: number; ring: number; x: number; z: number; yaw: number; scale: number; variant: number; door: V2; node: string; tier: number }
export interface VWall { id: string; kind: 'wall' | 'hedge'; pts: V2[]; tier: number }
export interface VBridge { id: string; x: number; z: number; yaw: number; len: number; w: number; tier: number }
export interface VWater { id: string; kind: 'pond' | 'basin' | 'millpond'; x: number; z: number; poly: V2[]; tier: number }
export interface VPlacement { kind: string; variant: number; x: number; z: number; yaw: number; scale: number; tier: number; /** season tint index for planting; lit lamps etc. */ tint?: number; lit?: boolean }
/** Harbour inlet: the lagoon opens onto the island edge; its water spills over the rim (a waterfall, the island floats). */
export interface VInlet { mouth: V2; dir: V2; width: number }
export interface VillagePlan {
  inlet: VInlet | null;
  seed: string; tier: number; season: number; R: number;
  /** Coast radius at evenly spaced angles from -pi (length COAST.samples). */
  edge: number[];
  plots: Record<SectionId, VPlot>; plotList: VPlot[];
  plaza: { x: number; z: number; r: number }; sign: V2 & { yaw: number; node: string };
  nodes: VNode[]; edges: VEdge[]; areas: VArea[]; cottages: VCottage[]; omittedHouses: number; capacity: number;
  waters: VWater[]; stream: { w: number; pts: V2[] } | null; bridges: VBridge[];
  walls: VWall[]; hills: { id: string; x: number; z: number; r: number; h: number }[];
  beaches: { id: string; a0: number; a1: number }[];
  placements: VPlacement[];
  cameras: Record<string, { az: number; el: number; dist: number; target: readonly [number, number, number] }>;
}

const N = COAST.samples, ANG0 = -Math.PI, TAU = Math.PI * 2;
export function edgeAt(edge: readonly number[], x: number, z: number): number {
  const t = ((Math.atan2(z, x) - ANG0) / TAU) * N; const i = Math.floor(t) % N, f = t - Math.floor(t);
  return edge[i] * (1 - f) + edge[(i + 1) % N] * f;
}
const angDiff = (a: number, b: number) => { let d = a - b; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return d; };
export function makeEdge(seed: string, tier: number): number[] {
  const Rn = rng('vedge' + seed); const ox = Rn() * 40, oz = Rn() * 40; const base = TIER_R[tier - 1], amp = COAST.amp[tier - 1] ?? 0;
  return Array.from({ length: N }, (_, i) => {
    const a = ANG0 + (i / N) * TAU;
    let r = base * (amp <= 0 ? 1 : clamp(1 + amp * 2.1 * fbm(Math.cos(a) * 1.4 + ox, 0.5, Math.sin(a) * 1.4 + oz, 3), COAST.min, 1.12));
    for (const l of LOBES) if (l.tier <= tier) { const d = angDiff(a, l.a) / l.w; r += l.k * Math.exp(-d * d); }
    return r;
  });
}
/** First tier whose guaranteed coast (smallest wobble, no lobes) encloses a disc; 6 when none. */
export function tierFor(x: number, z: number, r: number, margin: number = COAST.margin): number {
  const d = Math.hypot(x, z) + r + margin;
  for (let t = 1; t <= MAX_TIER; t++) if (d <= TIER_R[t - 1] * COAST.min) return t;
  return 6;
}

const front = (yaw: number): V2 => ({ x: Math.sin(yaw), z: Math.cos(yaw) });
const slotOf = (idx: number): { ring: number; slot: number; cap: number } | null => {
  let i = idx; for (let r = 0; r < RINGS.length; r++) { if (i < RINGS[r].cap) return { ring: r, slot: i, cap: RINGS[r].cap }; i -= RINGS[r].cap; } return null;
};
/** Distance-to-axis test for the harbour inlet channel (centre line from the lagoon's seaward end outward, 14 units: longer than any rim distance). */
const INLET_AXIS = { x: BASIN.x + Math.cos(BASIN.yaw - 0.05) * (BASIN.a - 0.5), z: BASIN.z + Math.sin(BASIN.yaw - 0.05) * (BASIN.a - 0.5), dx: Math.cos(BASIN.yaw - 0.05), dz: Math.sin(BASIN.yaw - 0.05) };
const nearInlet = (p: V2, pad = 0): boolean => { const t = (p.x - INLET_AXIS.x) * INLET_AXIS.dx + (p.z - INLET_AXIS.z) * INLET_AXIS.dz; if (t < -0.5 || t > 14) return false; const d = Math.abs((p.x - INLET_AXIS.x) * -INLET_AXIS.dz + (p.z - INLET_AXIS.z) * INLET_AXIS.dx); return d < 1.0 + pad; };
const inEllipse = (p: V2, pad = 0): boolean => {
  const t = { x: -Math.sin(BASIN.yaw), z: Math.cos(BASIN.yaw) }, u = { x: Math.cos(BASIN.yaw), z: Math.sin(BASIN.yaw) };
  const dx = p.x - BASIN.x, dz = p.z - BASIN.z; const lx = (dx * t.x + dz * t.z) / (BASIN.a + pad), lz = (dx * u.x + dz * u.z) / (BASIN.b + pad); return lx * lx + lz * lz < 1;
};
const ellipsePts = (pad: number, n = 40): V2[] => {
  const t = { x: -Math.sin(BASIN.yaw), z: Math.cos(BASIN.yaw) }, u = { x: Math.cos(BASIN.yaw), z: Math.sin(BASIN.yaw) };
  return Array.from({ length: n }, (_, i) => { const a = (i / n) * TAU; const lx = Math.cos(a) * (BASIN.a + pad), lz = Math.sin(a) * (BASIN.b + pad); return { x: BASIN.x + t.x * lx + u.x * lz, z: BASIN.z + t.z * lx + u.z * lz }; });
};
const blob = (x: number, z: number, r: number, seed: string, n = 28): V2[] => { const Rn = rng(seed); const o = Rn() * 30; return Array.from({ length: n }, (_, i) => { const a = (i / n) * TAU; const k = 1 + 0.16 * fbm(Math.cos(a) * 1.3 + o, 0.3, Math.sin(a) * 1.3 + o, 2); return { x: x + Math.cos(a) * r * k, z: z + Math.sin(a) * r * k }; }); };

export function generateVillagePlan(input: VillageInput): VillagePlan {
  const tier = clamp(Math.round(input.tier) || 1, 1, MAX_TIER); const seed = input.seed; const season = ((input.season ?? 1) % 4 + 4) % 4;
  const R = rng('village' + seed); const edge = makeEdge(seed, tier);
  const nodes = new Map<string, VNode>(); const edges: VEdge[] = []; const adj = new Map<string, string[]>();
  const addNode = (id: string, x: number, z: number, t: number) => { if (!nodes.has(id)) { nodes.set(id, { id, x, z, tier: t }); adj.set(id, []); } return id; };
  const P = (id: string): VNode => nodes.get(id)!;
  const addEdge = (a: string, b: string, kind: VEdgeKind, w: number, pts: V2[], t: number, id = `${kind}:${a}>${b}`) => { edges.push({ id, a, b, kind, w, pts, tier: t }); adj.get(a)!.push(b); adj.get(b)!.push(a); };
  const route = (a: V2, b: V2, bend: number, via: readonly V2[] = []): V2[] => {
    const d = hyp(a, b) || 1; const nx = -(b.z - a.z) / d, nz = (b.x - a.x) / d; const m = { x: (a.x + b.x) / 2 + nx * bend, z: (a.z + b.z) / 2 + nz * bend };
    return spline([a, ...(via.length ? via : [m]), b], 5);
  };

  // plots, plaza, sign, pond: fixed
  const plotList: VPlot[] = PLOT_IDS.map((id) => {
    const p = PLOTS[id]; const yaw = plotYaw(p.x, p.z); const f = front(yaw); const lv = input.levels[id] ?? 0;
    return { id, x: p.x, z: p.z, yaw, level: lv, raised: lv > 0, door: { x: p.x + f.x * DOOR_DIST, z: p.z + f.z * DOOR_DIST }, node: 'door:' + id };
  });
  const plots = Object.fromEntries(plotList.map((p) => [p.id, p])) as Record<SectionId, VPlot>;
  const signYaw = plotYaw(SIGNPOST.x, SIGNPOST.z);
  addNode('plaza', PLAZA.x, PLAZA.z, 1);
  const hubs: { id: string; to: V2; door: V2 }[] = [];
  for (const p of plotList) { if (p.id === 'hearth') { addNode(p.node, p.door.x, p.door.z, 1); addEdge('plaza', p.node, 'plaza', 0, [P('plaza'), p.door], 1); continue; } hubs.push({ id: p.id, to: p, door: p.door }); }
  hubs.push({ id: 'search', to: SIGNPOST, door: { x: SIGNPOST.x - Math.sin(signYaw) * -1.3, z: SIGNPOST.z - Math.cos(signYaw) * -1.3 } });
  hubs.push({ id: 'pond', to: POND, door: { x: POND.x, z: POND.z - POND.r - 0.45 } });
  for (const h of hubs) {
    const d = Math.hypot(h.to.x, h.to.z); const u = { x: h.to.x / d, z: h.to.z / d }; const pe = { x: u.x * (PLAZA.r - 0.3), z: u.z * (PLAZA.r - 0.3) };
    addNode('pe:' + h.id, pe.x, pe.z, 1); addEdge('plaza', 'pe:' + h.id, 'plaza', 0, [P('plaza'), pe], 1);
    const nid = h.id === 'search' ? 'door:search' : h.id === 'pond' ? 'door:pond' : 'door:' + h.id; addNode(nid, h.door.x, h.door.z, 1);
    addEdge('pe:' + h.id, nid, 'spoke', 1.1, route(pe, h.door, (R() - 0.5) * 1.0), 1);
  }

  // areas
  const areas: VArea[] = AREAS.map((a) => ({ id: a.id, kind: a.kind, x: a.x, z: a.z, r: a.r, tier: Math.max(a.tier, tierFor(a.x, a.z, a.r, 0.8)), yaw: a.yaw ?? 0, w: a.w ?? a.r * 2, d: a.d ?? a.r * 2, node: 'area:' + a.id })).filter((a) => a.tier <= MAX_TIER);
  const basinTier = Math.max(BASIN.tier, tierFor(BASIN.x, BASIN.z, Math.max(BASIN.a, BASIN.b) + BASIN.quayGap + BASIN.quayW / 2, 0.5));
  const area = (id: string) => areas.find((a) => a.id === id);
  const dirTo = (from: V2, to: V2, dist: number): V2 => { const d = hyp(from, to) || 1; return { x: from.x + ((to.x - from.x) / d) * dist, z: from.z + ((to.z - from.z) / d) * dist }; };
  const link = (a: string, b: string, bend: number, w: number, t: number, kind: VEdgeKind = 'link', via: readonly V2[] = []) => addEdge(a, b, kind, w, route(P(a), P(b), bend, via), t);
  const peAt = (id: string, to: V2) => { const d = Math.hypot(to.x, to.z); const pe = { x: (to.x / d) * (PLAZA.r - 0.3), z: (to.z / d) * (PLAZA.r - 0.3) }; addNode('pe:' + id, pe.x, pe.z, 1); addEdge('plaza', 'pe:' + id, 'plaza', 0, [P('plaza'), pe], 1); };
  const mk = area('market'), gr = area('green'), fs = area('fish');
  if (gr) { peAt('green', gr); addNode('area:green', gr.x, gr.z, gr.tier); const e = dirTo(gr, { x: 0, z: 0 }, gr.r); addNode('in:green', e.x, e.z, gr.tier); link('pe:green', 'in:green', 0.2, 1.4, gr.tier); link('in:green', 'area:green', 0, 1.2, gr.tier, 'link'); }
  if (mk) { peAt('market', mk); addNode('area:market', mk.x, mk.z, mk.tier); const e = dirTo(mk, { x: 0, z: 0 }, mk.r); addNode('in:market', e.x, e.z, mk.tier); link('pe:market', 'in:market', -0.2, 1.5, mk.tier); link('in:market', 'area:market', 0, 1.3, mk.tier); }
  if (mk && fs) { addNode('area:fish', fs.x, fs.z, fs.tier); const s = { x: mk.x, z: mk.z + mk.r }; addNode('s:market', s.x, s.z, mk.tier); link('area:market', 's:market', 0, 1.2, mk.tier); const n = { x: fs.x, z: fs.z - fs.r }; addNode('n:fish', n.x, n.z, fs.tier); link('s:market', 'n:fish', 0.3, 1.2, fs.tier); link('n:fish', 'area:fish', 0, 1.1, fs.tier); }
  // harbour lagoon: quay ring + links
  const quayPts = ellipsePts(BASIN.quayGap + BASIN.quayW / 2, 48);
  {
    const q = [0, 12, 24, 36].map((i) => quayPts[i]); const names = ['quay:e', 'quay:s', 'quay:w', 'quay:n'];
    // ellipse local frame: i=0 tangent +, 12 radial + (seaward), 24 tangent -, 36 radial - (inland)
    names.forEach((n, k) => addNode(n, q[k].x, q[k].z, basinTier));
    for (let k = 0; k < 4; k++) addEdge(names[k], names[(k + 1) % 4], 'quay', BASIN.quayW, [...quayPts.slice(k * 12, k * 12 + 13), ...(k === 3 ? [quayPts[0]] : [])].slice(0, 13).map((p) => p), basinTier);
    if (fs) link('quay:w', 'area:fish', 0, 1.2, basinTier);
    link('quay:n', 'door:pond', -0.3, 1.3, basinTier, 'link', [{ x: 3.6, z: 7.5 }]);
  }

  // south-west avenue: the one radial gap wide enough between plots; nodes every ~3 units, each living from the tier whose coast reaches it
  {
    const a0 = 1.8; const pe = { x: Math.cos(a0) * (PLAZA.r - 0.3), z: Math.sin(a0) * (PLAZA.r - 0.3) }; addNode('pe:avenue', pe.x, pe.z, 1); addEdge('plaza', 'pe:avenue', 'plaza', 0, [P('plaza'), pe], 1);
    const tierAt = (r: number) => { for (let t = 1; t <= MAX_TIER; t++) if (r <= TIER_R[t - 1] * COAST.min - 1.3) return t; return 6; };
    const pts: V2[] = []; const o = R() * 20; for (let r = PLAZA.r - 0.3; r <= 18.6; r += 0.5) { const w = Math.sin(r * 0.35 + o) * 0.35; pts.push({ x: Math.cos(a0) * r - Math.sin(a0) * w, z: Math.sin(a0) * r + Math.cos(a0) * w }); }
    let prev = 'pe:avenue'; let from = 0;
    for (let i = 1; i < pts.length; i++) { const r = PLAZA.r - 0.3 + i * 0.5; const t = tierAt(r); if (t > MAX_TIER) break; if ((i - from) * 0.5 >= 3 || i === pts.length - 1 || tierAt(r + 0.5) !== t) { const id = addNode('avenue:' + i, pts[i].x, pts[i].z, t); const seg = pts.slice(from, i + 1); if (hyp(P(prev), pts[i]) > 0.2) { addEdge(prev, id, 'link', 1.2, [P(prev), ...seg.slice(1)], Math.max(t, P(prev).tier)); prev = id; from = i; } } }
  }
  // cottages (before ring lanes: lanes keep off them)
  const phase = RINGS.map((_, i) => rng(seed + 'ring' + i)() * TAU);
  const ringR = RINGS.map((r, k) => Math.min(r.r, TIER_R[k] * COAST.min - COAST.margin));
  const ringTier = RINGS.map((r, k) => (ringR[k] >= r.r - RING.maxShrink ? k + 1 : k + 2));
  const hamlets = HAMLETS.map((h) => ({ ...h, tier: Math.max(h.tier, tierFor(h.x, h.z, Math.max(h.w, h.d) / 2 + 0.6, 0.8)) }));
  const stream = STREAM.pts; const streamTier = STREAM.tier;
  const reservedCircles: { x: number; z: number; r: number }[] = [
    ...plotList.map((p) => ({ x: p.x, z: p.z, r: Math.max(3.3, plotRadius(p.id) + 0.5) })), { x: SIGNPOST.x, z: SIGNPOST.z, r: 2.6 }, { x: 0, z: 0, r: 3.2 }, { x: POND.x, z: POND.z, r: 3.7 },
    ...areas.map((a) => ({ x: a.x, z: a.z, r: a.r + 0.8 })), ...hamlets.map((h) => ({ x: h.x, z: h.z, r: Math.max(h.w, h.d) / 2 + 1.1 })),
  ];
  const cottages: VCottage[] = []; let omitted = 0; const seen = new Set<number>();
  const cottageFree = (x: number, z: number) => !reservedCircles.some((c) => Math.hypot(x - c.x, z - c.z) < c.r) && !inEllipse({ x, z }, BASIN.quayGap + BASIN.quayW + 1.3) && !nearInlet({ x, z }, 1.5) && polyDist({ x, z }, stream) > 2.2 && !cottages.some((c) => Math.hypot(c.x - x, c.z - z) < RING.houseClear)
    && !edges.some((e) => e.kind !== 'plaza' && polyDist({ x, z }, e.pts) < 1.5);
  [...input.houses].sort((a, b) => a.plot_index - b.plot_index).forEach((h) => {
    if (seen.has(h.plot_index)) return; seen.add(h.plot_index); const sl = slotOf(h.plot_index); if (!sl) { omitted++; return; }
    const t = ringTier[sl.ring]; if (t > MAX_TIER) { omitted++; return; }
    const base = ((sl.slot + (sl.ring % 2) * 0.5) / sl.cap) * TAU + phase[sl.ring]; const r = ringR[sl.ring]; const Rj = rng(seed + 'cot' + h.plot_index);
    for (let n = 0; n <= RING.nudgeTries * 3; n++) {
      const a = base + (n % 2 ? 1 : -1) * Math.ceil((n % (RING.nudgeTries + 1)) / 2) * RING.nudgeStep; const rr = r - Math.floor(n / (RING.nudgeTries + 1)) * 0.5; const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      if (!cottageFree(x, z)) continue;
      const yaw = Math.atan2(-x, -z); const f = front(yaw); const scale = 1 + (Rj() - 0.5) * 2 * COTTAGE.scaleJitter;
      cottages.push({ userId: h.user_id, plotIndex: h.plot_index, ring: sl.ring, x, z, yaw, scale, variant: Math.floor(Rj() * COTTAGE.variants), door: { x: x + f.x * COTTAGE.door * scale, z: z + f.z * COTTAGE.door * scale }, node: 'door:h' + h.plot_index, tier: t }); return;
    }
    omitted++;
  });

  // ring lanes: wandering cobbled lanes inside each cottage ring, broken by buildings, bridged over the stream
  const blockedAt = (x: number, z: number): boolean => reservedCircles.some((c, i) => i < plotList.length ? Math.hypot(x - c.x, z - c.z) < plotRadius(plotList[i].id) + 0.2 : Math.hypot(x - c.x, z - c.z) < c.r - 1.0)
    || cottages.some((c) => Math.hypot(x - c.x, z - c.z) < 1.35) || inEllipse({ x, z }, BASIN.quayGap + BASIN.quayW + 0.5) || nearInlet({ x, z }, 1.0);
  type Smp = V2 & { br: boolean };
  const chains: { k: number; id: string; samples: Smp[] }[] = [];
  RINGS.forEach((rg, k) => {
    const Rl = ringR[k] - RING.inset; const M = Math.max(24, Math.round((TAU * Rl) / RING.step)); const o = R() * 50; const t = ringTier[k];
    const s: (Smp | null)[] = Array.from({ length: M }, (_, i) => { const a = (i / M) * TAU; const rr = Rl + fbm(Math.cos(a) * 1.2 + o, 2, Math.sin(a) * 1.2 + o, 2) * 2 * RING.wobble; const x = Math.cos(a) * rr, z = Math.sin(a) * rr; if (blockedAt(x, z)) return null; return { x, z, br: t >= streamTier && polyDist({ x, z }, stream) < STREAM.w / 2 + 0.9 }; });
    const startAt = s.findIndex((v) => v === null); if (startAt < 0) { chains.push({ k, id: `r${k}c0`, samples: [...(s as Smp[]), s[0] as Smp] }); return; }
    let cur: Smp[] = []; let ci = 0; const flush = () => { if (cur.length >= 8) chains.push({ k, id: `r${k}c${ci++}`, samples: cur }); cur = []; };
    for (let j = 1; j <= M; j++) { const v = s[(startAt + j) % M]; if (v) cur.push(v); else flush(); }
    flush();
  });
  const bridges: VBridge[] = []; const ringEdgeIds = new Map<string, string>();
  for (const ch of chains) {
    const t = ringTier[ch.k]; const sm = ch.samples; let last = 0; let acc = 0; const cutIdx: number[] = [0];
    for (let i = 1; i < sm.length; i++) { acc += hyp(sm[i - 1], sm[i]); if (sm[i].br !== sm[i - 1].br || acc >= 4.2 || i === sm.length - 1) { cutIdx.push(i); acc = 0; last = i; } }
    void last;
    const ids = cutIdx.map((i, n) => addNode(`${ch.id}:${n}`, sm[i].x, sm[i].z, t));
    for (let n = 0; n < cutIdx.length - 1; n++) {
      const seg = sm.slice(cutIdx[n], cutIdx[n + 1] + 1); const br = seg.slice(1).some((p) => p.br) && seg.slice(0, -1).some((p) => p.br);
      addEdge(ids[n], ids[n + 1], br ? 'bridge' : 'lane', br ? 1.3 : RING.lane, seg.map((p) => ({ x: p.x, z: p.z })), t);
      if (br) { const m = along(seg, polyLen(seg) / 2); bridges.push({ id: `bridge:${ch.id}:${n}`, x: m.x, z: m.z, yaw: m.yaw, len: Math.max(2.2, polyLen(seg)), w: 1.3, tier: t }); }
    }
    ringEdgeIds.set(ch.id, ids[0]);
  }

  // connectivity: bring every disconnected piece to the network with a clear link, lowest tier first
  const segClear = (a: V2, b: V2, own: V2 | null = null, strict: boolean | 1 = true): boolean => {
    const n = Math.max(2, Math.ceil(hyp(a, b) / 0.5)); const mp = area('millpond'); const pr = strict === 1 ? 1.2 : 0.3;
    for (let i = 1; i < n; i++) {
      const p = { x: a.x + ((b.x - a.x) * i) / n, z: a.z + ((b.z - a.z) * i) / n };
      if (plotList.some((q) => Math.hypot(p.x - q.x, p.z - q.z) < plotRadius(q.id) - pr)) return false;
      if (Math.hypot(p.x - POND.x, p.z - POND.z) < POND.r + 0.25 || inEllipse(p, 0.2) || nearInlet(p, 0.3) || Math.hypot(p.x - SIGNPOST.x, p.z - SIGNPOST.z) < 0.9) return false;
      if (mp && Math.hypot(p.x - mp.x, p.z - mp.z) < mp.r + 0.2) return false;
      if (strict === false) continue;
      if (cottages.some((c) => !(own && Math.hypot(c.door.x - own.x, c.door.z - own.z) < 0.05) && Math.hypot(p.x - c.x, p.z - c.z) < 1.3)) return false;
      if (hamlets.some((h) => Math.hypot(p.x - h.x, p.z - h.z) < Math.max(h.w, h.d) / 2 + 0.3)) return false;
    }
    return true;
  };
  const routeClear = (pts: readonly V2[], own: V2 | null, strict: boolean | 1): boolean => { for (let i = 1; i < pts.length; i++) if (!segClear(pts[i - 1], pts[i], own, strict)) return false; return true; };
  const BENDS = [0, 0.7, -0.7, 1.5, -1.5, 2.5, -2.5];
  const bestRoute = (a: V2, b: V2, own: V2 | null, strict: boolean | 1): V2[] | null => { const base = (R() - 0.5) * 0.4; for (const bd of BENDS) { const pts = route(a, b, base + bd); if (routeClear(pts, own, strict)) return pts; } return null; };
  const component = (): Set<string> => { const seenN = new Set<string>(['plaza']); const st = ['plaza']; while (st.length) for (const n of adj.get(st.pop()!) ?? []) if (!seenN.has(n)) { seenN.add(n); st.push(n); } return seenN; };
  const tryLink = (id: string, t: number, w = 1.1, kind: VEdgeKind = 'link', avoidSelf: Set<string> | null = null): boolean => {
    const conn = component(); const from = P(id);
    const cand = [...nodes.values()].filter((n) => n.id !== id && conn.has(n.id) && n.tier <= t && !(avoidSelf && avoidSelf.has(n.id))).sort((a, b) => hyp(a, from) - hyp(b, from) || (a.id < b.id ? -1 : 1));
    for (const strict of [true, 1 as const, false]) for (const n of cand) { if (hyp(n, from) < 0.4) continue; const pts = bestRoute(n, from, from, strict); if (!pts) continue; addEdge(n.id, id, kind, w, pts, t); return true; }
    return false;
  };
  const piecesOf = (): string[][] => { const left = new Set(nodes.keys()); const out: string[][] = []; while (left.size) { const s = [...left][0]; const comp = [s]; left.delete(s); const st = [s]; while (st.length) for (const n of adj.get(st.pop()!)!) if (left.delete(n)) { comp.push(n); st.push(n); } out.push(comp); } return out; };
  // areas without a node yet link by their centre
  for (const a of areas) if (!nodes.has(a.node)) addNode(a.node, a.x, a.z, a.tier);
  for (let guard = 0; guard < 400; guard++) {
    const conn = component(); const loose = piecesOf().filter((c) => !c.includes('plaza') && !conn.has(c[0])); if (!loose.length) break;
    loose.sort((a, b) => Math.min(...a.map((n) => P(n).tier)) - Math.min(...b.map((n) => P(n).tier)) || (a[0] < b[0] ? -1 : 1));
    const comp = loose[0]; const compSet = new Set(comp); const t = Math.max(...comp.map((n) => P(n).tier));
    // link the member nearest the network, trying members in order of distance to the network
    let done = false; const connNodes = [...nodes.values()].filter((n) => conn.has(n.id) && n.tier <= t);
    const pairs: [string, string, number][] = []; for (const m of comp) for (const c of connNodes) pairs.push([m, c.id, hyp(P(m), P(c.id))]);
    pairs.sort((a, b) => a[2] - b[2] || (a[0] + a[1] < b[0] + b[1] ? -1 : 1));
    for (const strict of [true, 1 as const, false]) { for (const [m, c] of pairs) { const pts = bestRoute(P(c), P(m), null, strict); if (!pts) continue; addEdge(c, m, 'link', 1.1, pts, t); done = true; break; } if (done) break; }
    if (!done) { addEdge('plaza', comp[0], 'link', 1.0, [P('plaza'), P(comp[0])], t); }
    void compSet;
  }
  // cottage doors and hamlet doors: short spurs onto the network
  const hamletDoor = (h: (typeof hamlets)[number]): V2 => { const f = front(h.yaw); return { x: h.x + f.x * (h.d / 2 + 0.5), z: h.z + f.z * (h.d / 2 + 0.5) }; };
  for (const c of cottages) { addNode(c.node, c.door.x, c.door.z, c.tier); if (!tryLink(c.node, c.tier, 0.6, 'spur')) addEdge('plaza', c.node, 'spur', 0.6, [P('plaza'), c.door], c.tier); }
  for (const h of hamlets) { const d = hamletDoor(h); addNode('door:' + h.id, d.x, d.z, h.tier); if (!tryLink('door:' + h.id, h.tier, 0.8, 'spur')) addEdge('plaza', 'door:' + h.id, 'spur', 0.8, [P('plaza'), d], h.tier); }

  // water, hills, beaches
  const waters: VWater[] = [{ id: 'pond', kind: 'pond', x: POND.x, z: POND.z, poly: blob(POND.x, POND.z, POND.r, seed + 'pond'), tier: 1 }];
  let inlet: VInlet | null = null;
  if (basinTier <= MAX_TIER) {
    waters.push({ id: 'basin', kind: 'basin', x: BASIN.x, z: BASIN.z, poly: ellipsePts(0), tier: basinTier });
    // channel from the lagoon's seaward end to the rim (and 0.6 beyond, so the coast clip cuts it cleanly)
    const dx = Math.cos(BASIN.yaw - 0.05), dz = Math.sin(BASIN.yaw - 0.05); const sx = BASIN.x + dx * (BASIN.a - 0.5), sz = BASIN.z + dz * (BASIN.a - 0.5);
    const rim = edgeAt(edge, sx + dx * 4, sz + dz * 4); const len = Math.max(0.5, rim - Math.hypot(sx, sz) + 0.6); const nx = -dz, nz = dx; const poly: V2[] = []; const N = 6;
    for (let i = 0; i <= N; i++) { const t = (i / N) * len; const w = 0.85 - 0.2 * (i / N); poly.push({ x: sx + dx * t + nx * w, z: sz + dz * t + nz * w }); }
    for (let i = N; i >= 0; i--) { const t = (i / N) * len; const w = 0.85 - 0.2 * (i / N); poly.push({ x: sx + dx * t - nx * w, z: sz + dz * t - nz * w }); }
    waters.push({ id: 'inlet', kind: 'basin', x: sx + dx * len / 2, z: sz + dz * len / 2, poly, tier: basinTier });
    if (basinTier <= tier) inlet = { mouth: { x: sx + dx * (len - 0.6), z: sz + dz * (len - 0.6) }, dir: { x: dx, z: dz }, width: 1.3 };
  }
  const mp = area('millpond'); if (mp) waters.push({ id: 'millpond', kind: 'millpond', x: mp.x, z: mp.z, poly: blob(mp.x, mp.z, mp.r, seed + 'mill'), tier: mp.tier });

  // placements
  const pl: VPlacement[] = []; const put = (kind: string, variant: number, x: number, z: number, yaw: number, scale: number, t: number, extra: Partial<VPlacement> = {}) => { if (t <= MAX_TIER) pl.push({ kind, variant, x, z, yaw, scale, tier: t, ...extra }); };
  const net = () => edges.filter((e) => e.kind !== 'plaza');
  const offsetPt = (p: { x: number; z: number; yaw: number }, d: number): V2 => ({ x: p.x + Math.cos(p.yaw) * d, z: p.z - Math.sin(p.yaw) * d });
  for (const e of net()) {
    if (e.kind === 'bridge' || e.kind === 'quay') continue; const L = polyLen(e.pts); if (L < 1) continue;
    const spacing = e.kind === 'spoke' ? LANE_PROPS.lamp : e.kind === 'lane' ? LANE_PROPS.lamp : 0; if (!spacing) continue;
    const n = Math.floor(L / spacing); for (let i = 0; i < n; i++) { const a = along(e.pts, ((i + 0.5) / n) * L); const o = offsetPt(a, (e.kind === 'spoke' ? 0.8 : -0.7)); put('lamp', 0, o.x, o.z, a.yaw, 1, e.tier, { lit: e.kind === 'spoke' }); }
    if (e.kind === 'lane' && L > LANE_PROPS.bench) { const n2 = Math.floor(L / LANE_PROPS.bench); for (let i = 0; i < n2; i++) { const a = along(e.pts, ((i + 0.35) / n2) * L); const o = offsetPt(a, 0.8); put('bench', i % 2, o.x, o.z, a.yaw + Math.PI / 2, 1, e.tier); } }
  }
  const mkA = area('market'); if (mkA) { put('well', 0, mkA.x, mkA.z, 0, 1, mkA.tier); for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU + 0.3; put('stall', i % 3, mkA.x + Math.cos(a) * 1.6, mkA.z + Math.sin(a) * 1.6, Math.atan2(-Math.cos(a), -Math.sin(a)), 1, mkA.tier); } put('cart', 0, mkA.x + 1.9, mkA.z - 1.1, 0.6, 1, mkA.tier); [0, 1, 2].forEach((i) => put(['barrel', 'crate', 'barrel'][i], i, mkA.x - 1.0 + i * 0.5, mkA.z + 1.0, i, 1, mkA.tier)); }
  const grA = area('green'); if (grA) { for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU + 0.5; put('bench', i % 2, grA.x + Math.cos(a) * 1.8, grA.z + Math.sin(a) * 1.8, a + Math.PI / 2, 1, grA.tier); } put('oak', 3, grA.x - 0.4, grA.z - 0.3, 0.4, 1.15, grA.tier, { tint: season }); for (let i = 0; i < 6; i++) { const a = R() * TAU, r = grA.r * (0.7 + R() * 0.25); put('flower-patch', season, grA.x + Math.cos(a) * r, grA.z + Math.sin(a) * r, R() * 6, 0.8 + R() * 0.5, grA.tier); } }
  for (const a of areas) {
    if (a.kind === 'orchard') { const sp = 1.3; for (let gx = -a.r; gx <= a.r; gx += sp) for (let gz = -a.r; gz <= a.r; gz += sp) { const x = a.x + gx + (R() - 0.5) * 0.2, z = a.z + gz + (R() - 0.5) * 0.2; if (Math.hypot(x - a.x, z - a.z) < a.r - 0.2) put('apple', Math.floor(R() * 3), x, z, R() * 6, 0.85 + R() * 0.25, a.tier, { tint: season }); } put('haystack', 0, a.x + a.r + 0.2, a.z, 0, 0.8, a.tier); }
    if (a.kind === 'allotment') { const c = Math.cos(a.yaw), s = Math.sin(a.yaw); for (let i = 0; i < 4; i++) { const lx = -a.w / 2 + ((i + 0.5) / 4) * a.w; put('allotment-bed', i % 2, a.x + lx * c, a.z - lx * s, a.yaw, 1, a.tier, { tint: season }); } put('scarecrow', 0, a.x, a.z + a.d / 2 + 0.3, a.yaw, 1, a.tier); put('barrel', 0, a.x + a.w / 2 + 0.3, a.z, 0, 1, a.tier); }
    if (a.kind === 'meadow') { for (let i = 0; i < 3; i++) put('haystack', i, a.x + (R() - 0.5) * a.r, a.z + (R() - 0.5) * a.r, R() * 6, 1, a.tier); put('beehive', 0, a.x + 0.8, a.z - 0.8, 0.5, 1, a.tier); for (let i = 0; i < 8; i++) { const ang = R() * TAU, r = a.r * Math.sqrt(R()); put('flower-patch', season, a.x + Math.cos(ang) * r, a.z + Math.sin(ang) * r, R() * 6, 0.8 + R() * 0.6, a.tier); } }
    if (a.kind === 'fishmarket') { for (let i = 0; i < 3; i++) { const ang = (i / 3) * TAU + 1; put('stall', 3 + (i % 2), a.x + Math.cos(ang) * 1.2, a.z + Math.sin(ang) * 1.2, ang + Math.PI, 1, a.tier); } ['crate', 'barrel', 'crate', 'net-rack'].forEach((k, i) => put(k, i, a.x - 0.8 + i * 0.5, a.z - 1.4, i, 1, a.tier)); }
    if (a.kind === 'festival') { for (let i = 0; i < 3; i++) put('festival-table', i, a.x - 1.0 + i * 1.0, a.z + 0.6, 0, 1, a.tier); for (let i = 0; i < 8; i++) { const ang = (i / 8) * TAU; put('bunting-post', i, a.x + Math.cos(ang) * (a.r - 0.3), a.z + Math.sin(ang) * (a.r - 0.3), ang, 1, a.tier); } put('maypole', 0, a.x, a.z - 0.6, 0, 1, a.tier); }
  }
  if (basinTier <= MAX_TIER) {
    [0, 1].forEach((i) => { const ang = BASIN.yaw + Math.PI + (i ? 0.7 : -0.7); const px = BASIN.x + Math.cos(ang) * (BASIN.b + 0.7), pz = BASIN.z + Math.sin(ang) * (BASIN.b + 0.7); put('pier', i, px, pz, Math.atan2(BASIN.x - px, BASIN.z - pz), 1, basinTier); });
    [0, 1, 2].forEach((i) => put('boat', i, BASIN.x + (i - 1) * 1.3, BASIN.z + ((i % 2) - 0.5) * 0.7, (i - 1) * 0.5 + 1.2, 1, basinTier));
    for (let i = 0; i < 6; i++) { const ang = (i / 6) * TAU; const q = { x: BASIN.x + Math.cos(ang) * (BASIN.a + 0.6), z: BASIN.z + Math.sin(ang) * (BASIN.b + 0.6) }; put('dock-post', 0, q.x, q.z, 0, 1, basinTier); }
  }
  for (const h of hamlets) put(h.kind, 0, h.x, h.z, h.yaw, 1, h.tier);
  const hillTier = (h: (typeof HILLS)[number]) => Math.max(h.tier, tierFor(h.x, h.z, h.r * 0.6, 0.5));
  for (const c of cottages) {
    const Rc = rng(seed + 'cg' + c.plotIndex); const f = front(c.yaw); const sd = { x: f.z, z: -f.x };
    if (Rc() < 0.18) put('washing-line', 0, c.x + sd.x * 1.4 - f.x * 0.2, c.z + sd.z * 1.4 - f.z * 0.2, c.yaw, 1, c.tier);
    if (Rc() < 0.14) put('beehive', 0, c.x - sd.x * 1.3, c.z - sd.z * 1.3, c.yaw, 1, c.tier);
    if (Rc() < 0.4) put('firewood', 0, c.x - sd.x * 1.1 - f.x * 0.5, c.z - sd.z * 1.1 - f.z * 0.5, c.yaw, 1, c.tier);
    for (let i = 0; i < 2; i++) put('flower-patch', season, c.x + f.x * 1.1 + sd.x * (i ? 0.6 : -0.6), c.z + f.z * 1.1 + sd.z * (i ? 0.6 : -0.6), Rc() * 6, 0.8, c.tier);
  }
  // trees: one fixed candidate stream, a candidate lives from the first tier whose coast encloses it
  const treeOk = (x: number, z: number): boolean => !(plotList.some((q) => Math.hypot(x - q.x, z - q.z) < TREES.plotClear + 0.2 || Math.hypot(x - q.door.x - front(q.yaw).x * TREES.doorAhead, z - q.door.z - front(q.yaw).z * TREES.doorAhead) < TREES.doorClear) || Math.hypot(x - SIGNPOST.x, z - SIGNPOST.z) < 2.0 || Math.hypot(x, z) < PLAZA.r + 0.9
    || Math.hypot(x - POND.x, z - POND.z) < POND.r + 0.9 || areas.some((a) => Math.hypot(x - a.x, z - a.z) < a.r + 0.6) || hamlets.some((h) => Math.hypot(x - h.x, z - h.z) < 1.7) || cottages.some((c) => Math.hypot(x - c.x, z - c.z) < TREES.cottageClear)
    || inEllipse({ x, z }, BASIN.quayGap + BASIN.quayW + 0.9) || nearInlet({ x, z }, 0.9) || polyDist({ x, z }, stream) < 1.4 || edges.some((e) => e.kind !== 'plaza' && polyDist({ x, z }, e.pts) < TREES.corridor));
  const Rt = rng(seed + 'trees'); const Rmax = TIER_R[MAX_TIER - 1] + 3.5; const cand = Math.round(Math.PI * Rmax * Rmax * TREES.perUnit2 * 3.2); let nt = 0;
  for (let i = 0; i < cand && nt < TREES.max; i++) {
    const a = Rt() * TAU, r = Math.sqrt(Rt()) * Rmax; const x = Math.cos(a) * r, z = Math.sin(a) * r; const kindRoll = Rt(), sc = 0.85 + Rt() * 0.4, yw = Rt() * 6;
    const t = tierFor(x, z, 0.9, TREES.margin); if (t > MAX_TIER || r < 4.2 || !treeOk(x, z)) continue;
    const kind = kindRoll < 0.45 ? 'oak' : kindRoll < 0.7 ? 'birch' : kindRoll < 0.88 ? 'poplar' : 'pine'; put(kind, Math.floor(kindRoll * 997) % 3, x, z, yw, sc, t, { tint: season }); nt++;
  }
  const Rf = rng(seed + 'flora'); const flora = Math.round(Rmax * Rmax * 0.55);
  for (let i = 0; i < flora; i++) { const a = Rf() * TAU, r = Math.sqrt(Rf()) * Rmax; const x = Math.cos(a) * r, z = Math.sin(a) * r; const t = tierFor(x, z, 0.4, 0.6); const roll = Rf(), sc = 0.7 + Rf() * 0.7, yw = Rf() * 6; if (t > MAX_TIER || r < 3.6) continue; if (!treeOk(x, z) && roll < 0.9) continue;
    put(roll < 0.55 ? 'flower-patch' : roll < 0.8 ? 'shrub' : roll < 0.93 ? 'rock' : 'boulder', roll < 0.55 ? season : Math.floor(roll * 31) % 3, x, z, yw, sc, t); }
  // reeds around ponds and the stream
  for (const w of waters) if (w.kind !== 'basin') { const n = Math.round(w.poly.length / 2); for (let i = 0; i < n; i++) { const p = w.poly[(i * 2 + 1) % w.poly.length]; if (Rf() < 0.6) put('reed', i % 3, p.x, p.z, Rf() * 6, 0.8 + Rf() * 0.5, w.tier); } }
  for (let s = 1; s < polyLen(stream); s += 1.4) { const a = along(stream, s); const o = offsetPt(a, (Rf() < 0.5 ? 1 : -1) * (STREAM.w / 2 + 0.3)); put('reed', Math.floor(Rf() * 3), o.x, o.z, Rf() * 6, 0.8 + Rf() * 0.4, Math.max(streamTier, tierFor(o.x, o.z, 0.2, 0.3))); }
  // lighthouse on its lobe (coast-bound: follows this tier's coast)
  const lob = LOBES.find((l) => l.id === 'lighthouse-point')!; if (tier >= lob.tier) { const e = edgeAt(edge, Math.cos(lob.a), Math.sin(lob.a)) - 1.3; pl.push({ kind: 'lighthouse', variant: 0, x: Math.cos(lob.a) * e, z: Math.sin(lob.a) * e, yaw: lob.a + Math.PI, scale: 1, tier: 5 }); }

  // walls: low stone walls on the outer side of ring lanes, hedges around orchards and allotments; gaps where another path meets them
  const walls: VWall[] = [];
  const nearOther = (p: V2, own: string) => edges.some((e) => e.id !== own && e.kind !== 'plaza' && e.kind !== 'bridge' && polyDist(p, e.pts) < 1.0 && !e.id.includes(own.split(':')[0])) || cottages.some((c) => Math.hypot(p.x - c.door.x, p.z - c.door.z) < 1.2);
  for (const e of edges) if (e.kind === 'lane' && polyLen(e.pts) > 3) {
    let run: V2[] = []; let ri = 0; const flushRun = () => { if (run.length > 2) walls.push({ id: `wall:${e.id}:${ri++}`, kind: 'wall', pts: run, tier: e.tier }); run = []; };
    for (const p of e.pts) { const q = { x: p.x + (p.x / Math.hypot(p.x, p.z)) * (RING.lane / 2 + 0.42), z: p.z + (p.z / Math.hypot(p.x, p.z)) * (RING.lane / 2 + 0.42) }; if (nearOther(q, e.id) || blockedAt(q.x, q.z) || tierFor(q.x, q.z, 0, 0.5) > e.tier) flushRun(); else run.push(q); }
    flushRun();
  }
  for (const a of areas) if (a.kind === 'orchard' || a.kind === 'allotment') { const pts: V2[] = []; const gapA = Math.atan2(-a.z, -a.x); for (let i = 0; i <= 28; i++) { const ang = gapA + 0.5 + (i / 28) * (TAU - 1.0); pts.push({ x: a.x + Math.cos(ang) * (a.r + 0.15), z: a.z + Math.sin(ang) * (a.r + 0.15) }); } walls.push({ id: 'hedge:' + a.id, kind: 'hedge', pts, tier: a.tier }); }

  // filter by tier
  const keepN = new Set([...nodes.values()].filter((n) => n.tier <= tier).map((n) => n.id));
  const outEdges = edges.filter((e) => e.tier <= tier && keepN.has(e.a) && keepN.has(e.b));
  const sortId = <T extends { id: string }>(l: T[]) => l;
  const cams: VillagePlan['cameras'] = { home: { ...CAMERAS.home }, plan: { ...CAMERAS.plan } };
  if (tier >= 2) cams.market = { ...CAMERAS.market }; if (tier >= 3) cams.harbour = { ...CAMERAS.harbour }; cams.green = { ...CAMERAS.green };
  const capacity = RINGS.reduce((s, r, k) => s + (ringTier[k] <= tier ? r.cap : 0), 0);
  return {
    seed, tier, season, R: TIER_R[tier - 1], edge, plots, plotList, plaza: { ...PLAZA }, sign: { x: SIGNPOST.x, z: SIGNPOST.z, yaw: signYaw, node: 'door:search' },
    nodes: sortId([...nodes.values()].filter((n) => n.tier <= tier)), edges: outEdges, areas: areas.filter((a) => a.tier <= tier), cottages: cottages.filter((c) => c.tier <= tier), omittedHouses: omitted + cottages.filter((c) => c.tier > tier).length, capacity,
    waters: waters.filter((w) => w.tier <= tier),
    stream: tier >= streamTier ? { w: STREAM.w, pts: stream.filter((p) => Math.hypot(p.x, p.z) < edgeAt(edge, p.x, p.z) - 0.8) } : null,
    bridges: bridges.filter((b) => b.tier <= tier), walls: walls.filter((w) => w.tier <= tier), hills: HILLS.filter((h) => hillTier(h) <= tier).map((h) => ({ id: h.id, x: h.x, z: h.z, r: h.r, h: h.h })),
    inlet, beaches: BEACHES.filter((b) => b.tier <= tier).map((b) => ({ id: b.id, a0: b.a0, a1: b.a1 })), placements: pl.filter((p) => p.tier <= tier), cameras: cams,
  };
}
void segDist;
