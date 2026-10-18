import * as THREE from 'three';
import { INTERIOR } from '@/config/scene';
import { rng } from '../rng';
import type { InteriorRoom, PaintLine } from '../interiors';
import { framing, type RoomKit } from './kit';
import { board, paintNotes } from './paint';

/** The Loom (skein): round stone tower, spiral stair, turning spool with threads to the walls. */
export function loom(K: RoomKit): InteriorRoom {
  const { M, WK, m } = K; const { B, C, lathe, windowAt } = WK; const Lt = INTERIOR.lights;
  const g = new THREE.Group(); const r = 4.6, h = 7;
  g.add(lathe([[r, 0], [r, h], [r * 0.6, h + 1.2], [0.01, h + 1.6]], m.wallS, 96));
  const fl = new THREE.Mesh(new THREE.CircleGeometry(r, 96), m.floorWood); fl.rotation.x = -Math.PI / 2; g.add(fl);
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + 0.3; windowAt(g, Math.sin(a) * (r - 0.06), 3.2, Math.cos(a) * (r - 0.06), 0.6, 1.5, a + Math.PI, { arch: true, rows: 3, glass: M.daylight }); }
  for (let i = 0; i < 26; i++) { const a = (i / 26) * Math.PI * 2; const s = B(1.0, 0.1, 0.36, M.timber, Math.sin(a) * (r - 0.45), 0.2 + i * 0.26, Math.cos(a) * (r - 0.45)); s.rotation.y = a + Math.PI / 2; g.add(s); }
  const spool = new THREE.Group(); const fl1 = lathe([[0, 0], [1.3, 0], [1.38, 0.06], [1.38, 0.16], [1.25, 0.2], [0.6, 0.22], [0.55, 0.22]], M.trim, 96); spool.add(fl1);
  const fl2 = fl1.clone(); fl2.rotation.x = Math.PI; fl2.position.y = 2.6; spool.add(fl2); spool.add(C(0.55, 0.55, 2.4, M.timber, 64, 0, 1.3, 0));
  for (let i = 0; i < 26; i++) { const t = new THREE.Mesh(new THREE.TorusGeometry(0.62 + Math.sin(i * 0.7) * 0.03, 0.05, 20, 96), M.gold); t.rotation.x = Math.PI / 2; t.position.y = 0.32 + i * 0.08; spool.add(t); }
  g.add(spool);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2; const p0 = new THREE.Vector3(Math.cos(a) * 0.68, 1.4 + (i % 3) * 0.5, Math.sin(a) * 0.68), p2 = new THREE.Vector3(Math.cos(a) * (r - 0.6), 1.2 + i * 0.55, Math.sin(a) * (r - 0.6));
    const mid = p0.clone().lerp(p2, 0.5); mid.y += 0.9; g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(p0, mid, p2), 48, 0.012, 8), M.thread));
  }
  const tags = board(3.2, 1.2, 1400); tags.m.position.set(0, 3.6, -1.6); tags.m.lookAt(0, 3.4, 3); g.add(tags.m); g.add(B(3.3, 0.06, 0.06, m.brass, 0, 4.22, -1.62));
  const R = rng('spools');
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2; const s2 = lathe([[0, 0], [0.12, 0], [0.12, 0.03], [0.07, 0.04], [0.07, 0.2], [0.12, 0.21], [0.12, 0.24], [0, 0.24]], M.trim, 24);
    s2.position.set(Math.sin(a) * (r - 0.4), 0.25 + Math.floor(R() * 26) * 0.26, Math.cos(a) * (r - 0.4)); g.add(s2);
    const th = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.03, 12, 32), M.gold); th.rotation.x = Math.PI / 2; th.position.copy(s2.position).add(new THREE.Vector3(0, 0.12, 0)); g.add(th);
  }
  const l1 = K.pl(Lt.loomTop); l1.position.set(0, 5, 1.5); g.add(l1); const l2 = K.pl(Lt.loomLow); l2.position.set(0, 1.2, 1.2); g.add(l2);
  g.add(new THREE.HemisphereLight(Lt.loomHemi.sky, Lt.loomHemi.ground, Lt.loomHemi.intensity));
  (g as InteriorRoom).userData = { ...framing('loom'), paint: (list) => paintNotes(tags, list as PaintLine[], { grid: 3, bg: INTERIOR.notes.loomBoard }), tick: (t) => { spool.rotation.y = t * INTERIOR.spoolSpeed; } };
  return g as InteriorRoom;
}
