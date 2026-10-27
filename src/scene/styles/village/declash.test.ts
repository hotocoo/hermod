import { describe, expect, it } from 'vitest';
import { PLOTS } from '@/config/scene';
import { BUILDING_FIT, plotYaw } from './config';
import { declash, overlaps, type Footprint } from './declash';

/** Local bounds of the widest authored village building at level 3 (board.glb), in world units. */
const WIDE = { x0: -5.2, x1: 4.6, z0: -1.7, z1: 2.8 };
/** Local LOD0 bounds of every authored section building with all three levels built (public/assets/village/<id>.glb). */
const LEVEL3 = {
  chat: { x0: -4.75, x1: 4.58, z0: -1.82, z1: 2.44 }, hearth: { x0: -3.54, x1: 3.5, z0: -3.5, z1: 3.5 }, feed: { x0: -4.53, x1: 5.1, z0: -1.76, z1: 2.39 },
  board: { x0: -5.2, x1: 4.53, z0: -1.65, z1: 2.28 }, skein: { x0: -2.5, x1: 3.1, z0: -1.3, z1: 2.81 }, desk: { x0: -4.0, x1: 3.94, z0: -1.61, z1: 2.21 }, arcade: { x0: -4.1, x1: 4.03, z0: -1.66, z1: 2.51 },
} as const;
const at = (x: number, z: number): Footprint => ({ x, z, yaw: plotYaw(x, z), ...WIDE });

describe('declash', () => {
  it('leaves buildings that already clear each other at full size', () => {
    expect(declash([at(-20, 0), at(20, 0)])).toEqual([1, 1]);
  });
  it('shrinks a clashing pair just enough to clear', () => {
    const fps = [at(-3, 3), at(3, 3)]; const s = declash(fps);
    expect(s[0]).toBeLessThan(1);
    expect(overlaps(fps[0], s[0], fps[1], s[1])).toBe(false);
    expect(overlaps(fps[0], s[0] * 1.05, fps[1], s[1] * 1.05)).toBe(true);
  });
  it('clears every pair of the real plots with the authored buildings at level 3', () => {
    const fps = (Object.keys(LEVEL3) as (keyof typeof PLOTS)[]).map((id) => ({ x: PLOTS[id].x, z: PLOTS[id].z, yaw: plotYaw(PLOTS[id].x, PLOTS[id].z), ...LEVEL3[id] })); const s = declash(fps);
    s.forEach((v) => expect(v).toBeGreaterThanOrEqual(BUILDING_FIT.minScale));
    for (let i = 0; i < fps.length; i++) for (let k = i + 1; k < fps.length; k++) expect(overlaps(fps[i], s[i], fps[k], s[k])).toBe(false);
  });
});
