// node scripts/assets/mpfb-lock.mjs  -> scripts/assets/mpfb.lock.json: BLAKE3 of the MPFB add-on and every MakeHuman pack used, plus the per-asset author and licence read from the pack manifests.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, b3 } from './lib.mjs';
const dir = join(ROOT, 'assets/cache/mpfb'); const cfg = JSON.parse(readFileSync(join(ROOT, 'scripts/assets/figures/figures.json'), 'utf8'));
const archives = readdirSync(dir).filter((n) => n.endsWith('.zip')).sort().map((n) => { const buf = readFileSync(join(dir, n)); return { name: n, blake3: b3(buf), bytes: buf.length }; });
const manifests = {}; for (const n of readdirSync(join(ROOT, 'assets/cache/mh-assets/packs'))) Object.assign(manifests, JSON.parse(readFileSync(join(ROOT, 'assets/cache/mh-assets/packs', n), 'utf8')));
const used = [];
for (const f of cfg.figures) for (const [kind, name] of [['skins', f.skin], ['hair', f.hair], ['eyebrows', f.eyebrows], ['eyelashes', f.eyelashes], ['eyes', f.eyes], ...f.clothes.map((c) => ['clothes', c])]) {
  if (used.some((u) => u.name === name && u.kind === kind)) continue; const m = manifests[name];
  const mhclo = join(ROOT, 'assets/cache/mh-assets', kind === 'skins' ? 'skins' : kind, name, `${name}.mhclo`); let lic = m?.license; let author = m?.author;
  if (!lic && existsSync(mhclo)) { const t = readFileSync(mhclo, 'utf8'); lic = /^# license (.+)$/m.exec(t)?.[1]; author ??= /^# author (.+)$/m.exec(t)?.[1]; }
  if (kind === 'eyes') { lic ??= 'CC0'; author ??= 'MakeHuman system assets'; }
  if (!lic || !/CC0/i.test(lic)) throw new Error(`license of ${kind}/${name} is not verifiably CC0 (${lic})`);
  used.push({ name, kind, author: author || 'MakeHuman community', license: lic });
}
writeFileSync(join(ROOT, 'scripts/assets/mpfb.lock.json'), JSON.stringify({ version: 1, mpfb: { version: '2.0.18', source: 'https://extensions.blender.org/add-ons/mpfb/', license: 'GPL-3.0-or-later (build tool only)' }, archives, used }, null, 1) + '\n'); console.log('locked', archives.length, 'archives,', used.length, 'assets');
