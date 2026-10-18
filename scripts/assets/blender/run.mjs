// Blender stage. node scripts/assets/blender/run.mjs [--only id,id] [--force]
//  1. author: procedural hero assets (BLENDER_MODELS + scripts/assets/extra/*.mjs entries with origin:'blender') -> assets/cache/blender/<id>/<id>.glb
//  2. lightmap: static-furniture AO into UV1 for catalog entries flagged lm -> assets/cache/blender-lm/<id>/<id>.glb
// Everything is keyed by BLAKE3 of (script + args + inputs), recorded in assets.lock.json, and skipped when unchanged. Blender pinned via BLENDER env or PATH.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { MODELS } from '../catalog.mjs';
import { BLENDER_MODELS } from './catalog.mjs';
import { loadExtra } from '../extra.mjs';
import { CACHE, ROOT, b3, readLock, writeLock } from '../lib.mjs';

const args = process.argv.slice(2); const only = args.includes('--only') ? new Set(args[args.indexOf('--only') + 1].split(',')) : null; const force = args.includes('--force');
const BLENDER = process.env.BLENDER || 'blender'; const EXPECT = '5.2';
const v = spawnSync(BLENDER, ['--version'], { encoding: 'utf8' });
if (v.status !== 0) { console.error('blender not found (set BLENDER=/path/to/blender)'); process.exit(1); }
const ver = /Blender (\d+\.\d+\.\d+)/.exec(v.stdout)?.[1]; if (!ver?.startsWith(EXPECT)) console.warn(`warning: Blender ${ver}, pipeline pinned to ${EXPECT}.x`);

const lock = readLock(); const extra = await loadExtra();
const authored = [...BLENDER_MODELS, ...extra.filter((e) => e.origin === 'blender')];
const sh = (p) => b3(readFileSync(p));
const common = sh(join(ROOT, 'scripts/assets/blender/common.py'));
const run = (script, a, env = {}) => { const r = spawnSync(BLENDER, ['-b', '--factory-startup', '-P', script, '--', ...a], { encoding: 'utf8', maxBuffer: 1 << 28, env: { ...process.env, ...env } }); const bad = r.status !== 0 || /Traceback|Error:/.test(r.stdout + r.stderr); if (bad) { console.error((r.stdout + r.stderr).split('\n').filter((l) => /Error|Traceback|File "/.test(l)).slice(0, 8).join('\n')); throw new Error(`blender failed: ${script} ${a[0]}`); } };

let n = 0;
for (const e of authored) {
  if (only && !only.has(e.id)) continue;
  const script = join(ROOT, e.script ?? 'scripts/assets/blender/author.py'); const out = join(CACHE, 'blender', e.id, `${e.id}.glb`);
  const px = e.bake ?? e.px[1];
  const figCfg = e.figure ? sh(join(ROOT, 'scripts/assets/figures/figures.json')) : null;
  const key = b3(Buffer.from(JSON.stringify([e.id, px, figCfg, sh(script), common, lock.assets['brown_leather']?.files?.['diff.jpg']?.blake3, ver])));
  const cur = lock.assets[e.id];
  if (!force && cur?.key === key && existsSync(out)) continue;
  mkdirSync(dirname(out), { recursive: true }); run(script, [e.id, out, ROOT, String(px)], e.figure ? { BLENDER_USER_RESOURCES: join(CACHE, 'blender-home') } : {});
  const h = sh(out);
  lock.assets[e.id] = { id: e.id, type: 'model', origin: 'blender', res: 'authored', page: 'procedural (scripts/assets/blender/author.py)', authors: ['Hermod'], license: 'CC0-1.0 (authored here; source textures CC0 Poly Haven)', key, outBlake3: h, files: { [`${e.id}.glb`]: { blake3: h } } };
  process.stdout.write('+'); n++;
}
// lightmap pass for flagged imported furniture
for (const e of MODELS.filter((m) => m.lm || m.refine)) {
  if (only && !only.has(e.id)) continue; const a = lock.assets[e.id]; if (!a) continue;
  const script = join(ROOT, 'scripts/assets/blender/lightmap.py'); const src = join(CACHE, 'model', e.id, a.res, `${e.id}.gltf`); const out = join(CACHE, 'blender-lm', e.id, `${e.id}.glb`);
  const px = e.px[1] >= 4096 ? 1024 : 512; const flags = [e.lm && 'lm', e.refine && 'refine'].filter(Boolean).join(',');
  const key = b3(Buffer.from(JSON.stringify([e.id, px, flags, sh(script), common, Object.values(a.files).map((f) => f.blake3), ver])));
  if (!force && a.lmKey === key && existsSync(out)) continue;
  mkdirSync(dirname(out), { recursive: true }); run(script, [src, out, String(px), ROOT, flags]);
  a.lmKey = key; a.lmBlake3 = sh(out); process.stdout.write('L'); n++;
}
writeLock(lock); console.log(`\nblender: ${n} built`);
