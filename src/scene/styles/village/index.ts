/**
 * "village" map style: the round organic island with plaza, signpost, market square, harbour, lanes and cottage rings.
 * Layout and ground come from village/plan.ts (+ terrain, paths, water); section buildings from authored glb (assets.ts)
 * with the procedural builders as fallback while loading.
 */
import * as THREE from 'three';
import { CAMERA, CONTACT, GROWTH, LIGHTS, NIGHT, SIGN, type QualitySpec, type QualityTier } from '@/config/scene';
import { GRASS } from './config';
import { finish } from '../../finish';
import { createHousing } from '../../world/housing';
import { mergeStatic } from '../../world/staticMerge';
import { setSiteAssetRenderer } from '../../site';
import { getSiteKtx2 } from '../../site/landmarks/assets';
import { instantiate, loadVillageGlb, windowMats } from './assets';
import { windify } from '../../render/wind';
import { ImpostorBank, IMPOSTOR_FADE, IMPOSTOR_FROM, impostorSwitch } from '../shared/impostor';
import { InstancedBank, loadGlb, preferUltraAssets, type Placement, windowMats as propWindows } from '../shared/instanced';
import { groupPlacements } from './placements';
import { generateVillagePlan } from './plan';
import { buildVillagePaths } from './paths';
import { buildVillageTerrain } from './terrain';
import { buildVillageWater } from './water';
import { applyAuthoredTerrain, fallbackTextureSet } from './tex';
import { LIGHT_UNIT_METERS, type AnchorId, type CameraPresets, type HousePlace, type LightSpec, type MapStyle, type PlotAnchor, type SiteFrame, type StyleCtx, type StyleSite } from '../types';

const CT = CONTACT as unknown as Record<string, readonly [number, number]>;
/** Season 0..3 from the real date (northern hemisphere). */
const seasonNow = (): number => { const m = new Date().getMonth(); return m >= 2 && m <= 4 ? 0 : m >= 5 && m <= 7 ? 1 : m >= 8 && m <= 10 ? 2 : 3; };

function buildSite(ctx: StyleCtx): StyleSite {
  const { kit: WK, info } = ctx; const M = WK.M; const rng = ctx.rng;
  let q: QualitySpec = ctx.q;
  setSiteAssetRenderer(ctx.renderer); preferUltraAssets(ctx.tier === 'ultra');
  const group = new THREE.Group(); group.name = 'style:village';
  const owned: { dispose(): void }[] = []; const pending: Promise<void>[] = []; let disposed = false;

  const box = (w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; return o; };
  const cyl = (rt: number, rb: number, h: number, m: THREE.Material, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 64, 1), m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; return o; };

  // contact shadow decals
  const decalTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d')!; const g = x.createRadialGradient(64, 64, 4, 64, 64, 62); g.addColorStop(0, 'rgba(0,0,0,0.95)'); g.addColorStop(0.5, 'rgba(0,0,0,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, 128, 128); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const decalMat = new THREE.MeshBasicMaterial({ map: decalTex, color: 0x120d08, transparent: true, opacity: CONTACT.opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const decalGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const houseDecalGeo = decalGeo.clone().scale(CONTACT.cottage[0] * 2, 1, CONTACT.cottage[1] * 2).translate(0, CONTACT.y, 0);
  owned.push(decalTex, decalMat, decalGeo, houseDecalGeo);
  const forest = WK.forest(group, GROWTH.maxTrees); const housing = createHousing(group, WK.cottage, GROWTH.maxTrees, { material: decalMat, geometry: houseDecalGeo }, WK.houseRoofs);
  const contactDecal = (hw: number, hd: number) => { const m = new THREE.Mesh(decalGeo, decalMat); m.scale.set(hw * 2, 1, hd * 2); m.position.y = CONTACT.y; m.renderOrder = 1; m.userData.noAO = true; m.raycast = () => undefined; return m; };

  // plan: deterministic layout per (seed, tier, levels, houses)
  const plan = generateVillagePlan({ seed: info.id, tier: ctx.growth.tier, levels: ctx.growth.levels, houses: ctx.growth.houses, season: seasonNow() });
  let housesKey = ctx.growth.houses.map((h) => h.user_id + ':' + h.plot_index).join(',');
  const TEXN = ctx.tier === 'ultra' ? 4096 : 2048; const tex = fallbackTextureSet(64); pending.push(applyAuthoredTerrain(tex, 'village', TEXN, getSiteKtx2()).then(() => undefined, () => undefined)); // procedural pixels only until the authored Blender maps are in
  const terrain = buildVillageTerrain(plan, tex, { grass: q.grass }); group.add(terrain.group);
  const paths = buildVillagePaths(plan, terrain.heightAt, tex); if (paths.mesh) group.add(paths.mesh);
  const water = buildVillageWater(plan, terrain.heightAt, tex); group.add(water.group);
  const heightAt = terrain.heightAt;
  pending.push(loadGlb('/assets/nature/grass_0.glb').then((sc) => { let m: THREE.Mesh | null = null; sc.traverse((o) => { const x = o as THREE.Mesh; if (x.isMesh && !m && /LOD0/.test(x.name)) m = x; }); if (!m) return; const mm = m as THREE.Mesh; const mat = (mm.material as THREE.MeshStandardMaterial).clone(); mat.side = THREE.DoubleSide; mat.alphaTest = GRASS.alphaTest; mat.alphaToCoverage = false; mat.userData.noA2C = true; /* kept out of the tier sweep, see GRASS */ mat.roughness = GRASS.roughness; mat.roughnessMap = null; mat.metalness = GRASS.metalness; mat.metalnessMap = null; mat.normalMap = null; mat.envMapIntensity = GRASS.envMapIntensity; mat.vertexColors = false; windify(mat, 'grass'); const geo = mm.geometry.clone().applyMatrix4(mm.matrixWorld); terrain.useGrass(geo, mat); geo.dispose(); }).catch(() => undefined));
  const monument = WK.signpost(); monument.userData.pickId = 'search'; const orb = monument.userData.orb as THREE.Object3D, orbRing = monument.userData.ring as THREE.Object3D;
  monument.position.set(SIGN.x, heightAt(SIGN.x, SIGN.z), SIGN.z); group.add(monument);

  const anchors = {} as Record<AnchorId, PlotAnchor>;
  for (const pl of plan.plotList) anchors[pl.id] = { x: pl.x, y: heightAt(pl.x, pl.z), z: pl.z, yaw: pl.yaw, door: pl.door };
  anchors.search = { x: SIGN.x, y: heightAt(SIGN.x, SIGN.z), z: SIGN.z, yaw: 0, door: { x: SIGN.x, z: SIGN.z + 0.8 } };
  anchors.fire = { x: 0, y: 0, z: 0, yaw: 0, door: { x: 0, z: 1 } };

  // placements: lamps and trees from the plan (procedural stand-ins until the nature assets are bound)
  const lampLights: THREE.PointLight[] = []; const lampObjs: THREE.Object3D[] = []; const litLamps: LightSpec[] = [];
  const TREE_KINDS = new Set(['oak', 'birch', 'poplar', 'pine', 'apple']); let useForest = false;
  const treeHolders: THREE.Object3D[] = [];
  for (const pm of plan.placements) {
    const y = heightAt(pm.x, pm.z);
    if (pm.kind === 'lamp') { if (pm.lit) litLamps.push({ id: `lamp:${litLamps.length}`, kind: 'point', x: pm.x, y: y + 1.3, z: pm.z, color: 0xffc27a, cd: 40, distance: 6.5, decay: 2, night: true }); }
    else if (TREE_KINDS.has(pm.kind) && useForest) { const g = forest.add(rng(`${info.id}:${pm.x.toFixed(2)}:${pm.z.toFixed(2)}`)); g.position.set(pm.x, y - 0.03, pm.z); g.rotation.y = pm.yaw; g.scale.setScalar(0.6 * pm.scale); treeHolders.push(g); }
  }
  // authored trees and props (instanced); the procedural forest is only the fallback when the glb files fail to load
  const bank = new InstancedBank(group); const imps = new ImpostorBank(group, null, IMPOSTOR_FADE); const impLists = new Map<string, Placement[]>();
  pending.push(Promise.all(groupPlacements(plan, heightAt).map((g) => { if (g.foliage) { const kind = /nature\/([a-z]+)_/.exec(g.url)![1]; const l = impLists.get(kind) ?? []; impLists.set(kind, l); l.push(...g.list); } return bank.add(g.url, g.list, g.foliage, false, 0, g.foliage ? IMPOSTOR_FROM + IMPOSTOR_FADE : Infinity, g.foliage ? impostorSwitch : undefined).catch(() => { if (g.foliage) throw new Error('tree asset missing'); }); })).then(() => Promise.all([...impLists].map(([k, l]) => imps.add(`/assets/nature/${k}_imp.glb`, l).catch(() => undefined)))).then(() => undefined).catch(() => {
    useForest = true; for (const pm of plan.placements) if (TREE_KINDS.has(pm.kind)) { const t = forest.add(rng(`${info.id}:${pm.x.toFixed(2)}:${pm.z.toFixed(2)}`)); t.position.set(pm.x, heightAt(pm.x, pm.z) - 0.03, pm.z); t.rotation.y = pm.yaw; t.scale.setScalar(0.6 * pm.scale); treeHolders.push(t); }
  }));
  // member cottages: authored variants, instanced live (the town animates each holder's position and scale)
  const COTTAGES = 6; const cottageLists: Placement[][] = Array.from({ length: COTTAGES }, () => []); const CAP = 64;
  const holderOf = new Map<THREE.Object3D, { list: Placement[]; p: Placement }>();
  const variantOf = (id: string) => { let h = 7; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return h % COTTAGES; };
  cottageLists.forEach((l, i) => { pending.push(bank.add(`/assets/village/cottage_${i}.glb`, l, false, true, CAP).catch(() => undefined)); });
  function makeLiveHouse(userId: string): THREE.Object3D {
    const h = new THREE.Object3D(); const list = cottageLists[variantOf(userId)];
    const p: Placement = { get x() { return h.position.x; }, get y() { return h.position.y; }, get z() { return h.position.z; }, get yaw() { return h.rotation.y; }, get scale() { return h.scale.x; } };
    list.push(p); holderOf.set(h, { list, p }); return h;
  }
  function releaseLiveHouse(h: THREE.Object3D) { const e = holderOf.get(h); if (!e) return; const i = e.list.indexOf(e.p); if (i >= 0) e.list.splice(i, 1); holderOf.delete(h); }
  const applyLampLights = () => lampLights.forEach((l, i) => { l.visible = i < q.lampLights; }); applyLampLights();

  const buildEmpty = () => {
    const g = new THREE.Group();
    g.add(box(3.0, 0.03, 3.0, M.path, 0, 0.081, 0));
    const corner = (x: number, z: number) => g.add(box(0.12, 0.3, 0.12, M.stone, x, 0.15, z));
    corner(-1.4, -1.4); corner(1.4, -1.4); corner(-1.4, 1.4); corner(1.4, 1.4);
    for (let i = -1.2; i <= 1.21; i += 0.4) { g.add(box(0.2, 0.02, 0.03, M.gold, i, 0.05, 1.5)); g.add(box(0.2, 0.02, 0.03, M.gold, i, 0.05, -1.5)); g.add(box(0.03, 0.02, 0.2, M.gold, 1.5, 0.05, i)); g.add(box(0.03, 0.02, 0.2, M.gold, -1.5, 0.05, i)); }
    g.add(cyl(0.04, 0.04, 1.0, M.trunk, 0.9, 0.5, 1.2), box(0.7, 0.4, 0.05, M.paper, 0.9, 1.0, 1.2));
    return mergeStatic(finish(g, [], 1.6)); // 35 static boxes: one draw call per material
  };

  let houses: HousePlace[] = plan.cottages.map((c) => ({ userId: c.userId, plotIndex: c.plotIndex, x: c.x, z: c.z, yaw: c.yaw }));
  const cameraPresets = {} as CameraPresets; for (const [k, c] of Object.entries(plan.cameras)) cameraPresets[k] = c; cameraPresets.home = plan.cameras.home ?? { az: CAMERA.home.az, el: CAMERA.home.el, dist: CAMERA.home.dist, target: [0, 0, 0] };
  const site: StyleSite = {
    group, plotAnchors: anchors, cameraPresets, radius: plan.R, tier: plan.tier, heightAt: (x, z) => heightAt(x, z),
    makeBuilding(id, level, built) {
      const g = built ? WK.builders[id]({ level }) : buildEmpty();
      if (built) {
        const [hw, hd] = CT[id]; const grow = 1 + (level - 1) * 0.28; g.add(contactDecal(hw * grow, hd * grow));
        // swap the procedural stand-in for the authored glb once loaded (kept on failure)
        const procedural = g.children.filter((c) => !c.userData.noAO);
        pending.push(loadVillageGlb(id).then((scene) => {
          if (disposed) return; const a = instantiate(scene, id, level); if (!a.group.children.length) return;
          procedural.forEach((c) => { c.visible = false; }); g.add(a.group);
          if (a.door) g.userData.door = { x: a.door.x, y: a.door.y + 0.3, z: a.door.z };
          g.userData.anchorY = a.top + 0.4; g.userData.doors = []; g.userData.perchY = a.top + 0.02;
        }).catch(() => undefined));
      }
      return g;
    },
    get houses() { return houses; }, makeHouse: (userId) => makeLiveHouse(userId), releaseHouse: (g) => releaseLiveHouse(g),
    pickables: [monument],
    lights: [...litLamps, { id: 'plaza', kind: 'point', x: SIGN.x, y: heightAt(SIGN.x, SIGN.z) + LIGHTS.plaza.y, z: SIGN.z, color: LIGHTS.plaza.color, cd: 7 * LIGHT_UNIT_METERS * LIGHT_UNIT_METERS, distance: LIGHTS.plaza.distance, decay: LIGHTS.plaza.decay, night: true }],
    update(f: SiteFrame) {
      const { t, night: k, reduced: red } = f;
      if (!red) { orbRing.rotation.x = Math.PI / 2 + Math.sin(t * 0.7) * 0.4; orbRing.rotation.y = t * 0.6; orb.position.y = 3.05 + Math.sin(t * 1.2) * 0.05; }
      water.update(t, k); terrain.update(t);
      windowMats.forEach((m) => { m.emissiveIntensity = Math.max(0, k - NIGHT.winFrom) * NIGHT.winIntensity; });
      lampLights.forEach((l, i) => { l.intensity = Math.max(0, k - NIGHT.lampLight.from) * NIGHT.lampLight.intensity * (red ? 1 : 0.95 + Math.sin(t * 7 + i * 2.3) * 0.03 + Math.sin(t * 17 + i) * 0.02); });
      propWindows.forEach((m) => { m.emissiveIntensity = Math.max(0, k - NIGHT.winFrom) * NIGHT.winIntensity; });
      bank.update(f.frustum, f.camPos); imps.update(f.camPos, f.frustum, f.fogDensity); forest.update(f.frustum); housing.update(f.frustum, f.camPos, f.camDist * GROWTH.lod.k);
    },
    setQuality(_tier: QualityTier, nq: QualitySpec) { q = nq; terrain.setGrass(q.grass); applyLampLights(); forest.setShadows(q.smallShadows); bank.setShadows(q.smallShadows); housing.setShadows(q.smallShadows); },
    ready: Promise.resolve(),
    /** Same tier: only cottages (members) change, so the town animates them in place; a new tier changes coast, lanes and districts, so it rebuilds with a cross-fade. */
    applyGrowth(g, next) {
      if (g.tier !== plan.tier) return false;
      const key = g.houses.map((h) => h.user_id + ':' + h.plot_index).join(','); if (key === housesKey) return true; // cottages depend on members only; level changes keep their places
      housesKey = key;
      const np = generateVillagePlan({ seed: next.id, tier: g.tier, levels: g.levels, houses: g.houses, season: plan.season });
      houses = np.cottages.map((c) => ({ userId: c.userId, plotIndex: c.plotIndex, x: c.x, z: c.z, yaw: c.yaw })); return true;
    },
    stats() { let meshes = 0, instanced = 0, triangles = 0; group.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh || !m.visible) return; const geo = m.geometry; const tri = (geo.index ? geo.index.count : geo.attributes.position.count) / 3; if ((m as THREE.InstancedMesh).isInstancedMesh) { instanced++; triangles += tri * (m as THREE.InstancedMesh).count; } else triangles += tri; meshes++; }); return { meshes, instanced, triangles: Math.round(triangles) }; },
    dispose() { disposed = true; terrain.dispose(); paths.dispose(); tex.dispose(); water.dispose(); bank.dispose(); imps.dispose(); owned.forEach((o) => o.dispose()); housing.clear(); forest.clear(); lampObjs.forEach((l) => l.removeFromParent()); treeHolders.length = 0; group.removeFromParent(); },
  };
  Object.defineProperty(site, 'ready', { get: () => Promise.all(pending).then(() => undefined) });
  return site;
}

export const village: MapStyle = { id: 'village', label: 'Village', blurb: 'A round green island: cottages in rings, a cobbled plaza, signpost, market square and harbour.', buildSite };
