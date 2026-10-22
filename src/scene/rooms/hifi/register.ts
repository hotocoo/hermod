import type * as THREE from 'three';
import { ROOM_RESIDENCY } from '@/config/scene';
import { AssetLibrary } from '../../assets/loader';
import type { AssetTier } from '../../assets/types';
import { registerRoomProvider } from '../../interiors';
import { LAYOUTS } from './layouts';
import { buildRoom } from './room';

/** Sections whose room is not an interior the camera cuts into: the hearth is a pavilion owned by the town/map code, which places its layout. */
const EXTERNAL = new Set(['hearth']);

/**
 * Plug the authored-asset rooms in for every layout (high / ultra tiers). Must run before the town loads a room;
 * returns an uninstall that unregisters providers and frees the asset library.
 */
export function installHifiRooms(opts: { renderer: THREE.WebGLRenderer; tier: AssetTier; base?: Record<AssetTier, string> }): () => void {
  const lib = new AssetLibrary({ renderer: opts.renderer, tier: opts.tier, base: opts.base, warm: ROOM_RESIDENCY.warmModels });
  const off = Object.entries(LAYOUTS).filter(([section]) => !EXTERNAL.has(section)).map(([section, layout]) => registerRoomProvider(section, ({ context }) => buildRoom(layout, lib, context().seed || 'hermod', () => context().online)));
  return () => { off.forEach((f) => f()); lib.dispose(); };
}
export { LAYOUTS };
