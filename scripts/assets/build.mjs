// npm run assets:build  ->  fetch (pinned) -> [blender] -> convert -> manifest + ultra zip.
// Usage: node scripts/assets/build.mjs [--tier high|ultra|both] [--only id,id] [--force] [--jobs n]
import { spawn } from 'node:child_process';
import { cpus } from 'node:os';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { zipSync } from 'fflate';
import { MODELS, MATERIALS, HDRIS } from './catalog.mjs';
import { BLENDER_MODELS } from './blender/catalog.mjs';
import { loadExtra } from './extra.mjs';
import { ROOT, b3, readLock } from './lib.mjs';

const args = process.argv.slice(2); const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const tiers = { high: ['high'], ultra: ['ultra'], both: ['high', 'ultra'] }[opt('--tier', 'both')];
const only = opt('--only') ? new Set(opt('--only').split(',')) : null; const force = args.includes('--force');
const jobsN = +opt('--jobs', Math.max(1, cpus().length - 2));
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')); const lock = readLock();
const codeHash = b3(Buffer.concat(['build-one.mjs', 'gltf.mjs', 'catalog.mjs', 'blender/catalog.mjs', 'extra.mjs'].map((f) => readFileSync(join(ROOT, 'scripts/assets', f)))));

const EXTRA = await loadExtra();
const PRUNE = new Set(JSON.parse(readFileSync(join(ROOT, 'scripts/assets/prune.json'), 'utf8')).ids); // unreferenced catalog entries: not built, not shipped
const all = [...MODELS, ...BLENDER_MODELS, ...EXTRA, ...MATERIALS, ...HDRIS].filter((e) => !PRUNE.has(e.id)).map((e) => ({ e, a: lock.assets[e.id] }));
const items = all.filter((x) => !only || only.has(x.e.id));
for (const { e, a } of items) if (!a) throw new Error(`${e.id} not in lock: run npm run assets:fetch (or assets:blender)`);
const stamp = (e, a, tier) => b3(Buffer.from(JSON.stringify([e, tier, codeHash, Object.values(a.files).map((f) => f.blake3 ?? a.outBlake3), a.lmBlake3 ?? null])));
const fragPath = (id, tier) => join(ROOT, `.cache/manifest/${id}.${tier}.json`);
const jobs = [];
for (const { e, a } of items) for (const tier of tiers) {
  const st = stamp(e, a, tier); const fp = fragPath(e.id, tier);
  if (!force && existsSync(fp) && JSON.parse(readFileSync(fp, 'utf8')).stamp === st) continue;
  jobs.push({ id: e.id, tier, st });
}
console.log(`${jobs.length} jobs, ${jobsN} workers`);
const failed = [];
await new Promise((res) => {
  let active = 0;
  const next = () => {
    if (!jobs.length && !active) return res();
    while (active < jobsN && jobs.length) {
      const j = jobs.shift(); active++;
      const p = spawn('node', [join(ROOT, 'scripts/assets/build-one.mjs'), j.id, j.tier], { env: { ...process.env, ASSET_STAMP: j.st }, stdio: ['ignore', 'ignore', 'pipe'] });
      let err = ''; p.stderr.on('data', (d) => { err += d; });
      p.on('close', (code) => { active--; if (code) { failed.push(`${j.id}/${j.tier}: ${err.split('\n').filter((l) => /Error|error/.test(l)).slice(0, 3).join(' | ') || err.slice(-300)}`); } process.stdout.write(code ? 'x' : '.'); next(); });
    }
  };
  next();
});
console.log();
if (failed.length) { console.error('FAILED:\n' + failed.join('\n')); process.exit(1); }

// ---- manifest
const man = { version: 1, schema: 'hermod-assets/1', app: pkg.version, models: {}, materials: {}, hdris: {}, ultraPack: null };
for (const { e, a } of all) {
  const fr = Object.fromEntries(['high', 'ultra'].filter((t) => existsSync(fragPath(e.id, t))).map((t) => [t, JSON.parse(readFileSync(fragPath(e.id, t), 'utf8'))]));
  const base = fr.high || fr.ultra; if (!base) continue;
  const rest = { ...base }; delete rest.stamp; delete rest.tier; const tierInfo = {}; for (const t of Object.keys(fr)) tierInfo[t] = fr[t].tier ?? { file: fr[t].files, bytes: fr[t].bytes, hashes: fr[t].hashes };
  const group = a.type === 'model' ? man.models : a.type === 'material' ? man.materials : man.hdris;
  group[e.id] = { ...rest, tiers: tierInfo };
}
const dir = join(ROOT, 'src/scene/assets'); mkdirSync(dir, { recursive: true });

// ---- ultra zip (deterministic: fixed mtime, sorted entries)
const ultraDir = join(ROOT, 'dist-assets/ultra');
if (tiers.includes('ultra') && existsSync(ultraDir)) {
  const files = {}; const walk = (d) => { for (const n of readdirSync(d).sort()) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else files[relative(ultraDir, p)] = [readFileSync(p), { mtime: new Date('2020-01-01T00:00:00Z'), level: 0 }]; } }; walk(ultraDir);
  const zip = Buffer.from(zipSync(files)); const name = `hermod-assets-ultra-${pkg.version}.zip`;
  writeFileSync(join(ROOT, 'dist-assets', name), zip);
  man.ultraPack = { file: name, bytes: zip.length, blake3: b3(zip), url: `https://github.com/hotocoo/hermod/releases/download/v${pkg.version}/${name}` };
}
if (!man.ultraPack && existsSync(join(dir, 'manifest.json'))) man.ultraPack = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')).ultraPack ?? null;
{ const nm = join(dir, 'nature.manifest.json'); if (existsSync(nm)) { const j = JSON.parse(readFileSync(nm, 'utf8')); Object.assign(man.models, j.models); man.terrainSets = j.terrain; } } // nature + village sets (scripts/assets/nature-pack.mjs)
{ const sm = join(dir, 'site.manifest.json'); if (existsSync(sm)) Object.assign(man.models, JSON.parse(readFileSync(sm, 'utf8')).models); } // sanctuary set (scripts/assets/site-pack.mjs)
writeFileSync(join(dir, 'manifest.json'), JSON.stringify(man, null, 1) + '\n');
await import('./material-tags.mjs'); // material-tag pass: per-material clearcoat/sheen/anisotropy/transmission overrides (scripts/assets/material-tags.json)
const sum = (g, t) => Object.values(g).reduce((s, x) => s + (x.tiers[t]?.bytes ?? 0), 0);
const hi = sum(man.models, 'high') + sum(man.materials, 'high') + sum(man.hdris, 'high');
console.log(`high: models ${(sum(man.models, 'high') / 1e6).toFixed(1)} MB, materials ${(sum(man.materials, 'high') / 1e6).toFixed(1)} MB, hdris ${(sum(man.hdris, 'high') / 1e6).toFixed(1)} MB, total ${(hi / 1e6).toFixed(1)} MB (budget 260)`);
if (man.ultraPack) console.log(`ultra zip ${(man.ultraPack.bytes / 1e6).toFixed(1)} MB`);
