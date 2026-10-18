/**
 * MapStyle contract. A style owns everything static about the island (terrain, paths, plaza, water, trees, cottages,
 * section buildings, props, lights data); the town owns actors and the camera (plot springs, people, ravens, rooms, overlay).
 * A third style is one folder src/scene/styles/<id>/index.ts plus one entry in ./index.ts.
 * Units: world units (1 unit ~ 4 m). x east, z south, y up. Plot-local +z is a building's front; yaw rotates +z to (sin yaw, cos yaw).
 */
import type * as THREE from 'three';
import type { BuildingLevel, QualitySpec, QualityTier } from '@/config/scene';
import type { SectionId } from '@/lib/data/types';
import type { Rng } from '../rng';
import type { Fx, SpaceInfo } from '../types';
import type { createWorld } from '../world';

export type MapStyleId = 'village' | 'sanctuary';
/** Shared kit (people, clouds, lamps, interiors props). Styles may use it but never need to. */
export type WorldKit = ReturnType<typeof createWorld>;
export type AnchorId = SectionId | 'search' | 'fire';

/** Where a building (or the signpost 'search' / plaza fire 'fire') stands. y is the seat height; door is in world xz. */
export interface PlotAnchor { x: number; y: number; z: number; yaw: number; door: { x: number; z: number }; group?: THREE.Group }
export interface CameraPreset { az: number; el: number; dist: number; target: readonly [number, number, number] }
/** Contract: `home` is required (orbit az/el/dist around target); other names are optional shots (plan, temple, harbour...). */
export type CameraPresets = { home: CameraPreset } & Record<string, CameraPreset>;

export interface HousePlace { userId: string; plotIndex: number; x: number; z: number; yaw: number }
export interface StyleGrowth {
  tier: number;
  /** Island radius in world units. */
  R: number;
  /** 0 = empty foundation, 1..3 raised. Same semantics as the Rust projection `buildings`. */
  levels: Record<SectionId, BuildingLevel | 0>;
  houses: readonly { user_id: string; plot_index: number }[];
}
/** Per frame values the style needs (sun and sky are owned by the render stack, not the style). */
export interface SiteFrame { dt: number; t: number; night: number; wind: number; cover: number; reduced: boolean; frustum: THREE.Frustum; camPos: THREE.Vector3; camDist: number; fogDensity: number }
/** Meters per world unit: lights are authored in physical candela and scaled by 1/LIGHT_UNIT_METERS^2 for the scene. */
export const LIGHT_UNIT_METERS = 4;
/** A light placed by a style, in physical units (point/spot: candela; lumen = cd * 4pi for point). Data, never code. night: only lit at night (scaled by night factor); else always on. */
export interface LightSpec { id: string; kind: 'point' | 'spot'; x: number; y: number; z: number; color: number; cd: number; distance: number; decay: number; night: boolean; shadow?: boolean; minTier?: QualityTier }

export interface StyleCtx {
  three: typeof THREE;
  /** For KTX2 transcoder setup in asset loaders. */
  renderer: THREE.WebGLRenderer;
  seed: string;
  info: SpaceInfo;
  growth: StyleGrowth;
  tier: QualityTier;
  q: QualitySpec;
  kit: WorldKit;
  fx: Fx;
  reduced: boolean;
  /** First build of this town (staggered intro) vs a rebuild. */
  first: boolean;
  rng: (seed: string) => Rng;
}

export interface StyleSite {
  group: THREE.Group;
  /** Every section id, plus 'search' (signpost or herm) and 'fire' (plaza hearth centre). */
  plotAnchors: Record<AnchorId, PlotAnchor>;
  cameraPresets: CameraPresets;
  readonly radius: number;
  readonly tier: number;
  heightAt(x: number, z: number): number;
  /**
   * Section building in plot-local space (origin at the anchor, +z front), not yet added to a parent.
   * built=false returns the empty foundation. userData contract (all optional except door): door {x,y,z}, anchorY, doors[], roofMats[], smoke, arcadeSign.
   * Town animates the group (scale/hover) and positions it at the anchor.
   */
  makeBuilding(id: SectionId, level: BuildingLevel, built: boolean): THREE.Group;
  /** Cottage placements (one per member) and the factory for one cottage; town animates them in. May change after applyGrowth. */
  readonly houses: readonly HousePlace[];
  makeHouse(userId: string): THREE.Object3D;
  releaseHouse(g: THREE.Object3D): void;
  /** In place growth (tier, levels, cottages changed, same space and style). Returns false when the town must rebuild the site. */
  applyGrowth?(growth: StyleGrowth, info: SpaceInfo): boolean;
  /** Extra pick targets (signpost); userData.pickId is read on hit. */
  pickables: readonly THREE.Object3D[];
  lights: readonly LightSpec[];
  update(f: SiteFrame): void;
  setQuality(tier: QualityTier, q: QualitySpec): void;
  /** Resolves when authored assets are in (never rejects; failures keep the previous visual). */
  ready: Promise<void>;
  stats(): { meshes: number; instanced: number; triangles: number };
  dispose(): void;
}

export interface MapStyle {
  id: MapStyleId;
  label: string;
  blurb: string;
  buildSite(ctx: StyleCtx): StyleSite;
}
