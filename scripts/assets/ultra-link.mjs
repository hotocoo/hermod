#!/usr/bin/env node
// Dev/test access to the ultra asset pack without hand-made symlinks.
// The app loads ultra files from /assets/ultra/ (src/scene/assets/loader.ts DEFAULT_BASE). In a release the pack is downloaded and cached by the app;
// in a checkout it lives in dist-assets/ultra (written by `npm run assets:build`, or unpacked from dist-assets/hermod-assets-ultra-<version>.zip).
// This links public/assets/ultra -> ../../dist-assets/ultra so the dev server (and perf/e2e scripts) serve it. Idempotent; the link is git-ignored.
//   node scripts/assets/ultra-link.mjs            create the link if absent (exit 0 when it already works)
//   node scripts/assets/ultra-link.mjs --unlink   remove the link (never touches dist-assets)
//   node scripts/assets/ultra-link.mjs --unpack   unzip dist-assets/hermod-assets-ultra-*.zip into dist-assets/ultra first when the folder is missing (needs `unzip`)
import { existsSync, lstatSync, readdirSync, readlinkSync, rmSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT } from './lib.mjs';
const link = join(ROOT, 'public/assets/ultra'); const target = join(ROOT, 'dist-assets/ultra'); const rel = '../../dist-assets/ultra';
const has = (p) => { try { return lstatSync(p); } catch { return null; } };
if (process.argv.includes('--unlink')) {
  const st = has(link); if (!st) { console.log('ultra-link: nothing to remove'); process.exit(0); }
  if (!st.isSymbolicLink()) { console.error(`ultra-link: ${link} is a real directory, not removing it`); process.exit(1); }
  rmSync(link); console.log('ultra-link: removed'); process.exit(0);
}
if (!existsSync(join(target, 'rooms')) && process.argv.includes('--unpack')) {
  const zip = readdirSync(join(ROOT, 'dist-assets')).filter((n) => /^hermod-assets-ultra-.*\.zip$/.test(n)).sort().at(-1);
  if (!zip) { console.error('ultra-link: no dist-assets/hermod-assets-ultra-*.zip to unpack'); process.exit(1); }
  const r = spawnSync('unzip', ['-q', '-o', join(ROOT, 'dist-assets', zip), '-d', target], { stdio: 'inherit' }); if (r.status !== 0) process.exit(r.status ?? 1);
}
if (!existsSync(join(target, 'rooms'))) { console.error('ultra-link: dist-assets/ultra is missing. Build it (npm run assets:build) or run with --unpack to extract dist-assets/hermod-assets-ultra-*.zip.'); process.exit(1); }
const st = has(link);
if (st) {
  if (st.isSymbolicLink() && readlinkSync(link) === rel && existsSync(join(link, 'rooms'))) { console.log('ultra-link: already linked'); process.exit(0); }
  console.error(`ultra-link: ${link} exists and is not the expected link, leaving it alone`); process.exit(1);
}
symlinkSync(rel, link, 'dir'); console.log(`ultra-link: ${link} -> ${rel}`);
