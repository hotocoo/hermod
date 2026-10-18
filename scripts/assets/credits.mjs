// node scripts/assets/credits.mjs  -> assets/CREDITS.md from the manifest + lock (every shipped asset, author, licence, source page, BLAKE3 pins).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib.mjs';

const man = JSON.parse(readFileSync(join(ROOT, 'src/scene/assets/manifest.json'), 'utf8'));
const row = (e) => `| ${e.id} | ${e.source.authors.join(', ')} | ${e.source.license} | ${e.source.page} |`;
const head = '| id | author(s) | license | source |\n|---|---|---|---|';
const out = ['# Asset credits', '', 'Every shipped art asset is CC0-1.0 (public domain dedication) or authored in this repository. Sources are pinned by BLAKE3 in `scripts/assets/assets.lock.json` and `scripts/assets/mpfb.lock.json`.', ''];
const poly = Object.values(man.models).filter((m) => m.source.origin === 'polyhaven');
out.push('## Poly Haven models (CC0, https://polyhaven.com)', '', head, ...poly.map(row), '');
out.push('## Poly Haven materials and HDRIs (CC0)', '', head, ...Object.values(man.materials).map(row), ...Object.values(man.hdris).map(row), '');
out.push('## Authored in this repository (Blender, procedural; source textures CC0 Poly Haven)', '', ...Object.values(man.models).filter((m) => m.source.origin === 'blender').map((m) => `- ${m.id}`), '');
const mp = join(ROOT, 'scripts/assets/mpfb.lock.json');
if (existsSync(mp)) {
  const l = JSON.parse(readFileSync(mp, 'utf8'));
  out.push('## People (MakeHuman / MPFB2)', '', 'Figures are generated headlessly with the MPFB2 Blender add-on (code GPL-3.0-or-later, used only as a build tool, never shipped) and MakeHuman community asset packs. The exported meshes and textures are CC0: the MakeHuman project releases base mesh, targets and the `*_cc0` asset packs under CC0, and each used asset carries `license CC0` in its own `.mhclo` or in the pack manifest (verified at pin time, see below). Authors of used assets:', '');
  out.push('| asset | kind | author | license (per asset file) |', '|---|---|---|---|', ...l.used.map((u) => `| ${u.name} | ${u.kind} | ${u.author} | ${u.license} |`), '');
  out.push('Pinned archives:', '', '| archive | BLAKE3 | bytes |', '|---|---|---|', ...l.archives.map((a) => `| ${a.name} | ${a.blake3} | ${a.bytes} |`), '');
}
const al = join(ROOT, 'scripts/assets/rooms/art.lock.json'); // room paintings (scripts/assets/rooms/art.mjs)
if (existsSync(al)) { const art = JSON.parse(readFileSync(al, 'utf8')); out.push('## Room paintings (Art Institute of Chicago open access, CC0)', '', '| id | title | artist | date | source |', '|---|---|---|---|---|', ...Object.values(art.items).map((i) => `| ${i.id} | ${i.title} | ${i.artist} | ${i.date} | ${i.page} |`), ''); }
writeFileSync(join(ROOT, 'assets/CREDITS.md'), out.join('\n') + '\n'); console.log('wrote assets/CREDITS.md');
