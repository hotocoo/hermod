// Terrain map KTX2 encode via the native basisu CLI (ktx2-encoder wasm caps a source near 12 Mpix and fails on the 4096 PNGs).
// Source PNG (or WebP, converted to PNG by sharp first) -> resized to px (multiple of 4) -> basisu. normals: UASTC + linear, colour: ETC1S sRGB, orm/flow: ETC1S linear.
// Usage: node scripts/assets/ktx2-terrain.mjs [village|sanctuary ...] [--tier high|ultra] [--jobs 4]
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { ROOT } from './lib.mjs';

const run = promisify(execFile);
const TIERS = { high: 2048, ultra: 4096 };

/** Encode one map. kind: 'bc' | 'n' | 'orm' | 'flow' (anything else is linear data). Throws with basisu's output on failure. */
export async function encodeMap(src, dst, px, kind) {
  const t = mkdtempSync(join(tmpdir(), 'ktx2t-'));
  try {
    const meta = await sharp(src).metadata(); const sc = Math.min(1, px / Math.max(meta.width, meta.height)); const q4 = (n) => Math.max(4, Math.round((n * sc) / 4) * 4);
    const png = join(t, 'in.png'); await sharp(src).resize(q4(meta.width), q4(meta.height), { fit: 'fill', kernel: 'lanczos3' }).png().toFile(png);
    const a = ['-ktx2', '-mipmap', '-output_file', join(t, 'out.ktx2'), ...(kind === 'n' ? ['-uastc', '-uastc_level', '2', '-uastc_rdo_l', '1.5', '-ktx2_zstandard_level', '6', '-linear'] : ['-q', kind === 'bc' ? '180' : '150', '-comp_level', '2', ...(kind === 'bc' ? [] : ['-linear'])]), png];
    try { await run('basisu', a, { maxBuffer: 1 << 26 }); } catch (e) { throw new Error(`basisu failed for ${src}: ${String(e.stdout ?? '').slice(-400)}${e.message}`); }
    await run('cp', [join(t, 'out.ktx2'), dst]);
  } finally { rmSync(t, { recursive: true, force: true }); }
}

export async function encodeTerrain(maps, out, { palettes = null, tiers = Object.keys(TIERS), jobs = 4 } = {}) {
  const todo = [];
  for (const pal of readdirSync(maps).filter((n) => statSync(join(maps, n)).isDirectory() && (!palettes?.length || palettes.includes(n)))) {
    for (const tier of tiers) {
      const od = join(out, 'terrain', pal, tier); mkdirSync(od, { recursive: true });
      for (const f of readdirSync(join(maps, pal)).filter((n) => /_(bc|n|orm|flow)\.(png|webp)$/.test(n))) {
        const kind = f.match(/_(bc|n|orm|flow)\./)[1]; const dst = join(od, f.replace(/\.(png|webp)$/, '.ktx2')); const src = join(maps, pal, f);
        if (!existsSync(dst) || statSync(dst).mtimeMs < statSync(src).mtimeMs) todo.push({ src, dst, px: TIERS[tier], kind });
      }
    }
  }
  let done = 0, bad = 0;
  await Promise.all(Array.from({ length: jobs }, async () => { for (let j = todo.shift(); j; j = todo.shift()) { try { await encodeMap(j.src, j.dst, j.px, j.kind); process.stdout.write('t'); } catch (e) { bad++; console.error('\n' + e.message); } done++; } }));
  console.log(`\nterrain ktx2: ${done - bad} encoded, ${bad} failed`); if (bad) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = process.argv.slice(2); const opt = (k, d) => (a.includes(k) ? a[a.indexOf(k) + 1] : d); const tier = opt('--tier');
  await encodeTerrain(join(ROOT, '.cache/nature/maps'), join(ROOT, 'public/assets/nature'), { palettes: a.filter((x, i) => !x.startsWith('--') && !(a[i - 1] ?? '').startsWith('--')), tiers: tier ? [tier] : undefined, jobs: +opt('--jobs', 4) });
}
