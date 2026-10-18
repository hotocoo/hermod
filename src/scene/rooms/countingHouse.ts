import * as THREE from 'three';
import { FONTS, INTERIOR } from '@/config/scene';
import type { InteriorRoom, PaintLine } from '../interiors';
import { framing, type RoomKit } from './kit';

const COLS = 6; const ROWS = 4; const HOLE_W = 1.2; const HOLE_H = 0.8;

/** Pigeonhole wall: one cubby per queue, labelled with the queue name and its open-ticket count, painted on a single canvas. */
function paintHoles(c: HTMLCanvasElement, tx: THREE.CanvasTexture, rows: PaintLine[]) {
  const x = c.getContext('2d')!; const W = c.width, H = c.height; const cw = W / COLS, ch = H / ROWS;
  x.fillStyle = '#2a1d12'; x.fillRect(0, 0, W, H);
  for (let i = 0; i < COLS * ROWS; i++) {
    const cx = (i % COLS) * cw, cy = Math.floor(i / COLS) * ch; const row = rows[i];
    const g = x.createLinearGradient(cx, cy, cx, cy + ch); g.addColorStop(0, '#1b120b'); g.addColorStop(1, '#3a2a1c'); x.fillStyle = g; x.fillRect(cx + 8, cy + 8, cw - 16, ch - 16);
    if (!row) continue;
    const n = Math.min(12, Number(row.text) || 0);
    for (let k = 0; k < n; k++) { x.fillStyle = k % 2 ? '#efe6d2' : '#f7f0e0'; x.save(); x.translate(cx + cw * 0.5, cy + ch - 18 - k * 5); x.rotate(((k * 37) % 7 - 3) * 0.012); x.fillRect(-cw * 0.36, -4, cw * 0.72, 6); x.restore(); }
    x.fillStyle = '#b08a4a'; x.fillRect(cx + cw * 0.18, cy + 14, cw * 0.64, 34);
    x.fillStyle = '#2a1d12'; x.font = `600 ${Math.round(cw / 9)}px ${FONTS.serif}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText((row.who ?? '').slice(0, 14), cx + cw / 2, cy + 31);
    x.fillStyle = '#f6efe0'; x.font = `600 ${Math.round(ch / 3)}px ${FONTS.serif}`; x.fillText(row.text ?? '0', cx + cw / 2, cy + ch * 0.58);
  }
  tx.needsUpdate = true;
}

/** The Counting House (help desk): timber hall, a long counter with ledgers, and a pigeonhole wall showing open tickets per queue. */
export function countingHouse(K: RoomKit): InteriorRoom {
  const { M, WK, m, pendant, shell } = K; const { B, C, lathe, windowAt } = WK;
  const g = new THREE.Group(); shell(g, 11, 4.4, 8.6, m.wallP, m.floorWood, M.timber);
  for (let z = -3; z <= 3.1; z += 3) g.add(B(11, 0.2, 0.2, M.beam, 0, 4.15, z));
  // Pigeonhole wall.
  const wall = new THREE.Group(); wall.position.set(0, 2.15, -4.05);
  const fw = COLS * HOLE_W, fh = ROWS * HOLE_H;
  wall.add(B(fw + 0.4, fh + 0.4, 0.3, M.timber, 0, 0, -0.1, 0.6));
  for (let i = 0; i <= COLS; i++) wall.add(B(0.06, fh, 0.34, M.beam, -fw / 2 + i * HOLE_W, 0, 0.05, 0.6));
  for (let j = 0; j <= ROWS; j++) wall.add(B(fw, 0.06, 0.34, M.beam, 0, -fh / 2 + j * HOLE_H, 0.05, 0.6));
  const c = document.createElement('canvas'); c.width = 1440; c.height = 640;
  const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 8;
  const back = new THREE.Mesh(new THREE.PlaneGeometry(fw, fh), new THREE.MeshStandardMaterial({ map: tx, roughness: 0.9 })); back.position.z = 0.04; wall.add(back);
  g.add(wall);
  paintHoles(c, tx, []);
  // Counter with ledgers, a bell and a quill pot.
  const counter = new THREE.Group(); counter.position.set(0, 0, -1.4);
  counter.add(B(7, 1.0, 1.0, M.timber, 0, 0.5, 0, 0.6)); counter.add(B(7.3, 0.08, 1.3, M.beam, 0, 1.04, 0, 0.6));
  [-3, -1.5, 0, 1.5, 3].forEach((x, i) => { const gap = i % 2 ? 0.014 : 0; counter.add(B(0.02, 0.9, 0.02, M.ink, x, 0.5, 0.51 + gap)); });
  [[-2.4, 0.26, 0.3], [-1.2, 0.2, -0.1], [1.3, 0.3, 0.2], [2.5, 0.22, -0.2]].forEach(([x, h, z], i) => {
    for (let k = 0; k < 3; k++) counter.add(B(0.52, 0.07, 0.38, k % 2 ? M.ink : m.velvet, x + (k % 2) * 0.03, 1.1 + 0.07 * k + h * 0.2 * (i % 2), z, 0.4));
  });
  const bell = lathe([[0.001, 0.12], [0.03, 0.12], [0.08, 0.06], [0.1, 0], [0.001, 0]], m.brass, 24); bell.position.set(0.4, 1.08, 0.25); counter.add(bell);
  const pot = C(0.05, 0.05, 0.1, m.brass, 16, -0.4, 1.13, 0.2); counter.add(pot);
  [-0.18, -0.12, -0.06].forEach((dx, i) => { const q = B(0.01, 0.34, 0.01, M.trim, -0.4 + dx, 1.35, 0.2); q.rotation.z = 0.2 - i * 0.2; counter.add(q); });
  g.add(counter);
  // Stools behind the counter and a side window.
  [-2.2, 0.8, 2.6].forEach((x) => { const st = lathe([[0.2, 0.62], [0.2, 0.68], [0, 0.68]], M.timber, 24); st.position.set(x, 0, -2.5); g.add(st); [0, 2.1, 4.2].forEach((a) => { const lg = C(0.02, 0.025, 0.64, M.beam, 8, x + Math.cos(a) * 0.12, 0.31, -2.5 + Math.sin(a) * 0.12); lg.rotation.set(Math.sin(a) * 0.15, 0, -Math.cos(a) * 0.15); g.add(lg); }); });
  [1.8, 3.2].forEach((z) => windowAt(g, -5.38, 2.3, z - 1.5, 0.9, 1.5, Math.PI / 2, { arch: true, rows: 3, glass: M.daylight }));
  pendant(g, -1.8, 2.7, 0.2); pendant(g, 1.8, 2.7, 0.2, false);
  const h = INTERIOR.lights.commonsHemi; g.add(new THREE.HemisphereLight(h.sky, h.ground, h.intensity));
  (g as InteriorRoom).userData = { ...framing('countingHouse'), paint: (rows) => paintHoles(c, tx, rows as PaintLine[]) };
  return g as InteriorRoom;
}
