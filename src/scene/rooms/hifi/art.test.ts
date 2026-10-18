import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ARTWORKS, artOrder } from './art';

describe('room artwork', () => {
  it('ships every listed painting with credit data', () => {
    expect(ARTWORKS.length).toBeGreaterThanOrEqual(12);
    for (const a of ARTWORKS) {
      expect(existsSync(join(process.cwd(), 'public/assets/high/rooms/art', a.file)), a.file).toBe(true);
      expect(a.title && a.artist && a.date).toBeTruthy();
    }
  });
  it('orders paintings per seed deterministically without repeats', () => {
    const a = artOrder('s1|feed'); const b = artOrder('s1|feed');
    expect(a.map((x) => x.file)).toEqual(b.map((x) => x.file));
    expect(new Set(a.map((x) => x.file)).size).toBe(ARTWORKS.length);
    expect(artOrder('s2|feed').map((x) => x.file)).not.toEqual(a.map((x) => x.file));
  });
});
