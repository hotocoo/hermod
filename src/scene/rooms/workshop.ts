import * as THREE from 'three';
import { INTERIOR } from '@/config/scene';
import { rng } from '../rng';
import type { InteriorRoom, PaintColumn } from '../interiors';
import { framing, type RoomKit } from './kit';
import { board, paintNotes } from './paint';

/** The Workshop (board): brick shed, sawtooth roof, kanban board, two workbenches, shelving. */
export function workshop(K: RoomKit): InteriorRoom {
  const { M, WK, m, mat, shell, pendant } = K; const { B, C, lathe } = WK;
  const g = new THREE.Group(); shell(g, 12, 4.6, 9, m.wallB, m.floorConc, M.beam);
  for (let i = 0; i < 4; i++) { const x = -4.5 + i * 3; g.add(B(0.1, 0.8, 9, M.daylight, x + 1.4, 4.4, 0)); const r = B(3, 0.08, 9, M.slate, x, 4.62, 0); r.rotation.z = 0.25; g.add(r); }
  for (let z = -3; z <= 3; z += 3) g.add(B(12, 0.18, 0.14, M.ink, 0, 4.1, z));
  const kb = board(5.2, 2.2, 1800); kb.m.position.set(-0.6, 2.2, -4.38); g.add(kb.m); g.add(B(5.4, 2.4, 0.06, M.beam, -0.6, 2.2, -4.42));
  [[-2.2, 0.6], [1.8, 0.8]].forEach(([x, z]) => {
    const wb = new THREE.Group(); wb.position.set(x, 0, z); wb.add(B(2.4, 0.1, 1.0, M.timber, 0, 0.92, 0, 0.6));
    [-1, 1].forEach((sx) => [-1, 1].forEach((sz) => wb.add(B(0.1, 0.88, 0.1, M.beam, sx * 1.1, 0.44, sz * 0.42)))); wb.add(B(2.2, 0.05, 0.9, M.timber, 0, 0.3, 0));
    wb.add(B(0.22, 0.16, 0.2, M.ink, 1.0, 1.05, 0.38));
    const hh = C(0.018, 0.022, 0.32, M.timber, 12, -0.4, 0.99, 0.1); hh.rotation.z = Math.PI / 2; wb.add(hh, B(0.06, 0.06, 0.12, M.ink, -0.57, 0.99, 0.1));
    const saw = B(0.5, 0.004, 0.14, mat({ color: INTERIOR.mats.saw, metalness: 0.8, roughness: 0.3 }), 0.2, 0.975, -0.2); saw.rotation.y = 0.4; wb.add(saw);
    const stool = lathe([[0.18, 0.62], [0.18, 0.66], [0, 0.66]], M.timber, 32); stool.position.set(0, 0, 0.9); wb.add(stool);
    [0, 2.1, 4.2].forEach((a) => { const lg = C(0.02, 0.025, 0.64, M.beam, 8, Math.cos(a) * 0.12, 0.31, 0.9 + Math.sin(a) * 0.12); lg.rotation.set(Math.sin(a) * 0.15, 0, -Math.cos(a) * 0.15); wb.add(lg); });
    g.add(wb);
  });
  const sh = new THREE.Group(); sh.position.set(5.6, 0, 0); for (let k = 0; k < 4; k++) sh.add(B(0.6, 0.05, 6, M.timber, 0, 0.5 + k * 0.9, 0)); [-2.9, 0, 2.9].forEach((z) => sh.add(B(0.6, 3.4, 0.06, M.beam, 0, 1.7, z)));
  const R = rng('shelf'); for (let k = 0; k < 4; k++) for (let i = 0; i < 6; i++) { if (R() < 0.3) continue; const s = 0.3 + R() * 0.25; sh.add(B(s, s * 0.8, s, M.timber, (R() - 0.5) * 0.1, 0.52 + k * 0.9 + s * 0.4, -2.5 + i * 1)); }
  g.add(sh);
  [-2.2, 1.8].forEach((x) => pendant(g, x, 2.7, 0.7));
  const h = INTERIOR.lights.workshopHemi; g.add(new THREE.HemisphereLight(h.sky, h.ground, h.intensity));
  (g as InteriorRoom).userData = { ...framing('workshop'), paint: (cols) => paintNotes(kb, [], { cols: cols as PaintColumn[], bg: INTERIOR.notes.workshopBoard }) };
  return g as InteriorRoom;
}
