import type { RoomLayout } from './layoutTypes';
import type { Catalog } from './solver';

/** Normalise a layout against the catalog: openings that name an asset take their size from it (one source of truth). */
export function prepare(layout: RoomLayout, catalog: Catalog): RoomLayout {
  const openings = layout.shell.openings.map((o) => { const a = o.asset ? catalog[o.asset] : null; return a ? { ...o, w: a.footprint.w, h: a.footprint.h } : o; });
  return { ...layout, shell: { ...layout.shell, openings } };
}

