// Additive catalogs from other agents/tools: scripts/assets/extra/*.mjs exporting MODELS (same shape as catalog.mjs entries).
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './lib.mjs';
export async function loadExtra() {
  const d = join(ROOT, 'scripts/assets/extra'); if (!existsSync(d)) return [];
  const out = [];
  for (const f of readdirSync(d).filter((n) => n.endsWith('.mjs')).sort()) out.push(...((await import(pathToFileURL(join(d, f)).href)).MODELS ?? []));
  return out;
}
