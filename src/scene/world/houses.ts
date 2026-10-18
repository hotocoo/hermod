import * as THREE from 'three';
import { GROWTH } from '@/config/scene';
import type { Rng } from '../rng';
import type { Mats } from '../types';
import { B, C, merge, mtx, type Architecture, type MergePart } from './architecture';
import { mergeStatic } from './staticMerge';

/** Member cottages: small gabled houses with lit windows, merged to a handful of draw calls each. Door faces +z (the plaza). */
export function createHouses(M: Mats, arch: Architecture) {
  const CT = GROWTH.cottage;
  const roofs = CT.roofs.map((c) => { const m = M.slate.clone(); m.color.set(c); m.userData.base = m.color.clone(); return m; });
  const walls = [M.plasterW, M.brickW, M.stoneW, M.plasterW];
  const hedgeGeo = new THREE.IcosahedronGeometry(0.14, 1); const greens = [0x55663d, 0x66794a, 0x4c5d37];

  function cottage(R: Rng): THREE.Group {
    const g = new THREE.Group(); const j = 1 + (R() - 0.5) * 2 * CT.scaleJitter; const w = CT.w * j, d = CT.d * (1 + (R() - 0.5) * 0.2), wh = CT.wallH * (0.9 + R() * 0.25); const y0 = 0.12;
    const wall = walls[Math.floor(R() * walls.length)]; const roof = roofs[Math.floor(R() * roofs.length)]; const pitch = CT.pitch * (0.9 + R() * 0.3);
    g.add(B(w + 0.14, y0, d + 0.14, M.stoneW, 0, y0 / 2, 0)); g.add(B(w, wh, d, wall, 0, y0 + wh / 2, 0, 1));
    g.add(B(w + 0.03, 0.05, d + 0.03, M.beam, 0, y0 + wh - 0.03, 0));
    arch.gable(g, w, d, pitch, y0 + wh, roof, { wall, ov: 0.16 });
    // door with step and lantern, two windows, side window
    g.add(B(0.34, 0.58, 0.05, M.timber, 0, y0 + 0.29, d / 2 + 0.02, 0.5)); g.add(B(0.46, 0.06, 0.2, M.stoneW, 0, y0 + 0.02, d / 2 + 0.12)); g.add(B(0.4, 0.05, 0.08, M.trim, 0, y0 + 0.61, d / 2 + 0.04));
    const lan = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), M.lamp); lan.position.set(0.26, y0 + 0.5, d / 2 + 0.08); g.add(lan);
    [-1, 1].forEach((k) => arch.windowAt(g, k * w * 0.3, y0 + wh * 0.6, d / 2 + 0.012, 0.2, 0.3, 0, { rows: 2, shutters: R() > 0.4 }));
    [-1, 1].forEach((k) => arch.windowAt(g, k * (w / 2 + 0.012), y0 + wh * 0.6, 0, 0.2, 0.28, k * Math.PI / 2, { rows: 2 }));
    arch.chimney(g, w * 0.26 * (R() > 0.5 ? 1 : -1), y0 + wh + 0.18, -d * 0.12, 0.55, wall === M.stoneW ? M.stoneW : M.brickW);
    // small garden: hedge blobs at the sides and front corners, a flower box, fence posts
    const parts: MergePart[] = []; const side = (x: number, z: number) => parts.push({ g: hedgeGeo, mtx: mtx(x, 0.13, z, 0, R() * 6, 0, 0.9 + R() * 0.6, 0.8 + R() * 0.4, 0.9 + R() * 0.6), col: new THREE.Color(greens[Math.floor(R() * 3)]) });
    for (let z = -d / 2; z <= d / 2; z += 0.3) { side(-w / 2 - 0.2, z); if (R() > 0.35) side(w / 2 + 0.2, z); }
    [0.1, 0.25].forEach((f) => side(w * (f + 0.15), d / 2 + 0.2));
    const hm = new THREE.Mesh(merge(parts), M.foliage); g.add(hm);
    for (let i = -3; i <= 3; i++) { if (Math.abs(i) < 1) continue; g.add(C(0.012, 0.012, 0.22, M.timber, 5, i * 0.26, 0.11, d / 2 + 0.52)); }
    g.add(B(0.18 * 7, 0.02, 0.015, M.timber, 0, 0.17, d / 2 + 0.52, 0.5));
    g.userData.roofMats = [roof]; g.userData.anchorY = CT.labelY;
    return mergeStatic(g);
  }
  return { cottage, roofs };
}
export type Cottage = ReturnType<typeof createHouses>['cottage'];
