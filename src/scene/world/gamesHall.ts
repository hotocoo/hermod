import * as THREE from 'three';
import { GAMES_HALL } from '@/config/scene';
import { finish } from '../finish';
import type { Mats } from '../types';
import { B, C, lathe, type Architecture } from './architecture';

/** Pawn profile (radius, height) shared by the door-flanking statues. */
const PAWN: number[][] = [[0.001, 0], [0.24, 0], [0.24, 0.05], [0.14, 0.14], [0.1, 0.34], [0.17, 0.4], [0.07, 0.44], [0.12, 0.52], [0.12, 0.62], [0.001, 0.72]];

/**
 * The Games Hall (arcade): plaster hall under a slate gable, a checkerboard sign above the door that glows when a game
 * waits for players, bunting on the front eave and two stone pawns by the steps. Local +z faces the plaza.
 * userData.arcadeSign is the sign material the town drives (emissiveIntensity); everything else is static.
 */
export function makeGamesHall(M: Mats, arch: Architecture, roof: THREE.Material): THREE.Group {
  const { gable, windowAt, doorAt, chimney, moulding } = arch; const S = GAMES_HALL;
  const g = new THREE.Group();
  g.add(B(3.9, 0.26, 3.2, M.stoneW, 0, 0.13, 0));
  g.add(B(3.6, 1.8, 2.9, M.plasterW, 0, 1.16, 0));
  g.add(moulding(3.6, 2.9, 2.06, M.trim, [[0, 0.06, 0.03]]));
  [-1.7, 1.7].forEach((x) => g.add(B(0.14, 1.8, 0.14, M.beam, x, 1.16, 1.43)));
  gable(g, 3.6, 2.9, 0.58, 2.12, roof, { wall: M.plasterW, ov: 0.28 });
  arch.opts.stepsOff = 0.26;
  doorAt(g, 0, 0.26, 1.45, 0.52, 0.9, 0, true, 2);
  [-1.2, 1.2].forEach((x) => windowAt(g, x, 1.2, 1.46, 0.3, 0.5, 0, { arch: true, rows: 2 }));
  [-0.8, 0.8].forEach((z) => [-1, 1].forEach((s) => windowAt(g, s * 1.815, 1.3, z, 0.28, 0.5, s * Math.PI / 2, { arch: true, rows: 2 })));
  [-0.9, 0.9].forEach((x) => windowAt(g, x, 1.3, -1.465, 0.3, 0.5, Math.PI, { arch: true, rows: 2 }));
  // Sign: warm panel (emissive, driven by the town) with a checkerboard of dark tiles on it.
  const sign = new THREE.MeshStandardMaterial({ color: S.signColor, emissive: S.glowColor, emissiveIntensity: S.idleGlow, roughness: 0.6 });
  g.add(B(1.7, 0.62, 0.05, M.timber, 0, 1.95, 1.47)); g.add(B(1.54, 0.46, 0.04, sign, 0, 1.95, 1.5));
  const tiles = new THREE.InstancedMesh(new THREE.BoxGeometry(0.19, 0.19, 0.02), M.ink, 8); const m4 = new THREE.Matrix4();
  let n = 0; for (let c = 0; c < 8; c++) for (let r = 0; r < 2; r++) if ((c + r) % 2 === 0) { m4.makeTranslation(-0.665 + c * 0.19, 1.855 + r * 0.19, 1.525); tiles.setMatrixAt(n++, m4); }
  tiles.instanceMatrix.needsUpdate = true; tiles.castShadow = false; g.add(tiles);
  // Bunting: triangular pennants along the front eave, one InstancedMesh with per-instance colour.
  const penGeo = new THREE.ConeGeometry(0.09, 0.2, 3); penGeo.rotateX(Math.PI); penGeo.rotateY(Math.PI / 2);
  const pen = new THREE.InstancedMesh(penGeo, new THREE.MeshStandardMaterial({ roughness: 0.85 }), S.pennants); const col = new THREE.Color();
  for (let i = 0; i < S.pennants; i++) { const t = i / (S.pennants - 1); m4.makeTranslation(-1.65 + t * 3.3, 2.2 - 0.1 * 4 * t * (1 - t), 1.62); pen.setMatrixAt(i, m4); pen.setColorAt(i, col.setHex(S.pennantColors[i % S.pennantColors.length])); }
  pen.instanceMatrix.needsUpdate = true; if (pen.instanceColor) pen.instanceColor.needsUpdate = true; g.add(pen);
  const wire = C(0.006, 0.006, 3.3, M.ink, 4, 0, 2.2, 1.62); wire.rotation.z = Math.PI / 2; g.add(wire);
  // Stone pawns flanking the steps.
  [-1, 1].forEach((s) => { const p = lathe(PAWN, M.stoneW, 20); p.position.set(s * 0.95, 0.26, 1.75); g.add(p); });
  g.userData.smoke = chimney(g, 1.1, 2.12, -0.7, 1.4, M.brickW);
  g.userData.arcadeSign = sign;
  return finish(g, [roof], 3.6);
}
