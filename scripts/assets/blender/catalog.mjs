// Procedurally authored hero assets (Blender, headless). Built by blender/run.mjs -> assets/cache/blender/<id>/<id>.glb.
// px = [high, ultra] texture edge; the bake is done at px[1] and the JS stage downsizes for the high tier.
// More entries (exterior buildings, trees, lamps, piers, stalls) can be added in scripts/assets/extra/*.mjs: export const MODELS = [{id, cat, px, tags, origin:'blender', script?, ...}].
const b = (id, cat, px, tags = [], o = {}) => ({ id, cat, px, tags, origin: 'blender', ...o });
const H = [2048, 4096];
// H1: ultra 4K, high 1K: tiling wood/stone/fabric sets on props that read at 1K from the room cameras (high-tier asset budget).
const H1 = [1024, 4096];
export const BLENDER_MODELS = [
  b('book_row_a', 'books', H, ['books', 'tabletop', 'clutter:shelf', 'clutter:desk', 'clutter:table']),
  b('book_row_b', 'books', H, ['books', 'tabletop', 'clutter:shelf', 'clutter:desk']),
  b('candle_taper_tall', 'light', [512, 1024], ['light', 'tabletop', 'clutter:table', 'clutter:mantel', 'clutter:shelf'], { bake: 1024, lights: [{ kind: 'flame', at: [0.5, 1.03, 0.5], n: 1 }] }),
  b('candle_taper_mid', 'light', [512, 1024], ['light', 'tabletop', 'clutter:table', 'clutter:mantel', 'clutter:shelf'], { bake: 1024, lights: [{ kind: 'flame', at: [0.5, 1.03, 0.5], n: 1 }] }),
  b('candle_stub', 'light', [512, 1024], ['light', 'tabletop', 'clutter:table', 'clutter:mantel', 'clutter:shelf', 'clutter:desk'], { bake: 1024, lights: [{ kind: 'flame', at: [0.5, 1.05, 0.5], n: 1 }] }),
  b('window_casement', 'structure', H1, ['window', 'wall-mount', 'hero'], { hero: true, lights: [{ kind: 'window', at: [0.5, 0.5, 0.5], n: 1 }] }),
  b('notice_board', 'art', H1, ['board', 'wall-mount', 'content-slot'], { hero: true, slots: { content: 'paint' } }),
  b('easel_gallery', 'art', H1, ['easel', 'floor', 'content-slot', 'art-slot'], { hero: true, slots: { canvas: 'paint' } }),
  b('rug_woven', 'decor', H, ['rug', 'floor'], {}),
  b('loom_warp_weighted', 'craft', H1, ['craft', 'floor', 'hero'], { hero: true }),
  b('hearth_stone', 'fire', H, ['fireplace', 'wall', 'hero'], { hero: true, lights: [{ kind: 'fire', at: [0.5, 0.15, 0.55], n: 1 }] }),
  b('log_pile', 'fire', [1024, 2048], ['logs', 'floor', 'clutter:hearth'], { bake: 2048 }),
];
