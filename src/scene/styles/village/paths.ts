/**
 * Lanes, avenues, quays, the plaza and squares as ONE alpha-faded ribbon mesh (single draw call) with a PBR cobble set:
 * the tangent-space normal and ORM maps carry the relief, vertex colour tints per path kind, vertex alpha fades the verge into the grass.
 * Bridges are structures (placed assets), not ribbons.
 */
import * as THREE from 'three';
import { PLAZA, type V2 } from './config';
import type { VEdgeKind, VillagePlan } from './plan';
import type { TerrainTextureSet } from './tex';
import type { HeightFn } from './terrain';

const LIFT: Record<VEdgeKind, number> = { plaza: 0, bridge: 0, lane: 0.040, spur: 0.042, link: 0.044, spoke: 0.046, quay: 0.048 };
const TINT: Record<VEdgeKind, [number, number, number]> = { plaza: [1, 1, 1], bridge: [1, 1, 1], lane: [0.8, 0.74, 0.64], spur: [0.88, 0.8, 0.68], link: [0.95, 0.88, 0.76], spoke: [1, 0.94, 0.84], quay: [0.78, 0.8, 0.86] };
const VERGE = 0.3, UV = 0.5;

export interface VillagePaths { mesh: THREE.Mesh | null; dispose(): void }
export function buildVillagePaths(plan: VillagePlan, h: HeightFn, tex: TerrainTextureSet): VillagePaths {
  const pos: number[] = [], col: number[] = [], uv: number[] = [], idx: number[] = [];
  const vert = (x: number, z: number, y: number, c: readonly number[], a: number) => { pos.push(x, y, z); col.push(c[0], c[1], c[2], a); uv.push(x * UV, z * UV); return pos.length / 3 - 1; };
  const ribbon = (pts: readonly V2[], w: number, kind: VEdgeKind) => {
    if (pts.length < 2) return; const hw = w / 2, base = pos.length / 3; const c = TINT[kind]; const cols = [-(hw + VERGE), -hw, hw, hw + VERGE], al = [0, 1, 1, 0];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)]; const dx = b.x - a.x, dz = b.z - a.z; const l = Math.hypot(dx, dz) || 1; const nx = -dz / l, nz = dx / l;
      const y = Math.max(h(pts[i].x, pts[i].z), h(pts[i].x + nx * hw, pts[i].z + nz * hw), h(pts[i].x - nx * hw, pts[i].z - nz * hw)) + LIFT[kind];
      for (let k = 0; k < 4; k++) vert(pts[i].x + nx * cols[k], pts[i].z + nz * cols[k], y, c, al[k]);
    }
    for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k < 3; k++) { const a = base + i * 4 + k; idx.push(a, a + 4, a + 1, a + 1, a + 4, a + 5); }
  };
  const disc = (x: number, z: number, r0: number, r1: number, c: readonly number[], lift: number, fade = 0) => {
    const seg = 48; const base = pos.length / 3;
    for (let i = 0; i < seg; i++) { const a = (i / seg) * Math.PI * 2; const cx = Math.cos(a), sz = Math.sin(a); const y = Math.max(h(x + cx * r1, z + sz * r1), h(x, z)) + lift; vert(x + cx * r0, z + sz * r0, y, c, 1); vert(x + cx * (r1 + fade), z + sz * (r1 + fade), y, c, fade ? 0 : 1); }
    for (let i = 0; i < seg; i++) { const a = base + i * 2, b = base + ((i + 1) % seg) * 2; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  };
  for (const e of plan.edges) if (e.kind !== 'plaza' && e.kind !== 'bridge') ribbon(e.pts, e.w, e.kind);
  disc(PLAZA.x, PLAZA.z, 0, PLAZA.r, [1, 0.97, 0.9], 0.05, 0.25); disc(PLAZA.x, PLAZA.z, PLAZA.r - 0.35, PLAZA.r, [0.8, 0.78, 0.74], 0.052);
  for (const a of plan.areas) {
    if (a.kind === 'market') { disc(a.x, a.z, 0, a.r, [0.98, 0.93, 0.84], 0.05, 0.3); disc(a.x, a.z, a.r - 0.3, a.r, [0.78, 0.76, 0.72], 0.052); }
    if (a.kind === 'fishmarket') disc(a.x, a.z, 0, a.r, [0.84, 0.82, 0.8], 0.05, 0.3);
    if (a.kind === 'festival') disc(a.x, a.z, 0, a.r, [0.9, 0.82, 0.68], 0.05, 0.35);
  }
  if (!idx.length) return { mesh: null, dispose() { /* nothing */ } };
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  const t = tex.cobble; const m = new THREE.MeshStandardMaterial({ map: t.albedo, normalMap: t.normal, aoMap: t.orm, roughnessMap: t.orm, metalnessMap: t.orm, vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  tex.onMaps.push((k) => { if (k !== 'cobble') return; const c = tex.cobble; m.map = c.albedo; m.normalMap = c.normal; m.aoMap = m.roughnessMap = m.metalnessMap = c.orm; m.needsUpdate = true; });
  const mesh = new THREE.Mesh(g, m); mesh.name = 'village:paths'; mesh.receiveShadow = true; mesh.renderOrder = 1;
  return { mesh, dispose() { mesh.removeFromParent(); g.dispose(); m.dispose(); } };
}
