// npm run assets:rooms -> baked shell + lightmap per room (Cycles) into public/assets/high/rooms (2K) and dist-assets/ultra/rooms (4K); src/scene/assets/rooms.json
// Needs assets/cache/proxy/*.glb (written by build.mjs, high tier) and src/scene/assets/manifest.json.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { CACHE, ROOT, b3 } from '../lib.mjs';

const BLENDER = process.env.BLENDER || 'blender'; const work = join(CACHE, 'rooms'); mkdirSync(work, { recursive: true });
const args = process.argv.slice(2); const only = args.includes('--only') ? new Set(args[args.indexOf('--only') + 1].split(',')) : null; const force = args.includes('--force');
const ex = spawnSync('npx', ['tsx', join(ROOT, 'scripts/assets/rooms/export.ts'), work], { cwd: ROOT, encoding: 'utf8' }); if (ex.status !== 0) { console.error(ex.stdout + ex.stderr); process.exit(1); }
const stampFile = join(work, 'stamps.json'); const stamps = existsSync(stampFile) ? JSON.parse(readFileSync(stampFile, 'utf8')) : {};
const man = {}; const manPath = join(ROOT, 'src/scene/assets/rooms.json');
for (const f of readdirSync(work).filter((n) => /^[a-z]+\.json$/.test(n) && n !== 'stamps.json' && n !== 'rooms.json')) {
  const section = f.replace('.json', ''); if (only && !only.has(section)) continue;
  const src = join(work, f); const bakePy = readFileSync(join(ROOT, 'scripts/assets/blender/room_bake.py')); const stamp = b3(Buffer.concat([readFileSync(src), bakePy]));
  const glb = join(work, `${section}.glb`); const lm = join(work, `${section}_lm4k.png`);
  if (force || stamps[section] !== stamp || !existsSync(glb) || !existsSync(lm)) {
    const r = spawnSync(BLENDER, ['-b', '--factory-startup', '-P', join(ROOT, 'scripts/assets/blender/room_bake.py'), '--', src, join(CACHE, 'proxy'), glb, lm, '4096'], { encoding: 'utf8', maxBuffer: 1 << 28 });
    if (r.status !== 0 || /Traceback/.test(r.stdout + r.stderr)) { console.error((r.stdout + r.stderr).split('\n').filter((l) => /Error|Traceback|File "/.test(l)).slice(0, 8).join('\n')); process.exit(1); }
    stamps[section] = stamp; process.stdout.write('+');
  }
  const out = {};
  for (const [tier, size, dir] of [['high', 2048, join(ROOT, 'public/assets/high/rooms')], ['ultra', 4096, join(ROOT, 'dist-assets/ultra/rooms')]]) {
    mkdirSync(dir, { recursive: true }); const g = readFileSync(glb); const l = await sharp(lm).resize(size, size, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toBuffer();
    writeFileSync(join(dir, `${section}.glb`), g); writeFileSync(join(dir, `${section}_lm.png`), l);
    const fmSrc = join(work, `${section}_fm4k.png`); const fmJson = join(work, `${section}_fm.json`); let fm = null; let fb = Buffer.alloc(0);
    if (existsSync(fmSrc) && existsSync(fmJson)) { fb = await sharp(fmSrc).resize(size, size, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toBuffer(); writeFileSync(join(dir, `${section}_fm.png`), fb); fm = { image: `rooms/${section}_fm.png`, ...JSON.parse(readFileSync(fmJson, 'utf8')) }; }
    out[tier] = { glb: `rooms/${section}.glb`, lightmap: `rooms/${section}_lm.png`, furniture: fm, bytes: g.length + l.length + fb.length, blake3: b3(Buffer.concat([g, l, fb])) };
  }
  man[section] = out;
}
writeFileSync(stampFile, JSON.stringify(stamps)); const prev = existsSync(manPath) ? JSON.parse(readFileSync(manPath, 'utf8')) : {};
writeFileSync(manPath, JSON.stringify({ ...prev, ...man }, null, 1) + '\n'); console.log('\nrooms baked:', Object.keys(man).join(', '));
