// Offline: solve each room's seed-independent structure and dump shell geometry + placements for the Blender lightmap bake.
// npx tsx scripts/assets/rooms/export.ts <outDir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import manifest from '../../../src/scene/assets/manifest.json';
import { LAYOUTS } from '../../../src/scene/rooms/hifi/layouts';
import { prepare } from '../../../src/scene/rooms/hifi/prepare';
import { shellParts } from '../../../src/scene/rooms/hifi/shell';
import { solve, type Catalog } from '../../../src/scene/rooms/hifi/solver';

const out = process.argv[2]; mkdirSync(out, { recursive: true });
const catalog = manifest.models as unknown as Catalog;
for (const l of Object.values(LAYOUTS)) {
  const L = prepare(l, catalog); const s = solve(L, catalog, 'bake', { structureOnly: true });
  const parts = shellParts(L.shell, (id) => (manifest.materials as Record<string, { tileM: number }>)[id]?.tileM || 1);
  const shell = parts.map((p) => { const g = p.geometry.index ? p.geometry.toNonIndexed() : p.geometry; return { name: p.name, material: p.material, positions: Array.from(g.getAttribute('position').array as Float32Array), uv: Array.from(g.getAttribute('uv').array as Float32Array) }; });
  const windows = L.shell.openings.filter((o) => o.kind === 'window').map((o) => ({ wall: o.wall, at: o.at, w: o.w, h: o.h, sill: o.sill }));
  const lmPlacements = s.placements.filter((p) => p.kind !== 'surface' && (catalog[p.asset] as unknown as { source?: { lightmap?: boolean } }).source?.lightmap);
  const placements = [...s.placements.filter((p) => p.kind !== 'surface').map((p) => ({ asset: p.asset, pos: p.pos, rotY: p.rotY })), ...L.shell.openings.flatMap((o) => (o.asset ? [] : []))];
  writeFileSync(join(out, `${L.section}.json`), JSON.stringify({ id: L.id, section: L.section, w: L.shell.w, d: L.shell.d, h: L.shell.h, shell, windows, placements, lmPieces: lmPlacements.map((p) => ({ key: p.key, asset: p.asset, pos: p.pos, rotY: p.rotY })) }));
  console.log(L.section, shell.length, 'parts', placements.length, 'occluders');
}
