/** Map style preference: per device local override beats the space default (set by an admin via space.update `map_style`) beats 'village'. */
export const MAP_STYLE_IDS = ['village', 'sanctuary'] as const;
export type MapStyleChoice = (typeof MAP_STYLE_IDS)[number];
export const DEFAULT_MAP_STYLE: MapStyleChoice = 'village';
const KEY = 'hermod.mapStyle';
export const isMapStyle = (v: unknown): v is MapStyleChoice => typeof v === 'string' && (MAP_STYLE_IDS as readonly string[]).includes(v);
export function getLocalMapStyle(): MapStyleChoice | null { try { const v = window.localStorage.getItem(KEY); return isMapStyle(v) ? v : null; } catch { return null; } }
/** null clears the override (follow the space default). */
export function setLocalMapStyle(v: MapStyleChoice | null): void { try { if (v) window.localStorage.setItem(KEY, v); else window.localStorage.removeItem(KEY); } catch { /* storage blocked */ } }
export function resolveMapStyle(spaceDefault?: string | null, local: MapStyleChoice | null = getLocalMapStyle()): MapStyleChoice {
  return local ?? (isMapStyle(spaceDefault) ? spaceDefault : DEFAULT_MAP_STYLE);
}
