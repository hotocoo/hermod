import * as THREE from 'three';
import { INTERIOR } from '@/config/scene';
import { rng } from '../rng';
import type { Mats } from '../types';
import type { World } from '../world';

const { mats: MC, lights: L } = INTERIOR;

/** Shared interior materials and furniture builders; created once per town. */
export function createRoomKit(M: Mats, WK: World) {
  const { B, C, lathe, T } = WK;
  const rep = (t: THREE.Texture, x: number, y: number) => { const c = t.clone(); c.needsUpdate = true; c.wrapS = c.wrapT = THREE.RepeatWrapping; c.repeat.set(x, y); return c; };
  const mat = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(o);
  const m = {
    floorWood: mat({ color: MC.floorWood, map: rep(T.plank, 6, 6), normalMap: rep(T.plankN, 6, 6), normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.55 }),
    floorStone: mat({ color: MC.floorStone, map: rep(T.ashlar, 4, 4), normalMap: rep(T.ashlarN, 4, 4), normalScale: new THREE.Vector2(0.7, 0.7), roughness: 0.35 }),
    floorConc: mat({ color: MC.floorConc, map: rep(T.plaster, 3, 3), normalMap: rep(T.plasterN, 3, 3), normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.8 }),
    wallP: mat({ color: MC.wallPlaster, map: rep(T.plaster, 3, 2), normalMap: rep(T.plasterN, 3, 2), normalScale: new THREE.Vector2(0.45, 0.45), roughness: 0.95 }),
    wallB: mat({ color: MC.wallBrick, map: rep(T.brick, 3, 2), normalMap: rep(T.brickN, 3, 2), normalScale: new THREE.Vector2(1, 1), roughness: 0.9 }),
    wallS: mat({ color: MC.wallStone, map: rep(T.ashlar, 6, 3), normalMap: rep(T.ashlarN, 6, 3), normalScale: new THREE.Vector2(1, 1), roughness: 0.9, side: THREE.BackSide }),
    cork: mat({ color: MC.cork, map: rep(T.rock, 2, 2), roughness: 1 }),
    velvet: mat({ color: MC.velvet, roughness: 0.9 }),
    brass: mat({ color: MC.brass, roughness: 0.3, metalness: 0.85 }),
  };
  const pl = (s: { color: number; intensity: number; distance: number; decay: number }) => new THREE.PointLight(s.color, s.intensity, s.distance, s.decay);

  const pendant = (g: THREE.Object3D, x: number, y: number, z: number, light?: boolean) => {
    g.add(C(0.006, 0.006, 4.4 - y, M.ink, 6, x, y + (4.4 - y) / 2, z));
    const sh = lathe([[0.02, 0.32], [0.06, 0.3], [0.2, 0.12], [0.3, 0.0], [0.29, -0.01]], m.brass, 48); sh.position.set(x, y - 0.32, z); g.add(sh);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 24, 16), M.lamp); bulb.position.set(x, y - 0.3, z); g.add(bulb);
    if (light !== false) { const l = pl(L.pendant); l.position.set(x, y - 0.45, z); l.userData.shadowCandidate = true; g.add(l); }
  };
  const shell = (g: THREE.Object3D, w: number, h: number, d: number, wall: THREE.Material, floor: THREE.Material, ceil?: THREE.Material) => {
    g.add(B(w, 0.1, d, floor, 0, -0.05, 0)); g.add(B(w, h, 0.2, wall, 0, h / 2, -d / 2)); g.add(B(w, h, 0.2, wall, 0, h / 2, d / 2)); g.add(B(0.2, h, d, wall, -w / 2, h / 2, 0)); g.add(B(0.2, h, d, wall, w / 2, h / 2, 0)); g.add(B(w, 0.14, d, ceil || M.timber, 0, h + 0.07, 0));
    [-1, 1].forEach((s) => { g.add(B(w, 0.14, 0.06, M.trim, 0, 0.07, s * (d / 2 - 0.12))); g.add(B(0.06, 0.14, d, M.trim, s * (w / 2 - 0.12), 0.07, 0)); });
  };
  const fireplace = (g: THREE.Object3D, x: number, z: number, ry: number) => {
    const f = new THREE.Group(); f.position.set(x, 0, z); f.rotation.y = ry;
    f.add(B(1.9, 4.2, 0.6, M.stoneW, 0, 2.1, 0)); f.add(B(1.1, 0.9, 0.4, M.ink, 0, 0.55, 0.12)); f.add(B(2.1, 0.12, 0.8, M.stoneW, 0, 1.12, 0.12)); f.add(B(1.6, 0.06, 0.7, M.stoneW, 0, 0.03, 0.5));
    for (let i = 0; i < 3; i++) { const lg = C(0.06, 0.07, 0.6, M.barkM, 16, 0, 0.18, 0.2); lg.rotation.z = Math.PI / 2; lg.rotation.y = (i - 1) * 0.5; f.add(lg); }
    const fl = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 24, 6), M.flameA); fl.position.set(0, 0.45, 0.2); f.add(fl);
    const fl2 = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.32, 24, 6), M.flameB); fl2.position.set(0.05, 0.4, 0.22); f.add(fl2);
    const l = pl(L.fire); l.position.set(0, 0.7, 0.6); f.add(l);
    g.add(f); return { flames: [fl, fl2], light: l };
  };
  const table = (g: THREE.Object3D, x: number, z: number, len: number, ry?: number) => {
    const t = new THREE.Group(); t.position.set(x, 0, z); t.rotation.y = ry || 0;
    t.add(B(1.1, 0.07, len, M.timber, 0, 0.78, 0, 0.6));
    [-1, 1].forEach((sx) => [-1, 1].forEach((sz) => t.add(B(0.08, 0.74, 0.08, M.beam, sx * 0.45, 0.38, sz * (len / 2 - 0.2)))));
    [-1, 1].forEach((s) => { t.add(B(0.32, 0.05, len - 0.2, M.timber, s * 0.85, 0.46, 0, 0.6)); [-1, 1].forEach((sz) => t.add(B(0.05, 0.44, 0.24, M.beam, s * 0.85, 0.22, sz * (len / 2 - 0.4)))); });
    const R = rng('tbl' + x + z);
    for (let i = 0; i < 6; i++) { const mug = lathe([[0, 0], [0.045, 0], [0.05, 0.1], [0.045, 0.11], [0, 0.11]], M.trim, 24); mug.position.set((R() - 0.5) * 0.7, 0.815, (R() - 0.5) * (len - 0.6)); t.add(mug); }
    for (let i = 0; i < 3; i++) { const bk = B(0.22, 0.04 + R() * 0.03, 0.3, mat({ color: MC.books[i], roughness: 0.8 }), (R() - 0.5) * 0.5, 0.84, (R() - 0.5) * (len - 0.8)); bk.rotation.y = R(); t.add(bk); }
    const cd = lathe([[0, 0], [0.04, 0], [0.03, 0.02], [0.022, 0.03], [0.022, 0.2], [0, 0.2]], M.trim, 16); cd.position.set(0, 0.815, 0); t.add(cd);
    const fl = new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 10), M.flameB); fl.scale.y = 2; fl.position.set(0, 1.04, 0); t.add(fl);
    g.add(t); return t;
  };
  return { M, WK, rep, mat, m, pl, pendant, shell, fireplace, table };
}
export type RoomKit = ReturnType<typeof createRoomKit>;

/** Camera framing from config as vectors. */
export const framing = (k: keyof typeof INTERIOR.cams) => ({ cam: new THREE.Vector3(...INTERIOR.cams[k].cam), look: new THREE.Vector3(...INTERIOR.cams[k].look) });

/** Flame flicker and fire breathing, shared by rooms with a hearth. */
export function flicker(flames: THREE.Object3D[], fire: THREE.PointLight | null, t: number) {
  const F = INTERIOR.flicker, L2 = L.fire;
  flames.forEach((f, i) => { f.scale.set(1, F.base + Math.sin(t * F.speed + i) * F.swing + Math.random() * F.jitter, 1); });
  if (fire) fire.intensity = L2.base + Math.sin(t * L2.speed) * L2.swing + Math.random() * L2.jitter;
}
