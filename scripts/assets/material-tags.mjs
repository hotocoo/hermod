// Material-tag pass (additive): assigns KHR_materials_*-style overrides per material name to manifest entries (`materialOverrides`),
// driven by scripts/assets/material-tags.json. Authored glTF extensions always win (rule skipIfExt). Idempotent; runs standalone or from build.mjs.
//   node scripts/assets/material-tags.mjs [--check]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib.mjs';

const RULES = JSON.parse(readFileSync(join(ROOT, 'scripts/assets/material-tags.json'), 'utf8')).rules.map((r) => ({ ...r, re: new RegExp(r.match), not: r.not ? new RegExp(r.not) : null }));
const MANIFESTS = ['manifest.json', 'nature.manifest.json', 'site.manifest.json'].map((f) => join(ROOT, 'src/scene/assets', f)).filter(existsSync);
const glbJson = (path) => { const b = readFileSync(path); const l = b.readUInt32LE(12); return JSON.parse(b.subarray(20, 20 + l).toString()); };
const indentOf = (f) => (/\n( +)"/.exec(readFileSync(f, 'utf8'))?.[1].length ?? 2);
const find = (file) => ['public/assets/high/', 'public/assets/', 'public/assets/ultra/'].map((d) => join(ROOT, d, file)).find(existsSync);

/** Overrides for one glTF material, or null. One rule per family (first wins); several families can combine (wood: clearcoat only; fabric: sheen only). */
export function tag(name, mat, cat, id = '') {
  const n = name.toLowerCase(); const nid = n + ' ' + id.toLowerCase(); const out = {}; const done = new Set(); const metal = mat?.pbrMetallicRoughness?.metallicFactor ?? 1; const ext = mat?.extensions ?? {};
  for (const r of RULES) {
    const sn = r.useId ? nid : n;
    if (done.has(r.family) || !r.re.test(sn) || (r.not && r.not.test(sn)) || (r.unless && r.unless.some((f) => done.has(f))) || (r.cat && !r.cat.includes(cat))) continue;
    if (r.metal && (metal < r.metal[0] || metal > r.metal[1])) continue;
    if (r.skipIfExt && ext['KHR_materials_' + r.skipIfExt]) { done.add(r.family); continue; }
    done.add(r.family); Object.assign(out, r.set);
  }
  return Object.keys(out).length ? out : null;
}

if (!process.env.VITEST) main();
function main() {
let total = 0, tagged = 0; const stats = {};
for (const mf of MANIFESTS) {
  const man = JSON.parse(readFileSync(mf, 'utf8')); if (!man.models) continue; let changed = false;
  for (const e of Object.values(man.models)) {
    const t = e.tiers.high || e.tiers.ultra; const p = t && find(t.file); if (!p) continue; total++;
    const ov = {}; for (const m of glbJson(p).materials ?? []) { if (!m.name) continue; const o = tag(m.name, m, e.category, e.id); if (o) { ov[m.name] = o; for (const k of Object.keys(o)) stats[k] = (stats[k] || 0) + 1; } }
    const had = JSON.stringify(e.materialOverrides ?? null); if (Object.keys(ov).length) { e.materialOverrides = ov; tagged++; } else delete e.materialOverrides;
    if (JSON.stringify(e.materialOverrides ?? null) !== had) changed = true;
  }
  if (changed && !process.argv.includes('--check')) writeFileSync(mf, JSON.stringify(man, null, indentOf(mf)) + '\n');
}
console.log(`material-tags: ${tagged}/${total} models tagged`, stats);
}
