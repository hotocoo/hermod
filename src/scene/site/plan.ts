/**
 * Pure, deterministic site plan for one Space's island (an Olympia-style sanctuary town).
 * Same input -> same plan (JSON equal). Fixed monuments and section plots never move between tiers;
 * a higher tier only adds features (rings), so tier n is a subset of tier n+1.
 */
import { fbm } from '../noise';
import { rng } from '../rng';
import {
  ACCENTS, BRIDGES, CAMERAS, COAST, COL, EDGES, FIXED, KEEP_OUT, HILLS, LEVEL_SCALE, LOBES, MAX_TIER, NODES, ORCHARDS, PLOT_LINK, PLOT_SPEC, PROPS, QUARTER, RIVERS, SITE_SECTIONS, TERRACES,
  TEMENOS, TIER_RADIUS, TREES, RING_OFFSET, type LandmarkKind, type SiteSectionId, type V2,
} from './config';
import { clamp, front, hyp, inPoly, obbDist, polyCross, polyDist, segHitsObb, spline, type Obb } from './geo';
import { buildDecor, cottageStyle, type SiteCover, type SiteDecor } from './decor';

export interface SiteInput {
  seed: string;
  /** Island tier 1..5. */
  tier: number;
  /** Level per section 0..3; missing or 0 means not raised (an empty foundation stays). */
  levels?: Partial<Record<SiteSectionId, number>>;
  /** One cottage per member; plot_index picks the quarter slot deterministically. */
  houses?: readonly { user_id: string; plot_index: number }[];
}
export interface SitePlot { id: SiteSectionId; kind: LandmarkKind; name: string; x: number; z: number; yaw: number; scale: number; level: number; raised: boolean; fw: number; fd: number; door: V2; node: string }
export interface SiteNode { id: string; x: number; z: number }
export type PathKind = 'way' | 'lane' | 'spur' | 'bridge' | 'stair';
export interface SiteEdge { id: string; a: string; b: string; kind: PathKind; w: number; pts: V2[] }
export interface SiteTerrace { id: string; x: number; z: number; w: number; d: number; yaw: number; h: number; wall: boolean }
export interface SiteRiver { id: string; w: number; pts: V2[] }
export interface SiteBridge { id: string; x: number; z: number; yaw: number; len: number }
export interface SiteGate { id: string; x: number; z: number; yaw: number; w: number }
export interface SiteLandmark { id: string; kind: LandmarkKind; x: number; z: number; yaw: number; w: number; d: number; n?: number }
export interface SiteTree { x: number; z: number; s: number; yaw: number; kind: 'olive' | 'plane' | 'cypress' }
export interface SiteProp { kind: 'statue' | 'altar' | 'torch' | 'herm'; x: number; z: number; yaw: number; s: number }
export interface SiteCottage { userId: string; plotIndex: number; x: number; z: number; yaw: number; scale: number; roof: number; wall: number; door: V2; node: string; /** authored cottage_<variant> glb */ variant: number; awning: boolean; garden: boolean }
export interface SitePier { x: number; z: number; yaw: number; len: number }
export interface SitePlan {
  seed: string; tier: number; R: number;
  /** Coast radius at evenly spaced angles from -pi (length COAST.samples). */
  edge: number[];
  plots: Record<SiteSectionId, SitePlot>;
  plotList: SitePlot[];
  nodes: SiteNode[]; edges: SiteEdge[];
  terraces: SiteTerrace[]; hills: { x: number; z: number; r: number; h: number }[];
  rivers: SiteRiver[]; bridges: SiteBridge[];
  walls: { a: V2; b: V2 }[]; gates: SiteGate[]; plaza: { x: number; z: number; r: number };
  landmarks: SiteLandmark[];
  trees: SiteTree[]; props: SiteProp[]; cottages: SiteCottage[]; omittedHouses: number;
  piers: SitePier[]; landing: V2;
  /** Number of quarter slots available at this tier (cottage capacity). */
  capacity: number;
  cameras: typeof CAMERAS;
  /** Lived-in props (tier tagged; the plan lists those up to this tier only), stepping stones, harbour and ground cover. */
  decor: SiteDecor[]; cover: SiteCover[];
}

const ANG0 = -Math.PI, N = COAST.samples;
/** Coast radius toward (x, z) interpolated from the sampled edge. */
export function edgeAt(edge: readonly number[], x: number, z: number): number {
  const t = ((Math.atan2(z, x) - ANG0) / (Math.PI * 2)) * N; const i = Math.floor(t) % N, f = t - Math.floor(t);
  return edge[i] * (1 - f) + edge[(i + 1) % N] * f;
}
export function makeEdge(seed: string, tier: number): number[] {
  const R = TIER_RADIUS[tier - 1], amp = COAST.amp[tier - 1] ?? 0; const Rn = rng('coast' + seed); const ox = Rn() * 40, oz = Rn() * 40; const out: number[] = [];
  for (let i = 0; i < N; i++) {
    const a = ANG0 + (i / N) * Math.PI * 2; let r = R * Math.max(COAST.min, 1 + amp * 2.1 * fbm(Math.cos(a) * 1.4 + ox, 0.5, Math.sin(a) * 1.4 + oz, 3));
    for (const l of LOBES) if (tier >= l.tier) { let d = Math.abs(a - l.a); d = Math.min(d, Math.PI * 2 - d); r += l.k * Math.exp(-((d / l.w) ** 2)); }
    out.push(r);
  }
  return out;
}

const q = (n: number): number => Math.round(n * 1000) / 1000;
const mkObb = (x: number, z: number, w: number, d: number, yaw: number): Obb => ({ x, z, hw: w / 2, hd: d / 2, yaw });
const lerp2 = (a: V2, b: V2, t: number): V2 => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
const edgePts = (a: V2, b: V2, bend = 0, via: readonly V2[] = []): V2[] => {
  if (via.length) return spline([a, ...via, b], 6);
  if (!bend) return [a, lerp2(a, b, 0.5), b];
  const m = lerp2(a, b, 0.5); const dx = b.x - a.x, dz = b.z - a.z; const l = Math.hypot(dx, dz) || 1;
  return spline([a, { x: m.x - (dz / l) * bend * l * 0.35, z: m.z + (dx / l) * bend * l * 0.35 }, b], 6);
};

/** Master obstacles (independent of tier so the quarter never moves). */
function masterObstacles(): { id: string; obb: Obb }[] {
  const o: { id: string; obb: Obb }[] = [];
  for (const id of SITE_SECTIONS) { const s = PLOT_SPEC[id]; o.push({ id, obb: mkObb(s.x, s.z, s.fw * LEVEL_SCALE[3], s.fd * LEVEL_SCALE[3], s.yaw) }); }
  const T = FIXED.temple, pad = T.steps * T.stepW; o.push({ id: 'temple', obb: mkObb(T.x, T.z, T.w + pad * 2, T.d + pad * 2, T.yaw) });
  const R = FIXED.treasuryRow; o.push({ id: 'treasuryRow', obb: mkObb(R.x, R.z, R.w, R.d, R.yaw) });
  const E = FIXED.stoaEcho; o.push({ id: 'echo', obb: mkObb(E.x, E.z, E.w, E.d, E.yaw) });
  const H = FIXED.hostel; o.push({ id: 'hostel', obb: mkObb(H.x, H.z, H.w, H.d, H.yaw) });
  const S = FIXED.stadium; o.push({ id: 'stadium', obb: mkObb(S.x, S.z, S.wid + S.wall * 2, S.len + S.wall * 2, S.yaw) });
  const X = FIXED.xystos; o.push({ id: 'xystos', obb: mkObb(X.x, X.z, X.w, X.d, X.yaw) });
  return o;
}

/** Straight segment clear of walls, obstacles and rivers. */
function segClear(a: V2, b: V2, obs: readonly { id: string; obb: Obb }[], skipWall = false): boolean {
  if (!skipWall && polyCross(a, b, TEMENOS.poly, true)) return false;
  if (RIVERS.some((r) => polyCross(a, b, r.pts))) return false;
  return !obs.some((o) => segHitsObb(a, b, o.obb, 0.35));
}

export function generateSitePlan(input: SiteInput): SitePlan {
  const tier = clamp(Math.round(input.tier) || 1, 1, MAX_TIER); const seed = input.seed; const R = TIER_RADIUS[tier - 1];
  const edge = makeEdge(seed, tier); const obs = masterObstacles();

  // ---- plots
  const plots = {} as Record<SiteSectionId, SitePlot>;
  for (const id of SITE_SECTIONS) {
    const s = PLOT_SPEC[id]; const level = clamp(Math.round(input.levels?.[id] ?? 0), 0, 3); const f = front(s.yaw); const sc = LEVEL_SCALE[level];
    const off = (s.fd / 2) * sc + 0.35 + s.door;
    plots[id] = { id, kind: s.kind, name: s.name, x: s.x, z: s.z, yaw: s.yaw, scale: sc, level, raised: level > 0, fw: s.fw * sc, fd: s.fd * sc, door: { x: q(s.x + f.x * off), z: q(s.z + f.z * off) }, node: 'door:' + id };
  }
  const plotList = SITE_SECTIONS.map((id) => plots[id]);

  // ---- path graph
  const nodes: SiteNode[] = NODES.filter((n) => n.tier <= tier).map(({ id, x, z }) => ({ id, x, z }));
  const nodeMap = new Map(nodes.map((n) => [n.id, n] as const));
  const edges: SiteEdge[] = [];
  const addEdge = (id: string, a: string, b: string, kind: PathKind, w: number, pts: V2[]) => { edges.push({ id, a, b, kind, w, pts: pts.map((p) => ({ x: q(p.x), z: q(p.z) })) }); };
  const coastPt = (a: number): V2 => { const e = edgeAt(edge, Math.cos(a), Math.sin(a)); return { x: Math.cos(a) * (e - 0.7), z: Math.sin(a) * (e - 0.7) }; };
  const landing = coastPt(Math.PI / 2);
  for (const e of EDGES) {
    if (e.tier > tier) continue; const a = nodeMap.get(e.a), b = nodeMap.get(e.b); if (!a || !b) continue;
    addEdge(e.a + '-' + e.b, e.a, e.b, e.kind, e.w, edgePts(a, b, e.bend));
  }
  const ln = nodeMap.get('landing'); if (ln && landing.z > ln.z + 0.3) addEdge('landing-shore', 'landing', 'shore', 'way', 2.2, [ln, lerp2(ln, { x: 0, z: landing.z }, 0.5), { x: 0, z: landing.z }]);
  nodes.push({ id: 'shore', x: 0, z: landing.z });
  for (const p of plotList) {
    nodes.push({ id: p.node, x: p.door.x, z: p.door.z });
    const link = PLOT_LINK[p.id]; const to = nodeMap.get(link.to); if (!to) continue;
    addEdge(p.node + '-' + link.to, p.node, link.to, 'spur', 1.0, edgePts(p.door, to, 0, link.via));
  }
  // hostel + echo stoa (tier 3 landmarks) get their own doors
  const landmarks: SiteLandmark[] = [];
  landmarks.push({ id: 'propylon', kind: 'propylon', x: 0, z: TEMENOS.gates[0].z, yaw: 0, w: 3.6, d: 1.5 });
  const lmDoor = (id: string, x: number, z: number, yaw: number, d: number, to: string) => {
    const f = front(yaw); const door = { x: q(x + f.x * (d / 2 + 0.7)), z: q(z + f.z * (d / 2 + 0.7)) }; nodes.push({ id: 'door:' + id, x: door.x, z: door.z });
    const t = nodes.find((n) => n.id === to); if (t) addEdge('door:' + id + '-' + to, 'door:' + id, to, 'spur', 1.0, edgePts(door, t));
  };
  if (tier >= FIXED.temple.tier) { const T = FIXED.temple; landmarks.push({ id: 'temple', kind: 'temple', x: T.x, z: T.z, yaw: T.yaw, w: T.w, d: T.d }); const R2 = FIXED.treasuryRow; landmarks.push({ id: 'treasuryRow', kind: 'treasuryRow', x: R2.x, z: R2.z, yaw: R2.yaw, w: R2.w, d: R2.d, n: R2.n }); }
  if (tier >= FIXED.stoaEcho.tier) { const E = FIXED.stoaEcho; landmarks.push({ id: 'echo', kind: 'stoa', x: E.x, z: E.z, yaw: E.yaw, w: E.w, d: E.d }); lmDoor('echo', E.x, E.z, E.yaw, E.d, 'wayS'); }
  if (tier >= FIXED.hostel.tier) { const H = FIXED.hostel; landmarks.push({ id: 'hostel', kind: 'hostel', x: H.x, z: H.z, yaw: H.yaw, w: H.w, d: H.d });  }
  if (tier >= FIXED.stadium.tier) { const S = FIXED.stadium; landmarks.push({ id: 'stadium', kind: 'stadium', x: S.x, z: S.z, yaw: S.yaw, w: S.wid, d: S.len }); }
  if (tier >= FIXED.xystos.tier) { const X = FIXED.xystos; landmarks.push({ id: 'xystos', kind: 'xystos', x: X.x, z: X.z, yaw: X.yaw, w: X.w, d: X.d }); }

  // ---- peribolos road: lane ring just outside the temenos wall; cottages and the hostel hang off it
  const cen = { x: 0, z: -0.1 }; const ringPts: V2[] = [];
  TEMENOS.poly.forEach((A, i) => {
    const B = TEMENOS.poly[(i + 1) % TEMENOS.poly.length]; const n = Math.max(1, Math.round(hyp(A, B) / 2.0));
    for (let k = 0; k < n; k++) { const p = lerp2(A, B, k / n); const d = hyp(p, cen) || 1; ringPts.push({ x: q(p.x + ((p.x - cen.x) / d) * RING_OFFSET), z: q(p.z + ((p.z - cen.z) / d) * RING_OFFSET) }); }
  });
  const ringOk = ringPts.map((p) => tier >= 2 && hyp(p, cen) < edgeAt(edge, p.x, p.z) - 0.5 && !obs.some((o) => obbDist(o.obb, p) < 0.25) && !RIVERS.some((rv) => polyDist(p, rv.pts) < rv.w / 2 + 0.9) && !(Math.abs(p.x) < 2.2 && p.z > 9));
  ringPts.forEach((p, i) => { if (ringOk[i]) nodes.push({ id: 'r:' + i, x: p.x, z: p.z }); });
  ringPts.forEach((p, i) => { const j = (i + 1) % ringPts.length; if (ringOk[i] && ringOk[j] && segClear(p, ringPts[j], obs.filter((o) => o.id !== 'x'), true)) addEdge('r:' + i + '-r:' + j, 'r:' + i, 'r:' + j, 'lane', 1.1, [p, ringPts[j]]); });
  if (tier >= FIXED.hostel.tier) { const H = FIXED.hostel; const rn = nodes.filter((n) => n.id.startsWith('r:')).sort((a2, b2) => hyp(a2, H) - hyp(b2, H))[0]; if (rn) lmDoor('hostel', H.x, H.z, H.yaw, H.d, rn.id); }
  if (tier >= FIXED.xystos.tier) { const X = FIXED.xystos; const rn = nodes.filter((n) => n.id.startsWith('r:')).sort((a2, b2) => hyp(a2, X) - hyp(b2, X))[0]; if (rn) lmDoor('xystos', X.x, X.z, X.yaw, X.d, rn.id); }
  { const ln2 = nodes.find((n) => n.id === 'landing'); if (ln2) for (const side of [-1, 1]) { const near = ringPts.map((p, i) => ({ i, d: hyp(p, ln2) })).filter((r) => ringOk[r.i] && Math.sign(ringPts[r.i].x) === side).sort((a2, b2) => a2.d - b2.d)[0]; if (near) addEdge('landing-r:' + near.i, 'landing', 'r:' + near.i, 'lane', 1.2, edgePts(ln2, ringPts[near.i])); } }

  // ---- terrain features
  const terraces: SiteTerrace[] = TERRACES.filter((t) => t.tier <= tier).map(({ id, x, z, w, d, yaw, h, wall }) => ({ id, x, z, w, d, yaw, h, wall: !!wall }));
  const rivers: SiteRiver[] = RIVERS.filter((r) => r.tier <= tier).map((r) => ({ id: r.id, w: r.w, pts: r.pts.map((p) => ({ ...p })) }));
  const bridges: SiteBridge[] = BRIDGES.filter((b) => b.tier <= tier).map(({ id, x, z, yaw, len }) => ({ id, x, z, yaw, len }));
  // walls: temenos polygon with gate gaps cut out
  const gates: SiteGate[] = TEMENOS.gates.filter((g) => g.tier <= tier).map(({ id, x, z, yaw, w }) => ({ id, x, z, yaw, w }));
  const walls: { a: V2; b: V2 }[] = [];
  TEMENOS.poly.forEach((A, i) => {
    const B = TEMENOS.poly[(i + 1) % TEMENOS.poly.length]; const L = hyp(A, B);
    const cuts = gates.map((g) => ({ g, t: ((g.x - A.x) * (B.x - A.x) + (g.z - A.z) * (B.z - A.z)) / (L * L) })).filter((c) => polyDist(c.g, [A, B]) < 0.05).sort((p, r) => p.t - r.t);
    let t0 = 0; for (const c of cuts) { const h = c.g.w / 2 / L; if (c.t - h > t0) walls.push({ a: lerp2(A, B, t0), b: lerp2(A, B, c.t - h) }); t0 = c.t + h; }
    if (t0 < 1) walls.push({ a: lerp2(A, B, t0), b: lerp2(A, B, 1) });
  });

  // ---- quarter: cottages on spiral slots, linked by desire lines
  const masterEdgePts = EDGES.flatMap((e) => { const a = NODES.find((n) => n.id === e.a), b = NODES.find((n) => n.id === e.b); return a && b ? [edgePts(a, b, e.bend)] : []; });
  const slots: { ring: number; x: number; z: number; blocked: boolean }[] = [];
  QUARTER.rings.forEach((r, ring) => {
    const n = Math.floor((Math.PI * 2 * r) / QUARTER.spacing); const step = (Math.PI * 2) / n; const off = (ring % 2) * step * 0.5;
    const cand: { x: number; z: number; k: number }[] = [];
    for (let j = 0; j < n; j++) {
      const a = QUARTER.startAngle + off + ((j % 2 ? 1 : -1) * Math.ceil(j / 2)) * step; const p = { x: Math.cos(a) * r, z: Math.sin(a) * r };
      if (p.x > QUARTER.maxX || p.z < QUARTER.minZ || (Math.abs(p.x) < 1.8 && p.z > 9)) continue;
      if (polyDist(p, TEMENOS.poly, true) < QUARTER.clear.wall || inPoly(p, TEMENOS.poly)) continue;
      if (obs.some((o) => obbDist(o.obb, p) < QUARTER.clear.plot)) continue;
      if (RIVERS.some((rv) => polyDist(p, rv.pts) < rv.w / 2 + QUARTER.clear.river)) continue;
      if (masterEdgePts.some((pts) => polyDist(p, pts) < QUARTER.clear.path)) continue;
      cand.push({ ...p, k: j });
    }
    cand.forEach((c) => slots.push({ ring, x: c.x, z: c.z, blocked: ring >= 2 && KEEP_OUT.some((k) => Math.hypot(c.x - k.x, c.z - k.z) < k.r) }));
  });
  const slotsHere = slots.filter((s) => s.ring < tier);
  const cottages: SiteCottage[] = []; let omitted = 0;
  const seen = new Set<number>();
  const linkIds = new Map<string, V2>(nodes.filter((n) => n.id.startsWith('r:') || ['landing', 'gate'].includes(n.id)).map((n) => [n.id, n] as const));
  const Rj = rng(seed + 'cot'); const cot = QUARTER.cottage;
  [...(input.houses ?? [])].sort((a, b) => a.plot_index - b.plot_index).forEach((h) => {
    if (seen.has(h.plot_index)) return; seen.add(h.plot_index);
    const jit = Rj(), jit2 = Rj(), jit3 = Rj(), jit4 = Rj();
    const s = slots[h.plot_index]; if (!s || s.ring >= tier || s.blocked) { omitted++; return; }
    if (cottages.some((c) => hyp(c, s) < QUARTER.clear.house)) { omitted++; return; }
    const yaw = Math.atan2(-s.x, -s.z); const sc = 1 + (jit - 0.5) * 2 * cot.jitter; const f = front(yaw);
    const door = { x: q(s.x + f.x * (cot.d / 2 + 0.3)), z: q(s.z + f.z * (cot.d / 2 + 0.3)) }; const id = 'cottage:' + h.plot_index;
    // nearest reachable target: earlier cottage doors first, then backbone nodes
    const targets = [...cottages.map((c) => ({ id: c.node, p: c.door })), ...[...linkIds].map(([k, p]) => ({ id: k, p }))].sort((a, b) => hyp(door, a.p) - hyp(door, b.p));
    const tgt = targets.find((t) => segClear(door, t.p, obs)); if (!tgt) { omitted++; return; }
    cottages.push({ userId: h.user_id, plotIndex: h.plot_index, x: q(s.x), z: q(s.z), yaw: q(yaw), scale: q(sc), roof: COL.roof[Math.floor(jit2 * COL.roof.length)], wall: COL.wall[Math.floor(jit3 * COL.wall.length)], door, node: id, ...cottageStyle(h.user_id) });
    nodes.push({ id, x: door.x, z: door.z }); addEdge(id + '-' + tgt.id, id, tgt.id, 'spur', 0.8, edgePts(door, tgt.p, (jit4 - 0.5) * 0.4));
  });

  // ---- prune anything the gate cannot reach (keeps the path graph connected by construction)
  { const adj = new Map<string, string[]>(); nodes.forEach((n) => adj.set(n.id, [])); edges.forEach((e) => { adj.get(e.a)?.push(e.b); adj.get(e.b)?.push(e.a); });
    const reach = new Set<string>(['gate']); const st = ['gate']; while (st.length) for (const m of adj.get(st.pop()!) ?? []) if (!reach.has(m)) { reach.add(m); st.push(m); }
    for (let i = cottages.length - 1; i >= 0; i--) if (!reach.has(cottages[i].node)) { cottages.splice(i, 1); omitted++; }
    for (let i = nodes.length - 1; i >= 0; i--) if (!reach.has(nodes[i].id)) nodes.splice(i, 1);
    for (let i = edges.length - 1; i >= 0; i--) if (!reach.has(edges[i].a) || !reach.has(edges[i].b)) edges.splice(i, 1); }

  // ---- props
  const props: SiteProp[] = [];
  props.push({ kind: 'herm', x: FIXED.herm.x, z: FIXED.herm.z, yaw: FIXED.herm.yaw, s: 1 });
  PROPS.zanes.forEach((p, i) => props.push({ kind: 'statue', x: p.x, z: p.z, yaw: p.x < 0 ? Math.PI / 2 : -Math.PI / 2, s: 0.95 + (i % 2) * 0.1 }));
  PROPS.altars.forEach((p) => props.push({ kind: 'altar', x: p.x, z: p.z, yaw: 0, s: 1 }));
  PROPS.torches.forEach((p) => props.push({ kind: 'torch', x: p.x, z: p.z, yaw: 0, s: 1 }));
  // votive statues ring the hearth plaza, skipping path junctions
  const hp = FIXED.plaza; for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8; const x = hp.x + Math.sin(a) * (hp.r + 0.5), z = hp.z + Math.cos(a) * (hp.r + 0.5);
    if (nodes.some((n) => hyp(n, { x, z }) < 1.7) || obs.some((o) => obbDist(o.obb, { x, z }) < 0.8) || z < -0.2) continue;
    props.push({ kind: 'statue', x: q(x), z: q(z), yaw: q(a + Math.PI), s: 0.8 + ((i * 37) % 5) * 0.04 });
  }
  if (tier >= FIXED.temple.tier) { const T = FIXED.temple; const fz = T.z + T.d / 2 + T.steps * T.stepW + 0.5; props.push({ kind: 'torch', x: -2.2, z: fz, yaw: 0, s: 1.1 }, { kind: 'torch', x: 2.2, z: fz, yaw: 0, s: 1.1 }); }
  if (tier >= FIXED.stadium.tier) { const S = FIXED.stadium; [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => props.push({ kind: 'torch', x: q(S.x + (sx * (S.wid / 2 + 0.2))), z: q(S.z + sz * (S.len / 2 - 0.4)), yaw: 0, s: 1.15 })); props.push({ kind: 'altar', x: S.x, z: S.z + S.len / 2 + 0.6, yaw: 0, s: 0.9 }); }
  if (tier >= FIXED.hostel.tier || tier >= 3) props.push({ kind: 'torch', x: -1.4, z: 10.4, yaw: 0, s: 1 }, { kind: 'torch', x: 1.4, z: 10.4, yaw: 0, s: 1 });

  // ---- trees
  const trees: SiteTree[] = []; const Rt = rng(seed + 'trees');
  const treeFree = (x: number, z: number, pad: number): boolean => {
    const p = { x, z }; if (hyp(p, { x: 0, z: 0 }) > edgeAt(edge, x, z) - 1.0) return false;
    if (Math.abs(x) < TREES.corridor && z > -1 && z < 11) return false;
    if (obs.some((o) => obbDist(o.obb, p) < pad)) return false;
    if (edges.some((e) => polyDist(p, e.pts) < pad + e.w / 2)) return false;
    if (rivers.some((rv) => polyDist(p, rv.pts) < rv.w / 2 + pad)) return false;
    if (hyp(p, FIXED.plaza) < FIXED.plaza.r + 0.5) return false;
    if (slotsHere.some((s) => hyp(s, p) < 1.4)) return false;
    if (terraces.some((t) => t.id === 'treasuries' && Math.abs(x - t.x) < t.w / 2 && Math.abs(z - t.z) < t.d / 2 + 0.2)) return false;
    return true;
  };
  for (const a of ACCENTS) if (a.tier <= tier && treeFree(a.x, a.z, 0.6)) trees.push({ x: a.x, z: a.z, s: a.s, yaw: Rt() * 6.28, kind: a.kind });
  for (const g of ORCHARDS) {
    if (g.tier > tier) continue;
    for (let x = g.x - g.w / 2; x <= g.x + g.w / 2; x += g.step) for (let z = g.z - g.d / 2; z <= g.z + g.d / 2; z += g.step) {
      const jx = x + (Rt() - 0.5) * g.step * 0.4, jz = z + (Rt() - 0.5) * g.step * 0.4; const s = 0.85 + Rt() * 0.3, yaw = Rt() * 6.28;
      if (treeFree(jx, jz, 0.5)) trees.push({ x: q(jx), z: q(jz), s: q(s), yaw: q(yaw), kind: 'olive' });
    }
  }
  // sacred grove: planes along the inside of the wall, kept off the plots
  const wallPts = TEMENOS.poly; const nGrove = 10 + tier * 2;
  for (let i = 0, tries = 0; i < nGrove && tries < 200; tries++) {
    const k = Math.floor(Rt() * wallPts.length); const A = wallPts[k], B = wallPts[(k + 1) % wallPts.length]; const t = Rt(); const p = lerp2(A, B, t);
    const cx = -p.x * 0.07, cz = -p.z * 0.07; const x = p.x + cx - Math.sign(p.x) * 0.6, z = p.z + cz - Math.sign(p.z) * 0.6;
    if (!treeFree(x, z, 0.9) || trees.some((tr) => hyp(tr, { x, z }) < 1.6)) continue;
    trees.push({ x: q(x), z: q(z), s: q(0.9 + Rt() * 0.35), yaw: q(Rt() * 6.28), kind: Rt() < 0.5 ? 'plane' : 'olive' }); i++;
  }
  // olive groves on slopes outside the quarter ring zone: fill remaining free outer band up to a per-tier cap
  const cap = Math.min(TREES.max, 40 + tier * 18);
  for (let tries = 0; trees.length < cap && tries < 900; tries++) {
    const a = Rt() * Math.PI * 2, r = (0.55 + Rt() * 0.42) * R; const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (z < QUARTER.minZ - 0.5 || polyDist({ x, z }, TEMENOS.poly, true) < 1.8 || inPoly({ x, z }, TEMENOS.poly) || x > 9.5) continue;
    if (!treeFree(x, z, 0.8) || trees.some((tr) => hyp(tr, { x, z }) < 1.5)) continue;
    trees.push({ x: q(x), z: q(z), s: q(0.8 + Rt() * 0.4), yaw: q(Rt() * 6.28), kind: Rt() < 0.2 ? 'cypress' : 'olive' });
  }

  // ---- harbor
  const piers: SitePier[] = [];
  const pierAt = (a: number, len: number): SitePier => { const e = edgeAt(edge, Math.cos(a), Math.sin(a)); return { x: q(Math.cos(a) * (e - 0.3)), z: q(Math.sin(a) * (e - 0.3)), yaw: q(Math.atan2(Math.cos(a), Math.sin(a))), len }; };
  if (tier >= 3) piers.push(pierAt(Math.PI / 2 - 0.22, 3.2));
  if (tier >= 5) piers.push(pierAt(Math.PI / 2 + 0.36, 3.6), pierAt(Math.atan2(17, 13.2), 3.0));

  // ---- lived-in layer (static against everything, so tiers nest)
  const lines = [...EDGES.flatMap((e) => { const na = NODES.find((n) => n.id === e.a), nb = NODES.find((n) => n.id === e.b); return na && nb ? [{ pts: edgePts(na, nb, e.bend), hw: e.w / 2 }] : []; }), { pts: [...ringPts, ringPts[0]], hw: 0.65 }, ...([['echo', FIXED.stoaEcho, 'wayS'], ['hostel', FIXED.hostel, ''], ['xystos', FIXED.xystos, '']] as const).map(([, L, to]) => { const f = front(L.yaw); const dh = ('d' in L ? L.d : 4) / 2 + 0.7; const door = { x: L.x + f.x * dh, z: L.z + f.z * dh }; const tn = NODES.find((n) => n.id === to); return { pts: tn ? [door, tn] : [door, { x: door.x + f.x * 2.4, z: door.z + f.z * 2.4 }], hw: 0.55 }; }), ...SITE_SECTIONS.map((id) => { const sp = PLOT_SPEC[id]; const f = front(sp.yaw); const off = sp.fd / 2 * LEVEL_SCALE[3] + 0.35 + sp.door; const door = { x: sp.x + f.x * off, z: sp.z + f.z * off }; const lk = PLOT_LINK[id]; const to = NODES.find((n) => n.id === lk.to)!; return { pts: edgePts(door, to, 0, lk.via), hw: 0.5 }; })];
  const { decor: allDecor, cover: allCover } = buildDecor({ seed, obstacles: obs.map((o) => o.obb), lines, slots: slots.filter((sl) => !sl.blocked), plaza: FIXED.plaza, edges: [1, 2, 3, 4, 5].map((t) => makeEdge(seed, t)), edgeAt, landmarks: [] });
  const decor = allDecor.filter((d) => d.tier <= tier), cover = allCover.filter((c) => c.tier <= tier);

  return {
    seed, tier, R, edge: edge.map(q), plots, plotList, nodes, edges, terraces, hills: HILLS.map((h) => ({ ...h })), rivers, bridges, walls, gates, plaza: { ...FIXED.plaza }, landmarks,
    trees, props, cottages, omittedHouses: omitted, piers, landing: { x: q(landing.x), z: q(landing.z) }, capacity: slotsHere.length, cameras: CAMERAS, decor, cover,
  };
}
