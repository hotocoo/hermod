/** Maps plan placement kinds to authored assets (public/assets/nature trees, public/assets/village props) and groups them for instancing. */
import * as THREE from 'three';
import type { Placement } from '../shared/instanced';
import type { VillagePlan } from './plan';
import { SEA_Y } from './terrain';

const TREES = new Set(['oak', 'birch', 'poplar', 'pine', 'apple']);
/** Variants authored per prop kind (scripts/assets/blender/village/props.py). */
const PROPS: Record<string, number> = { lamp: 1, stall: 5, well: 1, bench: 2, barrel: 3, crate: 3, cart: 1, fence: 1, hedge: 2, haystack: 3, beehive: 1, firewood: 1, maypole: 1, scarecrow: 1, pier: 1, boat: 3, watermill: 1, lighthouse: 1, shrub: 3, rock: 3, boulder: 3, reed: 3, 'washing-line': 1, 'festival-table': 3, 'bunting-post': 1, 'allotment-bed': 2, 'net-rack': 1, 'dock-post': 1, 'fisher-hut': 1, 'craft-house': 1, 'flower-patch': 4 };
const WATER_LEVEL: Record<string, number> = { boat: SEA_Y - 0.03, pier: SEA_Y - 0.12, 'dock-post': SEA_Y - 0.1 };
/** Season tint multiplied into tree foliage (0 spring, 1 summer, 2 autumn, 3 winter). */
const TINT = [new THREE.Color(1.05, 1.12, 0.9), new THREE.Color(1, 1, 1), new THREE.Color(1.2, 0.85, 0.55), new THREE.Color(0.95, 0.94, 0.98)];

export interface Group { url: string; foliage: boolean; list: Placement[] }
export function groupPlacements(plan: VillagePlan, heightAt: (x: number, z: number) => number): Group[] {
  const out = new Map<string, Group>();
  for (const p of plan.placements) {
    let url: string, foliage = false;
    if (TREES.has(p.kind)) { url = `/assets/nature/${p.kind}_${p.variant % 3}.glb`; foliage = true; }
    else if (PROPS[p.kind]) url = `/assets/village/${p.kind}_${p.variant % PROPS[p.kind]}.glb`;
    else continue; // lamp: world kit lamp; hamlet kinds are in PROPS
    const y = WATER_LEVEL[p.kind] ?? heightAt(p.x, p.z) - (foliage ? 0.03 : 0.0);
    const g = out.get(url) ?? { url, foliage, list: [] }; out.set(url, g);
    g.list.push({ x: p.x, y, z: p.z, yaw: p.yaw, scale: p.scale * (TREES.has(p.kind) ? 1 : 1), tint: foliage ? TINT[((p.tint ?? plan.season) % 4 + 4) % 4] : undefined });
  }
  // hedge runs around orchards and allotments (plan.walls kind 'hedge'): the 1.2 long hedge prop laid end to end, long axis (local x) along the run
  for (const w of plan.walls) {
    if (w.kind !== 'hedge') continue; const L = 1.1; let acc = 0, next = 0;
    for (let i = 0; i + 1 < w.pts.length; i++) {
      const a = w.pts[i], b = w.pts[i + 1]; const seg = Math.hypot(b.x - a.x, b.z - a.z); if (seg < 1e-6) continue; const yaw = Math.atan2(-(b.z - a.z), b.x - a.x);
      for (; next < acc + seg; next += L) { const t = (next - acc) / seg; const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t; const url = `/assets/village/hedge_${Math.abs(Math.round(x * 7 + z * 13)) % 2}.glb`;
        const g = out.get(url) ?? { url, foliage: false, list: [] }; out.set(url, g); g.list.push({ x, y: heightAt(x, z), z, yaw, scale: 1 }); }
      acc += seg;
    }
  }
  return [...out.values()];
}
export const isAuthoredTree = (kind: string): boolean => TREES.has(kind);
