/** Tunable data for the 3D town scene (src/scene). Procedural vertex-level modelling stays inline in the builders. */
import type { SectionId } from '@/lib/data/types';

export interface PlotPos { readonly x: number; readonly z: number }

/** Island layout: building plots keyed by section, plus the signpost monument. */
export const SIGN: PlotPos = { x: 5.4, z: -3.4 };
export const PLOTS: Readonly<Record<SectionId, PlotPos>> = {
  chat: { x: 5.7, z: 4.4 }, hearth: { x: 0, z: 0 }, feed: { x: -5.0, z: 4.9 }, board: { x: -5.8, z: -2.6 }, skein: { x: 0.2, z: -7.6 }, desk: { x: -4.2, z: -7.6 }, arcade: { x: 5.0, z: -7.4 },
};
/** Build order (also the stagger order) of the plots. */
export const SECTION_ORDER: readonly SectionId[] = ['chat', 'hearth', 'feed', 'board', 'skein', 'desk', 'arcade'];
export const POND_POS: PlotPos = { x: 1.4, z: 9.0 };

/** Section -> exterior builder name (keys of the world kit builders). */
export const BUILDERS = { chat: 'commons', hearth: 'hearth', feed: 'gallery', board: 'workshop', skein: 'loom', desk: 'countingHouse', arcade: 'gamesHall' } as const satisfies Record<SectionId, string>;
export type BuilderName = (typeof BUILDERS)[SectionId];
/** Section -> interior room maker name. The hearth has no interior room (the camera goes inside the pavilion). */
export const INTERIOR_MAKERS = { chat: 'commons', feed: 'gallery', board: 'workshop', skein: 'loom', desk: 'countingHouse', arcade: 'gamesHall' } as const satisfies Partial<Record<SectionId, string>>;

/** Fonts painted into canvases (bundled by the app via @fontsource). */
export const FONTS = {
  serif: '"Cormorant Garamond", Georgia, serif',
  body: 'Lora, Georgia, serif',
} as const;

/** Signpost arms: label painted on the board and the yaw of the arm. Ravens perch on the same yaws. */
export const SIGN_ARMS = [
  { label: 'Commons', angle: 2.2 }, { label: 'Gallery', angle: -2.4 }, { label: 'Workshop', angle: 0.5 }, { label: 'Loom', angle: -0.4 },
] as const;
/** Perch positions on the commons roof (local z of the three "here" slots). */
export const HERE_PERCH_Z = [0.32, -1.45, 1.4] as const;

export const WEATHER_KINDS = ['clear', 'rain', 'snow', 'fog', 'storm'] as const;
export type WeatherKind = (typeof WEATHER_KINDS)[number];
/** Spring targets per weather: [rain, snow, fog, overcast, sun, wind]. */
export const WEATHER_TARGETS: Readonly<Record<WeatherKind, readonly [number, number, number, number, number, number]>> = {
  clear: [0, 0, 0, 0, 1, 0.25], rain: [1, 0, 0.25, 0.8, 0, 0.6], snow: [0, 1, 0.3, 0.6, 0.15, 0.35], fog: [0, 0, 1, 0.35, 0.2, 0.1], storm: [1.6, 0, 0.4, 1, 0, 1.3],
};
export const WEATHER_PARTICLES = { box: { x: 20, y: 26 }, rain: 1600, snow: 2200, motes: 260, maxSplashes: 60 } as const;

export type Rgb = readonly [number, number, number];
export interface SkyKeyframe {
  readonly h: number; readonly name: string; readonly top: string; readonly bot: string; readonly glow: string;
  readonly hemi: Rgb; readonly hi: number; readonly sun: Rgb; readonly si: number; readonly night: number; readonly exp: number;
}
/** Time-of-day keyframes (hour 0..24, first and last identical so the day wraps). */
export const SKY_KEYFRAMES: readonly SkyKeyframe[] = [
  { h: 0, name: 'Midnight', top: '#0d111d', bot: '#1d1b25', glow: 'rgba(140,150,210,.10)', hemi: [0.3, 0.4, 0.68], hi: 0.3, sun: [0.5, 0.64, 1], si: 0.6, night: 1, exp: 1.18 },
  { h: 4.8, name: 'Before dawn', top: '#181c2e', bot: '#3d3443', glow: 'rgba(170,140,170,.14)', hemi: [0.36, 0.42, 0.66], hi: 0.34, sun: [0.56, 0.66, 1], si: 0.55, night: 0.9, exp: 1.14 },
  { h: 6.3, name: 'Dawn', top: '#6a7aa0', bot: '#f0b48a', glow: 'rgba(255,170,120,.35)', hemi: [0.96, 0.78, 0.74], hi: 0.78, sun: [1, 0.64, 0.46], si: 1.25, night: 0.32, exp: 1.04 },
  { h: 8, name: 'Morning', top: '#b8cfe2', bot: '#f6eee2', glow: 'rgba(255,230,190,.30)', hemi: [1, 0.96, 0.92], hi: 1.15, sun: [1, 0.93, 0.82], si: 2.1, night: 0, exp: 1 },
  { h: 12.5, name: 'Noon', top: '#d6e3ec', bot: '#f5f3ef', glow: 'rgba(255,250,235,.25)', hemi: [1, 0.98, 0.95], hi: 1.3, sun: [1, 0.98, 0.94], si: 2.55, night: 0, exp: 1 },
  { h: 15.5, name: 'Afternoon', top: '#d2dce2', bot: '#f6ebda', glow: 'rgba(255,225,180,.30)', hemi: [1, 0.95, 0.88], hi: 1.2, sun: [1, 0.9, 0.76], si: 2.3, night: 0, exp: 1 },
  { h: 18, name: 'Golden hour', top: '#c6a687', bot: '#f4c58a', glow: 'rgba(255,170,90,.42)', hemi: [1, 0.82, 0.62], hi: 0.96, sun: [1, 0.68, 0.38], si: 2.05, night: 0.08, exp: 1.02 },
  { h: 19.2, name: 'Dusk', top: '#59557a', bot: '#e0957a', glow: 'rgba(230,120,100,.40)', hemi: [0.82, 0.6, 0.64], hi: 0.64, sun: [1, 0.5, 0.38], si: 0.95, night: 0.48, exp: 1.06 },
  { h: 20.6, name: 'Evening', top: '#232741', bot: '#54424f', glow: 'rgba(190,130,150,.18)', hemi: [0.42, 0.44, 0.66], hi: 0.38, sun: [0.6, 0.68, 1], si: 0.6, night: 0.85, exp: 1.14 },
  { h: 24, name: 'Midnight', top: '#0d111d', bot: '#1d1b25', glow: 'rgba(140,150,210,.10)', hemi: [0.3, 0.4, 0.68], hi: 0.3, sun: [0.5, 0.64, 1], si: 0.6, night: 1, exp: 1.18 },
];
/** Hours the dark/light theme maps to. */
export const THEME_HOURS = { dark: 21.5, light: 13 } as const;
export const CLOCK = { initialHour: 13, liveScanMs: 5000, lapseHoursPerSecond: 0.25, skyScanMs: 90, hourEpsilon: 0.05 } as const;

export const RENDER = { exposure: 1.0, shadowMap: 2048, shadowExtent: 18, shadowFit: 1.16, shadowFar: 90 } as const;

export type QualityTier = 'low' | 'medium' | 'high' | 'ultra';
export const QUALITY_ORDER: readonly QualityTier[] = ['low', 'medium', 'high', 'ultra'];
export interface QualitySpec {
  /** Render scale cap in device pixels per CSS pixel, never above the display's own devicePixelRatio (1x on a Retina screen rendered the island at half resolution). */
  readonly pixelRatio: number;
  readonly shadowMap: number; readonly shadowRadius: number;
  /** Post pipeline (EffectComposer) on/off; off renders straight to the canvas. */
  readonly post: boolean; readonly msaa: number; readonly ao: boolean; readonly aoScale: number; readonly bloom: boolean; readonly bloomScale: number; /** Temporal anti-aliasing and resolve at 1x (sub-pixel jitter + clamped history). */ readonly taa: boolean; /** Radial god rays from the sun (ultra). */ readonly godRays: boolean;
  /** Max grass blades drawn on the base island (scaled by island area). */
  readonly grass: number; readonly anisotropy: number; readonly texSize: number;
  /** Street lamps that get a real point light. */
  readonly lampLights: number; readonly dof: boolean; readonly motionBlur: boolean; readonly smallShadows: boolean; readonly env: boolean; readonly interiorShadow: boolean; readonly treeDensity: number;
  /** Probe-volume GI (DDGI style, incremental): probe spacing in world units, cube face size (keep equal across tiers: three caches one cube target per module and disposing it across renderers throws), probes baked per frame, extra bounce passes. null = off. */
  readonly gi: { readonly spacing: number; readonly cube: number; readonly perFrame: number; readonly bounces: number } | null;
}
/** Quality tiers. Auto-detected from the GPU string, device pixel ratio and core count, then downgraded when fps stays low. */
export const QUALITY: Readonly<Record<QualityTier, QualitySpec>> = {
  low: { pixelRatio: 1, shadowMap: 1024, shadowRadius: 2, post: false, msaa: 0, ao: false, aoScale: 1, bloom: false, bloomScale: 1, taa: false, godRays: false, grass: 2200, anisotropy: 2, texSize: 512, lampLights: 0, dof: false, motionBlur: false, smallShadows: false, env: true, interiorShadow: false, treeDensity: 0.7, gi: null },
  medium: { pixelRatio: 1.25, shadowMap: 2048, shadowRadius: 3, post: true, msaa: 2, ao: false, aoScale: 1, bloom: true, bloomScale: 1, taa: false, godRays: false, grass: 4500, anisotropy: 4, texSize: 1024, lampLights: 2, dof: false, motionBlur: false, smallShadows: true, env: true, interiorShadow: false, treeDensity: 0.85, gi: null },
  high: { pixelRatio: 1.5, shadowMap: 2048, shadowRadius: 3.5, post: true, msaa: 2, ao: false, aoScale: 1, bloom: true, bloomScale: 1, taa: true, godRays: false, grass: 7000, anisotropy: 8, texSize: 1024, lampLights: 5, dof: true, motionBlur: false, smallShadows: true, env: true, interiorShadow: true, treeDensity: 1, gi: { spacing: 3, cube: 16, perFrame: 2, bounces: 0 } },
  ultra: { pixelRatio: 2, shadowMap: 4096, shadowRadius: 4, post: true, msaa: 4, ao: true, aoScale: 1, bloom: true, bloomScale: 1, taa: true, godRays: true, grass: 9500, anisotropy: 16, texSize: 2048, lampLights: 5, dof: true, motionBlur: true, smallShadows: true, env: true, interiorShadow: true, treeDensity: 1, gi: { spacing: 2, cube: 16, perFrame: 6, bounces: 1 } },
};
/** Probe GI volume: world-space padding around the island, vertical extent, hours of sky change that trigger a rebake, indirect strength. */
export const GI = { minRoomMs: 2, probeSmallR: 1, fitStableFrames: 24, pad: 3, floor: -0.5, height: 10, rebakeHours: 0.6, rebakeEmissiveDelta: 0.35, interactBudgetMs: 1, frameBudgetMs: 8, busySpeed: 0.1, busyTurn: 0.1, maxFrameMs: 20, hemiScale: 0.62, envScale: 0.7, near: 0.2, far: 60 } as const;
/** Progressive path traced stills (photo mode, postcard, ultra idle refine): sample budgets, idle delay, bounces, denoise strength. */
export const STILL = { giWaitMs: 40000, idleMs: 2000, settleMs: 400, tilesIdle: 4, tilesPhoto: 2, idleTier: 'ultra' as QualityTier, photoSamples: 192, idleSamples: 512, maxTriangles: 2_500_000, exportSamples: 384, bounces: 4, samplesPerFrame: 1, denoise: { radius: 2, sigmaColor: 0.35, fadeSamples: 160 }, fireflyClamp: 8 } as const;
/** GPU classification and the fps-adaptive downgrade. */
export const QUALITY_DETECT = {
  storageKey: 'hermod.quality', queryParam: 'quality',
  /** CPU rasterisers: every shader link and frame costs seconds, so boot skips the idle warm-ups (room prebuild, higher-tier shader precompile) that only help real GPUs. */
  softwareGpu: /swiftshader|llvmpipe|software/i,
  /** Render scale on a CPU rasteriser (also drops canvas MSAA and shadow maps, which add depth programs and a pass to every shader link and frame): fill rate is the frame cost there, and the island stays readable at this scale. */
  softwareScale: 0.6,
  lowGpu: /swiftshader|llvmpipe|software|mali|powervr|videocore|adreno \(tm\) [1-5]\d\d|intel.*(hd|uhd|iris)(?!.*xe)/i,
  midGpu: /adreno|intel|iris xe|apple a\d|apple gpu(?! m)/i,
  ultraGpu: /rtx|radeon rx [6-9]|geforce gtx 1[06]|nvidia.*(quadro|titan)/i,
  highGpu: /apple m\d|radeon|geforce|amd|nvidia/i,
  smallScreenPx: 760, lowCores: 4,
  /** Downgrade when the 1s average fps stays under `fps` for `windows` consecutive windows. */
  adaptive: { fps: 44, windows: 4, windowMs: 1000, warmupMs: 7000 },
} as const;
/** Post processing parameters (HDR bloom thresholds blend from day to night values). */
export const POST = {
  bloom: { strengthDay: 0.05, strengthNight: 0.4, radius: 0.55, thresholdDay: 1.9, thresholdNight: 1.15 },
  ao: { radius: 0.5, distanceExponent: 1.4, thickness: 1.2, scale: 1.25, samples: 12, blend: 0.9 },
  vignette: { strength: 0.12, softness: 0.6 }, grade: { saturation: 1.06, contrast: 1.04, nightTint: [0.94, 0.99, 1.07] as const, dither: 1 / 255 },
} as const;
/** Procedural sky painted behind the island in the post composite (screen space, same gradient as the page CSS). */
export const SKY_DOME = {
  topAt: 0, botAt: 0.72, glowRadius: [0.55, 0.45] as const, sunDisc: 0.026, sunGlow: 0.2, moonDisc: 0.03, stars: { cell: 46, chance: 0.2, size: 0.085, boost: 2.4 },
  arc: { x0: 0.12, x1: 0.88, yHorizon: 0.5, yPeak: 0.1 },
} as const;
/** Environment lighting (PMREM of a generated sky) intensity by night amount. */
export const ENV = { day: 0.38, night: 0.3, regenHours: 0.35, size: 256, hemiScale: 0.42, sunScale: 1.15 } as const;
/** Foliage and grass wind shader. */
export const WIND = { grass: { amp: 0.055, freq: 1.7, speed: 1.35 }, leaf: { amp: 0.03, freq: 2.2, speed: 1.6 }, flag: { amp: 0.16, freq: 3.2, speed: 2.4 }, gust: 1.8 } as const;
/** Night look: lamp and window glow, lamp lights and fill. */
export const NIGHT = {
  lampLight: { color: 0xffc27a, intensity: 5.5, distance: 7.5, decay: 1.5, y: 1.18, from: 0.12 },
  winIntensity: 1, lampIntensity: 4.2, winFrom: 0.12,
  foliageLift: 0.045, groundLift: 0.03, fogDay: 0.0016, fogNight: 0.0042, rippleFade: 0.7,
  moon: { color: 0xbfd2ff, coreHdr: 2.2 }, interiorWindow: { day: 1.1, night: 0.45, dayColor: 0xf3ead8, nightColor: 0x6f86c8 },
  cloudNight: 0x2a3350, bulb: { color: 0xffd9a0, intensity: 3.4, size: 0.035 },
} as const;
/** Water (pond): scrolling procedural normal map. */
export const WATER = { color: 0x35565c, deep: 0x1c2f36, normalScale: 0.55, flow: [0.012, 0.007] as const, repeat: 3, roughness: 0.04, envIntensity: 1.1, opacity: 0.9 } as const;
/** Cheap contact shadow decal under each building (half extents) plus the baked darkening strength. */
export const CONTACT = { chat: [2.9, 2.3], hearth: [3.3, 3.3], feed: [3.1, 2.5], board: [3.4, 2.3], skein: [2.2, 2.2], desk: [2.0, 1.7], arcade: [2.1, 1.8], opacity: 0.38, y: 0.038, cottage: [1.35, 1.1] } as const;
export const LIGHTS = {
  hemi: { sky: 0xfff6ea, ground: 0xcfc4b6, intensity: 1.25 },
  sun: { color: 0xfff0d8, intensity: 2.4, pos: [14, 24, 6] as const, bias: -0.0004, normalBias: 0.03, radius: 4 },
  plaza: { color: 0xffc27a, distance: 9, decay: 1.6, y: 3.2 },
  hearthFire: { color: 0xffa850, intensity: 2.6, distance: 7, decay: 1.6, base: 2.8 },
  loom: { color: 0xffc27a, distance: 7, decay: 1.6, y: 6.2 },
  bolt: { color: 0xdfe6ff, distance: 80, y: 20 },
} as const;

/** Colours and sizes of the shared sky bodies and fx. */
export const COLORS = {
  gold: 0xd9a95f, stars: 0xfff1d6, moon: 0xf6ecd8, halo: 0xe1ad66, rain: 0x8f8a84, motes: 0xffd79a, storm: 0x8b8580, ripple: 0xc28d41,
  pulse: 0xffd79a, mini: 0x9aa57c, fog: 0xf3f2f2, smoke: 0xf2ede6, shopSmoke: 0xe9e3da, ring: 0xd9a95f,
} as const;

/** Camera rig tuning: spring constants, framing presets per interaction mode and limits. */
export const CAMERA = {
  fov: 28, near: 0.5, far: 300, fovIdle: 46,
  home: { az: Math.PI / 4, el: 0.66, dist: 46 },
  start: { az: Math.PI / 4 + 0.5, el: 0.95, dist: 48 },
  intro: { azOffset: 2.5, el: 1.32, dist: 140, tune: [6, 1] as const, settleMs: 3400, settleDist: [36, 0.95] as const, settle: [40, 0.95] as const },
  zoom: { min: 26, max: 62, wheel: 0.02, archiAt: 61.5, archiAccum: 260, dblDist: 10 },
  tilt: { min: 0.32, max: 1.15 },
  panLimit: 9, orbitSpeed: 0.0038, tiltSpeed: 0.0022, idleAfter: 22, idleSpin: 0.05, photoSpin: 0.09, keyStep: 70, keyOrbit: 0.35,
  doorHearth: { azOffset: 0.42, el: 0.32, dist: 8.5, fov: 34, ty: 1.0, labelY: 1.4 },
  doorOther: { azOffset: 0.85, el: 0.2, dist: 4.4, fov: 40, ty: 1.05, labelY: 1.1 },
  focus: { ty: 1.2, dist: 24, el: 0.52, azOffset: 0.55, off: 0.3, fov: 23 },
  hearthInside: { el: 0.26, ty: 0.95, dist: 3.6, off: 0.24, fov: 46 },
  roomPush: { dist: 0.9, el: 0.05, fov: 44, ty: 0.95, cutMs: 520 },
  roomCut: { distExtra: 1.6, fovFrom: 52, fovTo: 46, off: 0.2 },
  leave: { ty: 0.95, el: 0.1, dist: 1.4, fov: 40 },
  rollFarFactor: 0.045,
  ferry: { dist: 34, el: 0.32 }, archi: { dist: 108, el: 0.28, fov: 6, far: 200 }, photo: { dist: 8, el: 0.26, fov: 6 },
  maxElevation: 1.42,
} as const;

export const TIMING = {
  plotDelayFirst: 650, plotDelayNext: 120, plotStagger: 110,
  treeDelayFirst: 900, treeDelayNext: 300, treePerRadius: 55, treeJitter: 120,
  switchBuildMs: 560, switchFerryMs: 700, raiseMs: 380, enterHearthMs: 300, plotKillStagger: 50, archiStagger: 90,
  perchCooldown: 0.7, perchCooldownTakeoff: 0.45, perchCooldownSwitch: 2.2,
  obstacleScanMs: 400, labelScanMs: 400, compassScanMs: 500, watchdogMs: 33, watchdogStallMs: 200,
} as const;

export const ISLAND = { treeCount: 36, treeTries: 900, treeRadius: 12, plazaRadius: 2.7, peopleMin: 4, peopleMax: 12, maxVisitors: 4, archiRadius: 36, archiMiniScale: 0.4, archiMiniK: 0.36 } as const;

/** Spring constants [stiffness, damping ratio] for scene actors. */
export const SPRINGS = {
  plotOpen: [90, 0.62], plotScale: [170, 0.5], plotHover: [220, 0.7], plotPop: [260, 0.35], plotDoor: [55, 1],
  tree: [140, 0.45], person: [120, 0.6], visitor: [120, 0.6], seat: [160, 0.5], thread: [60, 0.9], mini: [90, 0.55], raven: [140, 0.6],
  rain: [8, 1], snow: [6, 1], fog: [8, 1], over: [8, 1], sun: [8, 1], wind: [6, 1],
  hour: [4, 1], islandY: [55, 0.7], ferry: [26, 0.85], archi: [18, 0.92], photo: [22, 1], fov: [22, 1], cloudOp: [40, 1], look: [9, 1], roll: [70, 1], off: [50, 0.92],
  azel: [40, 0.95], dist: [36, 0.95],
} as const;

export const RAVEN = { scale: 3.4, fallbackScale: 2.1, burst: 3, maxHere: 1 } as const;

/** Procedural palettes used by the world kit. */
export const PALETTE = {
  leaf: [0x6f7d50, 0x7f8b5a, 0x8e9663, 0x66744a, 0x9c9a62],
  cloth: [0x3a3532, 0x6b5a48, 0x8a7a64, 0xb68235, 0x5c6470, 0xd9cfbf, 0x7a4f3a],
  terrain: { g1: 0x9aa57c, g2: 0xb7b98c, g3: 0x7f8b62, dirt: 0xcdbf9f },
  hair: [0x2b2420, 0x5a3e2b, 0x9a7a52, 0xd8c8a8],
  pants: [0x3a3532, 0x4a4540, 0x5e5448],
  meTunic: 0xc28d41,
} as const;

export type TextureBase = 'shingle' | 'ashlar' | 'brick' | 'plank' | 'cob' | 'plaster' | 'rock' | 'bark' | 'turf';
/** Colour map `x`, height map `xB` and the normal map `xN` derived from it. */
export type TextureKey = TextureBase | `${TextureBase}B` | `${TextureBase}N` | 'waterN';
export interface MatSpec {
  readonly color?: number; readonly roughness?: number; readonly metalness?: number;
  readonly emissive?: number; readonly emissiveIntensity?: number; readonly transparent?: boolean; readonly opacity?: number;
}
export interface WorldMatSpec extends MatSpec { readonly map?: TextureKey; readonly bump?: TextureKey; readonly bumpScale?: number; readonly normal?: TextureKey; readonly normalScale?: number; readonly vertexColors?: boolean }

/** Base material table owned by the town (flat paper look); roughness defaults to 0.85. */
export const MATERIAL_BASE = {
  paper: { color: 0xf5f0e8, roughness: 0.82 }, stone: { color: 0xe4ddd1, roughness: 0.9 }, plinth: { color: 0xd6cdbf, roughness: 0.95 },
  plinthDark: { color: 0xb9b0a3, roughness: 0.95 }, ground: { color: 0xece6db, roughness: 0.95 }, ink: { color: 0x3a3532, roughness: 0.55 },
  gold: { color: 0xc28d41, roughness: 0.32, metalness: 0.7 }, path: { color: 0xe2d9ca, roughness: 1 },
  water: { color: 0x6f8a8e, roughness: 0.06, metalness: 0.2, transparent: true, opacity: 0.92 },
  leaf: { color: 0xeeeae2, roughness: 0.88 }, trunk: { color: 0x9b8f80, roughness: 0.9 },
  win: { color: 0x3a3532, roughness: 0.4, emissive: 0xe1ad66, emissiveIntensity: 0 },
  lamp: { color: 0xf6e4c4, roughness: 0.4, emissive: 0xe1ad66, emissiveIntensity: 0.25 },
  thread: { color: 0xc28d41, roughness: 0.35, metalness: 0.6, emissive: 0xc28d41, emissiveIntensity: 0.25 },
  cloud: { color: 0xe6e9ef, roughness: 1, transparent: true, opacity: 0.92 },
} as const satisfies Record<string, MatSpec>;

/** Textured architecture materials built by the world kit. */
export const MATERIAL_WORLD = {
  stoneW: { color: 0xe8dfcf, map: 'ashlar', normal: 'ashlarN', normalScale: 1.1, roughness: 0.88 },
  plasterW: { color: 0xf3ece1, map: 'plaster', normal: 'plasterN', normalScale: 0.45, roughness: 0.95 },
  brickW: { color: 0xe6d6c6, map: 'brick', normal: 'brickN', normalScale: 1.1, roughness: 0.9 },
  timber: { color: 0x7d5f43, map: 'plank', normal: 'plankN', normalScale: 0.8, roughness: 0.74 },
  beam: { color: 0x5a4433, map: 'plank', roughness: 0.8 },
  slate: { color: 0x6a6460, map: 'shingle', normal: 'shingleN', normalScale: 1.3, roughness: 0.7 },
  trim: { color: 0xf4efe6, roughness: 0.6 },
  rock: { color: 0xc9bfaf, map: 'rock', normal: 'rockN', normalScale: 1.6, roughness: 0.94, vertexColors: false },
  barkM: { color: 0x8a7560, map: 'bark', normal: 'barkN', normalScale: 1.2, roughness: 0.93 },
  foliage: { vertexColors: true, roughness: 0.82 },
  terrain: { vertexColors: true, roughness: 0.94, map: 'turf', normal: 'turfN', normalScale: 0.9 },
  bronze: { color: 0x8a6a3a, roughness: 0.38, metalness: 0.75 },
  cloth: { vertexColors: true, roughness: 0.85 },
  skin: { color: 0xe8cdb5, roughness: 0.6 },
  doorGlow: { color: 0x2a1c12, emissive: 0xffb860, emissiveIntensity: 0, roughness: 1 },
  daylight: { color: 0xf6efe2, emissive: 0xf3ead8, emissiveIntensity: 1.1, roughness: 1 },
} as const satisfies Record<string, WorldMatSpec>;
export type WorldMatName = keyof typeof MATERIAL_WORLD;
/** Additive flame materials (MeshBasicMaterial). */
export const MATERIAL_FLAME = { flameA: { color: 0xffb35a, opacity: 0.85 }, flameB: { color: 0xffe3a6, opacity: 0.9 } } as const;
/** Path and stone get textures added on top of the base table. */
export const PATH_TINT = 0xf2ece2;

/**
 * Interior room residency. Each built room holds geometry, a 2048 px lightmap and furniture atlas (about 45 MB of GPU memory at the high tiers), so only
 * `maxRooms` stay built (the room you are in never counts as evictable, the idle warm-up builds no more than this); the others are disposed and rebuilt on door hover or approach.
 * `warmModels` is how many unreferenced furniture models the high-tier asset library keeps before disposing their GPU copies.
 */
export const ROOM_RESIDENCY = { maxRooms: 2, warmModels: 8 } as const;

/** Interior rooms: shared material colors, light rigs, camera framing, and note-board paper colors. */
export const INTERIOR = {
  mats: {
    floorWood: 0x9a7a58, floorStone: 0xe9e2d6, floorConc: 0xd2ccc2, wallPlaster: 0xf2ebe0, wallBrick: 0xe4d4c4, wallStone: 0xe8dfcf,
    cork: 0xc8a67c, velvet: 0x6b3e3a, brass: 0xb08a4a, rug: 0x8a5a44, saw: 0xb8b8b8, books: [0x6b3e3a, 0x3a4a5a, 0x7a6a3a],
  },
  lights: {
    pendant: { color: 0xffc98a, intensity: 5, distance: 9, decay: 1.6 },
    fire: { color: 0xff9a48, intensity: 4, distance: 7, decay: 1.8, base: 3.6, swing: 0.5, jitter: 0.3, speed: 9 },
    commonsHemi: { sky: 0xfff1dc, ground: 0x5a4636, intensity: 0.55 },
    galleryHemi: { sky: 0xffffff, ground: 0x8a8070, intensity: 0.9 },
    galleryFill: { color: 0xfff6e8, intensity: 3, distance: 14, decay: 1.2 },
    gallerySpot: { color: 0xfff0d8, intensity: 17, distance: 7, angle: 0.5, penumbra: 0.6, decay: 1.4 },
    workshopHemi: { sky: 0xfff4e4, ground: 0x4a3a30, intensity: 0.7 },
    loomTop: { color: 0xffc98a, intensity: 8, distance: 12, decay: 1.4 },
    loomLow: { color: 0xe1ad66, intensity: 3, distance: 6, decay: 1.5 },
    loomHemi: { sky: 0xfff1dc, ground: 0x4a3a30, intensity: 0.6 },
  },
  cams: {
    commons: { cam: [0.9, 1.7, 3.9], look: [-1.0, 1.45, -1.2] },
    gallery: { cam: [1.4, 1.7, 3.8], look: [-0.6, 2.0, -2.2] },
    workshop: { cam: [0.8, 1.75, 3.9], look: [-0.6, 1.8, -2.4] },
    loom: { cam: [0.6, 1.8, 3.6], look: [0, 2.2, 0] },
    countingHouse: { cam: [0.6, 1.7, 3.8], look: [0, 1.9, -2.4] },
    gamesHall: { cam: [0.8, 1.8, 4.0], look: [0, 2.0, -2.4] },
  },
  notes: {
    board: '#b8956a', workshopBoard: '#a98a62', loomBoard: '#8a6a44', paper: '#f6efe0', pin: '#b68235',
    heading: '#3a2a1c', who: '#7d5411', text: '#201f1d', shadow: 'rgba(0,0,0,.35)', artLabel: 'rgba(255,255,255,.75)',
    artFont: '22px ui-monospace, Menlo, monospace',
  },
  flicker: { speed: 12, swing: 0.15, jitter: 0.05, base: 0.85 },
  spoolSpeed: 0.25,
} as const;

/** Island growth: tier -> size, shape and the rings member cottages are placed on. All thresholds live here. */
export const GROWTH = {
  /** Base island radius (tier 1) and the radius for each tier 1..5 when the data carries no radius. */
  baseRadius: 12.6, radiusByTier: [12.6, 14.6, 16.8, 19.0, 21.4] as readonly number[], minRadius: 12.6, maxRadius: 26,
  /** Coastline wobble (fraction of radius), cliff and underside depth per tier. */
  shapeAmp: [0, 0.035, 0.055, 0.075, 0.095] as readonly number[], cliffDepth: [2.6, 2.9, 3.2, 3.5, 3.8] as readonly number[], underDepth: [7, 8, 9, 10, 11] as readonly number[],
  /** Trees: base count comes from ISLAND.treeCount, this many more per extra unit of area ratio. */
  extraTreesPerArea: 24, forestInner: 3.6, forestMargin: 0.8, maxTrees: 90,
  /** Cottage rings: radius and slot capacity; plot_index walks the rings in order. */
  rings: [{ r: 10.9, cap: 8 }, { r: 12.9, cap: 12 }, { r: 15.1, cap: 16 }, { r: 17.3, cap: 20 }, { r: 19.7, cap: 24 }] as readonly { r: number; cap: number }[],
  edgeMargin: 1.6, nudgeStep: 0.09, nudgeTries: 36,
  clearance: { plot: 3.3, sign: 2.6, plaza: 3.2, pond: 3.7, house: 2.0 },
  /** Cobbled lane that runs along the inside of each occupied ring. */
  lane: { width: 0.85, inset: 1.45, stepDeg: 1.5, blockPlot: 2.1, blockPond: 2.9, blockSign: 1.7, flatEvery: 1.0, flatR: 0.8 },
  /** Piers on the coast: count per tier, size. */
  docks: { count: [0, 0, 1, 1, 2] as readonly number[], length: 3.4, width: 1.0, planks: 12, postEvery: 3, angles: [2.3, 5.3] as readonly number[] },
  anim: { terrainSpring: [48, 0.8] as const, houseDelay: 60, houseStagger: 45, houseSpring: [150, 0.5] as const, camExponent: 0.88, cloudExponent: 0.9 },
  /** Cottage look. */
  cottage: { w: 1.5, d: 1.25, wallH: 0.82, pitch: 0.7, scaleJitter: 0.12, labelY: 2.15, roofs: [0x8b4f3f, 0x5f666e, 0x9a7a45, 0x6e5b4f] as readonly number[] },
  label: { fadeDist: 52 },
  /** Instance culling margin (shadow reach) and cottage level of detail: cottages farther than `k` x camera distance use the low-poly template. */
  lod: { cullMargin: 8, k: 1.12 },
} as const;
export type BuildingLevel = 0 | 1 | 2 | 3;
export const MAX_LEVEL = 3;
export interface WingSpec { x: number; z: number; w: number; d: number; h: number; pitch: number; wall: 'plasterW' | 'brickW' | 'stoneW' }
export interface DressSpec {
  kind: 'box' | 'ring';
  wing: WingSpec; banners: readonly { x: number; y: number; z: number; ry: number }[];
  tower: { x: number; z: number; r: number; h: number }; lights: readonly { a: readonly [number, number, number]; b: readonly [number, number, number]; sag: number; n: number }[];
  garden: { x: number; z: number; w: number; d: number }; anchorBoost: number;
}
/** What each building gains per level (1 base, 2 wing and banners, 3 tower, string lights and garden). Local coordinates, +z faces the plaza. */
export const BUILDING_GROWTH: Readonly<Record<SectionId, DressSpec>> = {
  chat: { kind: 'box', wing: { x: -3.35, z: -0.1, w: 2.3, d: 2.2, h: 1.15, pitch: 0.62, wall: 'plasterW' },
    banners: [{ x: -1.4, y: 3.2, z: 1.62, ry: 0 }, { x: 1.4, y: 3.2, z: 1.62, ry: 0 }, { x: -4.05, y: 2.15, z: 1.04, ry: 0 }],
    tower: { x: 2.4, z: -1.0, r: 0.55, h: 3.3 }, lights: [{ a: [-2.0, 2.0, 1.55], b: [2.0, 2.0, 1.55], sag: 0.22, n: 12 }, { a: [-4.4, 1.65, 1.05], b: [-2.2, 1.65, 1.05], sag: 0.16, n: 7 }],
    garden: { x: 3.35, z: 0.9, w: 2.0, d: 2.6 }, anchorBoost: 0.5 },
  hearth: { kind: 'ring', wing: { x: 0, z: 0, w: 0, d: 0, h: 0, pitch: 0, wall: 'stoneW' },
    banners: [0, 1, 2, 3, 4, 5].map((i) => ({ x: Math.cos((i / 6) * Math.PI * 2 + 0.3) * 2.75, y: 2.4, z: Math.sin((i / 6) * Math.PI * 2 + 0.3) * 2.75, ry: -((i / 6) * Math.PI * 2 + 0.3) + Math.PI / 2 })),
    tower: { x: 0, z: 0, r: 0, h: 0 }, lights: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => { const a0 = (i / 8) * Math.PI * 2, a1 = ((i + 1) / 8) * Math.PI * 2; return { a: [Math.cos(a0) * 2.6, 2.1, Math.sin(a0) * 2.6] as const, b: [Math.cos(a1) * 2.6, 2.1, Math.sin(a1) * 2.6] as const, sag: 0.2, n: 8 }; }),
    garden: { x: 0, z: 0, w: 3.3, d: 3.3 }, anchorBoost: 0.2 },
  feed: { kind: 'box', wing: { x: 3.65, z: -0.3, w: 2.4, d: 2.6, h: 1.6, pitch: 0.4, wall: 'stoneW' },
    banners: [{ x: -1.2, y: 2.0, z: 1.55, ry: 0 }, { x: 1.2, y: 2.0, z: 1.55, ry: 0 }, { x: 3.6, y: 2.05, z: 1.05, ry: 0 }],
    tower: { x: -2.9, z: -0.9, r: 0.5, h: 3.5 }, lights: [{ a: [-1.9, 2.3, 1.5], b: [1.9, 2.3, 1.5], sag: 0.2, n: 12 }],
    garden: { x: -3.4, z: 1.0, w: 1.8, d: 2.4 }, anchorBoost: 0.5 },
  board: { kind: 'box', wing: { x: -3.75, z: 0, w: 2.4, d: 2.4, h: 1.3, pitch: 0.55, wall: 'brickW' },
    banners: [{ x: -0.9, y: 1.95, z: 1.35, ry: 0 }, { x: 1.4, y: 1.95, z: 1.35, ry: 0 }, { x: -3.75, y: 1.9, z: 1.25, ry: 0 }],
    tower: { x: 3.05, z: -0.9, r: 0.5, h: 3.0 }, lights: [{ a: [-1.5, 1.9, 1.4], b: [1.8, 1.9, 1.4], sag: 0.18, n: 12 }],
    garden: { x: 3.35, z: 1.3, w: 1.9, d: 1.6 }, anchorBoost: 0.5 },
  skein: { kind: 'box', wing: { x: 1.95, z: 0.1, w: 1.8, d: 1.7, h: 1.4, pitch: 0.7, wall: 'stoneW' },
    banners: [{ x: -0.55, y: 2.9, z: 1.08, ry: 0 }, { x: 0.55, y: 2.9, z: 1.08, ry: 0 }, { x: 1.95, y: 1.95, z: 0.98, ry: 0 }],
    tower: { x: -1.75, z: -0.5, r: 0.5, h: 3.0 }, lights: [{ a: [-1.0, 2.5, 1.0], b: [1.0, 2.5, 1.0], sag: 0.2, n: 9 }],
    garden: { x: -1.4, z: 1.9, w: 1.6, d: 1.4 }, anchorBoost: 0.4 },
  desk: { kind: 'box', wing: { x: -2.75, z: 0, w: 2.0, d: 2.2, h: 1.3, pitch: 0.6, wall: 'brickW' },
    banners: [{ x: -0.85, y: 1.95, z: 1.45, ry: 0 }, { x: 0.85, y: 1.95, z: 1.45, ry: 0 }, { x: -2.75, y: 1.8, z: 1.15, ry: 0 }],
    tower: { x: 2.2, z: -0.9, r: 0.45, h: 3.1 }, lights: [{ a: [-1.4, 1.95, 1.5], b: [1.4, 1.95, 1.5], sag: 0.18, n: 10 }],
    garden: { x: 2.85, z: 1.2, w: 1.7, d: 1.6 }, anchorBoost: 0.4 },
  arcade: { kind: 'box', wing: { x: -2.85, z: 0, w: 2.0, d: 2.2, h: 1.3, pitch: 0.6, wall: 'plasterW' },
    banners: [{ x: -1.4, y: 1.85, z: 1.5, ry: 0 }, { x: 1.4, y: 1.85, z: 1.5, ry: 0 }, { x: -2.85, y: 1.8, z: 1.15, ry: 0 }],
    tower: { x: 2.3, z: -0.9, r: 0.45, h: 3.1 }, lights: [{ a: [1.95, 1.9, -1.2], b: [1.95, 1.9, 1.5], sag: 0.18, n: 8 }],
    garden: { x: 3.0, z: 1.5, w: 1.6, d: 1.6 }, anchorBoost: 0.4 },
};
/** Games Hall exterior: sign panel colour, glow colour and emissive intensities (idle, lit when a game waits, pulse swing and rate), bunting. */
export const GAMES_HALL = { signColor: 0x4a3418, glowColor: 0xffb347, idleGlow: 0.08, litGlow: 1.3, pulse: 0.35, pulseHz: 2.2, pennants: 14, pennantColors: [0xb8862f, 0x8c3f36, 0x3f5f7a, 0x5b7447] as readonly number[] } as const;
/** Banner cloth colours, one per index. */
export const BANNER_COLORS = [0xb8862f, 0x8c3f36, 0x3f5f7a, 0x5b7447] as const;

/** Camera director: spline shots between poses, handheld noise inside rooms, idle drift, depth of field, lens. */
export const DIRECTOR = {
  /** Shot presets: duration (s), arc lift and sideways swing (fractions of the travel), target look-ahead (0..1 of the shot), dolly zoom blend. */
  shots: {
    approach: { dur: 1.7, arc: 0.95, swing: 0.45, lead: 0.1, dolly: 0.0 },
    focus: { dur: 1.35, arc: 0.55, swing: 0.3, lead: 0.08, dolly: 0.0 },
    release: { dur: 1.4, arc: 0.5, swing: 0.25, lead: 0.06, dolly: 0.0 },
    push: { dur: 0.6, arc: 0.0, swing: 0.0, lead: 0.0, dolly: 0.55 },
    leave: { dur: 1.0, arc: 0.3, swing: 0.2, lead: 0.05, dolly: 0.0 },
    hearth: { dur: 1.2, arc: 0.3, swing: 0.2, lead: 0.05, dolly: 0.35 },
  },
  /** Camera never goes below terrain + this, and is pushed out of building footprints (radius per section) while the shot is not in its last part. */
  groundClearance: 0.9, obstacleMargin: 0.5, obstacleRadius: { chat: 2.7, hearth: 2.9, feed: 2.9, board: 3.0, skein: 1.9, desk: 2.4, arcade: 2.4 } as Readonly<Record<string, number>>, obstacleMaxY: 4.2, obstacleReleaseAt: 0.82,
  /** Handheld noise inside a room: position (world units) and roll (rad) amplitude, base frequency (Hz). */
  handheld: { pos: 0.011, roll: 0.0018, freq: 0.55 },
  /** Idle drift outside after CAMERA.idleAfter: slow breathing of distance and elevation. */
  drift: { dist: 0.014, el: 0.012, speed: 0.11 },
  /** Orbit and pan inertia after release (per second decay), soft edge: overshoot allowed before the hard stop, spring-back rate. */
  inertia: { orbitDecay: 5, panDecay: 5, minSpeed: 0.0004, maxOrbit: 1.4, maxPan: 1100, minDtMs: 16 }, softEdge: { overshoot: 1.18, relax: 7 },
  /** Depth of field (high and ultra): aperture scales the circle of confusion, maxBlur in uv, taps per pixel, focus pull spring. */
  dof: { aperture: 0.55, maxBlur: 0.012, taps: 14, strengthDoor: 1, /* off: the panel glass already softens the room, and the 14-tap disc smeared streaks across lamp and window edges */ strengthInside: 0, strengthFocus: 0.7, /* inside a room the near field keeps this share of its blur, so foreground figures and furniture stay crisp */ nearInside: 0.12, spring: [30, 1] as const, minTier: 'high' as QualityTier },
  /** Lens: chromatic aberration at the edges (uv), film grain amount, edge softness is the vignette in POST. */
  lens: { aberration: 0.0011, grain: 0.018 },
  /** Over-the-shoulder framing used for a focused building while a side panel is open: wider azimuth, lower and closer, subject pushed off the panel side. */
  ots: { azOffset: 1.0, el: 0.4, distK: 0.8, off: 0.34, fov: 24 },
  /** Archipelago crane: sideways swing (rad) and extra lift (rad) at mid transition. */
  crane: { swing: 0.55, lift: 0.1 },
  /** Motion blur (ultra): taps, strength, camera speed (world units + rad per frame) where it starts and where it is full. */
  motionBlur: { taps: 8, strength: 0.9, from: 0.12, full: 0.9 },
  /** After this many idle seconds outside, render every other frame (ambient motion only). */
  idleThrottleAfter: 90,
} as const;

/** Lighting fidelity per tier: PCSS contact-hardening sun shadows, LTC rect area lights for windows (count = pool size, nearest to the camera win), froxel volumetric fog. Render scale stays 1x everywhere. */
export interface LightTier { readonly pcss: boolean; readonly rectLights: number; readonly froxel: boolean; /** Gain on the night window pane emissive colour: below ultra there is no AO or fog extinction to take the edge off, so a full-strength pane clips to flat white after exposure and ACES. */ readonly paneGain: number }
export const LIGHT_TIERS: Readonly<Record<QualityTier, LightTier>> = {
  low: { pcss: false, rectLights: 0, froxel: false, paneGain: 0.8 },
  medium: { pcss: false, rectLights: 0, froxel: false, paneGain: 0.8 },
  high: { pcss: true, rectLights: 2, froxel: false, paneGain: 0.8 },
  ultra: { pcss: true, rectLights: 4, froxel: true, paneGain: 1 },
};
/** Light fidelity data. IES profiles are candela relative to the peak, as [polar angle from the lamp axis in degrees, value] (the photometric web of a real luminaire, authored as data), baked into a cookie texture on the lamp SpotLight. */
export const LIGHT_FX = {
  ies: {
    /** Cutoff street lantern: strongest straight down, falls off to the horizon, almost nothing above it (hood and cap). */
    lantern: { angle: 1.5, penumbra: 0.3, size: 128, web: [[0, 1], [15, 0.98], [30, 0.92], [45, 0.8], [60, 0.62], [72, 0.4], [82, 0.16], [90, 0.04]] as readonly (readonly [number, number])[] },
  },
  /** PCSS: penumbra uv per unit of normalised blocker depth = shadowRadius * k, blocker search uv = shadowRadius * search, taps (near, then beyond `lodFrom` view depth in world units), penumbra clamp in uv. */
  pcss: { k: 0.0268, search: 0.004, blockerTaps: 8, filterTaps: 16, farBlockerTaps: 4, farFilterTaps: 8, lodFrom: 28, minUv: 0.0006, maxUv: 0.012 },
  /** Window rect lights: pane island merge distance (world units), panes smaller than this area are ignored, gain on the radiance the pane throws (the pane itself is shown through exposure and bloom, the light it casts is physical), fade seconds when a slot is re-assigned, selection period in frames, distance beyond which a pane is shaded as a point source (skips the LTC integrals), distance beyond which a pane is not evaluated at all. */
  rect: { color: 0xffc27a, mergeDist: 0.5, minArea: 0.004, gain: 12, fade: 0.35, every: 6, lift: 0.03, farRange: 4, cullRange: 24 },
  /** Froxel fog grid (ultra): cells (the depth slices tile an 8 column atlas), depth range in world units, extinction (1/unit) base / night mist / fog weather / rain, HG anisotropy, temporal history weight, ambient scale, height scale of the layer, lamps injected, lamp and sun gains. */
  froxel: { grid: [160, 90, 64] as const, near: 0.5, far: 110, base: 0.0035, night: 0.006, fog: 0.05, rain: 0.012, anisotropy: 0.45, history: 0.9, ambient: 0.5, scaleH: 5, maxLights: 12, lampGain: 30, sunGain: 1 },
} as const;

/** A cloud within `halfAngle` (rad) of the camera azimuth sits between it and the island: it shrinks away at `rate` (1/s), never below `minScale`. */
export const CLOUDS = { cameraSide: { halfAngle: 1.15, rate: 2.5, minScale: 0.001 } } as const;
