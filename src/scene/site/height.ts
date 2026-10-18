/** Terrain heightfield from the plan: terraces, hills, stadium bowl, riverbed, coast drop. Pure (no three), shared by terrain, paths, props and tests. */
import { fbm } from '../noise';
import { BOWL, FIXED, RIVER, TERRAIN as T } from './config';
import { clamp, inPoly, polyDist, smooth } from './geo';
import { edgeAt, type SitePlan } from './plan';
import { TEMENOS } from './config';

export type HeightFn = (x: number, z: number) => number;

export function makeHeight(plan: SitePlan): HeightFn {
  const ter = plan.terraces.map((t) => ({ ...t, c: Math.cos(t.yaw), s: Math.sin(t.yaw), skirt: t.wall ? T.wallSkirt : T.skirt }));
  const S = FIXED.stadium; const bowl = plan.tier >= S.tier; const hx = S.wid / 2, hz = S.len / 2;
  return (x, z) => {
    const p = { x, z }; const e = edgeAt(plan.edge, x, z);
    const dT = inPoly(p, TEMENOS.poly) ? 0 : polyDist(p, TEMENOS.poly, true); const interior = smooth(1 - dT / T.interiorBlend);
    const rough = fbm(x * T.noiseFreq, 0, z * T.noiseFreq, 3) * T.noise + T.base;
    let h = rough + (T.flatLevel + fbm(x * 0.5, 5, z * 0.5, 2) * T.flatNoise - rough) * interior;
    for (const hl of plan.hills) { const d = Math.hypot(x - hl.x, z - hl.z) / hl.r; h += hl.h * Math.exp(-d * d) * (1 - interior); }
    for (const t of ter) {
      const lx = (x - t.x) * t.c - (z - t.z) * t.s, lz = (x - t.x) * t.s + (z - t.z) * t.c; const d = Math.max(Math.abs(lx) - t.w / 2, Math.abs(lz) - t.d / 2);
      const k = smooth(1 - d / t.skirt); if (k > 0) h = h * (1 - k) + t.h * k;
    }
    if (bowl) {
      const qx = Math.abs(x - S.x) - (hx - T.bowlCorner), qz = Math.abs(z - S.z) - (hz - T.bowlCorner);
      const sd = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - T.bowlCorner; // signed distance to the track rectangle
      if (sd < S.wall + T.bowlSoft + 1) {
        const bh = sd <= 0 ? 0 : sd <= S.wall ? BOWL.embank * smooth(sd / S.wall) : BOWL.embank * (1 - smooth((sd - S.wall) / T.bowlSoft));
        const w = sd < S.wall + T.bowlSoft ? 1 : 1 - smooth(sd - S.wall - T.bowlSoft); h = h * (1 - w) + bh * w;
      }
    }
    for (const r of plan.rivers) {
      const d = polyDist(p, r.pts); const reach = r.w / 2 + RIVER.bank;
      if (d < reach) { const k = d <= r.w / 2 ? 1 : smooth(1 - (d - r.w / 2) / RIVER.bank); h += (-RIVER.bed - h) * k; }
    }
    h -= smooth(clamp((Math.hypot(x, z) - (e - T.coastBand)) / T.coastBand, 0, 1)) * T.coastDrop;
    return Math.max(T.minH, h);
  };
}
