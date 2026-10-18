import * as THREE from 'three';
import { BRIDGE, COL, TEMENOS } from './config';
import { hyp } from './geo';
import type { HeightFn } from './height';
import { Parts, tint } from './kit';
import type { SiteMaterials } from './materials';
import type { SitePlan } from './plan';

/** Temenos wall, terrace retaining walls, bridges, piers, quarter cottages and unbuilt foundations: one merged mesh (one draw call). */
export function buildStructures(plan: SitePlan, M: SiteMaterials, h: HeightFn): THREE.Mesh | null {
  const P = new Parts();
  // temenos wall: ashlar run with posts and a coping course
  for (const w of plan.walls) {
    const L = hyp(w.a, w.b); if (L < 0.05) continue; const yaw = Math.atan2(w.b.x - w.a.x, w.b.z - w.a.z); const mx = (w.a.x + w.b.x) / 2, mz = (w.a.z + w.b.z) / 2;
    const y0 = Math.min(h(w.a.x, w.a.z), h(w.b.x, w.b.z), h(mx, mz)) - 0.1;
    P.box(mx, y0, mz, TEMENOS.wallT, TEMENOS.wallH + 0.1, L, COL.limestone, yaw); P.box(mx, y0 + TEMENOS.wallH + 0.1, mz, TEMENOS.wallT + 0.1, 0.07, L + 0.02, COL.marble, yaw);
    const n = Math.max(1, Math.round(L / TEMENOS.postEvery)); for (let i = 0; i <= n; i++) { const x = w.a.x + ((w.b.x - w.a.x) * i) / n, z = w.a.z + ((w.b.z - w.a.z) * i) / n; P.box(x, y0, z, 0.42, TEMENOS.wallH + 0.28, 0.42, COL.marble, yaw); }
  }
  // gate piers beside each opening
  for (const g of plan.gates) for (const s of [-1, 1]) { const c = Math.cos(g.yaw), sn = Math.sin(g.yaw); const x = g.x + s * (g.w / 2) * c, z = g.z - s * (g.w / 2) * sn; if (g.id !== 'propylon') P.box(x, h(x, z) - 0.1, z, 0.5, 1.1, 0.5, COL.marble, g.yaw).box(x, h(x, z) + 1.0, z, 0.62, 0.1, 0.62, COL.limestone, g.yaw); }
  // terrace retaining walls (the stepped terraces that follow the contour)
  for (const t of plan.terraces) {
    if (!t.wall) continue; const hw = t.w / 2 + 0.2, hd = t.d / 2 + 0.2; const top = t.h;
    for (const [dx, dz, w, d] of [[0, hd, hw * 2, 0.22], [0, -hd, hw * 2, 0.22], [hw, 0, 0.22, hd * 2], [-hw, 0, 0.22, hd * 2]] as const) { const x = t.x + dx, z = t.z + dz; const y0 = Math.min(h(x, z), top) - 0.15; P.box(x, y0, z, w, top - y0 + 0.02, d, COL.limestone).box(x, top - 0.02, z, w + 0.06, 0.06, d + 0.06, COL.marble); }
  }
  // bridges: arched deck with parapets
  for (const b of plan.bridges) {
    const half = b.len / 2; const c = Math.cos(b.yaw), s = Math.sin(b.yaw); const yb = 0.0;
    P.box(b.x, yb, b.z, BRIDGE.w, 0.12, b.len + 0.5, COL.limestone, b.yaw);
    for (const sd of [-1, 1]) { const ox = (BRIDGE.w / 2) * sd; const x = b.x + ox * Math.cos(b.yaw), z = b.z - ox * Math.sin(b.yaw); P.box(x, yb + 0.12, z, BRIDGE.rail, 0.2, b.len + 0.5, COL.marble, b.yaw); }
    for (const e of [-1, 1]) { const x = b.x + e * (half + 0.2) * s, z = b.z + e * (half + 0.2) * c; P.box(x, yb - 0.1, z, BRIDGE.w + 0.2, 0.2, 0.34, COL.stoneDark, b.yaw); }
    P.box(b.x, yb - 0.55, b.z, BRIDGE.w - 0.3, 0.45, 0.3, COL.stoneDark, b.yaw);
  }
  // piers
  for (const p of plan.piers) {
    const c = Math.cos(p.yaw), s = Math.sin(p.yaw); const n = Math.round(p.len / 0.8);
    P.box(p.x + s * p.len / 2, -0.25, p.z + c * p.len / 2, 1.0, 0.07, p.len, COL.wood, p.yaw);
    for (let i = 0; i <= n; i++) for (const sd of [-1, 1]) { const d = (i / n) * p.len; P.box(p.x + s * d + c * 0.5 * sd, -1.0, p.z + c * d - s * 0.5 * sd, 0.1, 1.0, 0.1, tint(COL.wood, 0.8)); }
  }
  // unbuilt section foundations are owned by SiteHandle.section(id, false) (the town owns every section group)
  // cottages are authored glb variants (see index.ts); buildCottageProxies draws the stand-ins used until they load
  const g = P.build(); if (!g) return null; const m = new THREE.Mesh(g, M.vcol); m.castShadow = m.receiveShadow = true; return m;
}

/** Stand-in cottages (boxes) shown only until the authored cottage variants load. */
export function buildCottageProxies(plan: SitePlan, M: SiteMaterials, h: HeightFn): THREE.Mesh | null {
  const P = new Parts();
  // cottages: whitewashed walls, hipped terracotta roofs, small door
  for (const ct of plan.cottages) {
    const k = ct.scale; const w = 1.9 * k, d = 1.6 * k, wh = 1.0 * k; const y0 = h(ct.x, ct.z) - 0.05;
    P.box(ct.x, y0, ct.z, w, wh, d, ct.wall, ct.yaw); P.prism(ct.x, y0 + wh, ct.z, w * 1.1, d * 1.12, 0.7 * k, ct.roof, ct.yaw);
    const f = { x: Math.sin(ct.yaw), z: Math.cos(ct.yaw) }; P.box(ct.x + f.x * (d / 2 + 0.01), y0, ct.z + f.z * (d / 2 + 0.01), 0.28 * k, 0.5 * k, 0.04, COL.wood, ct.yaw);
  }
  const g = P.build(); if (!g) return null; const m = new THREE.Mesh(g, M.vcol); m.castShadow = m.receiveShadow = true; return m;
}
