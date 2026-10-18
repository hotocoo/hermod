import { describe, expect, it } from 'vitest';
import manifest from '../../assets/manifest.json';
import { LAYOUTS } from './layouts';
import { prepare } from './prepare';
import { boxOf, occupiedSeats, overlaps, seatSurface, solve, type Catalog } from './solver';

const catalog = manifest.models as unknown as Catalog;

describe('room solver', () => {
  it('every asset id in every layout exists in the manifest', () => {
    const ids = new Set<string>(); const walk = (o: unknown) => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { if ((k === 'asset' || k === 'table') && typeof v === 'string') ids.add(v); else if (['assets', 'traces', 'figures'].includes(k) && Array.isArray(v)) (v as string[]).forEach((x) => ids.add(x)); else walk(v); } };
    for (const l of Object.values(LAYOUTS)) { walk(l.rules); walk(l.shell.openings); walk(l.presence); l.content.forEach((c) => ids.add(c.asset)); }
    expect([...ids].filter((i) => !catalog[i])).toEqual([]);
  });
it('every seat sits on a sittable surface of its piece and records its local x', () => {
  for (const raw of Object.values(LAYOUTS)) {
    const s = solve(prepare(raw, catalog), catalog, 'seats');
    for (const seat of s.seats) { expect(seatSurface(catalog[seat.asset])).toBeDefined(); expect(Number.isFinite(seat.lx)).toBe(true); expect(Math.abs(seat.lx)).toBeLessThanOrEqual(catalog[seat.asset].footprint.w / 2); }
  }
});
  for (const [section, raw] of Object.entries(LAYOUTS)) {
    const layout = prepare(raw, catalog);
    it(`${section}: same seed gives identical placements`, () => {
      expect(JSON.stringify(solve(layout, catalog, 'space-a'))).toBe(JSON.stringify(solve(layout, catalog, 'space-a')));
    });
    it(`${section}: different seeds differ`, () => {
      expect(JSON.stringify(solve(layout, catalog, 'space-a').placements)).not.toBe(JSON.stringify(solve(layout, catalog, 'space-b').placements));
    });
    it(`${section}: no two placed objects overlap`, () => {
      for (const seed of ['a', 'b', 'c', 'ashgrove', 'x9']) {
        const s = solve(layout, catalog, seed); const bad: string[] = [];
        const floorish = s.placements.filter((p) => !p.under);
        const hostOf = new Map(s.placements.map((p) => [p.key, p.host]));
        for (let i = 0; i < floorish.length; i++) for (let j = i + 1; j < floorish.length; j++) {
          const a = floorish[i], b = floorish[j];
          if (hostOf.get(a.key) === b.key || hostOf.get(b.key) === a.key) continue; // clutter rests on its host
          if (a.host && a.host === b.host && a.kind === 'surface' && b.kind === 'surface') { if (overlaps(boxOf(catalog[a.asset], ...a.pos, a.rotY), boxOf(catalog[b.asset], ...b.pos, b.rotY), 0)) bad.push(`${a.key} x ${b.key}`); continue; }
          if (a.kind === 'surface' || b.kind === 'surface') continue;
          if (overlaps(boxOf(catalog[a.asset], a.pos[0], a.pos[1], a.pos[2], a.rotY), boxOf(catalog[b.asset], b.pos[0], b.pos[1], b.pos[2], b.rotY), 0)) bad.push(`${a.key} x ${b.key}`);
        }
        expect(bad, `seed ${seed}`).toEqual([]);
      }
    });
    it(`${section}: every piece finds a valid spot for any seed`, () => {
      for (const seed of ['a', 'b', 'c', 'ashgrove', 'x9', 'dev', 'bake']) expect(solve(layout, catalog, seed).rejected, `seed ${seed}`).toEqual([]);
    });
    it(`${section}: everything stays inside the shell`, () => {
      const s = solve(layout, catalog, 'bounds');
      for (const p of s.placements) { expect(Math.abs(p.pos[0])).toBeLessThanOrEqual(layout.shell.w / 2 + 0.2); expect(Math.abs(p.pos[2])).toBeLessThanOrEqual(layout.shell.d / 2 + 0.2); expect(p.pos[1]).toBeGreaterThanOrEqual(-1e-6); }
    });
    it(`${section}: hero pieces always place`, () => {
      const s = solve(layout, catalog, 'heroes'); const failed = s.rejected.filter((r) => catalog[r.asset]?.tags.includes('hero') || ['notice_board', 'hearth_stone', 'dining_table'].includes(r.asset));
      expect(failed).toEqual([]);
    });
    it(`${section}: seats fill with the real online count, in a stable order`, () => {
      const s = solve(layout, catalog, 'seats'); expect(s.seats.length).toBeGreaterThan(0);
      expect(occupiedSeats(s, 0, 'seats')).toHaveLength(0);
      expect(occupiedSeats(s, 3, 'seats')).toHaveLength(Math.min(3, s.seats.length));
      expect(occupiedSeats(s, 9999, 'seats')).toHaveLength(s.seats.length);
      const three = occupiedSeats(s, 3, 'seats').map((x) => x.key); const four = occupiedSeats(s, 4, 'seats').map((x) => x.key);
      expect(four.slice(0, 3)).toEqual(three);
    });
  }
});
