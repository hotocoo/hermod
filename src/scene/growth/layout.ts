import { GROWTH as G, MAX_LEVEL, PLOTS, POND_POS, SECTION_ORDER, SIGN, type BuildingLevel } from '@/config/scene';
import type { SectionId } from '@/lib/data/types';
import { fbm } from '../noise';
import { rng } from '../rng';
import type { SpaceGrowth } from '../types';

export interface HousePlace { userId: string; plotIndex: number; ring: number; x: number; z: number; yaw: number }
export interface LaneArc { r: number; a0: number; a1: number }
export interface DockPlace { x: number; z: number; yaw: number; angle: number }
export interface Flat { x: number; z: number; r: number }
/** Resolved growth for one space: always complete, defaults to tier 1 with no houses. */
export interface GrowthState { tier: number; radius: number; members: number; active7d: number; levels: Record<SectionId, BuildingLevel>; houses: readonly { user_id: string; plot_index: number }[] }
export interface IslandLayout { R: number; tier: number; edge: (theta: number) => number; houses: HousePlace[]; lanes: LaneArc[]; docks: DockPlace[]; flats: Flat[] }

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const PP: Readonly<Record<string, { x: number; z: number }>> = PLOTS;

/** Normalise optional growth data. `sections` decides which buildings exist; growth only supplies their level (1..3). */
export function resolveGrowth(g: SpaceGrowth | undefined, sections: readonly SectionId[]): GrowthState {
  const tier = g ? clamp(Math.round(g.tier) || 1, 1, G.radiusByTier.length) : 1;
  const radius = g && Number.isFinite(g.radius) && g.radius > 0 ? clamp(g.radius, G.minRadius, G.maxRadius) : G.radiusByTier[tier - 1];
  const levels = {} as Record<SectionId, BuildingLevel>;
  for (const id of SECTION_ORDER) levels[id] = (sections.includes(id) ? clamp(Math.round(g?.buildings?.[id] ?? 1) || 1, 1, MAX_LEVEL) : 0) as BuildingLevel;
  return { tier, radius, members: g?.members ?? 0, active7d: g?.active7d ?? 0, levels, houses: g?.houses ?? [] };
}

/** Stable text signature of everything that changes the island, used to diff two setSpace calls. */
export const growthKey = (s: GrowthState): string => [s.tier, s.radius.toFixed(2), SECTION_ORDER.map((id) => s.levels[id]).join(''), s.houses.map((h) => h.user_id + ':' + h.plot_index).join(',')].join('|');

/** Coastline radius at angle theta; a perfect circle at tier 1, wobbling more per tier, distinct per space. */
export function makeEdge(R: number, tier: number, seed: string): (theta: number) => number {
  const amp = G.shapeAmp[tier - 1] ?? 0; if (amp <= 0) return () => R;
  const Rn = rng('edge' + seed); const ox = Rn() * 40, oz = Rn() * 40;
  return (t: number) => R * clamp(1 + amp * 2.1 * fbm(Math.cos(t) * 1.4 + ox, 0.5, Math.sin(t) * 1.4 + oz, 3), 0.93, 1.12);
}

/** Largest radius the coast can reach (bounds the terrain grid). */
export const maxEdge = (R: number, tier: number): number => R * (1 + (G.shapeAmp[tier - 1] ?? 0) * 1.4 + 0.02);

const obstacles = (): { x: number; z: number; r: number }[] => [
  ...SECTION_ORDER.map((id) => ({ x: PP[id].x, z: PP[id].z, r: G.clearance.plot })), { x: SIGN.x, z: SIGN.z, r: G.clearance.sign }, { x: POND_POS.x, z: POND_POS.z, r: G.clearance.pond }, { x: 0, z: 0, r: G.clearance.plaza },
];

function slotOf(index: number): { ring: number; slot: number; cap: number } | null {
  let i = index; for (let r = 0; r < G.rings.length; r++) { if (i < G.rings[r].cap) return { ring: r, slot: i, cap: G.rings[r].cap }; i -= G.rings[r].cap; } return null;
}

/** Deterministic island layout: houses on plot rings (nudged around obstacles), lanes, docks and extra flat zones. */
export function layoutIsland(seed: string, s: GrowthState): IslandLayout {
  const edge = makeEdge(s.radius, s.tier, seed); const obs = obstacles(); const houses: HousePlace[] = [];
  const phase = G.rings.map((_, i) => rng(seed + 'ring' + i)() * Math.PI * 2);
  const free = (x: number, z: number) => !obs.some((o) => Math.hypot(x - o.x, z - o.z) < o.r) && !houses.some((h) => Math.hypot(x - h.x, z - h.z) < G.clearance.house);
  const seen = new Set<number>();
  [...s.houses].sort((a, b) => a.plot_index - b.plot_index).forEach((h) => {
    if (seen.has(h.plot_index)) return; seen.add(h.plot_index);
    const sl = slotOf(h.plot_index); if (!sl) return;
    const base = ((sl.slot + (sl.ring % 2) * 0.5) / sl.cap) * Math.PI * 2 + phase[sl.ring]; const ringR = G.rings[sl.ring].r;
    for (let n = 0; n <= G.nudgeTries; n++) {
      const a = base + (n % 2 ? 1 : -1) * Math.ceil(n / 2) * G.nudgeStep; const r = Math.min(ringR, edge(a) - G.edgeMargin); const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (r < ringR - 1.2 || !free(x, z)) continue;
      houses.push({ userId: h.user_id, plotIndex: h.plot_index, ring: sl.ring, x, z, yaw: Math.atan2(-x, -z) }); return;
    }
  });
  const used = [...new Set(houses.map((h) => h.ring))].sort((a, b) => a - b);
  const L = G.lane; const lanes: LaneArc[] = [];
  used.forEach((ri) => {
    const r = G.rings[ri].r - L.inset; const step = (L.stepDeg * Math.PI) / 180; let start: number | null = null;
    const ok = (a: number) => { const x = Math.cos(a) * r, z = Math.sin(a) * r; return r < edge(a) - G.edgeMargin - 0.3 && !SECTION_ORDER.some((id) => Math.hypot(x - PP[id].x, z - PP[id].z) < L.blockPlot + 1.2) && Math.hypot(x - POND_POS.x, z - POND_POS.z) > L.blockPond + 0.6 && Math.hypot(x - SIGN.x, z - SIGN.z) > L.blockSign + 0.4; };
    for (let a = 0; a <= Math.PI * 2 + step; a += step) { const good = a <= Math.PI * 2 && ok(a); if (good && start == null) start = a; if (!good && start != null) { if (a - start > step * 4) lanes.push({ r, a0: start, a1: a - step }); start = null; } }
    if (start != null && Math.PI * 2 - start > step * 4) lanes.push({ r, a0: start, a1: Math.PI * 2 });
  });
  const docks: DockPlace[] = []; const nDocks = G.docks.count[s.tier - 1] ?? 0; const Rd = rng(seed + 'dock');
  for (let i = 0; i < nDocks; i++) {
    const base = (G.docks.angles[i] ?? i * 2.6) + Rd() * 0.5;
    for (let n = 0; n < 60; n++) {
      const a = base + (n % 2 ? 1 : -1) * Math.ceil(n / 2) * 0.1; const e = edge(a); const x = Math.cos(a) * (e - 0.5), z = Math.sin(a) * (e - 0.5);
      if (houses.some((h) => Math.hypot(h.x - x, h.z - z) < 3.4) || docks.some((d) => Math.hypot(d.x - x, d.z - z) < 7) || Math.hypot(x - POND_POS.x, z - POND_POS.z) < 4.6) continue;
      docks.push({ x, z, yaw: Math.atan2(Math.cos(a), Math.sin(a)), angle: a }); break;
    }
  }
  const flats: Flat[] = houses.map((h) => ({ x: h.x, z: h.z, r: 1.3 }));
  lanes.forEach((l) => { const len = (l.a1 - l.a0) * l.r; const n = Math.max(2, Math.ceil(len / L.flatEvery)); for (let i = 0; i <= n; i++) { const a = l.a0 + ((l.a1 - l.a0) * i) / n; flats.push({ x: Math.cos(a) * l.r, z: Math.sin(a) * l.r, r: L.flatR }); } });
  docks.forEach((d) => flats.push({ x: d.x, z: d.z, r: 0.9 }));
  return { R: s.radius, tier: s.tier, edge, houses, lanes, docks, flats };
}
