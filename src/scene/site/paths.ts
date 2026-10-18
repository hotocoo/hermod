import * as THREE from 'three';
import { COL, FIXED, type V2 } from './config';
import { along, polyLen } from './geo';
import type { HeightFn } from './height';
import type { SiteMaterials } from './materials';
import type { SitePlan } from './plan';

const lift = 0.09;
const kindCol = { way: COL.paveWay, lane: COL.paveLane, spur: COL.paveLane, stair: COL.paveWay, bridge: COL.paveWay } as const;

/** Paved ways, lanes and plazas as one vertex coloured ribbon mesh (single draw call). Bridges get their own deck in structures. */
export function buildPaths(plan: SitePlan, M: SiteMaterials, h: HeightFn): THREE.Mesh | null {
  const pos: number[] = [], col: number[] = [], idx: number[] = []; const c = new THREE.Color();
  let layer = 0;
  const vert = (x: number, z: number, hex: number, k = 1, y = h(x, z)) => { c.setHex(hex).multiplyScalar(k); pos.push(x, y + lift + layer * 0.012, z); col.push(c.r, c.g, c.b); return pos.length / 3 - 1; };
  const ribbon = (pts: readonly V2[], w: number, hex: number, k: number, ytw = 0, L = 1) => {
    layer = L;
    const len = polyLen(pts); if (len < 0.05) return; const n = Math.max(1, Math.ceil(len / 0.4)); const base = pos.length / 3;
    for (let i = 0; i <= n; i++) {
      const a = along(pts, (i / n) * len); const nx = Math.cos(a.yaw), nz = -Math.sin(a.yaw); const ww = w / 2 + ytw;
      const y = Math.max(h(a.x, a.z), h(a.x - nx * ww, a.z - nz * ww), h(a.x + nx * ww, a.z + nz * ww));
      vert(a.x - nx * ww, a.z - nz * ww, hex, k, y); vert(a.x + nx * ww, a.z + nz * ww, hex, k, y);
    }
    for (let i = 0; i < n; i++) { const a = base + i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  };
  for (const e of plan.edges) {
    if (e.kind === 'bridge') continue;
    ribbon(e.pts, e.w, COL.paveEdge, 1, 0.07, 1); ribbon(e.pts, e.w, kindCol[e.kind], 1, 0, 2);
    if (e.kind === 'way') ribbon(e.pts, Math.max(0.3, e.w * 0.3), COL.marble, 1, 0, 3);
  }
  const disc = (x: number, z: number, r0: number, r1: number, hex: number, k = 1, L = 2) => {
    layer = L;
    const seg = 40; const base = pos.length / 3;
    for (let i = 0; i < seg; i++) { const a = (i / seg) * Math.PI * 2; vert(x + Math.sin(a) * r0, z + Math.cos(a) * r0, hex, k); vert(x + Math.sin(a) * r1, z + Math.cos(a) * r1, hex, k); }
    for (let i = 0; i < seg; i++) { const a = base + i * 2, b = base + ((i + 1) % seg) * 2; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  };
  const P = plan.plaza; disc(P.x, P.z, 0.0, P.r, COL.paveWay, 1, 2); disc(P.x, P.z, P.r - 0.35, P.r, COL.paveEdge, 1, 3); disc(P.x, P.z, 2.35, 2.5, COL.paveEdge, 1, 3); disc(P.x, P.z, 1.4, 1.5, COL.paveEdge, 1, 3); disc(P.x, P.z, 0.0, 1.4, COL.marble, 0.97, 3);
  const rect = (x: number, z: number, w: number, d: number, hex: number, k = 1, L = 2) => {
    layer = L;
    const base = pos.length / 3; const sx = Math.ceil(w / 0.5), sz = Math.ceil(d / 0.5);
    for (let i = 0; i <= sx; i++) for (let j = 0; j <= sz; j++) vert(x - w / 2 + (i / sx) * w, z - d / 2 + (j / sz) * d, hex, k);
    for (let i = 0; i < sx; i++) for (let j = 0; j < sz; j++) { const a = base + i * (sz + 1) + j; idx.push(a, a + 1, a + sz + 1, a + 1, a + sz + 2, a + sz + 1); }
  };
  const T = FIXED.temple; if (plan.tier >= T.tier) rect(T.x, T.z + T.d / 2 + T.steps * T.stepW + 1.3, 5.6, 2.6, COL.paveWay);
  const g = plan.gates[0]; if (g) { rect(g.x, g.z + 0.6, 4.6, 1.8, COL.paveWay); }
  if (!idx.length) return null;
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2)); geo.setIndex(idx); geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, M.pave); m.receiveShadow = true; m.renderOrder = 1; return m;
}
