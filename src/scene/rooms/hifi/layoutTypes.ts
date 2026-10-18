/** Room layout data (src/scene/rooms/layouts/*.json). Everything a room contains is described here; nothing is placed in code. */
export type Wall = 'n' | 's' | 'e' | 'w';
export type Range = [number, number];
export interface Rect { x: Range; z: Range }

export interface Opening { wall: Wall; /** metres along the wall from its centre */ at: number; w: number; h: number; sill: number; asset?: string; kind: 'window' | 'door' }
export interface Shell {
  w: number; d: number; h: number;
  /** Tiling PBR material ids (manifest `materials`) and their real-world tile size comes from the manifest. */
  floor: string; wall: string; trim: string; ceiling: string; beams?: { material: string; every: number; size: [number, number]; axis: 'x' | 'z' };
  wainscot?: { material: string; h: number };
  baseboard: { h: number; d: number }; crown?: { h: number; d: number };
  openings: Opening[];
  /** Floor rectangles kept free of furniture (walkways, camera foreground). */
  keepClear: Rect[];
  /** Interior colour of the sky light coming through windows (practical rig), HDRI id for reflections. */
  hdri: string;
}

export interface Pool { assets: string[]; weights?: number[] }
export type Rule =
  | ({ kind: 'anchor'; wall: Wall; /** -1..1 along the wall, or 'auto' to take the first free slot (seeded start) */ along: number | 'auto'; inset?: number; group: string; asset: string })
  | ({ kind: 'place'; at: [number, number]; /** if the exact spot is taken, search this radius (m) around it */ spread?: number; rotY?: number; face?: [number, number]; group: string; asset: string; y?: number; under?: boolean })
  | ({ kind: 'set'; at: [number, number]; rotY: number; group: string; table: string; chairs: Pool & { long: number; short: number; tuck: number; /** chairs evenly around a round table instead of per side */ ring?: number } })
  | ({ kind: 'scatter'; group: string; count: Range; region: Rect | 'edge'; gap?: number; edge?: number; under?: boolean } & Pool)
  | ({ kind: 'surface'; group: string; host: { group?: string; asset?: string; tag?: string }; perHost: Range; yaw?: 'free' | 'aligned' } & Pool)
  | ({ kind: 'wallrow'; group: string; wall: Wall; y: number; count: number; span: Range; asset?: string } & Pool)
  | ({ kind: 'ceiling'; group: string; asset: string; at: [number, number][] });

export interface PresenceCfg {
  /** Seat tags that count as sittable; figures take them in a seeded order. */
  tags: string[];
  /** Figure assets (manifest category 'figure') cycled over occupied seats. */
  figures: string[];
  /** Clip names by seat context: at a table (read/write/sip) or free seating. */
  clips: { table: string[]; free: string[] };
  /** Asset ids that are placed at an occupied seat (cup, open book...), chosen by index. */
  traces: string[];
}
export interface ContentBind {
  /** Placed asset (first match by asset id, or by group) whose manifest slot receives painted data. */
  asset: string; slot: string; feed: 'notes' | 'columns' | 'frames' | 'chalk';
  /** Painting canvas size (px) at the authored texel density for the slot. */
  px: number;
}
export interface LightRig {
  /** Practical emitter kinds from the manifest -> light parameters. */
  kinds: Record<string, { color: string; intensity: number; distance: number; decay: number; flicker?: number; cast?: boolean }>;
  /** Sun/sky through windows. */
  window: { color: string; intensity: number; distance: number };
  fill: { sky: string; ground: string; intensity: number };
  /** Max shadow-casting lights (cube shadow maps are expensive). */
  shadowLights: number;
  /** Hard cap on dynamic point lights per room (forward shading cost). Highest-priority kinds first. */
  maxLights: number;
  /** Image-based light strength from the room HDRI (0..1). */
  env: number;
}
export interface RoomLayout {
  id: string; section: string; name: string;
  /** Camera framing (room local, metres). */
  cam: { cam: [number, number, number]; look: [number, number, number] };
  shell: Shell;
  rules: Rule[];
  presence: PresenceCfg;
  content: ContentBind[];
  lights: LightRig;
}
