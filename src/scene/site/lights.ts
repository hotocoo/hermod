/**
 * Sanctuary lights as data in physical units (candela for point lights, three.js PointLight.intensity is candela, decay 2).
 * One unit is ~4 m, so `distance` is the cutoff radius in world units where the contribution has fallen below ~0.3 lux equivalent.
 * Flame colour is ~1900 K. The render stack consumes LightSpec[] and caps the count by tier (LIGHT_CAP).
 */
import type { LightSpec } from '../styles/types';
import { FIXED } from './config';
import type { SitePlan } from './plan';

export const FLAME_COLOR = 0xffa43a; // 1900 K
/** Max simultaneously active night lights per quality tier (nearest to the camera win; the rest are emissive only). */
export const LIGHT_CAP = { low: 0, medium: 4, high: 8, ultra: 12 } as const;
const CD = { torch: 55, altar: 40, hearth: 220, templeLamp: 70, stadium: 60, lampStand: 28 } as const;
const TORCH_Y = 1.0;

export function sanctuaryLights(plan: SitePlan, yAt: (x: number, z: number) => number): LightSpec[] {
  const out: LightSpec[] = []; const add = (id: string, x: number, y: number, z: number, cd: number, distance: number, minTier: LightSpec['minTier'], shadow = false) =>
    out.push({ id, kind: 'point', x, y, z, color: FLAME_COLOR, cd, distance, decay: 2, night: true, shadow, minTier });
  const hp = plan.plots.hearth; add('hearth', hp.x, yAt(hp.x, hp.z) + 1.5, hp.z, CD.hearth, 11, 'low', true);
  plan.props.forEach((p, i) => {
    if (p.kind === 'torch') add(`torch:${i}`, p.x, yAt(p.x, p.z) + TORCH_Y * p.s, p.z, CD.torch * p.s, 6.5, i % 2 ? 'high' : 'medium');
    else if (p.kind === 'altar') add(`altar:${i}`, p.x, yAt(p.x, p.z) + 0.5, p.z, CD.altar, 5, 'high');
  });
  const tm = plan.landmarks.find((l) => l.kind === 'temple');
  if (tm) { const T = FIXED.temple; for (const sx of [-1, 1]) add(`temple:${sx}`, T.x + sx * (T.w / 2 - 0.1), yAt(T.x, T.z) + 2.1, T.z + T.d / 2 + 0.6, CD.templeLamp, 7.5, 'high'); }
  const st = plan.landmarks.find((l) => l.kind === 'stadium');
  if (st) for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) add(`stadium:${sx}${sz}`, st.x + sx * (st.w / 2 + 0.2), yAt(st.x, st.z) + 1.3, st.z + sz * (st.d / 2 - 0.4), CD.stadium, 7, 'ultra');
  plan.decor.filter((d) => d.kind === 'banner_pole' || d.kind === 'tripod').forEach((d) => add(`${d.id}`, d.x, yAt(d.x, d.z) + 0.8, d.z, CD.lampStand, 4, 'ultra'));
  return out;
}
