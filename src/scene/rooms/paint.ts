import * as THREE from 'three';
import { FONTS, INTERIOR } from '@/config/scene';
import { rng, type Rng } from '../rng';
import type { PaintColumn, PaintLine } from '../interiors';

const N = INTERIOR.notes;

export interface NoteBoard { m: THREE.Mesh; c: HTMLCanvasElement; tx: THREE.CanvasTexture }
export interface NotesOpts { bg?: string; grid?: number; cols?: PaintColumn[] }

/** Paper notes on a board, painted onto one canvas. */
export function board(w: number, h: number, px: number): NoteBoard {
  const c = document.createElement('canvas'); c.width = px; c.height = Math.round(px * h / w);
  const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 8;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tx, roughness: 0.95 }));
  return { m, c, tx };
}

function wrap(x: CanvasRenderingContext2D, text: string, maxW: number) {
  const words = String(text).split(' '); const lines: string[] = []; let line = '';
  words.forEach((wd) => { const t = line ? line + ' ' + wd : wd; if (x.measureText(t).width > maxW && line) { lines.push(line); line = wd; } else line = t; });
  if (line) lines.push(line); return lines;
}

function drawNote(x: CanvasRenderingContext2D, X: number, Y: number, w: number, h: number, nt: PaintLine & { paper?: string }, R: Rng) {
  x.save(); x.translate(X + w / 2, Y + h / 2); x.rotate((R() - 0.5) * 0.06);
  x.shadowColor = N.shadow; x.shadowBlur = 10; x.shadowOffsetY = 4; x.fillStyle = nt.paper || N.paper; x.fillRect(-w / 2, -h / 2, w, h);
  x.shadowColor = 'transparent'; x.fillStyle = N.pin; x.beginPath(); x.arc(0, -h / 2 + 12, 7, 0, Math.PI * 2); x.fill();
  const fs = Math.max(14, Math.round(w / 12));
  x.fillStyle = N.who; x.font = `600 ${Math.round(fs * 0.8)}px ${FONTS.body}`; x.fillText((nt.who || '').toUpperCase(), -w / 2 + 14, -h / 2 + 40);
  x.fillStyle = N.text; x.font = `italic ${fs}px ${FONTS.serif}`;
  wrap(x, nt.text || '', w - 28).slice(0, Math.max(1, Math.floor((h - 56) / (fs * 1.15)))).forEach((ln, i) => x.fillText(ln, -w / 2 + 14, -h / 2 + 44 + (i + 1) * fs * 1.15));
  x.restore();
}

export function paintNotes(bd: NoteBoard, notes: PaintLine[], opts: NotesOpts) {
  const { c, tx } = bd; const x = c.getContext('2d')!; const W = c.width, H = c.height; const R = rng('notes');
  x.fillStyle = opts.bg || N.board; x.fillRect(0, 0, W, H);
  for (let i = 0; i < 3000; i++) { x.fillStyle = `rgba(${R() < 0.5 ? 60 : 255},${R() < 0.5 ? 40 : 230},20,${R() * 0.12})`; x.fillRect(R() * W, R() * H, 2, 2); }
  if (opts.cols) {
    const cw = W / opts.cols.length;
    opts.cols.forEach((col, ci) => { x.fillStyle = N.heading; x.font = `600 ${Math.round(W / 34)}px ${FONTS.serif}`; x.fillText(col.name, ci * cw + 24, 52); col.cards.forEach((cd, k) => drawNote(x, ci * cw + 18, 76 + k * (H * 0.2), cw - 36, H * 0.17, cd, R)); });
  } else {
    const n = notes.length, cols = opts.grid || 3, rows = Math.ceil(n / cols), nw = W / cols, nh = (H - 20) / Math.max(rows, 2);
    notes.forEach((nt, i) => drawNote(x, (i % cols) * nw + 16, 14 + Math.floor(i / cols) * nh, nw - 32, nh - 22, nt, R));
  }
  tx.needsUpdate = true;
}

export function artTex(label: string, hue: number) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 384; const x = c.getContext('2d')!;
  const g = x.createLinearGradient(0, 0, 0, 384); g.addColorStop(0, `hsl(${hue},28%,72%)`); g.addColorStop(1, `hsl(${(hue + 30) % 360},30%,42%)`); x.fillStyle = g; x.fillRect(0, 0, 512, 384);
  x.strokeStyle = 'rgba(255,255,255,.08)'; for (let i = -384; i < 512; i += 14) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 384, 384); x.stroke(); }
  x.fillStyle = N.artLabel; x.font = N.artFont; x.fillText(label, 22, 360);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
