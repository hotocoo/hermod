/**
 * Site plan data: every dimension, position and colour of the Olympia-style sanctuary island.
 * Units are world units (1 unit ~ 4 m). x east, z south (toward the default camera), y up.
 * A building's local +z is its front; yaw rotates +z to (sin yaw, cos yaw).
 * Nothing here imports three or the app config, so the plan stays pure and testable under node.
 */

export type SiteSectionId = 'chat' | 'hearth' | 'feed' | 'board' | 'skein' | 'desk' | 'arcade';
export const SITE_SECTIONS: readonly SiteSectionId[] = ['hearth', 'chat', 'feed', 'board', 'skein', 'desk', 'arcade'];
export type SiteQuality = 'low' | 'medium' | 'high' | 'ultra';
export type LandmarkKind = 'tholos' | 'stoa' | 'treasury' | 'workshop' | 'tower' | 'bouleuterion' | 'palaestra' | 'temple' | 'propylon' | 'stadium' | 'treasuryRow' | 'hostel' | 'xystos';

export const MAX_TIER = 5;
/** Copy of GROWTH.radiusByTier (src/config/scene.ts); keep in sync when integrating. */
export const TIER_RADIUS = [12.6, 14.6, 16.8, 19.0, 21.4] as const;
/** Coast wobble amplitude per tier (fraction of radius). Wobble only pushes outward so planned zones never fall off the island. */
export const COAST = { amp: [0.0, 0.025, 0.04, 0.055, 0.07] as readonly number[], min: 0.985, samples: 192, margin: 1.2 } as const;
/** Peninsulas that unlock with a tier: angle (rad, atan2(z,x)), angular width, extra radius. */
export const LOBES = [
  { id: 'kronion', tier: 2, a: -Math.PI / 2 - 0.25, w: 0.55, k: 2.0 },
  { id: 'stadium', tier: 4, a: 0.1, w: 0.62, k: 3.4 },
  { id: 'harbor', tier: 5, a: Math.PI / 2 + 0.1, w: 0.5, k: 2.4 },
] as const;
export const CLIFF = { depth: [2.6, 2.9, 3.2, 3.5, 3.8] as readonly number[], under: [7, 8, 9, 10, 11] as readonly number[] };

export interface V2 { x: number; z: number }
const v = (x: number, z: number): V2 => ({ x, z });

/** Walled temenos (Altis): closed chamfered polygon, gates cut into it. */
export const TEMENOS = {
  poly: [v(-5.5, -10), v(5.5, -10), v(9, -6.4), v(9, 6.6), v(5.5, 9.8), v(-5.5, 9.8), v(-9, 6.6), v(-9, -6.4)] as readonly V2[],
  wallH: 0.55, wallT: 0.32, postEvery: 2.6,
  gates: [
    { id: 'propylon', x: 0, z: 9.8, yaw: 0, w: 3.6, tier: 1 },
    { id: 'east', x: 9, z: 1.7, yaw: Math.PI / 2, w: 2.2, tier: 1 },
    { id: 'postern', x: 3.5, z: -10, yaw: 0, w: 1.8, tier: 2 },
  ] as readonly { id: string; x: number; z: number; yaw: number; w: number; tier: number }[],
} as const;

/** Section plots (all inside the temenos, so a tier 1 island hosts every raised section). fw across the front, fd depth. */
export const PLOT_SPEC: Readonly<Record<SiteSectionId, { x: number; z: number; yaw: number; fw: number; fd: number; kind: LandmarkKind; name: string; door: number }>> = {
  hearth: { x: 0, z: 3.0, yaw: 0, fw: 4.2, fd: 4.2, kind: 'tholos', name: 'The Hearth', door: 0 },
  chat: { x: -6.9, z: 4.7, yaw: Math.PI / 2, fw: 7.2, fd: 2.4, kind: 'stoa', name: 'The Commons', door: 0.3 },
  feed: { x: -6.9, z: -2.0, yaw: Math.PI / 2, fw: 4.0, fd: 3.4, kind: 'treasury', name: 'The Gallery', door: 0.4 },
  board: { x: 6.9, z: -1.8, yaw: -Math.PI / 2, fw: 4.2, fd: 3.2, kind: 'workshop', name: 'The Workshop', door: 0.4 },
  skein: { x: 5.7, z: -6.4, yaw: 0, fw: 3.0, fd: 3.0, kind: 'tower', name: 'The Loom', door: 0.4 },
  desk: { x: 6.9, z: 5.0, yaw: -Math.PI / 2, fw: 4.0, fd: 3.8, kind: 'bouleuterion', name: 'The Counting House', door: 0.4 },
  arcade: { x: -5.8, z: -6.6, yaw: Math.PI / 2, fw: 4.0, fd: 4.0, kind: 'palaestra', name: 'The Games Hall', door: 0.4 },
};
/** Scale per building level (0 = empty foundation). */
export const LEVEL_SCALE = [1, 1, 1.07, 1.14] as const;

/** Fixed monuments (not sections). */
export const FIXED = {
  /** Temple of Hermes on its crepidoma: the focal point at the north end of the axis. Appears with the terrace ring. */
  temple: { x: 0, z: -5.2, yaw: 0, w: 4.0, d: 7.2, steps: 3, stepW: 0.25, stepH: 0.16, tier: 2, cols: [6, 11] as const },
  /** Herm of the signpost (search) by the propylon. */
  herm: { x: 2.5, z: 8.1, yaw: -0.5 },
  /** Great fire altar ring in front of the tholos (always there: tier 1 altar). */
  plaza: { x: 0, z: 3.0, r: 3.7 },
  treasuryRow: { x: -1.3, z: -11.9, w: 10.4, d: 2.0, n: 5, yaw: 0, tier: 2, bw: 1.7, bd: 1.5 },
  stoaEcho: { x: 5.4, z: 8.9, w: 4.2, d: 1.5, yaw: Math.PI, tier: 3 },
  stadium: { x: 15.6, z: 1.7, yaw: 0, len: 8.6, wid: 4.4, wall: 1.5, tier: 4 },
  /** Covered running track (xystos) of the gymnasium beside the hostel quarter. Long axis along z. */
  xystos: { x: -14.4, z: -3.2, yaw: Math.PI / 2, w: 8.0, d: 2.2, tier: 4 },
  hostel: { x: -13.9, z: 3.2, w: 4.0, d: 4.4, yaw: Math.PI / 2, tier: 3 },
} as const;

/** Terraces follow contour lines: rectangular plateaus (yaw 0 = long side along x) with stepped skirts. */
export const TERRACES: readonly { id: string; x: number; z: number; w: number; d: number; yaw: number; h: number; tier: number; wall?: boolean }[] = [
  { id: 'temple', x: 0, z: -5.2, w: 6.4, d: 10.0, yaw: 0, h: 0.5, tier: 2, wall: true },
  { id: 'gallery', x: -6.9, z: -2.0, w: 4.2, d: 5.4, yaw: 0, h: 0.35, tier: 1, wall: true },
  { id: 'treasuries', x: -1.3, z: -11.9, w: 12.6, d: 3.0, yaw: 0, h: 0.95, tier: 2, wall: true },
  { id: 'loom', x: 5.7, z: -6.4, w: 4.4, d: 4.4, yaw: 0, h: 0.3, tier: 1, wall: true },
  { id: 'palaestra', x: -5.8, z: -6.6, w: 5.2, d: 5.2, yaw: 0, h: 0.25, tier: 1, wall: true },
];
/** Kronion: the wooded hill behind the sanctuary. */
export const HILLS = [{ x: -2.5, z: -17.5, r: 9.5, h: 3.4 }, { x: 5.5, z: -16.5, r: 6, h: 1.9 }] as const;
/** Stadium bowl in the heightfield (tier 4). */
export const BOWL = { embank: 1.25 } as const;

export const RIVERS = [
  { id: 'alpheios', tier: 3, w: 1.7, pts: [v(10.7, -16), v(10.9, -9), v(11.1, -2), v(10.9, 4), v(11.6, 10), v(12.8, 17)] },
  { id: 'kladeos', tier: 3, w: 1.0, pts: [v(3.6, -14.6), v(-1.5, -15.1), v(-6, -14.6), v(-10.5, -12.6), v(-15, -9.5)] },
] as const;
export const RIVER = { bed: 0.34, bank: 1.6 } as const;
export const BRIDGE = { w: 1.9, rail: 0.16, rise: 0.22 } as const;
/** Bridges: where a path edge crosses a river. */
export const BRIDGES = [
  { id: 'alpheios-east', x: 10.95, z: 1.7, yaw: Math.PI / 2, len: 3.6, tier: 3 },
] as const;

/** Backbone path nodes. door nodes are added per plot. tier = first tier where the node exists. */
export const NODES: readonly { id: string; x: number; z: number; tier: number }[] = [
  { id: 'landing', x: 0, z: 11.2, tier: 1 }, { id: 'gate', x: 0, z: 9.8, tier: 1 }, { id: 'wayS', x: 0, z: 6.9, tier: 1 },
  { id: 'pW', x: -3.2, z: 3.0, tier: 1 }, { id: 'pE', x: 3.2, z: 3.0, tier: 1 }, { id: 'pN', x: 0, z: -0.45, tier: 1 },
  { id: 'jNW', x: -2.8, z: -0.45, tier: 1 }, { id: 'jNE', x: 2.8, z: -0.45, tier: 1 }, { id: 'tfront', x: 0, z: -1.0, tier: 2 },
  { id: 'jE', x: 4.4, z: 1.7, tier: 1 }, { id: 'eastGate', x: 9, z: 1.7, tier: 1 }, { id: 'bridgeW', x: 9.9, z: 1.7, tier: 3 }, { id: 'bridgeE', x: 12.0, z: 1.7, tier: 3 },
  { id: 'tunnel', x: 13.0, z: 1.7, tier: 4 },
  { id: 'north', x: 3.5, z: -4.0, tier: 2 }, { id: 'postern', x: 3.5, z: -10, tier: 2 }, { id: 'terrace', x: 3.5, z: -11.9, tier: 2 }, { id: 'terraceW', x: -6.1, z: -10.4, tier: 2 },
  { id: 'echo', x: -2.2, z: 8.5, tier: 3 },
];
/** Backbone path edges: [a, b, kind, width, optional bend (signed offset of the midpoint)]. */
export const EDGES: readonly { a: string; b: string; kind: 'way' | 'lane' | 'bridge' | 'stair'; w: number; bend?: number; tier: number }[] = [
  { a: 'landing', b: 'gate', kind: 'way', w: 2.6, tier: 1 }, { a: 'gate', b: 'wayS', kind: 'way', w: 2.6, tier: 1 },
  { a: 'wayS', b: 'pW', kind: 'way', w: 1.7, bend: -0.5, tier: 1 }, { a: 'wayS', b: 'pE', kind: 'way', w: 1.7, bend: 0.5, tier: 1 },
  { a: 'pW', b: 'jNW', kind: 'way', w: 1.7, bend: 0.4, tier: 1 }, { a: 'pE', b: 'jNE', kind: 'way', w: 1.7, bend: -0.4, tier: 1 },
  { a: 'jNW', b: 'pN', kind: 'way', w: 2.2, tier: 1 }, { a: 'pN', b: 'jNE', kind: 'way', w: 2.2, tier: 1 }, { a: 'pN', b: 'tfront', kind: 'way', w: 2.6, tier: 2 },
  { a: 'pE', b: 'jE', kind: 'lane', w: 1.2, bend: 0.2, tier: 1 }, { a: 'jE', b: 'eastGate', kind: 'way', w: 1.5, tier: 1 },
  { a: 'eastGate', b: 'bridgeW', kind: 'lane', w: 1.3, tier: 3 }, { a: 'bridgeW', b: 'bridgeE', kind: 'bridge', w: 1.9, tier: 3 }, { a: 'bridgeE', b: 'tunnel', kind: 'way', w: 1.6, tier: 4 },
  { a: 'jNE', b: 'north', kind: 'lane', w: 1.1, bend: 0.3, tier: 2 }, { a: 'north', b: 'postern', kind: 'lane', w: 1.1, tier: 2 }, { a: 'postern', b: 'terrace', kind: 'stair', w: 1.4, tier: 2 },
  { a: 'terrace', b: 'terraceW', kind: 'lane', w: 1.2, tier: 2 },
  { a: 'wayS', b: 'echo', kind: 'lane', w: 1.1, bend: 0.2, tier: 3 },
];

/** Colour palette (hex). Vertex colours bake these into merged meshes; terrain colours blend per vertex. */
export const COL = {
  marble: 0xe9e3d6, limestone: 0xd9cfba, stoneDark: 0xb4a994, plinth: 0xc9bfa9, terracotta: 0xb4623f, terracottaD: 0x8e4b34, ochre: 0xc9a05a, bronze: 0xa8793a, wood: 0x7a5a3d, plaster: 0xeee3cb,
  sand: 0xe0cc9c, track: 0xd8be86, cloth: 0x9a3f35, cloth2: 0x3f6275, flame: 0xffa43a,
  grass: 0x9aa57c, grass2: 0xb7b98c, grass3: 0x7f8b62, dirt: 0xcdbf9f, rim: 0x8c8068, paveWay: 0xe2d6bd, paveLane: 0xd4c6a8, paveEdge: 0xb9ab8c,
  olive: 0x7d8b5c, oliveD: 0x61704a, plane: 0x6f8450, cypress: 0x3f5a3d, trunk: 0x7b6650, roof: [0xb4623f, 0x9a5238, 0xa86f46, 0x8b4f3f, 0x9a7a45] as readonly number[], wall: [0xeee3cb, 0xe3d4b6, 0xf1e8d5] as readonly number[],
  water: 0x6f9a9e, rock: 0x9b8f7c,
} as const;

/** Quarter (hostel and villa district) slot generation. Rings only exist once the island is large enough (ring k needs tier k+1). */
export const QUARTER = {
  rings: [10.4, 12.4, 14.4, 16.4, 18.4] as readonly number[], spacing: 2.6, clear: { plot: 1.1, wall: 1.1, river: 1.1, path: 1.25, house: 2.3 },
  /** Keep-out half planes: no houses east of this x (river and stadium side) or north of this z (Kronion). */
  maxX: 9.0, minZ: -9.2, cottage: { w: 1.9, d: 1.6, r: 1.2, jitter: 0.1 }, startAngle: Math.PI / 2, maxSlots: 400,
} as const;

/** Tree scatter. */
export const TREES = {
  /** Candidates per unit of island area at each tier are capped here. */
  max: 140, olive: { h: 0.95, crown: 0.62 }, plane: { h: 1.7, crown: 0.95 }, cypress: { h: 2.0, crown: 0.28 },
  /** Axis corridor kept clear so the temple stays visible from the gate. */
  corridor: 1.9,
} as const;

/** Props. */
export const PROPS = {
  zanes: [v(-2.0, 8.3), v(2.0, 8.3), v(-2.0, 6.6), v(2.0, 6.7)] as readonly V2[],
  altars: [v(-3.6, -0.1), v(3.6, -0.1)] as readonly V2[],
  /** Torches: along the way and at the temple front, plus extra ring points per tier. */
  torches: [v(-1.7, 9.3), v(1.7, 9.3), v(-1.5, -0.9), v(1.5, -0.9), v(-1.5, 7.5), v(1.5, 7.5)] as readonly V2[],
  statueH: 0.85, baseH: 0.38, torchH: 1.1,
  flame: { r: 0.12, h: 0.34 },
} as const;

/** Level of detail and budgets per quality tier. */
export const DETAIL = {
  low: { detail: 0, radial: 6, terrainStep: 0.5, trees: 0.45, lights: 0, shadows: false },
  medium: { detail: 1, radial: 8, terrainStep: 0.36, trees: 0.75, lights: 1, shadows: true },
  high: { detail: 2, radial: 10, terrainStep: 0.3, trees: 1, lights: 3, shadows: true },
  ultra: { detail: 2, radial: 12, terrainStep: 0.26, trees: 1.2, lights: 3, shadows: true },
} as const;
export const BUDGET = { high: 250, low: 120 } as const;
export const NIGHT = { windowGlow: 1.0, flame: 1.0, lightIntensity: 14, lightDist: 9, flicker: 0.18 } as const;

/** Camera presets (orbit azimuth/elevation/distance around target), compatible with CAMERA.home in src/config/scene.ts. */
export const CAMERAS = {
  home: { az: Math.PI / 4, el: 0.66, dist: 46, target: [0, 0.5, 0] as const },
  procession: { az: 0.28, el: 0.5, dist: 40, target: [0, 1.2, -1] as const },
  temple: { az: 0.5, el: 0.35, dist: 22, target: [0, 1.6, -5] as const },
  stadium: { az: 1.05, el: 0.55, dist: 30, target: [12, 0.5, 2] as const },
  quarter: { az: -0.9, el: 0.7, dist: 34, target: [-6, 0, 6] as const },
  plan: { az: 0, el: 1.5, dist: 56, target: [0, 0, 0] as const },
} as const;

/** Each plot's door links to this backbone node (optionally through waypoints) with a purposeful desire line. */
export const PLOT_LINK: Readonly<Record<SiteSectionId, { to: string; via?: readonly V2[] }>> = {
  hearth: { to: 'wayS' }, chat: { to: 'pW' }, feed: { to: 'jNW' }, arcade: { to: 'jNW' }, board: { to: 'jNE' },
  skein: { to: 'jNE', via: [v(4.0, -2.9)] }, desk: { to: 'pE' },
};
/** Hostel door and echo stoa door link targets. */
export const EXTRA_LINK = { hostel: 'landing', echo: 'echo' } as const;

/** Olive orchards on the hill foot and the far bank: jittered-grid patches (yaw 0 = long side along x). */
export const ORCHARDS: readonly { x: number; z: number; w: number; d: number; tier: number; step: number }[] = [
  { x: -11.4, z: -10.0, w: 4.6, d: 4.6, tier: 3, step: 1.55 }, { x: 7.0, z: -12.6, w: 4.4, d: 2.6, tier: 2, step: 1.5 },
  { x: 14.2, z: 10.2, w: 4.4, d: 3.0, tier: 5, step: 1.6 }, { x: 17.5, z: -6.0, w: 3.0, d: 4.0, tier: 5, step: 1.6 },
];
/** Hand-placed accent trees (framing the approach and the temple, never in the axis corridor). */
export const ACCENTS: readonly { x: number; z: number; kind: 'olive' | 'plane' | 'cypress'; s: number; tier: number }[] = [
  { x: -4.4, z: 9.0, kind: 'cypress', s: 1.0, tier: 1 }, { x: 4.4, z: 9.2, kind: 'cypress', s: 1.1, tier: 1 },
  { x: -8.0, z: 8.6, kind: 'plane', s: 1.1, tier: 1 }, { x: 8.1, z: 8.5, kind: 'plane', s: 1.0, tier: 1 },
  { x: -8.1, z: -9.0, kind: 'plane', s: 1.2, tier: 1 }, { x: 8.0, z: -9.0, kind: 'plane', s: 1.15, tier: 1 },
  { x: -3.9, z: -9.2, kind: 'cypress', s: 1.2, tier: 2 }, { x: 4.0, z: -9.3, kind: 'cypress', s: 1.25, tier: 2 },
  { x: -3.4, z: -2.2, kind: 'olive', s: 0.9, tier: 1 }, { x: -8.1, z: 1.4, kind: 'olive', s: 0.85, tier: 1 }, { x: 8.1, z: -4.8, kind: 'olive', s: 0.9, tier: 1 },
  { x: -8.2, z: 8.0, kind: 'olive', s: 0.8, tier: 1 }, { x: 8.0, z: 8.4, kind: 'olive', s: 0.8, tier: 1 },
];

/** Terrain heightfield tuning. */
export const TERRAIN = {
  base: 0.22, noise: 0.5, noiseFreq: 0.16, flatLevel: 0.12, flatNoise: 0.04, interiorBlend: 3.5, skirt: 0.9, wallSkirt: 0.28, coastDrop: 0.14, coastBand: 0.8,
  bowlSoft: 1.4, bowlCorner: 1.0, minH: -0.5,
} as const;
/** Asset file per landmark/prop id (public/assets/site/<id>.glb, built by scripts/assets/blender/landmarks). */
export const ASSET_BASE = '/assets/site/';
export const KIND_ASSET: Readonly<Record<LandmarkKind, string>> = {
  tholos: 'tholos', stoa: 'stoa', treasury: 'treasury', workshop: 'workshop', tower: 'tower', bouleuterion: 'bouleuterion', palaestra: 'palaestra',
  temple: 'temple', propylon: 'propylon', stadium: 'stadium', treasuryRow: 'treasury_small', hostel: 'hostel', xystos: 'xystos',
};
export const LOD_BY_QUALITY = { low: 2, medium: 1, high: 0, ultra: 0 } as const;

/** Peribolos road: distance (units) outside the temenos wall. */
export const RING_OFFSET = 2.2;

/** Cottage variants (authored glb cottage_0..5), picked per member by hash. */
export const COTTAGE_VARIANTS = 6;
export type DecorKind =
  | 'amphora' | 'amphora_stack' | 'well' | 'cistern' | 'basin' | 'kline' | 'loom' | 'kiln' | 'tripod' | 'offering_table' | 'stall' | 'garden_bed'
  | 'rock_a' | 'rock_b' | 'rock_c' | 'step_stone' | 'boat_a' | 'boat_b' | 'hut' | 'net_rack' | 'mole_seg' | 'bollard' | 'banner_pole' | 'woodpile';
/** Footprint clearance radius per decor kind (world units). */
export const DECOR_R: Readonly<Record<DecorKind, number>> = {
  amphora: 0.18, amphora_stack: 0.4, well: 0.5, cistern: 0.8, basin: 0.3, kline: 0.55, loom: 0.55, kiln: 0.6, tripod: 0.3, offering_table: 0.4, stall: 0.7, garden_bed: 0.7,
  rock_a: 0.3, rock_b: 0.4, rock_c: 0.25, step_stone: 0.18, boat_a: 0.9, boat_b: 0.75, hut: 1.0, net_rack: 0.5, mole_seg: 0.5, bollard: 0.1, banner_pole: 0.12, woodpile: 0.4,
};
/**
 * Lived-in props by zone. `at` is the anchor, items are rejection-sampled inside `spread` of it against every static feature
 * (plots, landmarks, paths, rivers, plaza, quarter slots), independent of tier, so a tier n scene is a subset of tier n+1.
 * zone: inside = inside the temenos, out = outside it on the island, coast = within `spread` of the coast point at angle `at.x` (rad), inset `at.z`.
 */
export interface DecorSpec { kind: DecorKind; at: V2; spread: number; n: number; tier: number; zone: 'inside' | 'out' | 'coast'; yaw?: 'face' | 'free' | 'axis'; s?: [number, number] }
export const DECOR_SPECS: readonly DecorSpec[] = [
  { kind: 'well', at: v(-3.6, 8.0), spread: 0.8, n: 1, tier: 1, zone: 'inside' },
  { kind: 'basin', at: v(-3.0, 8.4), spread: 0.9, n: 1, tier: 1, zone: 'inside' },
  { kind: 'amphora_stack', at: v(-3.5, 7.2), spread: 1.2, n: 2, tier: 1, zone: 'inside' },
  { kind: 'kline', at: v(-5.0, 3.0), spread: 1.6, n: 3, tier: 1, zone: 'inside', yaw: 'face' },
  { kind: 'kline', at: v(5.0, 5.0), spread: 1.6, n: 2, tier: 1, zone: 'inside', yaw: 'face' },
  { kind: 'tripod', at: v(0, 0.2), spread: 9, n: 3, tier: 1, zone: 'inside', yaw: 'free' },
  { kind: 'offering_table', at: v(0, -1.6), spread: 9, n: 2, tier: 1, zone: 'inside', yaw: 'axis' },
  { kind: 'loom', at: v(3.4, -3.4), spread: 8, n: 1, tier: 1, zone: 'inside', yaw: 'free' },
  { kind: 'kiln', at: v(8.0, -4.0), spread: 7, n: 1, tier: 1, zone: 'inside', yaw: 'free' },
  { kind: 'woodpile', at: v(8.0, 1.0), spread: 8, n: 2, tier: 1, zone: 'inside', yaw: 'free' },
  { kind: 'amphora', at: v(8.0, 0.6), spread: 8, n: 4, tier: 1, zone: 'inside', yaw: 'free' },
  { kind: 'amphora', at: v(-8.0, -4.2), spread: 8, n: 3, tier: 1, zone: 'inside', yaw: 'free' },
  { kind: 'banner_pole', at: v(-2.6, 9.2), spread: 0.4, n: 1, tier: 1, zone: 'inside', yaw: 'axis' },
  { kind: 'banner_pole', at: v(2.6, 9.2), spread: 0.4, n: 1, tier: 1, zone: 'inside', yaw: 'axis' },
  { kind: 'garden_bed', at: v(-7.4, 7.8), spread: 8, n: 1, tier: 2, zone: 'inside', yaw: 'axis' },
  { kind: 'garden_bed', at: v(2.6, 8.2), spread: 1.0, n: 2, tier: 2, zone: 'inside', yaw: 'axis' },
  { kind: 'cistern', at: v(-8.0, 0.4), spread: 12, n: 1, tier: 3, zone: 'inside', yaw: 'free' },
  { kind: 'stall', at: v(5.4, 14.4), spread: 2.6, n: 3, tier: 3, zone: 'out', yaw: 'face' },
  { kind: 'amphora_stack', at: v(3.4, 14.4), spread: 2.2, n: 2, tier: 3, zone: 'out' },
  { kind: 'garden_bed', at: v(-11.0, -2.4), spread: 2.4, n: 3, tier: 4, zone: 'out', yaw: 'axis' },
  { kind: 'basin', at: v(-12.6, -0.4), spread: 1.0, n: 1, tier: 4, zone: 'out' },
  { kind: 'rock_a', at: v(11.6, -9), spread: 4.0, n: 5, tier: 2, zone: 'out', yaw: 'free', s: [0.8, 1.6] },
  { kind: 'rock_b', at: v(-9.4, -13), spread: 5.0, n: 6, tier: 2, zone: 'out', yaw: 'free', s: [0.8, 1.8] },
  { kind: 'rock_c', at: v(12.4, 8.4), spread: 4.0, n: 5, tier: 3, zone: 'out', yaw: 'free', s: [0.7, 1.4] },
  { kind: 'rock_a', at: v(0, -12.8), spread: 5.0, n: 5, tier: 2, zone: 'out', yaw: 'free', s: [0.8, 1.5] },
  { kind: 'rock_b', at: v(Math.PI / 2, 0.1), spread: 6.0, n: 7, tier: 1, zone: 'coast', yaw: 'free', s: [0.8, 1.6] },
  { kind: 'rock_c', at: v(Math.PI, 0.1), spread: 6.0, n: 7, tier: 1, zone: 'coast', yaw: 'free', s: [0.7, 1.4] },
  { kind: 'rock_a', at: v(0, 0.1), spread: 6.0, n: 7, tier: 1, zone: 'coast', yaw: 'free', s: [0.8, 1.6] },
];
/** Stepping stones across the kladeos (tier 3): positions along the river centre line by fraction. */
export const STEP_STONES = { river: 'kladeos', at: [0.28, 0.5, 0.74] as readonly number[], span: 5, tier: 3 } as const;
/** Harbour (tier 5): mole arc, boats at the piers, fishermen huts and quay props. Angles are atan2(z, x) at the coast of the tier 5 island. */
export const HARBOR = {
  tier: 5, arc: [Math.PI / 2 - 0.62, Math.PI / 2 + 1.05] as const, moleOut: 1.6, moleStep: 1.5,
  boats: 5, huts: [v(-2.8, 0), v(-6.6, 0), v(2.0, 0)] as readonly V2[], quayProps: 7,
} as const;
/** Ground cover patches (authored wildflower, thyme and grass clumps) per tier cap. */
export const COVER = { cap: [90, 170, 260, 340, 420] as readonly number[], inner: 0.35, olivePatch: 1.1 } as const;

/** Market square (tier 3) and gymnasium court (tier 4): quarter slots inside are kept free (index stays stable, the slot is simply unusable). */
export const KEEP_OUT: readonly { x: number; z: number; r: number }[] = [{ x: 5.4, z: 14.4, r: 2.6 }, { x: -11.4, z: -1.2, r: 3.2 }];

/** Harbour basin water level in site space (the island floats, so the basin is drawn by the site itself between the coast and the mole). */
export const SEA_Y = -0.35;
