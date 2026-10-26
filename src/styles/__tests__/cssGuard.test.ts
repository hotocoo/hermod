import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** X-007 / W-007: type is rem (so text scaling reaches it) and horizontal sides are logical (so RTL mirrors). */
const SRC = join(__dirname, '..', '..');
/** Decorative display type at or above this size stays in px (hero numerals, intro mark, island sky label). */
const MAX_REM_PX = 40;
/** The one physical idiom allowed: horizontal centring with translateX. */
const CENTRE = /(^|[;{\s])left:\s*50%/;
const FONT_PX = /font-size:\s*([0-9.]+)px/g;
const PHYSICAL = /(^|[;{\s])(margin-left|margin-right|padding-left|padding-right|border-left|border-right|right|left)\s*:|text-align:\s*(left|right)|float:\s*(left|right)/;

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? cssFiles(p) : p.endsWith('.css') ? [p] : [];
  });
}

const files = cssFiles(SRC);

describe('stylesheets keep text scalable and sides logical', () => {
  it('finds the stylesheets', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('has no px font-size at or below the decorative threshold', () => {
    const bad = files.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(FONT_PX)].filter((m) => Number(m[1]) <= MAX_REM_PX).map((m) => `${f}: ${m[0]}`));
    expect(bad).toEqual([]);
  });

  it('has no physical left/right property outside the left:50% centring idiom', () => {
    const bad = files.flatMap((f) => readFileSync(f, 'utf8').split('\n').filter((l) => PHYSICAL.test(l) && !CENTRE.test(l)).map((l) => `${f}: ${l.trim().slice(0, 100)}`));
    expect(bad).toEqual([]);
  });
});
