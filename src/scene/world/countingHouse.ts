import * as THREE from 'three';
import { finish } from '../finish';
import type { Mats } from '../types';
import { B, C, type Architecture } from './architecture';

/** The Counting House (help desk): small brick hall with a slate gable, shuttered windows, a hanging ledger plaque and stacked ledgers by the door. Local +z faces the plaza. */
export function makeCountingHouse(M: Mats, arch: Architecture, roof: THREE.Material): THREE.Group {
  const { gable, windowAt, doorAt, chimney, moulding } = arch;
  const g = new THREE.Group();
  g.add(B(3.7, 0.26, 3.1, M.stoneW, 0, 0.13, 0));
  g.add(B(3.4, 1.9, 2.8, M.brickW, 0, 1.21, 0, 0.9));
  g.add(moulding(3.4, 2.8, 2.16, M.stoneW, [[0, 0.07, 0.03]]));
  gable(g, 3.4, 2.8, 0.62, 2.22, roof, { wall: M.brickW, ov: 0.28 });
  arch.opts.stepsOff = 0.26;
  doorAt(g, 0, 0.26, 1.4, 0.5, 0.9, 0, true, 2);
  [-1.1, 1.1].forEach((x) => windowAt(g, x, 1.35, 1.415, 0.3, 0.52, 0, { arch: true, rows: 2, shutters: true }));
  [-0.8, 0.8].forEach((z) => [-1, 1].forEach((s) => windowAt(g, s * 1.715, 1.35, z, 0.28, 0.5, s * Math.PI / 2, { arch: true, rows: 2 })));
  [-0.9, 0.9].forEach((x) => windowAt(g, x, 1.35, -1.415, 0.3, 0.5, Math.PI, { arch: true, rows: 2 }));
  // Hanging plaque on an iron arm, right of the door.
  g.add(B(0.62, 0.04, 0.04, M.ink, 1.3, 2.05, 1.46));
  g.add(B(0.38, 0.34, 0.03, M.gold, 1.45, 1.8, 1.46));
  g.add(C(0.006, 0.006, 0.2, M.ink, 6, 1.33, 1.93, 1.46));
  // Ledgers stacked beside the door and a lantern above it.
  [[-0.95, 0.26 + 0.07, 1.55, M.ink], [-0.95, 0.26 + 0.2, 1.55, M.timber], [-0.9, 0.26 + 0.33, 1.55, M.ink]].forEach(([x, y, z, m], i) => g.add(B(0.42 - i * 0.03, 0.12, 0.3, m as THREE.Material, x as number, y as number, z as number, 0.4)));
  g.add(C(0.04, 0.05, 0.12, M.bronze, 12, 0, 1.45, 1.5));
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), M.lamp); bulb.position.set(0, 1.35, 1.5); g.add(bulb);
  g.userData.smoke = chimney(g, 1.0, 2.2, -0.6, 1.5, M.brickW);
  return finish(g, [roof], 3.7);
}
