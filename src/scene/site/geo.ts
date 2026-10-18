/** Pure 2D helpers for the site plan (plan view: x east, z south). No three import. */
import type { V2 } from './config';

export const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));
export const smooth = (t: number): number => { const c = clamp(t, 0, 1); return c * c * (3 - 2 * c); };
export const hyp = (a: V2, b: V2): number => Math.hypot(a.x - b.x, a.z - b.z);
export const front = (yaw: number): V2 => ({ x: Math.sin(yaw), z: Math.cos(yaw) });

/** Distance from p to segment ab. */
export function segDist(p: V2, a: V2, b: V2): number {
  const dx = b.x - a.x, dz = b.z - a.z; const l2 = dx * dx + dz * dz;
  const t = l2 === 0 ? 0 : clamp(((p.x - a.x) * dx + (p.z - a.z) * dz) / l2, 0, 1);
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
}
/** Distance from p to a polyline (or closed ring). */
export function polyDist(p: V2, pts: readonly V2[], closed = false): number {
  let d = Infinity; const n = pts.length;
  for (let i = 0; i < n - (closed ? 0 : 1); i++) d = Math.min(d, segDist(p, pts[i], pts[(i + 1) % n]));
  return d;
}
export function inPoly(p: V2, poly: readonly V2[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) c = !c;
  }
  return c;
}
/** True when segments ab and cd properly cross. */
export function segCross(a: V2, b: V2, c: V2, d: V2): boolean {
  const o = (p: V2, q: V2, r: V2) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  const d1 = o(a, b, c), d2 = o(a, b, d), d3 = o(c, d, a), d4 = o(c, d, b);
  return d1 * d2 < 0 && d3 * d4 < 0;
}
export function polyCross(a: V2, b: V2, pts: readonly V2[], closed = false): boolean {
  const n = pts.length;
  for (let i = 0; i < n - (closed ? 0 : 1); i++) if (segCross(a, b, pts[i], pts[(i + 1) % n])) return true;
  return false;
}

/** Oriented box: centre, half extents along local x (w) and local z (d), yaw as in the plan (front = +z local). */
export interface Obb { x: number; z: number; hw: number; hd: number; yaw: number }
export function obbCorners(o: Obb): V2[] {
  const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
  // local x axis -> (cos, -sin), local z axis -> (sin, cos)
  return ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([sx, sz]) => ({ x: o.x + sx * o.hw * c + sz * o.hd * s, z: o.z - sx * o.hw * s + sz * o.hd * c }));
}
export function obbLocal(o: Obb, p: V2): V2 { const c = Math.cos(o.yaw), s = Math.sin(o.yaw); const dx = p.x - o.x, dz = p.z - o.z; return { x: dx * c - dz * s, z: dx * s + dz * c }; }
export const obbContains = (o: Obb, p: V2, pad = 0): boolean => { const l = obbLocal(o, p); return Math.abs(l.x) <= o.hw + pad && Math.abs(l.z) <= o.hd + pad; };
/** Separating axis test between two oriented boxes, with padding added to both. */
export function obbOverlap(a: Obb, b: Obb, pad = 0): boolean {
  const ax = [{ x: Math.cos(a.yaw), z: -Math.sin(a.yaw) }, { x: Math.sin(a.yaw), z: Math.cos(a.yaw) }, { x: Math.cos(b.yaw), z: -Math.sin(b.yaw) }, { x: Math.sin(b.yaw), z: Math.cos(b.yaw) }];
  const ca = obbCorners({ ...a, hw: a.hw + pad / 2, hd: a.hd + pad / 2 }), cb = obbCorners({ ...b, hw: b.hw + pad / 2, hd: b.hd + pad / 2 });
  for (const n of ax) {
    const pa = ca.map((p) => p.x * n.x + p.z * n.z), pb = cb.map((p) => p.x * n.x + p.z * n.z);
    if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
  }
  return true;
}
/** Distance from a point to the boundary region of an obb (0 inside). */
export function obbDist(o: Obb, p: V2): number { const l = obbLocal(o, p); return Math.hypot(Math.max(0, Math.abs(l.x) - o.hw), Math.max(0, Math.abs(l.z) - o.hd)); }
export function segHitsObb(a: V2, b: V2, o: Obb, pad = 0): boolean {
  const n = 12; for (let i = 0; i <= n; i++) { const t = i / n; if (obbContains(o, { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, pad)) return true; } return false;
}

/** Catmull-Rom through points, `per` samples per span. Endpoints are kept. */
export function spline(pts: readonly V2[], per = 6): V2[] {
  if (pts.length < 3) return pts.slice();
  const out: V2[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < per; k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), z: f(p0.z, p1.z, p2.z, p3.z) });
    }
  }
  out.push(pts[pts.length - 1]); return out;
}
export const polyLen = (pts: readonly V2[]): number => { let l = 0; for (let i = 1; i < pts.length; i++) l += hyp(pts[i - 1], pts[i]); return l; };
/** Point and heading at distance s along a polyline. */
export function along(pts: readonly V2[], s: number): { x: number; z: number; yaw: number } {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = hyp(pts[i - 1], pts[i]);
    if (acc + l >= s || i === pts.length - 1) { const t = l === 0 ? 0 : clamp((s - acc) / l, 0, 1); return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, z: pts[i - 1].z + (pts[i].z - pts[i - 1].z) * t, yaw: Math.atan2(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z) }; }
    acc += l;
  }
  return { x: pts[0].x, z: pts[0].z, yaw: 0 };
}
