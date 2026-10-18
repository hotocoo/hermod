/**
 * Village ground macro variation: large-scale tint, dry patches, flower drifts, worn fringes along paths and squares, height/slope tint and
 * wetness near water. Pure (noise only); terrain.ts bakes the result into a vertex colour (tint) and nudges the splat weights.
 */
import { fbm } from '../../noise';
import { clamp } from '../../site/geo';

export interface MacroIn { x: number; z: number; ox: number; oz: number; h: number; slope: number; /** distance beyond the path/square edge (<=0 on it) */ pathD: number; /** distance outside water (<=0 inside) */ waterD: number }
export interface Macro { r: number; g: number; b: number; dry: number; worn: number; flower: number }
const sm = (t: number) => { const c = clamp(t, 0, 1); return c * c * (3 - 2 * c); };
const mixc = (a: number, b: number, t: number) => a + (b - a) * t;

export function macroGround(i: MacroIn): Macro {
  const { x, z, ox, oz } = i;
  const big = fbm(x * 0.045 + ox, 11, z * 0.045 + oz, 3) * 2; // about -0.5..0.5, ~22 unit blobs
  const mid = fbm(x * 0.13 + oz, 17, z * 0.13 + ox, 2) * 2;
  const dry = sm((fbm(x * 0.08 + ox * 1.7, 23, z * 0.08 - oz, 3) * 2 - 0.12) * 3.2); // dry patches
  const flower = sm((fbm(x * 0.2 - oz, 29, z * 0.2 + ox, 2) * 2 - 0.2) * 3.5) * (1 - dry); // flower drifts
  const worn = (1 - sm(i.pathD / 1.7)) * clamp(0.55 + fbm(x * 0.5 + ox, 31, z * 0.5 + oz, 2) * 3, 0, 1); // trampled fringe
  let r = 1 + big * 0.2 + mid * 0.05, g = 1 + big * 0.05 + mid * 0.03, b = 1 - big * 0.22 - mid * 0.05;
  r = mixc(r, r * 1.2, dry); g = mixc(g, g * 1.02, dry); b = mixc(b, b * 0.6, dry);
  r = mixc(r, r * 1.14, flower); g = mixc(g, g * 1.08, flower); b = mixc(b, b * 0.82, flower);
  r = mixc(r, r * 1.05, worn); g = mixc(g, g * 0.88, worn); b = mixc(b, b * 0.72, worn);
  const hi = clamp((i.h - 0.12) * 0.7, 0, 0.3); r *= 1 + hi; g *= 1 + hi * 0.9; b *= 1 + hi * 0.6; // higher ground bleaches
  const sl = clamp(i.slope * 0.45, 0, 0.35); r *= 1 - sl; g *= 1 - sl; b *= 1 - sl * 0.8;
  const wet = clamp(1 - Math.max(0, i.waterD) / 3, 0, 1) * (i.waterD > -1.2 ? 1 : 0); // damp, deeper green near water
  r *= 1 - wet * 0.26; g *= 1 - wet * 0.14; b *= 1 - wet * 0.2;
  return { r, g, b, dry, worn, flower };
}
