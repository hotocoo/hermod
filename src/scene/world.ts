import * as THREE from 'three';
import { MATERIAL_FLAME, MATERIAL_WORLD, PATH_TINT, SECTION_ORDER, WATER, type PlotPos, type WorldMatSpec } from '@/config/scene';
import { displace, fbm, noise } from './noise';
import type { SectionId } from '@/lib/data/types';
import type { BaseMats, Fx, Mats } from './types';
import { B, C, createArchitecture, lathe, merge, mtx } from './world/architecture';
import { createBuildings, type Builder } from './world/buildings';
import { createDress } from './world/dress';
import { createHouses } from './world/houses';
import { mergeStatic } from './world/staticMerge';
import { createFigures } from './world/figures';
import { createFoliage } from './world/foliage';
import { createProps } from './world/props';
import { createRaven } from './world/raven';
import { buildTerrain, type TerrainOpts, type TerrainResult } from './world/terrain';
import { createTextures, type Textures } from './world/textures';

export interface WorldCtx { fx: () => Fx; quality: { texSize: number; anisotropy: number; grass: number } }

/** Build a MeshStandardMaterial from a config spec, skipping undefined keys (three warns on them). */
function worldMaterial(spec: WorldMatSpec, T: Textures): THREE.MeshStandardMaterial {
  const p: THREE.MeshStandardMaterialParameters = {};
  if (spec.color != null) p.color = spec.color;
  if (spec.map) p.map = T[spec.map];
  if (spec.bump) p.bumpMap = T[spec.bump];
  if (spec.bumpScale != null) p.bumpScale = spec.bumpScale;
  if (spec.normal) { p.normalMap = T[spec.normal]; const ns = spec.normalScale == null ? 1 : spec.normalScale; p.normalScale = new THREE.Vector2(ns, ns); }
  if (spec.roughness != null) p.roughness = spec.roughness;
  if (spec.metalness != null) p.metalness = spec.metalness;
  if (spec.vertexColors != null) p.vertexColors = spec.vertexColors;
  if (spec.emissive != null) p.emissive = spec.emissive;
  if (spec.emissiveIntensity != null) p.emissiveIntensity = spec.emissiveIntensity;
  return new THREE.MeshStandardMaterial(p);
}

/**
 * Procedural world kit: textures, extra materials, architecture, terrain, foliage, figures and props.
 * `base` is the town's material table; the kit fills in the rest (cast seam: base becomes the full Mats).
 */
export function createWorld(base: BaseMats, ctx: WorldCtx) {
  const M = base as Mats;
  const T = createTextures({ size: ctx.quality.texSize, anisotropy: ctx.quality.anisotropy });
  for (const [name, spec] of Object.entries(MATERIAL_WORLD)) (M as unknown as Record<string, THREE.Material>)[name] = worldMaterial(spec, T);
  for (const [name, f] of Object.entries(MATERIAL_FLAME)) (M as unknown as Record<string, THREE.Material>)[name] = new THREE.MeshBasicMaterial({ color: f.color, transparent: true, opacity: f.opacity, blending: THREE.AdditiveBlending, depthWrite: false });
  M.path.map = T.cob; M.path.normalMap = T.cobN; M.path.normalScale.set(1.1, 1.1); M.path.color.set(PATH_TINT); M.path.needsUpdate = true; M.path.userData.base = M.path.color.clone();
  M.stone.map = T.ashlar; M.stone.normalMap = T.ashlarN; M.stone.normalScale.set(1, 1); M.stone.needsUpdate = true;
  { const w = M.water; w.color.set(WATER.color); w.normalMap = T.waterN; w.normalScale.set(WATER.normalScale, WATER.normalScale); w.roughness = WATER.roughness; w.metalness = 0.1; w.opacity = WATER.opacity; w.envMapIntensity = WATER.envIntensity; T.waterN.repeat.set(WATER.repeat, WATER.repeat); w.needsUpdate = true; }
  M.leaf = M.foliage; M.foliage.userData.base = new THREE.Color(1, 1, 1); M.foliage.color.set(0xffffff);
  M.ground = M.terrain; M.terrain.color.set(0xffffff); M.terrain.userData.base = M.terrain.color.clone();
  M.stone.userData.base = M.stone.color.clone();

  const arch = createArchitecture(M);
  const figures = createFigures(M);
  const { tree, forest } = createFoliage(M);
  const { raven } = createRaven(M, T);
  const props = createProps(M);
  const { builders: built } = createBuildings(M, arch, figures, ctx);
  const dress = createDress(M, arch); const { cottage, roofs: houseRoofs } = createHouses(M, arch);
  /** Builders with level upgrades applied (wing and banners at 2, tower, lights and garden at 3). */
  const builders = Object.fromEntries(SECTION_ORDER.map((id) => [id, ((o) => { const g = built[id](o); const level = o?.level ?? 1; g.userData.anchorY += dress(g, id, level, g.userData.roofMats[0]); g.userData.level = level; const f = ctx.fx(); const doors = (g.userData.doors || []) as { pivot: THREE.Object3D }[]; return mergeStatic(g, [...doors.map((d) => d.pivot), g.userData.slide?.m, ...(g.userData.clock || []), f.spool, ...f.fireLights.map((l) => l.f), ...(f.seats || []).map((x) => x.fig)]); }) as Builder])) as Record<SectionId, Builder>;

  const api = {
    M,
    raven, B, C, lathe, windowAt: arch.windowAt, doorAt: arch.doorAt, column: arch.column, moulding: arch.moulding, chimney: arch.chimney, gable: arch.gable,
    T, noise, fbm, merge, mtx, builders, cottage, houseRoofs, tree, forest, person: figures.person, seated: figures.seated,
    cloud: props.cloud, lamp: props.lamp, signpost: props.signpost, pondDetail: props.pondDetail, puffGeo: props.puffGeo, displace,
    /** Ground height sampler; replaced by terrain() once the island is built. */
    heightAt: (x: number, z: number): number => { void x; void z; return 0; },
    terrain(parent: THREE.Group, plots: Record<string, PlotPos>, sign: PlotPos, opts: TerrainOpts): TerrainResult {
      const r = buildTerrain(M, parent, plots, sign, { ...opts, grass: ctx.quality.grass }); api.heightAt = r.heightAt; return r;
    },
  };
  return api;
}
export type World = ReturnType<typeof createWorld>;
