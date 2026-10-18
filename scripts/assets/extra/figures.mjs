// Rigged people (MakeHuman / MPFB2, CC0 asset packs). Specs live in scripts/assets/figures/figures.json; built by blender/figures.py.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const cfg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../figures/figures.json'), 'utf8'));
export const MODELS = cfg.figures.map((f) => ({
  id: f.id, cat: 'figure', px: [1024, 2048], tags: ['figure', 'person'], origin: 'blender', script: 'scripts/assets/blender/figures.py', hero: true,
  figure: { clips: cfg.clips, seatHeight: 0.45 }, noLod: true,
}));
