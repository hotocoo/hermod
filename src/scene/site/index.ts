/**
 * buildSite(THREE, materials, plan, quality) -> SiteHandle.
 * Terrain, paths, water and flames build synchronously. Everything with a silhouette is an authored glTF (scripts/assets/blender/landmarks):
 * landmarks, section buildings, cottage variants, kit pieces (walls, bridges, piers), lived-in decor, trees. Proxies stand in until `ready`.
 * Section buildings are NOT in `group`: the town owns them (springs, hover, picking) and gets them from `section(id, raised)`.
 */
import * as THREE from 'three';
import { COTTAGE_VARIANTS, DETAIL, FIXED, HARBOR, SEA_Y, SITE_SECTIONS, type SiteQuality, type SiteSectionId } from './config';
import type { LightSpec } from '../styles/types';
import { makeHeight, type HeightFn } from './height';
import { buildKit, KIT_IDS } from './kitpieces';
import { sanctuaryLights } from './lights';
import type { SiteMaterials } from './materials';
import { buildPaths } from './paths';
import { edgeAt, type SiteCottage, type SitePlan } from './plan';
import { buildFlames, buildTrees, type Flames } from './props';
import { buildCottageProxies, buildStructures } from './structures';
import { buildTerrain } from './terrain';
import { assetIdsFor, buildProxies, loadBank, placements, seatY, type AssetBank } from './landmarks';
import { COL } from './config';
import { Parts } from './kit';

export interface PlotAnchor { x: number; y: number; z: number; yaw: number; group: THREE.Group; door: { x: number; z: number } }
export interface SiteHandle {
  group: THREE.Group;
  /** Per section anchors (y = seat height used by section()), plus 'search' (herm at the propylon) and 'fire' (hearth centre). */
  plotAnchors: Record<SiteSectionId, PlotAnchor> & { search: PlotAnchor; fire: PlotAnchor };
  /**
   * Plot-local section building: origin at the anchor (seat height 0), +z front, plot yaw NOT applied, level scale applied to the mesh.
   * Proxy until `ready`, then the authored LOD set (swapped in place). raised=false is the empty foundation.
   * userData: door {x,y,z} plot-local, anchorY label height, roofMats [], smoke (plot-local Vector3, hearth and board).
   */
  section(id: SiteSectionId, raised: boolean): THREE.Group;
  cottages: SiteCottage[];
  /** Physical lights (candela) as data; `buildSite` also drives its own PointLights from the same list when `ownLights` (default). */
  lights: LightSpec[];
  update(dt: number): void;
  setNight(n: number): void;
  heightAt: HeightFn;
  /** Resolves when the glTF assets are in (never rejects; missing assets keep their proxies). */
  ready: Promise<void>;
  stats(): { meshes: number; instanced: number; triangles: number };
  dispose(): void;
}

const LOD_DIST = [0, 34, 72] as const;
const SMOKE: Partial<Record<SiteSectionId, [number, number, number]>> = { hearth: [0, 3.9, 0], board: [1.2, 2.2, -0.9] };

/** externalTrees: the caller instances authored tree assets from plan.trees, so the procedural tree meshes are not built. */
export interface BuildOpts { ownLights?: boolean; externalTrees?: boolean }
export function buildSite(_three: typeof THREE, M: SiteMaterials, plan: SitePlan, quality: SiteQuality, opts: BuildOpts = {}): SiteHandle {
  const D = DETAIL[quality]; const group = new THREE.Group(); group.name = 'site';
  const height = makeHeight(plan); const terrain = buildTerrain(plan, M, quality, height);
  group.add(terrain.top, terrain.rim); if (terrain.water) group.add(terrain.water);
  const paths = buildPaths(plan, M, height); if (paths) group.add(paths);
  const structs = buildStructures(plan, M, height); if (structs) group.add(structs);
  const cotProx = buildCottageProxies(plan, M, height); if (cotProx) group.add(cotProx);
  const trees = opts.externalTrees ? { meshes: [] as THREE.Object3D[], dispose: () => undefined } : buildTrees(plan, M, height, D.trees); trees.meshes.forEach((m) => group.add(m));

  const placedAll = placements(plan, height); const placed = placedAll.filter((l) => !l.section);
  const proxies = buildProxies(placed, plan, M); if (proxies) group.add(proxies);
  const anchors = {} as Record<string, PlotAnchor>;
  const mk = (id: string, x: number, z: number, yaw: number, door: { x: number; z: number }, y = height(x, z)) => { const g = new THREE.Group(); g.name = 'site:' + id; g.position.set(x, y, z); g.rotation.y = yaw; group.add(g); anchors[id] = { x, y, z, yaw, group: g, door }; };
  for (const id of SITE_SECTIONS) { const p = plan.plots[id]; mk(id, p.x, p.z, p.yaw, p.door, seatY(height, p.x, p.z, p.fw / 2, p.fd / 2, p.yaw)); }
  mk('search', FIXED.herm.x, FIXED.herm.z, FIXED.herm.yaw, { x: FIXED.herm.x, z: FIXED.herm.z + 0.8 }); mk('fire', FIXED.plaza.x, FIXED.plaza.z, 0, { x: FIXED.plaza.x, z: FIXED.plaza.z + 1 });

  // ---- harbour basin: a water sector between the coast and the mole (tier 5)
  let basin: THREE.Mesh | null = null;
  if (plan.tier >= HARBOR.tier) {
    const [a0, a1] = HARBOR.arc; const n = 48; const pos: number[] = [], idx: number[] = [];
    for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; const e = edgeAt(plan.edge, Math.cos(a), Math.sin(a)); for (const o of [-0.25, HARBOR.moleOut + 0.2]) pos.push(Math.cos(a) * (e + o), SEA_Y, Math.sin(a) * (e + o)); }
    for (let i = 0; i < n; i++) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const uv = new Float32Array((pos.length / 3) * 2); for (let i = 0; i < pos.length / 3; i++) { uv[i * 2] = pos[i * 3] * 0.5; uv[i * 2 + 1] = pos[i * 3 + 2] * 0.5; } g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    basin = new THREE.Mesh(g, M.water); basin.renderOrder = 2; group.add(basin);
  }
  // ---- sections: plot-local groups owned by the town
  interface Sec { id: SiteSectionId; raised: boolean; g: THREE.Group; proxy: THREE.Object3D | null }
  const secs: Sec[] = []; let bank: AssetBank | null = null;
  const lodMesh = (id: string, sx: number, sy: number, sz: number): THREE.LOD | null => {
    const a = bank?.get(id); if (!a) return null; const lod = new THREE.LOD();
    a.lods.forEach((geo, i) => { const m = new THREE.Mesh(geo, a.material); m.castShadow = m.receiveShadow = true; lod.addLevel(m, LOD_DIST[i] ?? LOD_DIST[LOD_DIST.length - 1] * (i + 1)); });
    lod.scale.set(sx, sy, sz); return lod;
  };
  const proxyBox = (w: number, d: number, h: number, roof: boolean): THREE.Mesh => {
    const P = new Parts(); P.box(0, 0, 0, w * 0.95, h, d * 0.95, COL.limestone); if (roof) P.prism(0, h, 0, w * 0.95, d * 0.95, 0.5, COL.terracotta);
    const m = new THREE.Mesh(P.build()!, M.vcol); m.castShadow = m.receiveShadow = true; return m;
  };
  const fillSection = (s: Sec) => {
    const pl = plan.plots[s.id]; const sc = s.raised ? pl.scale : 1;
    if (s.proxy) { s.g.remove(s.proxy); s.proxy = null; }
    const real = s.raised ? lodMesh(KIND_OF[pl.kind] ?? pl.kind, sc, sc, sc) : lodMesh('foundation', pl.fw / 4, 1, pl.fd / 4);
    if (real) { s.g.add(real); s.proxy = real; const a = bank!.get(s.raised ? KIND_OF[pl.kind] ?? pl.kind : 'foundation'); s.g.userData.anchorY = s.raised ? (a ? a.bounds.max.y * sc + 0.5 : 3) : 0.8; return; }
    s.proxy = s.raised ? proxyBox(pl.fw, pl.fd, 1.6 * sc, true) : proxyBox(pl.fw, pl.fd, 0.25, false); s.g.add(s.proxy); s.g.userData.anchorY = s.raised ? 2.4 * sc : 0.8;
  };
  const section = (id: SiteSectionId, raised: boolean): THREE.Group => {
    const g = new THREE.Group(); g.name = 'section:' + id; const pl = plan.plots[id]; const a = anchors[id];
    const dx = pl.door.x - a.x, dz = pl.door.z - a.z, c = Math.cos(a.yaw), s = Math.sin(a.yaw);
    g.userData.door = { x: dx * c - dz * s, y: 0.3, z: dx * s + dz * c }; g.userData.roofMats = [];
    const sm = SMOKE[id]; if (raised && sm) g.userData.smoke = new THREE.Vector3(...sm);
    const rec: Sec = { id, raised, g, proxy: null }; secs.push(rec); fillSection(rec); return g;
  };

  // ---- flames and lights from the data list
  const lights = sanctuaryLights(plan, height);
  const fl: { x: number; y: number; z: number; s: number }[] = []; const hearth = plan.plots.hearth;
  fl.push({ x: hearth.x, y: anchors.hearth.y + 0.52, z: hearth.z, s: 1.6 });
  plan.props.forEach((p) => { if (p.kind === 'torch') fl.push({ x: p.x, y: height(p.x, p.z) + 0.9 * p.s, z: p.z, s: 0.7 * p.s }); else if (p.kind === 'altar') fl.push({ x: p.x, y: height(p.x, p.z) + 0.46, z: p.z, s: 0.55 }); });
  const order = ['low', 'medium', 'high', 'ultra'] as const; const qi = order.indexOf(quality);
  const own = opts.ownLights !== false ? lights.filter((l) => order.indexOf(l.minTier ?? 'low') <= qi && D.lights > 0).slice(0, [0, 4, 8, 12][qi]) : [];
  const flames: Flames = buildFlames(fl, M, own.map((l) => ({ x: l.x, y: l.y, z: l.z, i: l.cd })));
  group.add(flames.mesh); flames.lights.forEach((l) => group.add(l));

  // ---- authored assets
  const instanced: THREE.InstancedMesh[] = []; const lodObjs: THREE.Object3D[] = []; let disposed = false; const bankDispose: (() => void)[] = [];
  const dm = new THREE.Object3D();
  const inst = (id: string, list: readonly { x: number; y: number; z: number; yaw: number; sx?: number; sy?: number; sz?: number }[]) => {
    const a = bank?.get(id); if (!a || !list.length) return false;
    const im = new THREE.InstancedMesh(a.geometry, a.material, list.length); im.castShadow = im.receiveShadow = true;
    list.forEach((p, i) => { dm.position.set(p.x, p.y, p.z); dm.rotation.set(0, p.yaw, 0); dm.scale.set(p.sx ?? 1, p.sy ?? 1, p.sz ?? 1); dm.updateMatrix(); im.setMatrixAt(i, dm.matrix); });
    im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); group.add(im); instanced.push(im); return true;
  };
  const decorIds = [...new Set(plan.decor.map((d) => d.kind))];
  const ids = [...new Set([...assetIdsFor(placed, plan.props, ['foundation', ...Object.values(KIND_OF), ...decorIds, ...KIT_IDS]), ...Array.from({ length: COTTAGE_VARIANTS }, (_, i) => `cottage_${i}`)])];
  const ready = loadBank(ids).then((b) => {
    if (disposed) { b.dispose(); return; }
    bank = b; bankDispose.push(() => b.dispose());
    for (const l of placed) {
      const lod = lodMesh(l.asset, l.scale, l.scale, l.scale); if (!lod) continue; lod.position.set(l.x, l.y, l.z); lod.rotation.y = l.yaw; lod.name = l.id; group.add(lod); lodObjs.push(lod);
    }
    if (placed.some((l) => bank!.get(l.asset)) && proxies) { group.remove(proxies); proxies.geometry.dispose(); }
    secs.forEach(fillSection);
    // props
    for (const key of ['statue', 'altar', 'herm', 'torch'] as const) inst(key, plan.props.filter((p) => p.kind === key).map((p) => ({ x: p.x, y: height(p.x, p.z) - 0.02, z: p.z, yaw: p.yaw, sx: p.s, sy: p.s, sz: p.s })));
    // cottages: authored variants
    const byVar: SiteCottage[][] = Array.from({ length: COTTAGE_VARIANTS }, () => []); plan.cottages.forEach((c) => byVar[c.variant].push(c));
    let cot = false; byVar.forEach((list, v) => { if (inst(`cottage_${v}`, list.map((c) => ({ x: c.x, y: height(c.x, c.z) - 0.05, z: c.z, yaw: c.yaw, sx: c.scale, sy: c.scale, sz: c.scale })))) cot = true; });
    if (cot && cotProx) { group.remove(cotProx); cotProx.geometry.dispose(); }
    // kit pieces replace the merged wall/terrace/bridge/pier proxies
    if (buildKit(plan, height, inst, (id) => !!bank!.get(id)) && structs) { group.remove(structs); structs.geometry.dispose(); }
    // lived-in decor (stones, mole, boats sit on the water or the river bed, everything else on the ground)
    const yOf = (d: { kind: string; x: number; z: number }) => (d.kind === 'step_stone' ? -0.2 : d.kind === 'mole_seg' ? SEA_Y - 3.2 : d.kind.startsWith('boat') ? SEA_Y + 0.02 : height(d.x, d.z) - 0.02);
    for (const kind of decorIds) inst(kind, plan.decor.filter((d) => d.kind === kind).map((d) => ({ x: d.x, y: yOf(d), z: d.z, yaw: d.yaw, sx: d.s, sy: kind === 'mole_seg' ? 1.25 : d.s, sz: d.s })));
  }).catch((e) => { console.warn('site assets', e); });
  void ready;

  return {
    group, plotAnchors: anchors as SiteHandle['plotAnchors'], section, cottages: plan.cottages, lights, ready: ready.then(() => undefined),
    update: (dt) => flames.update(dt), setNight: (n) => flames.setNight(n), heightAt: height,
    stats: () => { let meshes = 0, instancedN = 0, triangles = 0; group.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh || !m.visible) return; const g = m.geometry; const t = (g.index ? g.index.count : g.attributes.position.count) / 3; if ((m as THREE.InstancedMesh).isInstancedMesh) { instancedN++; triangles += t * (m as THREE.InstancedMesh).count; } else triangles += t; meshes++; }); return { meshes, instanced: instancedN, triangles: Math.round(triangles) }; },
    dispose: () => { disposed = true; basin?.geometry.dispose(); terrain.dispose(); trees.dispose(); flames.dispose(); paths?.geometry.dispose(); structs?.geometry.dispose(); proxies?.geometry.dispose(); cotProx?.geometry.dispose(); instanced.forEach((o) => o.dispose()); lodObjs.forEach((o) => o.removeFromParent()); bankDispose.forEach((f) => f()); group.removeFromParent(); },
  };
}
const KIND_OF: Record<string, string> = { tholos: 'tholos', stoa: 'stoa', treasury: 'treasury', workshop: 'workshop', tower: 'tower', bouleuterion: 'bouleuterion', palaestra: 'palaestra' };
export { generateSitePlan } from './plan';
export type { SitePlan, SiteInput } from './plan';
export { makeSiteMaterials } from './materials';
export { setSiteAssetRenderer } from './landmarks/assets';
export { sanctuaryLights, LIGHT_CAP } from './lights';
