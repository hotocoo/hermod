import * as THREE from 'three';
import { INTERIOR } from '@/config/scene';
import { rng } from '../rng';
import type { InteriorRoom, PaintLine } from '../interiors';
import { framing, type RoomKit } from './kit';
import { artTex } from './paint';

const SPOTS: [number, number, number][] = [[-3.6, -4.38, 0], [0, -4.38, 0], [3.6, -4.38, 0], [-5.88, -1.6, Math.PI / 2], [-5.88, 1.8, Math.PI / 2]];

/** The Gallery (feed): skylit hall, framed works with spotlights, benches, rope line, visitors. */
export function gallery(K: RoomKit): InteriorRoom {
  const { M, WK, m, mat, shell } = K; const { B, lathe, column, moulding } = WK; const Lt = INTERIOR.lights;
  const g = new THREE.Group(); shell(g, 12, 5, 9, m.wallP, m.floorStone, M.trim);
  g.add(B(5, 0.04, 3, M.daylight, 0, 4.98, 0)); g.add(B(5.3, 0.2, 0.15, M.trim, 0, 4.9, 1.55), B(5.3, 0.2, 0.15, M.trim, 0, 4.9, -1.55));
  g.add(moulding(12, 9, 4.6, M.trim, [[0, 0.06, -0.05], [0.06, 0.08, -0.1]]));
  const frames: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>[] = [];
  SPOTS.forEach(([x, z, ry], i) => {
    const f = new THREE.Group(); f.position.set(x, 2.3, z); f.rotation.y = ry; const w = i === 1 ? 2.4 : 1.8, h = i === 1 ? 1.8 : 1.35;
    f.add(B(w + 0.24, h + 0.24, 0.08, M.gold, 0, 0, 0.02)); f.add(B(w + 0.1, h + 0.1, 0.1, m.brass, 0, 0, 0.03));
    const art = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat({ map: artTex('artwork', 20 + i * 47), roughness: 0.7 })); art.position.z = 0.09; f.add(art);
    f.add(B(0.4, 0.12, 0.02, m.brass, 0, -h / 2 - 0.3, 0.05)); g.add(f); frames.push(art);
    const s = Lt.gallerySpot; const sp = new THREE.SpotLight(s.color, s.intensity, s.distance, s.angle, s.penumbra, s.decay); sp.position.set(x + (ry ? 1.4 : 0), 4.6, z + (ry ? 0 : 1.6)); sp.target = art; g.add(sp);
  });
  [[-1.4, 1.0], [1.4, 1.0]].forEach(([x, z]) => { g.add(B(1.8, 0.1, 0.55, m.velvet, x, 0.45, z)); [-0.75, 0.75].forEach((dx) => g.add(B(0.08, 0.42, 0.45, m.brass, x + dx, 0.22, z))); });
  [-1, 1].forEach((s) => { const c1 = column(4.6, 0.2, true); c1.position.set(s * 4.3, 0, 2.6); g.add(c1); });
  for (let i = 0; i < 5; i++) {
    const x = -3.6 + i * 1.8; const post = lathe([[0.12, 0], [0.12, 0.04], [0.03, 0.08], [0.025, 0.85], [0.05, 0.9], [0.05, 0.98], [0, 1.0]], m.brass, 32); post.position.set(x, 0, -3.3); g.add(post);
    if (i < 4) g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(x, 0.9, -3.3), new THREE.Vector3(x + 0.9, 0.7, -3.3), new THREE.Vector3(x + 1.8, 0.9, -3.3)), 24, 0.025, 10), m.velvet));
  }
  const v1 = WK.person(rng('gv1'), 4); v1.position.set(-1.2, 0, -2.4); v1.rotation.y = Math.PI; v1.scale.setScalar(0.95); g.add(v1);
  const v2 = WK.person(rng('gv2'), 5); v2.position.set(0.5, 0, -2.6); v2.rotation.y = Math.PI + 0.3; v2.scale.setScalar(0.9); g.add(v2);
  g.add(new THREE.HemisphereLight(Lt.galleryHemi.sky, Lt.galleryHemi.ground, Lt.galleryHemi.intensity)); const fill = K.pl(Lt.galleryFill); fill.position.set(0, 4, 1); g.add(fill);
  (g as InteriorRoom).userData = { ...framing('gallery'), paint: (list) => { (list as PaintLine[]).slice(0, frames.length).forEach((it, i) => { frames[i].material.map = artTex(it.label || it.text || '', 20 + i * 47); frames[i].material.needsUpdate = true; }); } };
  return g as InteriorRoom;
}
