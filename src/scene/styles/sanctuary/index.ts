/**
 * "sanctuary" map style: the Olympia-like island (walled temenos, temple on the axis, stadium, rivers, harbour).
 * Thin adapter over src/scene/site (pure plan + builders); section buildings come from SiteHandle.section so the town
 * can animate, hover and pick them like any plot.
 */
import * as THREE from 'three';
import { ImpostorBank, IMPOSTOR_FROM } from '../shared/impostor';
import { InstancedBank, type Placement } from '../shared/instanced';
import { CAMERAS } from '../../site/config';
import { applyTerrainSplat, layerMeans } from '../../render/terrainShader';
import { applyAuthoredTerrain, fallbackTextureSet } from '../village/tex';
import { buildSite as buildSiteWorld, generateSitePlan, makeSiteMaterials, setSiteAssetRenderer } from '../../site';
import type { AnchorId, CameraPresets, HousePlace, MapStyle, PlotAnchor, StyleCtx, StyleSite } from '../types';

function buildSite(ctx: StyleCtx): StyleSite {
  const { growth, info } = ctx;
  const plan = generateSitePlan({ seed: info.id, tier: growth.tier, levels: growth.levels, houses: growth.houses });
  setSiteAssetRenderer(ctx.renderer);
  const siteMats = makeSiteMaterials(); const mapsReady = applyGroundMaps(siteMats, ctx.tier);
  // the town creates the PointLights from `lights` (data), so the site must not drive its own
  const handle = buildSiteWorld(THREE, siteMats, plan, ctx.tier, { ownLights: false, externalTrees: true });
  const bank = new InstancedBank(handle.group); const groups = new Map<string, Placement[]>();
  for (const t of plan.trees) { const url = `/assets/nature/${t.kind}_${Math.floor((t.x * 7 + t.z * 13 + 100) % 3)}.glb`; const l = groups.get(url) ?? []; groups.set(url, l); l.push({ x: t.x, y: handle.heightAt(t.x, t.z) - 0.03, z: t.z, yaw: t.yaw, scale: t.s }); }
  const imps = new ImpostorBank(handle.group); const impL = new Map<string, Placement[]>();
  for (const [u, l] of groups) { const k = /nature\/([a-z]+)_/.exec(u)![1]; impL.set(k, [...(impL.get(k) ?? []), ...l]); }
  const treesReady = Promise.all([...groups].map(([u, l]) => bank.add(u, l, true, false, 0, IMPOSTOR_FROM).catch(() => undefined))).then(() => Promise.all([...impL].map(([k, l]) => imps.add(`/assets/nature/${k}_imp.glb`, l).catch(() => undefined))));
  const anchors = {} as Record<AnchorId, PlotAnchor>;
  (Object.keys(handle.plotAnchors) as AnchorId[]).forEach((id) => { const a = handle.plotAnchors[id]; anchors[id] = { x: a.x, y: a.y, z: a.z, yaw: a.yaw, door: a.door }; });
  const cameraPresets = { home: { az: CAMERAS.home.az, el: CAMERAS.home.el, dist: CAMERAS.home.dist, target: CAMERAS.home.target } } as CameraPresets;
  for (const [k, c] of Object.entries(CAMERAS)) cameraPresets[k] = { az: c.az, el: c.el, dist: c.dist, target: c.target };
  const houses: HousePlace[] = plan.cottages.map((c) => ({ userId: c.userId, plotIndex: c.plotIndex, x: c.x, z: c.z, yaw: c.yaw }));
  // the herm is the signpost: an invisible pick volume stands over it
  const pick = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 2.2, 8), new THREE.MeshBasicMaterial({ visible: false }));
  pick.position.set(anchors.search.x, anchors.search.y + 1.1, anchors.search.z); pick.userData.pickId = 'search'; handle.group.add(pick);
  return {
    group: handle.group, plotAnchors: anchors, cameraPresets, radius: plan.R, tier: plan.tier, heightAt: handle.heightAt,
    makeBuilding: (id, _level, built) => { const g = handle.section(id, built); g.userData.perchY = 2.35; return g; }, // stoa ridge height (perchY: raven perch height of the Commons roof)
    houses, makeHouse: () => new THREE.Object3D(), releaseHouse: () => undefined,
    pickables: [], lights: handle.lights,
    // same tier and members: levels only, the town raises the buildings in place; anything else rebuilds with a cross-fade
    applyGrowth: (g) => g.tier === plan.tier && g.houses.length === plan.cottages.length && g.houses.every((h, i) => h.user_id === plan.cottages[i]?.userId),
    update: (f) => { bank.update(f.frustum, f.camPos); imps.update(f.camPos, f.frustum, f.fogDensity); handle.update(f.dt); handle.setNight(f.night); },
    setQuality: (_t, q) => bank.setShadows(q.smallShadows),
    ready: Promise.all([handle.ready.catch(() => undefined), treesReady, mapsReady]).then(() => undefined),
    stats: () => handle.stats(),
    dispose: () => { bank.dispose(); imps.dispose(); pick.geometry.dispose(); (pick.material as THREE.Material).dispose(); handle.dispose(); },
  };
}

export const sanctuary: MapStyle = { id: 'sanctuary', label: 'Sanctuary', blurb: 'An Olympia-like sanctuary: a walled precinct, a temple on the axis, a stadium and rivers.', buildSite };

/** Blender-baked PBR sets (public/assets/nature/terrain/sanctuary): the ground runs the shared splat shader (render/terrainShader.ts, same module as the village); cliff and paving keep single sets. */
async function applyGroundMaps(M: ReturnType<typeof makeSiteMaterials>, tier: string): Promise<void> {
  const load = (u: string, srgb: boolean) => new Promise<THREE.Texture>((res, rej) => new THREE.TextureLoader().load(u, (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8; res(t); }, undefined, rej));
  const base = `/assets/nature/terrain/sanctuary/${tier === 'ultra' ? 'ultra' : 'high'}/`;
  const set = async (m: THREE.Material, k: string, tile: number) => {
    const mm = m as THREE.MeshStandardMaterial; const [a, n, o] = await Promise.all([load(`${base}${k}_bc.webp`, true), load(`${base}${k}_n.webp`, false), load(`${base}${k}_orm.webp`, false)]);
    [a, n, o].forEach((t) => t.repeat.set(tile, tile)); mm.map = a; mm.normalMap = n; mm.roughnessMap = o; mm.aoMap = null; mm.metalnessMap = null; mm.needsUpdate = true;
  };
  try { await Promise.all([set(M.rock, 'cliff', 1), set(M.pave, 'flagstone', 1.4)]); } catch { /* keep vertex colours */ }
  try {
    const ts = fallbackTextureSet(64); if (!(await applyAuthoredTerrain(ts, 'sanctuary', tier === 'ultra' ? 4096 : 2048))) { ts.dispose(); return; }
    const m = M.terrain as THREE.MeshStandardMaterial; m.map = null; m.normalMap = null; m.roughnessMap = null; m.userData.splatMeans = layerMeans(ts.splat.albedo);
    applyTerrainSplat(m, { albedo: ts.splat.albedo, normal: ts.splat.normal, orm: ts.splat.orm, tile: [0.9, 0.7, 0.8, 0.8, 0.5, 0.8] }, { key: 'sanctuary-splat', albedoGain: 1.0, desaturate: 0.1, normalStrength: 1 });
  } catch { /* keep the single grass map */ void set(M.terrain, 'grass', 1.1).catch(() => undefined); }
}
