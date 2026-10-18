import type * as THREE from 'three';
import { ROOM_MAKERS } from './rooms';
import { createRoomKit, type RoomKit } from './rooms/kit';
import { INTERIOR_MAKERS } from '@/config/scene';
import type { SectionId } from '@/lib/data/types';
import type { Mats } from './types';
import type { World } from './world';

/** Data painted onto an interior (chat lines, feed posters, board columns, skein snapshots). */
export interface PaintLine { who?: string; text?: string; label?: string }
export interface PaintColumn { name: string; cards: PaintLine[] }
export type InteriorPaint = PaintLine[] | PaintColumn[];

/** Room group contract: userData.cam / look frame the camera, paint redraws canvases, tick animates. */
export interface InteriorRoom extends THREE.Group {
  userData: { cam: THREE.Vector3; look: THREE.Vector3; paint?: (data: InteriorPaint) => void; presence?: (online: number) => void; tick?: (t: number, cam?: THREE.Camera) => void; [k: string]: unknown };
}
export type InteriorName = (typeof INTERIOR_MAKERS)[keyof typeof INTERIOR_MAKERS];
export type InteriorMaker = (K: RoomKit) => InteriorRoom;

/** Interior room makers by name (commons, gallery, workshop, loom). */
export const interiorMakers: Partial<Record<InteriorName, InteriorMaker>> = ROOM_MAKERS;

/** What a room provider receives: the shared kit (materials, furniture builders) and the world. */
export interface RoomProviderCtx { kit: RoomKit; M: Mats; WK: World; context: () => RoomContext }
/** Live facts rooms render: the space id seeds the layout solver, `online` is the real member count that fills seats. */
export interface RoomContext { seed: string; online: number }
/** Builds a room for a section, possibly async (e.g. loading a glTF). Rooms from providers replace the built-in makers. */
export type RoomProvider = (ctx: RoomProviderCtx) => Promise<InteriorRoom> | InteriorRoom;
const providers = new Map<string, RoomProvider>();
/** Plug a room in for a section id; returns an unregister function. Takes effect the next time that room is loaded. */
export function registerRoomProvider(section: string, provider: RoomProvider): () => void {
  providers.set(section, provider); return () => { if (providers.get(section) === provider) providers.delete(section); };
}

/** Rooms kept built at once (the active one never counts as evictable); older ones are disposed and rebuilt on demand. */
const MAX_ROOMS = 3;

/**
 * Lazy room cache. Rooms are built on first entry, only the active room is ticked, and the least recently used
 * rooms are disposed beyond MAX_ROOMS. Rooms are never in the scene graph unless the camera is inside (the town adds and removes them).
 */
export function createInteriors(M: Mats, WK: World, makers: Partial<Record<InteriorName, InteriorMaker>> = interiorMakers) {
  const rooms = new Map<string, InteriorRoom>(); const pending = new Map<string, Promise<InteriorRoom | null>>(); const lastPaint = new Map<string, InteriorPaint>();
  let shadows = false; let active: string | null = null; let ctx: RoomContext = { seed: '', online: 0 };
  /** One shadow-casting pendant per room (cube shadow map), on at the high tiers. */
  const applyShadow = (room: InteriorRoom) => { let done = false; room.traverse((o) => { const l = o as THREE.PointLight; if (!l.isPointLight) return; const cand = !done && !!l.userData.shadowCandidate; if (cand) done = true; l.castShadow = shadows && cand; if (l.castShadow) { l.shadow.mapSize.set(512, 512); l.shadow.bias = -0.002; l.shadow.normalBias = 0.02; l.shadow.radius = 3; } }); };
  let kit: RoomKit | null = null;
  const maker = (id: string): InteriorMaker | undefined => makers[(INTERIOR_MAKERS as Record<string, InteriorName | undefined>)[id] as InteriorName];
  const touch = (id: string, room: InteriorRoom) => { rooms.delete(id); rooms.set(id, room); };
  function evict() {
    for (const [id, room] of rooms) {
      if (rooms.size <= MAX_ROOMS) return; if (id === active) continue;
      room.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); }); (room.userData.dispose as (() => void) | undefined)?.(); rooms.delete(id);
    }
  }
  function adopt(id: string, room: InteriorRoom): InteriorRoom {
    room.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { o.receiveShadow = true; o.castShadow = !(m.material as THREE.Material).transparent; } });
    applyShadow(room); rooms.set(id, room); const p = lastPaint.get(id); if (p && room.userData.paint) room.userData.paint(p); room.userData.presence?.(ctx.online); evict(); return room;
  }
  return {
    has: (id: string) => rooms.has(id),
    canLoad: (id: string) => providers.has(id) || !!maker(id),
    /** Built room, or null (also null while a provider room is still loading). */
    get(id: SectionId | string): InteriorRoom | null {
      const hit = rooms.get(id); if (hit) { touch(id, hit); return hit; }
      if (providers.has(id)) return null; const make = maker(id); if (!make) return null;
      return adopt(id, make((kit ??= createRoomKit(M, WK))));
    },
    /** Build (or fetch) a room, awaiting async providers. Resolves null for unknown sections or failed providers. */
    load(id: SectionId | string): Promise<InteriorRoom | null> {
      const hit = rooms.get(id); if (hit) { touch(id, hit); return Promise.resolve(hit); }
      const run = pending.get(id); if (run) return run;
      const prov = providers.get(id);
      if (!prov) return Promise.resolve(this.get(id));
      const p = Promise.resolve().then(() => prov({ kit: (kit ??= createRoomKit(M, WK)), M, WK, context: () => ctx })).then((room) => adopt(id, room)).catch((e) => { console.error('Room provider failed for ' + id + ': ' + (e as Error)?.message); return null; }).finally(() => { pending.delete(id); });
      pending.set(id, p); return p;
    },
    /** Mark which room is shown (it is ticked and never evicted); null when outside. */
    setActive(id: string | null) { active = id; evict(); },
    paint(id: string, data: InteriorPaint) { lastPaint.set(id, data); const r = rooms.get(id); if (r && r.userData.paint) r.userData.paint(data); },
    /** Space id (layout seed) and online count; seats refill live without rebuilding rooms. */
    setContext(c: RoomContext) {
      const reseed = c.seed !== ctx.seed; ctx = c;
      if (reseed) for (const [id, r] of [...rooms]) { if (id === active) continue; r.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); }); (r.userData.dispose as (() => void) | undefined)?.(); rooms.delete(id); }
      rooms.forEach((r) => r.userData.presence?.(c.online));
    },
    setShadows(on: boolean) { shadows = on; rooms.forEach(applyShadow); },
    tick(t: number, cam?: THREE.Camera) { const r = active ? rooms.get(active) : null; if (r && r.userData.tick) r.userData.tick(t, cam); },
  };
}
export type Interiors = ReturnType<typeof createInteriors>;
