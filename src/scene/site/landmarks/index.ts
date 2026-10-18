import * as THREE from 'three';
import { COL, KIND_ASSET, type LandmarkKind, type SiteSectionId } from '../config';
import type { HeightFn } from '../height';
import { Parts } from '../kit';
import type { SiteMaterials } from '../materials';
import type { SiteLandmark, SitePlan, SiteProp } from '../plan';
import { loadAsset, type LoadedAsset } from './assets';

export interface PlacedLandmark { id: string; kind: LandmarkKind; asset: string; x: number; y: number; z: number; yaw: number; scale: number; section?: SiteSectionId }
/** Base y that keeps a footprint seated on the terrain (highest sample, buried 3 cm). */
export function seatY(h: HeightFn, x: number, z: number, hw: number, hd: number, yaw: number): number {
  const c = Math.cos(yaw), s = Math.sin(yaw); let y = h(x, z);
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) y = Math.max(y, h(x + a * hw * c + b * hd * s, z - a * hw * s + b * hd * c));
  return y - 0.03;
}

/** Every landmark to place: raised section plots (with their level scale) plus fixed monuments. */
export function placements(plan: SitePlan, h: HeightFn): PlacedLandmark[] {
  const out: PlacedLandmark[] = [];
  for (const p of plan.plotList) if (p.raised) out.push({ id: p.id, kind: p.kind, asset: KIND_ASSET[p.kind], x: p.x, y: seatY(h, p.x, p.z, p.fw / 2, p.fd / 2, p.yaw), z: p.z, yaw: p.yaw, scale: p.scale, section: p.id });
  for (const l of plan.landmarks) {
    if (l.kind === 'treasuryRow') { const n = l.n ?? 1; for (let i = 0; i < n; i++) out.push({ id: 'treasury:' + i, kind: 'treasuryRow', asset: 'treasury_small', x: l.x - l.w / 2 + ((i + 0.5) * l.w) / n, y: 0, z: l.z, yaw: l.yaw, scale: 1 }); } else out.push({ id: l.id, kind: l.kind, asset: l.id === 'echo' ? 'stoa_short' : KIND_ASSET[l.kind], x: l.x, y: 0, z: l.z, yaw: l.yaw, scale: 1 });
  }
  return out.map((o) => (o.section ? o : { ...o, y: seatY(h, o.x, o.z, o.kind === 'treasuryRow' ? 0.8 : 1.4, o.kind === 'treasuryRow' ? 0.7 : 1.4, o.yaw) }));
}

/** Plain boxes standing in while the glTF assets load (or if they fail). Never shown once assets are in. */
export function buildProxies(list: readonly PlacedLandmark[], plan: SitePlan, M: SiteMaterials): THREE.Mesh | null {
  const P = new Parts(); const dims = new Map<string, SiteLandmark>(plan.landmarks.map((l) => [l.id, l]));
  for (const l of list) { const d = dims.get(l.id); const plot = l.section ? plan.plots[l.section] : null; const w = (d?.w ?? plot?.fw ?? 3) * 0.95, dd = (d?.d ?? plot?.fd ?? 3) * 0.95; P.box(l.x, l.y, l.z, w, 1.6 * l.scale, dd, COL.limestone, l.yaw).prism(l.x, l.y + 1.6 * l.scale, l.z, w, dd, 0.5, COL.terracotta, l.yaw); }
  const g = P.build(); if (!g) return null; const m = new THREE.Mesh(g, M.vcol); m.castShadow = m.receiveShadow = true; return m;
}

export interface AssetBank { get(id: string): LoadedAsset | undefined; ids: string[]; dispose(): void }
export async function loadBank(ids: readonly string[]): Promise<AssetBank> {
  const lod = 0; const map = new Map<string, LoadedAsset>();
  await Promise.all([...new Set(ids)].map(async (id) => { try { map.set(id, await loadAsset(id, lod)); } catch { /* missing asset keeps its proxy */ } }));
  return { get: (id) => map.get(id), ids: [...map.keys()], dispose: () => map.forEach((a) => a.lods.forEach((g) => g.dispose())) };
}
export const assetIdsFor = (list: readonly PlacedLandmark[], props: readonly SiteProp[], extra: readonly string[] = []): string[] => [...list.map((l) => l.asset), ...new Set(props.map((p) => (p.kind === 'statue' ? 'statue' : p.kind))), ...extra];
