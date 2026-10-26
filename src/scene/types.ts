import type * as THREE from 'three';
import type { SectionId } from '@/lib/data/types';
import type { BuildingLevel, QualityTier, WeatherKind } from '@/config/scene';
import type { InteriorPaint } from './interiors';
import type { Rng } from './rng';
import type { Spring } from './spring';

type Std = THREE.MeshStandardMaterial;
/** Shared material table: base entries are created by the town, the rest by the world kit. */
export interface Mats {
  paper: Std; stone: Std; plinth: Std; plinthDark: Std; ground: Std; ink: Std; gold: Std; path: Std; water: Std; leaf: Std; trunk: Std;
  win: Std; lamp: Std; thread: Std; cloud: Std;
  stoneW: Std; plasterW: Std; brickW: Std; timber: Std; beam: Std; slate: Std; trim: Std; rock: Std; barkM: Std; foliage: Std; terrain: Std;
  bronze: Std; cloth: Std; skin: Std; doorGlow: Std; daylight: Std; grass: Std; leafCard: Std;
  flameA: THREE.MeshBasicMaterial; flameB: THREE.MeshBasicMaterial;
}
export type BaseMats = Omit<Mats, 'stoneW' | 'plasterW' | 'brickW' | 'timber' | 'beam' | 'slate' | 'trim' | 'rock' | 'barkM' | 'foliage' | 'terrain' | 'bronze' | 'cloth' | 'skin' | 'doorGlow' | 'daylight' | 'grass' | 'leafCard' | 'flameA' | 'flameB'>;

export interface FireLight { l: THREE.PointLight; b: number; f: THREE.Object3D | null }
export interface Seat { fig: THREE.Group; s: Spring; on: boolean; me: boolean; a: number }
export interface SmokePuff { m: THREE.Object3D; life: number; dx: number }
/** Mutable effect state shared between the town loop and the building builders. */
export interface Fx {
  smoke: SmokePuff[]; pulses: unknown[]; fireLights: FireLight[]; spool: THREE.Group | null; spoolV: number; burst: number; fire: number;
  smokeOrigin?: THREE.Vector3 | null; seats?: Seat[] | null;
}
/** Roof bookkeeping stamped on every building group by finish(). */
export interface RoofEntry { m: THREE.Mesh; y: number }
export type BuildingMeta = { section?: SectionId };

/** A building plot on the island with its animation springs. */
export interface Plot {
  id: SectionId; g: THREE.Group; built: boolean; level: BuildingLevel;
  open: Spring; scale: Spring; hover: Spring; pop: Spring; door?: Spring;
  delay: number; born: number; dying?: boolean;
}
/** Plots by section id (entries exist only for built-out ids; look up with a guard). */
export type Plots = Record<string, Plot>;

export interface RingOpts { w?: number; color?: number; y?: number; dur?: number; r0?: number; r1?: number; op?: number }
/** Spawn an expanding ring pulse on the island at (x, z). */
export type RingFn = (x: number, z: number, o?: RingOpts) => void;

// ---------- public town API ----------

/** Island growth for one space (mirrors the Rust `growth` projection). Missing means tier 1, no houses, every listed section at level 1. */
export interface SpaceGrowth {
  members: number; active7d: number;
  /** Island size, 1..5. */
  tier: number;
  /** Island radius as the core projection reports it; the scene maps it onto its renderable range (GROWTH.coreRadiusByTier). */
  radius: number;
  /** One cottage per member; `plot_index` picks the ring slot deterministically. */
  houses: readonly { user_id: string; plot_index: number }[];
  /** Level per section: 0 not raised, 1 base, 2 wing and banners, 3 tower, lights and garden. Sections not in `SpaceInfo.sections` stay empty plots. */
  buildings: Partial<Record<SectionId, number>> | Record<SectionId, number>;
  /** Games with a free seat (arcade); drives the Games Hall sign glow when `SpaceInfo.arcade` is absent. */
  waiting_games?: number;
}
/** Games Hall hints: games with a free seat and the top of the space leaderboard (already sorted, at most 5 are shown). */
export interface ArcadeHints { waiting: number; leaders: readonly { name: string; elo: number; wins: number }[] }
/**
 * Space data pushed by the app via setSpace (and the archipelago list). Extra fields are ignored.
 *
 * House labels: the scene creates a small badge per cottage inside the overlay element with `data-house="<user_id>"` and the
 * member initials as text; the app may supply its own `[data-house="<user_id>"]` element in the overlay instead, which the scene
 * then positions (translate -50% -100%) and fades with the camera, exactly like `[data-bld]` labels.
 */
export interface SpaceInfo { id: string; /** Space default map style (admin `space.update` field `map_style`); a local device override wins. */ map_style?: string | null; sections: readonly SectionId[]; online?: number; name?: string; growth?: SpaceGrowth; arcade?: ArcadeHints; people?: Readonly<Record<string, { name: string; initials: string }>> }
/** Pickable things in the scene: section buildings and the search monument. */
export type PickId = SectionId | 'search';
/** Sky state reported to the app roughly every 90ms when the period or hour changes. */
export interface SkyInfo { hour: number; period: string; night: number }
export type ClockMode = 'manual' | 'live' | 'lapse';
export type TownMode = 'island' | 'door' | 'inside';
/** Activity hints: counts of visitors (feed), smoke (board), loom glow (skein) and which seat is speaking (-1 none). */
export interface Hints { feed: number; board: number; skein: number; speak: number }
export interface ScreenPoint { x: number; y: number; z?: number }
export type RavenSource = 'here' | 'away';

export interface TownOptions {
  /** Element the canvas is appended to; also observed for resize. */
  mount: HTMLElement;
  /** Element holding [data-bld] / [data-isle] / [data-perch] / [data-door] labels positioned each frame. */
  overlay?: HTMLElement | null;
  /** Skip intro, idle motion and springs. */
  reduced?: boolean;
  /** Return true to suspend keyboard navigation (e.g. a palette is open). */
  blocked?: () => boolean;
  /** Building or monument clicked (id null: empty click while focused); x/y are screen coords of the pick. */
  onPick?: (id: PickId | null, x?: number, y?: number) => void;
  /** Pointer hover target; pickable ids plus 'isle:<id>' and 'raven-<kind>' while those are hit-testable. */
  onHover?: (id: string | null) => void;
  onSky?: (sky: SkyInfo) => void;
  /** Lightning flash. */
  onFlash?: () => void;
  /** A neighbouring island was clicked in archipelago view. */
  onIsle?: (spaceId: string) => void;
  onRaven?: (kind: RavenSource) => void;
  /** Wheel gesture asks to enter (true) or leave (false) archipelago view. */
  onArchi?: (on: boolean) => void;
}

export interface TownApi {
  /** Show a space; with `raise` only that section's plot is rebuilt as a real building. */
  setSpace(info: SpaceInfo, o?: { raise?: SectionId }): void;
  /** Walk up to a building's door. */
  approach(id: SectionId): void;
  /** Go inside (hearth: camera in the pavilion; others: interior room). cb fires when the camera arrives. */
  enter(id: SectionId, cb?: () => void): void;
  /** Leave the interior and return to the island. */
  leave(): void;
  mode(): TownMode;
  /** Frame a plot (or release focus with null). */
  focus(id: PickId | null): void;
  setTheme(dark: boolean, instant?: boolean): void;
  hover(id: string | null): void;
  screenPos(id: string): ScreenPoint;
  recenter(): void;
  zoomBy(d: number): void;
  rotateBy(a: number): void;
  /** A side panel is open: focused buildings are framed over the shoulder and pushed off the panel side. */
  setPanel(open: boolean): void;
  /** An opaque panel hides the canvas: stop rendering (after its open animation) so a software or busy GPU is left to the page. */
  setCovered(on: boolean): void;
  setFire(on: boolean): void;
  /** n people at the hearth, `me` seated, `speak` the speaking seat index (omit to keep). */
  setRoom(n: number, me: boolean, speak?: number | null): void;
  burst(): void;
  /** Pulse the commons raven (or launch it); cb fires immediately. */
  sendRaven(toId?: string, cb?: () => void): void;
  /** A raven flies in from beyond the island to the `toId` anchor carrying a letter; cb fires on arrival (at once when no flight plays). */
  flyIn(toId: string, cb?: () => void): boolean;
  /** A raven lifts off the `fromId` building with a sent letter. False when no flight plays (reduced motion, no room). */
  flyOut(fromId: string): boolean;
  setUnread(m?: Partial<Record<SectionId, number>> | null): void;
  setWeather(kind: WeatherKind): void;
  setPerched(here?: number, away?: number): void;
  setHints(h?: Partial<Hints> | null): void;
  /** v in 0..1 maps to hour 0..24. */
  setTimeOfDay(v: number): void;
  setHour(h: number, instant?: boolean): void;
  setClockMode(m: ClockMode): void;
  getHour(): number;
  /** Toggle the archipelago view; `list` (all spaces) is required when turning it on. */
  setArchipelago(on: boolean, list?: readonly SpaceInfo[]): void;
  setPhoto(on: boolean): void;
  /** Redraw an interior room's canvases with fresh data. */
  paintInterior(id: SectionId, data: InteriorPaint): void;
  /** Render now and return a PNG data URL. */
  snapshot(): string;
  /** Progressive path traced, denoised still of the current view as a PNG data URL (rejects when the tracer is unavailable; callers fall back to snapshot). */
  snapshotStill(samples?: number): Promise<string>;
  /** Graphics tier: 'auto' detects from the GPU and downgrades when fps stays low. Saved for the next session. */
  setQuality(tier: QualityTier | 'auto'): void;
  /** Frame cap / low-power mode (an id from FRAME_LIMIT.options). Persisting the choice is the caller's job. */
  setFrameCap(id: string): void;
  /** Current tier and whether it follows auto-detect. */
  getQuality(): { tier: QualityTier; auto: boolean; /** Probe GI bake progress 0..1 (1 = settled or off). */ giProgress: number; stillSamples: number; stillEngaged: boolean };
  /** Map style for this device: an id overrides the space default, 'default' clears the override. Live switch (cross-fade rebuild), saved locally. */
  /** Draw calls and triangles of the last frame (all passes). */
  renderInfo(): { calls: number; triangles: number; site: { meshes: number; instanced: number; triangles: number } | null; meshesInScene: unknown };
  setMapStyle(style: 'village' | 'sanctuary' | 'default'): void;
  /** Style currently shown and whether it comes from the local override. */
  getMapStyle(): { style: 'village' | 'sanctuary'; local: boolean };
  dispose(): void;
}

// ---------- town actors ----------
export interface HouseActor { key: string; g: THREE.Object3D; s: Spring; delay: number; born: number; userId: string; initials: string; name: string; x: number; z: number; dying?: boolean }
export interface TreeActor { g: THREE.Object3D; s: Spring; delay: number; k: number; born: number; dead?: boolean }
export interface PersonActor { g: THREE.Group; from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; R: Rng; s: Spring; wait: number }
export interface ThreadActor { tube: THREE.Mesh; pulse: THREE.Mesh; curve: THREE.QuadraticBezierCurve3; t: number; s: Spring }
export interface Visitor { g: THREE.Group; s: Spring; on: boolean; yaw: number }
export interface MiniIsle { id: string; g: THREE.Group; s: Spring }
export interface RingFx { m: THREE.Mesh; life: number; dur: number; r0: number; r1: number; op: number }
