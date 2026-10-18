/**
 * Instanced placement of the authored kit pieces that replace the merged wall/terrace/bridge/pier/gate/stair proxies.
 * Piece conventions (asset space): length runs along +z and is centred, base at y 0 unless noted. Lengths in world units.
 */
import { BRIDGE, SEA_Y, TEMENOS } from './config';
import { along, hyp, polyLen } from './geo';
import type { HeightFn } from './height';
import type { SitePlan } from './plan';

export const KIT = { wallSeg: 1.3, retainSeg: 1.3, retainH: 1.0, bridgeLen: 3.6, pierSeg: 0.8, stairDepth: 0.6, stairRise: 0.16, moleSeg: 1.5 } as const;
export const KIT_IDS = ['wall_seg', 'wall_post', 'retain_seg', 'bridge', 'pier_deck', 'pier_post', 'gate_pier', 'stair_seg'] as const;
export interface Inst { x: number; y: number; z: number; yaw: number; sx?: number; sy?: number; sz?: number }
type InstFn = (id: string, list: readonly Inst[]) => boolean;

/** Returns true when every kit piece was present and placed (so the caller can drop the proxy mesh). */
export function buildKit(plan: SitePlan, h: HeightFn, inst: InstFn, has: (id: string) => boolean): boolean {
  if (!KIT_IDS.every(has)) return false;
  const seg: Record<string, Inst[]> = { wall_seg: [], wall_post: [], retain_seg: [], bridge: [], pier_deck: [], pier_post: [], gate_pier: [], stair_seg: [] };
  // temenos wall: segments with a post at every joint
  for (const w of plan.walls) {
    const L = hyp(w.a, w.b); if (L < 0.05) continue; const yaw = Math.atan2(w.b.x - w.a.x, w.b.z - w.a.z); const n = Math.max(1, Math.round(L / KIT.wallSeg));
    for (let i = 0; i <= n; i++) { const x = w.a.x + ((w.b.x - w.a.x) * i) / n, z = w.a.z + ((w.b.z - w.a.z) * i) / n; seg.wall_post.push({ x, y: h(x, z) - 0.12, z, yaw }); }
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n; const x = w.a.x + (w.b.x - w.a.x) * t, z = w.a.z + (w.b.z - w.a.z) * t;
      const y0 = Math.min(h(w.a.x + (w.b.x - w.a.x) * (i / n), w.a.z + (w.b.z - w.a.z) * (i / n)), h(x, z), h(w.a.x + (w.b.x - w.a.x) * ((i + 1) / n), w.a.z + (w.b.z - w.a.z) * ((i + 1) / n))) - 0.1;
      seg.wall_seg.push({ x, y: y0, z, yaw, sz: L / n / KIT.wallSeg });
    }
  }
  for (const g of plan.gates) if (g.id !== 'propylon') for (const s of [-1, 1]) { const c = Math.cos(g.yaw), sn = Math.sin(g.yaw); const x = g.x + s * (g.w / 2) * c, z = g.z - s * (g.w / 2) * sn; seg.gate_pier.push({ x, y: h(x, z) - 0.1, z, yaw: g.yaw }); }
  // terrace retaining walls (four runs per walled terrace)
  for (const t of plan.terraces) {
    if (!t.wall) continue; const hw = t.w / 2 + 0.2, hd = t.d / 2 + 0.2; const c = Math.cos(t.yaw), s = Math.sin(t.yaw);
    const runs: [number, number, number, number][] = [[0, hd, hw * 2, Math.PI / 2], [0, -hd, hw * 2, Math.PI / 2], [hw, 0, hd * 2, 0], [-hw, 0, hd * 2, 0]];
    for (const [lx, lz, len, ry] of runs) {
      const n = Math.max(1, Math.round(len / KIT.retainSeg));
      for (let i = 0; i < n; i++) {
        const u = ((i + 0.5) / n - 0.5) * len; const ax = ry ? u : 0, az = ry ? 0 : u; const px = lx + ax, pz = lz + az;
        seg.retain_seg.push({ x: t.x + px * c + pz * s, y: t.h - KIT.retainH + 0.02, z: t.z - px * s + pz * c, yaw: ry + t.yaw, sz: len / n / KIT.retainSeg });
      }
    }
  }
  for (const b of plan.bridges) seg.bridge.push({ x: b.x, y: 0, z: b.z, yaw: b.yaw, sz: b.len / KIT.bridgeLen, sx: BRIDGE.w / 1.9 });
  for (const p of plan.piers) {
    const c = Math.cos(p.yaw), s = Math.sin(p.yaw); const n = Math.max(1, Math.round(p.len / KIT.pierSeg));
    for (let i = 0; i < n; i++) { const d = ((i + 0.5) / n) * p.len; seg.pier_deck.push({ x: p.x + s * d, y: SEA_Y + 0.4, z: p.z + c * d, yaw: p.yaw, sz: p.len / n / KIT.pierSeg }); }
    for (let i = 0; i <= n; i++) for (const sd of [-1, 1]) { const d = (i / n) * p.len; seg.pier_post.push({ x: p.x + s * d + c * 0.5 * sd, y: SEA_Y - 2.0, z: p.z + c * d - s * 0.5 * sd, yaw: 0 }); }
  }
  // stair runs: one step slab per tread, stepping with the terrain
  for (const e of plan.edges) {
    if (e.kind !== 'stair') continue; const L = polyLen(e.pts); const n = Math.max(2, Math.round(L / KIT.stairDepth));
    for (let i = 0; i < n; i++) { const a = along(e.pts, ((i + 0.5) / n) * L); seg.stair_seg.push({ x: a.x, y: h(a.x, a.z) - 0.02, z: a.z, yaw: a.yaw, sx: e.w / 1.4, sz: L / n / KIT.stairDepth }); }
  }
  void TEMENOS;
  for (const [id, list] of Object.entries(seg)) inst(id, list);
  return true;
}
