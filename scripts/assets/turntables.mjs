// npm run assets:turntables [-- --out dir --only id,id --jobs 3]: QA turntable stills (3 angles, Cycles) of every asset from its pinned source.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { MODELS } from './catalog.mjs';
import { BLENDER_MODELS } from './blender/catalog.mjs';
import { loadExtra } from './extra.mjs';
import { CACHE, ROOT, readLock } from './lib.mjs';

const args = process.argv.slice(2); const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const out = opt('--out', join(ROOT, 'qa/turntables')); const only = opt('--only') ? new Set(opt('--only').split(',')) : null; const jobsN = +opt('--jobs', 3);
mkdirSync(out, { recursive: true }); const lock = readLock(); const all = [...MODELS, ...BLENDER_MODELS, ...(await loadExtra())].filter((e) => !only || only.has(e.id));
const src = (e) => { const a = lock.assets[e.id]; if (!a) return null; const lm = join(CACHE, 'blender-lm', e.id, `${e.id}.glb`); const c = a.origin === 'blender' ? (e.figure ? join(CACHE, 'figures', `${e.id}.glb`) : join(CACHE, 'blender', e.id, `${e.id}.glb`)) : (e.lm || e.refine) && existsSync(lm) ? lm : join(CACHE, 'model', e.id, a.res, `${e.id}.gltf`); return existsSync(c) ? c : null; };
const jobs = all.map((e) => ({ id: e.id, file: src(e) })).filter((j) => j.file && !existsSync(join(out, `${j.id}_240.png`)));
let n = 0, bad = 0;
await new Promise((res) => {
  let active = 0; const next = () => {
    if (!jobs.length && !active) return res();
    while (active < jobsN && jobs.length) {
      const j = jobs.shift(); active++;
      const p = spawn(process.env.BLENDER || 'blender', ['-b', '--factory-startup', '-P', join(ROOT, 'scripts/assets/blender/turntable.py'), '--', j.file, out, j.id], { stdio: ['ignore', 'ignore', 'pipe'] });
      let e = ''; p.stderr.on('data', (d) => { e += d; }); p.on('close', (c) => { active--; n++; if (c) { bad++; console.error(j.id, e.slice(-200)); } process.stdout.write(c ? 'x' : '.'); next(); });
    }
  }; next();
});
console.log(`\n${n - bad}/${n} turntables in ${out}`);
