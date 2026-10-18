// Deterministic room layout solver. Pure (no three, no DOM): layout JSON + asset catalog + seed -> placements.
import { rng, type Rng } from '../../rng';
import type { ModelEntry } from '../../assets/types';
import type { Pool, Rect, RoomLayout, Rule, Wall } from './layoutTypes';

export type CatalogItem = Pick<ModelEntry, 'id' | 'category' | 'tags' | 'footprint' | 'surfaces' | 'lights' | 'slots'>;
export type Catalog = Record<string, CatalogItem>;

export type PlacementKind = 'floor' | 'wall' | 'ceiling' | 'surface';
export interface Placement {
  key: string; asset: string; group: string; kind: PlacementKind;
  pos: [number, number, number]; rotY: number;
  host?: string; under?: boolean;
}
export interface Seat { key: string; asset: string; pos: [number, number, number]; rotY: number; /** Local x of the seat along its piece (sofas hold several). */ lx: number; /** Table top height in front of the seat, when the chair belongs to a table set. */ tableY?: number }
export interface Emitter { key: string; asset: string; kind: string; pos: [number, number, number] }
export interface Solved {
  layout: string; seed: string; placements: Placement[]; seats: Seat[]; emitters: Emitter[];
  /** Attempts that found no valid spot (reported, never silently overlapped). */
  rejected: { rule: number; asset: string }[];
  /** Optional clutter (surface items, scatter) that found no room after many tries: dropped, not a layout error. */
  skipped: { rule: number; asset: string }[];
}

/** Oriented footprint plus vertical span, the one shape every overlap test uses. */
export interface Box { cx: number; cz: number; hw: number; hd: number; rot: number; y0: number; y1: number }
const GAP = 0.02;

export function boxOf(it: CatalogItem, x: number, y: number, z: number, rot: number): Box {
  return { cx: x, cz: z, hw: it.footprint.w / 2, hd: it.footprint.d / 2, rot, y0: y, y1: y + it.footprint.h };
}
const axes = (b: Box): [number, number][] => { const c = Math.cos(b.rot), s = Math.sin(b.rot); return [[c, -s], [s, c]]; };
function project(b: Box, ax: [number, number]): [number, number] {
  const [ux, uz] = axes(b); const r = b.hw * Math.abs(ux[0] * ax[0] + ux[1] * ax[1]) + b.hd * Math.abs(uz[0] * ax[0] + uz[1] * ax[1]);
  const c = b.cx * ax[0] + b.cz * ax[1]; return [c - r, c + r];
}
/** Oriented rectangles overlap (SAT) and their height spans overlap, with `gap` slack. */
export function overlaps(a: Box, b: Box, gap = GAP): boolean {
  if (a.y1 <= b.y0 + 1e-4 || b.y1 <= a.y0 + 1e-4) return false;
  for (const ax of [...axes(a), ...axes(b)]) { const pa = project(a, ax), pb = project(b, ax); if (pa[1] + gap <= pb[0] || pb[1] + gap <= pa[0]) return false; }
  return true;
}
/** Half-extents of the box along world x/z. */
const extent = (b: Box): [number, number] => { const c = Math.abs(Math.cos(b.rot)), s = Math.abs(Math.sin(b.rot)); return [b.hw * c + b.hd * s, b.hw * s + b.hd * c]; };

const WALL_ROT: Record<Wall, number> = { n: 0, s: Math.PI, e: -Math.PI / 2, w: Math.PI / 2 };
const pickFrom = (R: Rng, p: Pool): string => {
  if (!p.weights) return p.assets[Math.floor(R() * p.assets.length)];
  const t = p.weights.reduce((a, b) => a + b, 0); let r = R() * t;
  for (let i = 0; i < p.assets.length; i++) { r -= p.weights[i]; if (r <= 0) return p.assets[i]; }
  return p.assets[p.assets.length - 1];
};
const between = (R: Rng, [a, b]: [number, number]) => a + (b - a) * R();
const count = (R: Rng, [a, b]: [number, number]) => a + Math.floor(R() * (b - a + 1));

export function solve(layout: RoomLayout, catalog: Catalog, seed: string, opts: { structureOnly?: boolean } = {}): Solved {
  const Rc = rng(`${layout.id}|${seed}`); const Rs = rng(`${layout.id}|structure`); let R = Rs; // structure is seed independent so the baked lightmap matches every space; clutter follows the seed
  const { w: W, d: D, h: H } = layout.shell;
  const out: Solved = { layout: layout.id, seed, placements: [], seats: [], emitters: [], rejected: [], skipped: [] };
  const boxes: { box: Box; key: string; skip?: boolean; under?: boolean }[] = [];
  const item = (id: string) => { const c = catalog[id]; if (!c) throw new Error(`layout ${layout.id}: asset ${id} not in catalog`); return c; };
  let n = 0;

  // Openings and the keep-clear areas occupy space the solver must respect.
  for (const o of layout.shell.openings) {
    const t = 0.3; const rot = WALL_ROT[o.wall]; const horizontal = o.wall === 'n' || o.wall === 's';
    const cx = horizontal ? o.at : (o.wall === 'e' ? W / 2 - t / 2 : -W / 2 + t / 2); const cz = horizontal ? (o.wall === 'n' ? -D / 2 + t / 2 : D / 2 - t / 2) : o.at;
    boxes.push({ box: { cx, cz, hw: o.w / 2, hd: t / 2, rot, y0: o.sill, y1: o.sill + o.h }, key: `opening:${o.kind}` });
  }
  for (const r of layout.shell.keepClear) boxes.push({ box: { cx: (r.x[0] + r.x[1]) / 2, cz: (r.z[0] + r.z[1]) / 2, hw: (r.x[1] - r.x[0]) / 2, hd: (r.z[1] - r.z[0]) / 2, rot: 0, y0: 0, y1: 0.6 }, key: 'keepClear', skip: false });

  // the entry camera must never sit inside furniture: reserve its surroundings full height
  boxes.push({ box: { cx: layout.cam.cam[0], cz: layout.cam.cam[2], hw: 1.4, hd: 1.4, rot: 0, y0: 0, y1: 3 }, key: 'camera' });
  const fits = (b: Box, margin = 0.04, ceilOk = false): boolean => {
    const [ex, ez] = extent(b);
    return Math.abs(b.cx) + ex <= W / 2 - margin + 0.2 && Math.abs(b.cz) + ez <= D / 2 - margin + 0.2 && (ceilOk || b.y1 <= H + 1e-3);
  };
  const free = (b: Box, ignore: Set<string> = new Set(), gap = GAP): boolean => boxes.every((o) => ignore.has(o.key) || o.under || !overlaps(b, o.box, gap));
  const add = (group: string, kind: PlacementKind, asset: string, pos: [number, number, number], rotY: number, extra: Partial<Placement> = {}): Placement => {
    const it = item(asset); const key = `${group}:${asset}:${n++}`; const p: Placement = { key, asset, group, kind, pos, rotY, ...extra };
    out.placements.push(p); boxes.push({ key, box: boxOf(it, pos[0], pos[1], pos[2], rotY), under: p.under });
    const c = Math.cos(rotY), s = Math.sin(rotY);
    for (const l of it.lights) out.emitters.push({ key, asset, kind: l.kind, pos: [pos[0] + l.pos[0] * c + l.pos[2] * s, pos[1] + l.pos[1], pos[2] - l.pos[0] * s + l.pos[2] * c] });
    if (kind === 'floor' && it.tags.includes('seat')) {
      const seats = it.tags.includes('chair') || it.tags.includes('stool') ? 1 : Math.max(1, Math.floor(it.footprint.w / 0.6));
      const sy = seatSurface(it)?.y; if (sy !== undefined) for (let i = 0; i < seats; i++) { const lx = seats === 1 ? 0 : ((i + 0.5) / seats - 0.5) * it.footprint.w; out.seats.push({ key: `${key}#${i}`, asset, pos: [pos[0] + lx * c, pos[1] + sy, pos[2] - lx * s], rotY, lx, tableY: extra.host ? catalog[out.placements.find((q) => q.key === extra.host)!.asset].surfaces[0]?.y : undefined }); }
    }
    return p;
  };
  const reject = (rule: number, asset: string) => out.rejected.push({ rule, asset });
  const skip = (rule: number, asset: string) => out.skipped.push({ rule, asset });

  layout.rules.forEach((r: Rule, ri) => {
    if (opts.structureOnly && (r.kind === 'scatter' || r.kind === 'surface')) return;
    R = r.kind === 'scatter' || r.kind === 'surface' ? Rc : Rs;
    switch (r.kind) {
      case 'place': {
        const it = item(r.asset); const y = r.y ?? 0; let spot: [number, number, number] | null = null;
        for (let t = 0; t <= ((r.spread ?? 0.8) ? 90 : 0) && !spot; t++) {
          const ang = R() * Math.PI * 2, rad = t === 0 ? 0 : (r.spread ?? 0.8) * Math.sqrt(R()) * (1 + t / 30); const at: [number, number] = [r.at[0] + Math.sin(ang) * rad, r.at[1] + Math.cos(ang) * rad];
          const rot = r.face ? Math.atan2(r.face[0] - at[0], r.face[1] - at[1]) : (r.rotY ?? 0); const b = boxOf(it, at[0], y, at[1], rot);
          if (fits(b) && (r.under || free(b))) spot = [at[0], rot, at[1]];
        }
        if (!spot) { reject(ri, r.asset); break; }
        add(r.group, 'floor', r.asset, [spot[0], y, spot[2]], spot[1], { under: r.under }); break;
      }
      case 'anchor': {
        const it = item(r.asset); const rot = WALL_ROT[r.wall]; const inset = r.inset ?? 0.02; const horizontal = r.wall === 'n' || r.wall === 's';
        const span = (horizontal ? W : D) / 2 - it.footprint.w / 2 - 0.1; const depth = inset + it.footprint.d / 2;
        const at = (along: number): [number, number] => { const a2 = along * span; return [horizontal ? a2 : (r.wall === 'e' ? W / 2 - depth : -W / 2 + depth), horizontal ? (r.wall === 'n' ? -D / 2 + depth : D / 2 - depth) : a2]; };
        const tries = r.along === 'auto' ? Array.from({ length: 41 }, (_, i) => ((i * 0.05 + R()) % 2) - 1) : [r.along];
        const hit = tries.map((al) => at(al)).find(([x, z]) => { const b2 = boxOf(it, x, 0, z, rot); return fits(b2, 0) && free(b2); });
        if (!hit) { reject(ri, r.asset); break; }
        add(r.group, 'floor', r.asset, [hit[0], 0, hit[1]], rot); break;
      }
      case 'set': {
        const t = item(r.table); const c = Math.cos(r.rotY), s = Math.sin(r.rotY);
        const tb = boxOf(t, r.at[0], 0, r.at[1], r.rotY);
        if (!fits(tb) || !free(tb)) { reject(ri, r.table); break; }
        const tp = add(r.group, 'floor', r.table, [r.at[0], 0, r.at[1]], r.rotY);
        const ign = new Set([tp.key]); const longAlongX = t.footprint.w >= t.footprint.d;
        if (r.chairs.ring) {
          for (let i = 0; i < r.chairs.ring; i++) {
            const ch = pickFrom(R, r.chairs); const ci = item(ch); const ang = (i / r.chairs.ring) * Math.PI * 2 + r.rotY + R() * 0.15; const rad = Math.max(t.footprint.w, t.footprint.d) / 2 + ci.footprint.d / 2 - r.chairs.tuck;
            const x = r.at[0] + Math.sin(ang) * rad, z = r.at[1] + Math.cos(ang) * rad; const face = Math.atan2(r.at[0] - x, r.at[1] - z); const b = boxOf(ci, x, 0, z, face);
            if (!fits(b) || !free(b, ign, 0)) { reject(ri, ch); continue; }
            add(r.group, 'floor', ch, [x, 0, z], face, { host: tp.key });
          }
          break;
        }
        const sides: { n: number; nx: number; nz: number; len: number }[] = [
          { n: r.chairs.long, nx: 0, nz: 1, len: longAlongX ? t.footprint.w : t.footprint.d }, { n: r.chairs.long, nx: 0, nz: -1, len: longAlongX ? t.footprint.w : t.footprint.d },
          { n: r.chairs.short, nx: 1, nz: 0, len: longAlongX ? t.footprint.d : t.footprint.w }, { n: r.chairs.short, nx: -1, nz: 0, len: longAlongX ? t.footprint.d : t.footprint.w },
        ];
        for (const sd of sides) for (let i = 0; i < sd.n; i++) {
          const ch = pickFrom(R, r.chairs); const ci = item(ch);
          const u = ((i + 0.5) / sd.n - 0.5) * (sd.len - 0.2) + (R() - 0.5) * 0.05;
          const reach = (sd.nx ? t.footprint.w / 2 : t.footprint.d / 2) + ci.footprint.d / 2 - r.chairs.tuck + R() * 0.06;
          // local offset: along the side normal plus along the side tangent
          const lx = sd.nx * reach + sd.nz * u, lz = sd.nz * reach + sd.nx * u;
          const x = r.at[0] + lx * c + lz * s, z = r.at[1] - lx * s + lz * c;
          const face = Math.atan2(r.at[0] - x, r.at[1] - z) + (R() - 0.5) * 0.12;
          const b = boxOf(ci, x, 0, z, face);
          if (!fits(b) || !free(b, ign, 0)) { reject(ri, ch); continue; }
          add(r.group, 'floor', ch, [x, 0, z], face, { host: tp.key });
        }
        break;
      }
      case 'scatter': {
        const k = count(R, r.count);
        for (let i = 0; i < k; i++) {
          let ok = false; let a = r.assets[0];
          for (let t = 0; t < 120 && !ok; t++) {
            a = pickFrom(R, r); const it = item(a);
            let x: number, z: number, rot: number;
            if (r.region === 'edge') {
              const wall = (['n', 's', 'e', 'w'] as Wall[])[Math.floor(R() * 4)]; const horizontal = wall === 'n' || wall === 's';
              rot = WALL_ROT[wall] + (R() - 0.5) * 0.2; const off = (r.edge ?? 0.06) + it.footprint.d / 2;
              x = horizontal ? (R() - 0.5) * (W - 1.5) : (wall === 'e' ? W / 2 - off : -W / 2 + off); z = horizontal ? (wall === 'n' ? -D / 2 + off : D / 2 - off) : (R() - 0.5) * (D - 1.5);
            } else { x = between(R, (r.region as Rect).x); z = between(R, (r.region as Rect).z); rot = R() * Math.PI * 2; }
            const b = boxOf(it, x, 0, z, rot);
            if (!fits(b) || (!r.under && !free(b, new Set(), r.gap ?? GAP))) continue;
            add(r.group, 'floor', a, [x, 0, z], rot, { under: r.under }); ok = true;
          }
          if (!ok) skip(ri, a);
        }
        break;
      }
      case 'surface': {
        const hosts = out.placements.filter((p) => p.kind === 'floor' && (r.host.group ? p.group === r.host.group : true) && (r.host.asset ? p.asset === r.host.asset : true) && (r.host.tag ? catalog[p.asset].tags.includes(r.host.tag) : true) && catalog[p.asset].surfaces.length > 0);
        for (const h of hosts) {
          const hi = item(h.asset); const hc = Math.cos(h.rotY), hs = Math.sin(h.rotY);
          const poolArea = r.assets.reduce((q, id) => q + item(id).footprint.w * item(id).footprint.d, 0) / r.assets.length; const hostArea = hi.surfaces.reduce((q, sf) => q + sf.area, 0);
          const k = Math.max(1, Math.min(count(R, r.perHost), Math.floor((0.2 * hostArea) / Math.max(poolArea, 1e-4))));
          for (let i = 0; i < k; i++) {
            let ok = false; let a = r.assets[0];
            for (let t = 0; t < 90 && !ok; t++) {
              a = pickFrom(R, r); const it = item(a);
              const sf = hi.surfaces[Math.floor(R() * hi.surfaces.length)]; if (sf.area < 0.05) continue;
              const rot = (r.yaw === 'aligned' ? (R() - 0.5) * 0.5 : R() * Math.PI * 2) + h.rotY;
              const lrot = rot - h.rotY; const probe = boxOf(it, 0, 0, 0, lrot); const [ex, ez] = extent(probe);
              if (sf.max[0] - sf.min[0] < 2 * ex || sf.max[1] - sf.min[1] < 2 * ez) continue;
              const lx = between(R, [sf.min[0] + ex, sf.max[0] - ex]), lz = between(R, [sf.min[1] + ez, sf.max[1] - ez]);
              const x = h.pos[0] + lx * hc + lz * hs, z = h.pos[2] - lx * hs + lz * hc; const y = h.pos[1] + sf.y;
              const b = boxOf(it, x, y, z, rot); const ign = new Set([h.key]);
              if (!boxes.every((o) => ign.has(o.key) || o.under || !overlaps(b, o.box, 0.01))) continue;
              add(r.group, 'surface', a, [x, y, z], rot, { host: h.key }); ok = true;
            }
            if (!ok) skip(ri, a);
          }
        }
        break;
      }
      case 'wallrow': {
        const horizontal = r.wall === 'n' || r.wall === 's'; const rot = WALL_ROT[r.wall]; const len = horizontal ? W : D;
        for (let i = 0; i < r.count; i++) {
          const a = r.asset ?? pickFrom(R, r); const it = item(a); const u0 = (r.count === 1 ? 0.5 : i / (r.count - 1)) * (r.span[1] - r.span[0]) + r.span[0];
          const depth = 0.01 + it.footprint.d / 2; const y = r.y - it.footprint.h / 2; let placed = false;
          for (let t = 0; t < 40 && !placed; t++) {
            const u = Math.max(-1, Math.min(1, u0 + (t === 0 ? 0 : (t % 2 ? 1 : -1) * Math.ceil(t / 2) * 0.04)));
            const along = u * (len / 2 - it.footprint.w / 2 - 0.2);
            const x = horizontal ? along : (r.wall === 'e' ? W / 2 - depth : -W / 2 + depth); const z = horizontal ? (r.wall === 'n' ? -D / 2 + depth : D / 2 - depth) : along;
            const b = boxOf(it, x, y, z, rot); if (!fits(b, 0) || !free(b, new Set(), 0.04)) continue;
            add(r.group, 'wall', a, [x, y, z], rot); placed = true;
          }
          if (!placed) reject(ri, a);
        }
        break;
      }
      case 'ceiling': {
        const it = item(r.asset);
        for (const [x, z] of r.at) {
          const y = H - it.footprint.h; const b = boxOf(it, x, y, z, 0);
          if (!fits(b, 0, true) || !free(b, new Set(), 0.05)) { reject(ri, r.asset); continue; }
          add(r.group, 'ceiling', r.asset, [x, y, z], 0);
        }
        break;
      }
    }
  });
  return out;
}

/** Sittable surface of a piece: the first up-facing plane at seat height. */
export function seatSurface(it: { surfaces: { y: number; min: [number, number]; max: [number, number] }[] }) { return it.surfaces.find((q) => q.y > 0.3 && q.y < 0.56); }
/** Seats occupied by `online` people: seeded order so the same people sit in the same chairs. */
export function occupiedSeats(solved: Solved, online: number, seed: string): Seat[] {
  const R = rng(`seats|${solved.layout}|${seed}`); const order = solved.seats.map((s) => ({ s, k: R() })).sort((a, b) => a.k - b.k);
  return order.slice(0, Math.max(0, Math.min(online, order.length))).map((o) => o.s);
}
