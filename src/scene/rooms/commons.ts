import * as THREE from 'three';
import { INTERIOR } from '@/config/scene';
import type { InteriorRoom, PaintLine } from '../interiors';
import { flicker, framing, type RoomKit } from './kit';
import { board, paintNotes } from './paint';

/** The Commons (chat): timber hall, two long tables, notice board, fireplace. */
export function commons(K: RoomKit): InteriorRoom {
  const { M, WK, m, mat, rep, shell, table, pendant, fireplace } = K; const { B, windowAt, T } = WK;
  const g = new THREE.Group(); shell(g, 11, 4.4, 9, m.wallP, m.floorWood, M.timber);
  for (let z = -3.4; z <= 3.5; z += 2.27) { g.add(B(11, 0.2, 0.2, M.beam, 0, 4.15, z)); g.add(B(0.14, 0.9, 0.14, M.beam, 0, 3.65, z)); [-1, 1].forEach((s) => { const br = B(0.12, 0.12, 3.1, M.beam, s * 1.4, 3.55, z); br.rotation.set(0, Math.PI / 2, s * 0.55); g.add(br); }); }
  for (let x = -4.4; x <= 4.5; x += 2.2) { g.add(B(0.16, 4.4, 0.08, M.beam, x, 2.2, -4.38)); } g.add(B(11, 0.12, 0.08, M.beam, 0, 1.0, -4.38));
  [-2.2, 0, 2.2].forEach((x) => windowAt(g, x, 2.45, -4.4, 1.0, 1.8, 0, { arch: true, rows: 3, glass: M.daylight }));
  table(g, -1.8, 0.3, 5.2); table(g, 1.8, 0.3, 5.2);
  [-1.8, 1.8].forEach((x) => [-1.4, 1.4].forEach((z) => pendant(g, x, 2.6, z + 0.3, z < 0)));
  const nb = board(2.9, 1.7, 1400); nb.m.position.set(-5.37, 1.95, 0.4); nb.m.rotation.y = Math.PI / 2; g.add(nb.m); g.add(B(0.08, 1.86, 3.06, M.beam, -5.42, 1.95, 0.4));
  const fp = fireplace(g, 5.2, 0.4, -Math.PI / 2);
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(3, 5), mat({ color: INTERIOR.mats.rug, roughness: 1, map: rep(T.plaster, 2, 3) })); rug.rotation.x = -Math.PI / 2; rug.position.set(0, 0.01, 0.4); g.add(rug);
  const h = INTERIOR.lights.commonsHemi; g.add(new THREE.HemisphereLight(h.sky, h.ground, h.intensity));
  (g as InteriorRoom).userData = { ...framing('commons'), paint: (list) => paintNotes(nb, list as PaintLine[], { grid: 3 }), tick: (t) => flicker(fp.flames, fp.light, t) };
  return g as InteriorRoom;
}
