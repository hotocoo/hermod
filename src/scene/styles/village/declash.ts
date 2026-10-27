/**
 * Authored section buildings are wider than the plot spacing allows once they grow to levels 2 and 3 (plots are fixed, see config.ts),
 * so each one is scaled about its plot centre just enough to clear its neighbours. Pure: footprints in, one scale per footprint out.
 */
import { BUILDING_FIT } from './config';

/** A building's local x/z bounds (local +z is its front), placed at plot (x, z) and turned by yaw. */
export interface Footprint { x: number; z: number; yaw: number; x0: number; x1: number; z0: number; z1: number }

const corners = (f: Footprint, s: number): [number, number][] => {
  const c = Math.cos(f.yaw), n = Math.sin(f.yaw);
  return ([[f.x0, f.z0], [f.x1, f.z0], [f.x1, f.z1], [f.x0, f.z1]] as const).map(([x, z]) => [x * s * c + z * s * n + f.x, -x * s * n + z * s * c + f.z]);
};

/** Separating-axis test on the two rotated rectangles, each widened by half the gap on every side. */
export function overlaps(a: Footprint, sa: number, b: Footprint, sb: number, gap: number = BUILDING_FIT.gap): boolean {
  const A = corners(a, sa), B = corners(b, sb);
  for (const P of [A, B]) for (let i = 0; i < 2; i++) {
    const ax = -(P[i + 1][1] - P[i][1]), az = P[i + 1][0] - P[i][0], len = Math.hypot(ax, az);
    const pa = A.map(([x, z]) => (x * ax + z * az) / len), pb = B.map(([x, z]) => (x * ax + z * az) / len);
    if (Math.min(Math.max(...pa), Math.max(...pb)) - Math.max(Math.min(...pa), Math.min(...pb)) <= gap) return false;
  }
  return true;
}

/** Largest scale (at most 1, at least BUILDING_FIT.minScale) per footprint such that no two overlap; a clashing pair shrinks together. */
export function declash(fps: readonly Footprint[]): number[] {
  const s = fps.map(() => 1);
  for (let round = 0; round < BUILDING_FIT.rounds; round++) {
    let clean = true;
    for (let i = 0; i < fps.length; i++) for (let k = i + 1; k < fps.length; k++) {
      if (!overlaps(fps[i], s[i], fps[k], s[k])) continue;
      clean = false; let lo = BUILDING_FIT.minScale / Math.min(s[i], s[k]), hi = 1;
      if (overlaps(fps[i], s[i] * lo, fps[k], s[k] * lo)) { s[i] *= lo; s[k] *= lo; continue; }
      for (let j = 0; j < BUILDING_FIT.searchSteps; j++) { const m = (lo + hi) / 2; if (overlaps(fps[i], s[i] * m, fps[k], s[k] * m)) hi = m; else lo = m; }
      s[i] *= lo; s[k] *= lo;
    }
    if (clean) break;
  }
  return s.map((v) => Math.max(BUILDING_FIT.minScale, v));
}
