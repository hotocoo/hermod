/** Shapes of src/scene/assets/manifest.json (written by scripts/assets/build.mjs). */
export type AssetTier = 'high' | 'ultra';
export type Vec3 = [number, number, number];
export interface TierFile { file: string; bytes: number; blake3: string }
export interface SurfaceSlot { y: number; min: [number, number]; max: [number, number]; area: number }
export interface LightSlot { kind: string; n: number; pos: Vec3 }
/** Per-material KHR_materials_* style fields (scripts/assets/material-tags.mjs writes them; colors are CSS hex strings). */
export interface MaterialOverride {
  clearcoat?: number; clearcoatRoughness?: number; sheen?: number; sheenRoughness?: number; sheenColor?: string;
  anisotropy?: number; anisotropyRotation?: number; transmission?: number; thickness?: number; ior?: number; attenuationDistance?: number; attenuationColor?: string;
  specularIntensity?: number; iridescence?: number; /** 1 = parallax occlusion on ultra (userData.pom). */ pom?: number; roughness?: number; metalness?: number;
}
export interface ModelEntry {
  id: string; category: string; tags: string[]; hero: boolean; name: string;
  bounds: { min: Vec3; max: Vec3; size: Vec3 };
  pivot: 'bottom-center';
  footprint: { w: number; d: number; h: number };
  radius: number;
  lods: { tris: number; dist: number }[];
  surfaces: SurfaceSlot[];
  lights: LightSlot[];
  /** Named material slots whose map a room replaces with live content (material name -> kind). */
  slots?: Record<string, string>;
  /** Material name -> fidelity fields applied on load (high and ultra). */
  materialOverrides?: Record<string, MaterialOverride>;
  shadow: { cast: boolean; receive: boolean };
  /** Rigged people: baked idle clips (glTF animation names) and the seat height the sit clips are authored for. */
  figure?: { clips: string[]; seatHeight: number };
  source: { page: string; authors: string[]; license: string; res: string; origin: string; lightmap: boolean };
  tiers: Partial<Record<AssetTier, TierFile>>;
}
export interface MaterialEntry {
  id: string; use: string; tileM: number;
  source: { page: string; authors: string[]; license: string; res: string };
  tiers: Partial<Record<AssetTier, { file: { base: string; normal: string; orm: string }; bytes: number; hashes: Record<string, string> }>>;
}
export interface HdriEntry { id: string; use: string; width: number; source: { page: string; authors: string[]; license: string; res: string }; tiers: Partial<Record<AssetTier, TierFile>> }
export interface Manifest {
  version: number; schema: string; app: string;
  models: Record<string, ModelEntry>; materials: Record<string, MaterialEntry>; hdris: Record<string, HdriEntry>;
  ultraPack: { file: string; bytes: number; blake3: string; url: string } | null;
}
