/**
 * Village style data: every position, size and tier of the village island layout (pure data, no three import).
 * Units: world units (1 unit ~ 4 m). x east, z south, y up. A building's local +z is its front; yaw rotates +z to (sin yaw, cos yaw).
 * Section plots, the signpost and the pond are copied from src/config/scene.ts and MUST NOT move (overlay, interiors and director read them).
 */
import { CONTACT, GROWTH, PLOTS, POND_POS, SECTION_ORDER, SIGN } from '@/config/scene';
import type { SectionId } from '@/lib/data/types';

export interface V2 { x: number; z: number }
export const MAX_TIER = 5;
export const TIER_R: readonly number[] = GROWTH.radiusByTier;
export const COAST = { amp: GROWTH.shapeAmp, min: 0.975, samples: 192, margin: 1.35 } as const;
/** Peninsulas that unlock with a tier: angle (rad, atan2(z,x)), angular width, extra radius. */
export const LOBES = [
  { id: 'headland-west', tier: 3, a: 2.95, w: 0.38, k: 1.3 },
  { id: 'headland-north', tier: 4, a: -1.75, w: 0.42, k: 1.5 },
  { id: 'lighthouse-point', tier: 5, a: -0.62, w: 0.3, k: 2.6 },
] as const;

export const PLAZA = { x: 0, z: 0, r: 2.7 } as const;
export const SIGNPOST = { x: SIGN.x, z: SIGN.z } as const;
export const PLOT_IDS: readonly SectionId[] = SECTION_ORDER;
/** Yaw as the town computes it: facing the island centre (hearth ends up at -PI exactly like Math.atan2(-0, -0)). */
export const plotYaw = (x: number, z: number): number => Math.atan2(-x, -z);
/** Door distance in front of a plot's centre (the building's local door z). */
export const DOOR_DIST = 1.8;
/** Blocking radius per plot (CONTACT footprint plus a walkway). */
export const plotRadius = (id: SectionId): number => Math.max(...(CONTACT[id] as readonly number[])) + 0.5;
export const POND = { x: POND_POS.x, z: POND_POS.z, r: 2.0 } as const;
export { PLOTS };

/** Cottage rings: radius and slot capacity; plot_index walks rings in order. Ring k exists from tier k+1. */
export const RINGS = GROWTH.rings;
export const RING = { inset: 1.65, wobble: 0.22, step: 0.9, nudgeStep: 0.09, nudgeTries: 36, houseClear: 2.0, lane: 0.85, maxShrink: 1.2 } as const;
export const COTTAGE = { hw: 0.75, hd: 0.65, door: 0.7, variants: 8, scaleJitter: GROWTH.cottage.scaleJitter } as const;

export type AreaKind = 'lawn' | 'market' | 'fishmarket' | 'orchard' | 'allotment' | 'meadow' | 'festival' | 'millpond' | 'basin';
export interface AreaSpec { id: string; kind: AreaKind; x: number; z: number; r: number; tier: number; yaw?: number; w?: number; d?: number }
/** Districts. Effective tier is the larger of `tier` and the first tier whose coast encloses the area (see plan.ts). */
export const AREAS: readonly AreaSpec[] = [
  { id: 'green', kind: 'lawn', x: -9.2, z: 1.4, r: 2.1, tier: 1 },
  { id: 'market', kind: 'market', x: 9.6, z: 0.2, r: 2.3, tier: 2 },
  { id: 'orchard-nw', kind: 'orchard', x: -8.8, z: -6.2, r: 2.0, tier: 2 },
  { id: 'meadow-e', kind: 'meadow', x: 10.6, z: -3.8, r: 1.8, tier: 2 },
  { id: 'fish', kind: 'fishmarket', x: 10.4, z: 5.4, r: 1.6, tier: 3 },
  { id: 'orchard-ne', kind: 'orchard', x: 10.4, z: -8.0, r: 1.8, tier: 3 },
  { id: 'orchard-sw', kind: 'orchard', x: -9.4, z: 9.3, r: 1.8, tier: 3 },
  { id: 'allotments', kind: 'allotment', x: -12.2, z: 7.0, r: 2.2, tier: 4, yaw: 0.3, w: 4.2, d: 3.0 },
  { id: 'millpond', kind: 'millpond', x: -12.8, z: -6.4, r: 1.5, tier: 4 },
  { id: 'festival', kind: 'festival', x: 6.8, z: -13.2, r: 2.8, tier: 5 },
];
/** Harbour basin (inland lagoon with quays and boats): ellipse, tier 3. */
export const BASIN = { id: 'basin', x: 7.4, z: 9.8, a: 2.4, b: 1.6, yaw: 0.95, tier: 3, quayW: 1.3, quayGap: 0.35 } as const;
/** Stream from the mill pond to the west coast (tier 4); it falls off the cliff where it meets the coast. */
export const STREAM = { tier: 4, w: 0.85, pts: [{ x: -12.8, z: -6.4 }, { x: -14.2, z: -3.6 }, { x: -15.6, z: -0.6 }, { x: -17.4, z: 2.2 }, { x: -19.6, z: 4.4 }] as readonly V2[] };
export const HILLS: readonly { id: string; x: number; z: number; r: number; h: number; tier: number }[] = [
  { id: 'terraced-hill', x: -5.0, z: -15.5, r: 5.5, h: 2.2, tier: 5 },
];
/** Craft quarter and fisher row (tier 4 and 3): hand placed buildings along lanes. */
export const HAMLETS: readonly { id: string; kind: 'fisher-hut' | 'craft-house' | 'watermill' | 'lighthouse'; x: number; z: number; yaw: number; tier: number; w: number; d: number }[] = [
  { id: 'fisher-0', kind: 'fisher-hut', x: 12.0, z: 3.0, yaw: -1.2, tier: 3, w: 1.6, d: 1.3 },
  { id: 'fisher-1', kind: 'fisher-hut', x: 11.0, z: 7.9, yaw: -1.08, tier: 3, w: 1.6, d: 1.3 },
  { id: 'fisher-2', kind: 'fisher-hut', x: 12.6, z: 5.6, yaw: -1.4, tier: 3, w: 1.6, d: 1.3 },
  { id: 'craft-0', kind: 'craft-house', x: -10.4, z: -9.8, yaw: 0.6, tier: 4, w: 2.0, d: 1.6 },
  { id: 'craft-1', kind: 'craft-house', x: -13.0, z: -9.0, yaw: 0.9, tier: 4, w: 2.0, d: 1.6 },
  { id: 'mill', kind: 'watermill', x: -14.6, z: -6.6, yaw: 1.2, tier: 4, w: 2.4, d: 2.0 },
];
/** Beaches (sand weight along the coast), reed beds and rocky headlands by angle range. */
export const BEACHES: readonly { id: string; a0: number; a1: number; tier: number }[] = [
  { id: 'south-sands', a0: 1.5, a1: 2.3, tier: 2 }, { id: 'north-cove', a0: -2.5, a1: -2.0, tier: 3 }, { id: 'east-strand', a0: -0.2, a1: 0.25, tier: 4 },
];
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
/** Tree species ids (authored by the nature asset set); fruit trees only in orchards. */
export const TREE_KINDS = ['oak', 'birch', 'poplar', 'pine'] as const;
export const TREES = { perUnit2: 0.085, corridor: 1.35, margin: 0.9, max: 220, cottageClear: 1.6, plotClear: 3.0 } as const;
/** Props along lanes: spacing (units) per kind. */
export const LANE_PROPS = { lamp: 4.4, bench: 11, barrel: 17, fence: 0 } as const;
export const CAMERAS = {
  home: { az: Math.PI / 4, el: 0.66, dist: 46, target: [0, 0, 0] as const },
  market: { az: 0.9, el: 0.5, dist: 22, target: [9.6, 0.4, 0.2] as const },
  harbour: { az: 2.2, el: 0.55, dist: 26, target: [8.0, 0.3, 9.0] as const },
  green: { az: -0.8, el: 0.55, dist: 22, target: [-9.2, 0.4, 1.4] as const },
  plan: { az: 0, el: 1.5, dist: 60, target: [0, 0, 0] as const },
} as const;
