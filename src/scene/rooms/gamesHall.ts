import * as THREE from 'three';
import { FONTS, INTERIOR } from '@/config/scene';
import type { InteriorRoom, PaintLine } from '../interiors';
import { framing, type RoomKit } from './kit';

const W = 1200; const H = 600; const BOARD_W = 6; const BOARD_H = 3; const MAX_ROWS = 5;
const INK = '#1f2b24'; const CHALK = '#f1ead8'; const MUTED = 'rgba(241,234,216,.55)'; const GOLD = '#d9b25f';
const PAWN: number[][] = [[0.001, 0], [0.19, 0], [0.19, 0.03], [0.11, 0.09], [0.08, 0.2], [0.13, 0.24], [0.05, 0.27], [0.09, 0.32], [0.09, 0.38], [0.001, 0.44]];
const KING: number[][] = [[0.001, 0], [0.2, 0], [0.2, 0.03], [0.12, 0.1], [0.08, 0.3], [0.14, 0.36], [0.1, 0.44], [0.001, 0.5]];
const STOOL: number[][] = [[0.001, 0], [0.2, 0], [0.2, 0.62], [0.24, 0.62], [0.24, 0.68], [0.001, 0.68]];
const m4 = new THREE.Matrix4();

const fit = (x: CanvasRenderingContext2D, s: string, w: number) => { let t = s; while (t.length > 1 && x.measureText(t).width > w) t = t.slice(0, -1); return t === s ? s : t.slice(0, -1) + '...'; };

/** Chalkboard scoreboard: title, up to five rows (rank, name, elo, wins) and an honest empty state. */
function paintBoard(c: HTMLCanvasElement, tx: THREE.CanvasTexture, rows: readonly PaintLine[]) {
  const x = c.getContext('2d')!; x.clearRect(0, 0, W, H);
  const bg = x.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#26352c'); bg.addColorStop(1, INK); x.fillStyle = bg; x.fillRect(0, 0, W, H);
  x.strokeStyle = 'rgba(217,178,95,.7)'; x.lineWidth = 6; x.strokeRect(22, 22, W - 44, H - 44);
  x.fillStyle = GOLD; x.font = `700 84px ${FONTS.serif}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('Leaderboard', W / 2, 96);
  x.fillStyle = 'rgba(241,234,216,.25)'; x.fillRect(120, 150, W - 240, 2);
  if (!rows.length) { x.fillStyle = MUTED; x.font = `italic 600 52px ${FONTS.serif}`; x.fillText('No games finished yet', W / 2, 340); tx.needsUpdate = true; return; }
  x.fillStyle = MUTED; x.font = `600 30px ${FONTS.body}`; x.textBaseline = 'middle';
  x.textAlign = 'left'; x.fillText('#', 130, 188); x.fillText('PLAYER', 210, 188); x.textAlign = 'right'; x.fillText('ELO', 880, 188); x.fillText('WINS', 1070, 188);
  rows.slice(0, MAX_ROWS).forEach((r, i) => {
    const y = 254 + i * 64; x.fillStyle = i === 0 ? GOLD : CHALK; x.font = `700 44px ${FONTS.serif}`;
    x.textAlign = 'left'; x.fillText(String(i + 1), 130, y); x.font = `600 44px ${FONTS.serif}`; x.fillText(fit(x, r.who ?? '', 480), 210, y);
    x.textAlign = 'right'; x.fillText(r.text ?? '', 880, y); x.fillText(r.label ?? '', 1070, y);
  });
  tx.needsUpdate = true;
}

/** The Games Hall (arcade): timber hall with a chess table, a checkers table, a connect-four stand, a shelf of game boxes and a chalkboard leaderboard. */
export function gamesHall(K: RoomKit): InteriorRoom {
  const { M, WK, m, mat, pendant, shell } = K; const { B, windowAt } = WK;
  const g = new THREE.Group(); shell(g, 11, 4.4, 8.6, m.wallP, m.floorWood, M.timber);
  for (let z = -3; z <= 3.1; z += 3) g.add(B(11, 0.2, 0.2, M.beam, 0, 4.15, z));
  const own: THREE.Material[] = []; const inst: THREE.InstancedMesh[] = [];
  const own1 = <T extends THREE.Material>(x: T) => { own.push(x); return x; };
  const tint = own1(mat({ roughness: 0.5 })); const blue = own1(mat({ color: 0x24407a, roughness: 0.4 }));
  const mk = (geo: THREE.BufferGeometry, material: THREE.Material, n: number, parent: THREE.Object3D) => { const im = new THREE.InstancedMesh(geo, material, n); im.castShadow = true; im.receiveShadow = true; parent.add(im); inst.push(im); return im; };
  const col = new THREE.Color();
  const put = (im: THREE.InstancedMesh, i: number, x: number, y: number, z: number, hex?: number) => { im.setMatrixAt(i, m4.makeTranslation(x, y, z)); if (hex != null) im.setColorAt(i, col.setHex(hex)); };
  const fin = (im: THREE.InstancedMesh) => { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; };

  // Leaderboard on the back wall.
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 8;
  const face = own1(new THREE.MeshStandardMaterial({ map: tx, roughness: 0.9 }));
  const wall = new THREE.Group(); wall.position.set(0, 2.45, -4.05);
  wall.add(B(BOARD_W + 0.4, BOARD_H + 0.4, 0.2, M.timber, 0, 0, -0.06, 0.6));
  const back = new THREE.Mesh(new THREE.PlaneGeometry(BOARD_W, BOARD_H), face); back.position.z = 0.05; wall.add(back); g.add(wall);
  let key: string | null = null;
  const paint = (data: unknown) => {
    const rows = (data as PaintLine[]).slice(0, MAX_ROWS); const k = rows.map((r) => `${r.who}|${r.text}|${r.label}`).join('\n');
    if (k === key) return; key = k; paintBoard(c, tx, rows);
  };
  paint([]);

  // Shared square geometry for both boards (8x8, 0.1 per square).
  const sq = new THREE.BoxGeometry(0.1, 0.03, 0.1); const LIGHT = 0xe6d3a8; const DARK = 0x6b4a2b;
  const tbl = (x: number, z: number) => { const t = new THREE.Group(); t.position.set(x, 0, z); t.add(B(1.2, 0.07, 1.2, M.timber, 0, 0.74, 0, 0.6)); [-1, 1].forEach((a) => [-1, 1].forEach((b) => t.add(B(0.08, 0.72, 0.08, M.beam, a * 0.52, 0.36, b * 0.52)))); g.add(t); return t; };
  const board = (t: THREE.Group) => { const im = mk(sq, tint, 64, t); for (let i = 0; i < 64; i++) { const f = i % 8, r = Math.floor(i / 8); put(im, i, -0.35 + f * 0.1, 0.8, -0.35 + r * 0.1, (f + r) % 2 ? DARK : LIGHT); } fin(im); };
  // Chess table: mid-game pawns plus two kings and two queens.
  const chess = tbl(-2.8, -0.6); board(chess);
  const pawns = mk(new THREE.LatheGeometry(PAWN.map(([r, y]) => new THREE.Vector2(r * 0.34, y * 0.34)), 14), tint, 14, chess); let pi = 0;
  [0, 1, 2, 4, 5, 6, 7].forEach((f) => put(pawns, pi++, -0.35 + f * 0.1, 0.815, 0.15 - 0.0, 0xf2ead8)); [0, 1, 3, 4, 5, 6, 7].forEach((f) => put(pawns, pi++, -0.35 + f * 0.1, 0.815, -0.15, 0x2b2118)); fin(pawns);
  const majors = mk(new THREE.LatheGeometry(KING.map(([r, y]) => new THREE.Vector2(r * 0.34, y * 0.34)), 14), tint, 4, chess);
  put(majors, 0, -0.05, 0.815, 0.35, 0xf2ead8); put(majors, 1, 0.05, 0.815, 0.35, 0xf2ead8); put(majors, 2, -0.05, 0.815, -0.35, 0x2b2118); put(majors, 3, 0.05, 0.815, -0.35, 0x2b2118); fin(majors);
  // Checkers table: eight discs a side on the dark squares.
  const checkers = tbl(2.8, -0.6); board(checkers);
  const discs = mk(new THREE.CylinderGeometry(0.04, 0.04, 0.025, 16), tint, 16, checkers); let di = 0;
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) { if ((f + r) % 2 !== 1) continue; if (r < 2) put(discs, di++, -0.35 + f * 0.1, 0.83, -0.35 + r * 0.1, 0xb23a2e); else if (r > 5) put(discs, di++, -0.35 + f * 0.1, 0.83, -0.35 + r * 0.1, 0xefe6d0); }
  fin(discs);
  // Stools around the tables (instanced).
  const stools = mk(new THREE.LatheGeometry(STOOL.map(([r, y]) => new THREE.Vector2(r, y)), 18), M.timber, 4, g);
  [[-2.8, 0.55], [-2.8, -1.75], [2.8, 0.55], [2.8, -1.75]].forEach(([x, z], i) => put(stools, i, x, 0, z)); fin(stools);
  // Connect four stand by the right wall: blue frame, 42 holes, 14 discs dropped in column order.
  const c4 = new THREE.Group(); c4.position.set(4.7, 0, -3.1); g.add(c4);
  [-1, 1].forEach((s) => c4.add(B(0.08, 0.5, 0.5, M.beam, s * 0.56, 0.25, 0))); c4.add(B(1.2, 0.08, 0.5, M.beam, 0, 0.5, 0)); c4.add(B(1.12, 0.96, 0.08, blue, 0, 1.02, 0));
  const hole = new THREE.CylinderGeometry(0.06, 0.06, 0.02, 16); hole.rotateX(Math.PI / 2); const holes = mk(hole, M.ink, 42, c4); const chips = mk(hole.clone(), tint, 14, c4); let ci = 0;
  const heights = [2, 3, 1, 3, 2, 1, 2];
  for (let f = 0; f < 7; f++) for (let r = 0; r < 6; r++) { const x = -0.45 + f * 0.15, y = 0.64 + r * 0.15; put(holes, f * 6 + r, x, y, 0.045); if (r < heights[f]) { put(chips, ci, x, y, 0.06, (f + r) % 2 ? 0xd7b02f : 0xb23a2e); ci++; } }
  fin(holes); fin(chips);
  // Shelf of game boxes on the left wall.
  const shelf = new THREE.Group(); shelf.position.set(-5.3, 0, 0.6); shelf.rotation.y = Math.PI / 2; g.add(shelf);
  [1.3, 1.9].forEach((y) => shelf.add(B(2.6, 0.06, 0.4, M.timber, 0, y, 0, 0.6))); [-1.3, 1.3].forEach((x) => shelf.add(B(0.06, 1.9, 0.4, M.beam, x, 0.95, 0)));
  const boxes = mk(new THREE.BoxGeometry(0.34, 0.08, 0.3), tint, 12, shelf); const BC = [0xb23a2e, 0x3f5f7a, 0x5b7447, 0xb8862f];
  for (let i = 0; i < 12; i++) put(boxes, i, -0.9 + (i % 6) * 0.36, (i < 6 ? 1.37 : 1.97) + (i % 3) * 0.0, 0, BC[i % 4]); fin(boxes);
  [-2.4, 2.4].forEach((z) => windowAt(g, -5.38, 2.3, z, 0.9, 1.5, Math.PI / 2, { arch: true, rows: 3, glass: M.daylight }));
  pendant(g, -2.4, 2.7, -0.6); pendant(g, 2.4, 2.7, -0.6, false);
  const h = INTERIOR.lights.commonsHemi; g.add(new THREE.HemisphereLight(h.sky, h.ground, h.intensity));
  const dispose = () => { tx.dispose(); own.forEach((o) => o.dispose()); inst.forEach((i) => i.dispose()); };
  (g as InteriorRoom).userData = { ...framing('gamesHall'), paint, dispose };
  return g as InteriorRoom;
}
