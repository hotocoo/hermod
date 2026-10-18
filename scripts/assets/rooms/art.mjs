// npm run assets:art -> real public-domain paintings for the room frames and easels.
// Source: Art Institute of Chicago open access (CC0 images, https://www.artic.edu/open-access/public-domain). Ids are pinned below, bytes pinned by BLAKE3 in art.lock.json.
// Writes public/assets/high/rooms/art/<id>.jpg (at most 1024 px (IIIF serves 843 px wide)), art.lock.json (source url, blake3, credit) and src/scene/rooms/hifi/artworks.json (runtime list).
// Usage: node scripts/assets/rooms/art.mjs [--update]
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { b3, getJson } from '../lib.mjs';
// AIC asks API clients to identify themselves with an AIC-User-Agent header.
const UA = { 'AIC-User-Agent': 'hermod-assets (https://github.com/hotocoo/hermod)' };
const getBuf = async (u) => { const r = await fetch(u, { headers: UA }); if (!r.ok) throw new Error(`${r.status} ${u}`); return Buffer.from(await r.arrayBuffer()); };
const HERE = dirname(fileURLToPath(import.meta.url)); const ROOT = join(HERE, '../../..');
const OUT = join(ROOT, 'public/assets/high/rooms/art'); const LOCK = join(HERE, 'art.lock.json'); const LIST = join(ROOT, 'src/scene/rooms/hifi/artworks.json');
const IDS = [64818, 14598, 27992, 111436, 11723, 869, 4796, 56905, 90048, 28849, 5848, 84709, 76571, 44018, 28560, 69780, 16568];
const update = process.argv.includes('--update'); const lock = existsSync(LOCK) ? JSON.parse(readFileSync(LOCK, 'utf8')) : { license: 'CC0-1.0', source: 'Art Institute of Chicago open access', items: {} };
mkdirSync(OUT, { recursive: true });
for (const id of IDS) {
  let it = lock.items[id];
  if (!it || update) {
    const m = (await getJson(`https://api.artic.edu/api/v1/artworks/${id}?fields=id,title,artist_title,date_display,image_id,is_public_domain`)).data;
    if (!m.is_public_domain || !m.image_id) throw new Error(`art ${id} is not public domain`);
    const src = `https://www.artic.edu/iiif/2/${m.image_id}/full/843,/0/default.jpg`; const buf = await getBuf(src);
    it = lock.items[id] = { id, title: m.title, artist: m.artist_title ?? 'Unknown', date: m.date_display, page: `https://www.artic.edu/artworks/${id}`, src, srcBlake3: b3(buf) };
    const img = await sharp(buf).resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toBuffer(); const meta = await sharp(img).metadata();
    writeFileSync(join(OUT, `${id}.jpg`), img); Object.assign(it, { w: meta.width, h: meta.height, bytes: img.length, blake3: b3(img) });
  } else if (!existsSync(join(OUT, `${id}.jpg`))) throw new Error(`art ${id} missing on disk; run with --update to refetch`);
  else if (b3(readFileSync(join(OUT, `${id}.jpg`))) !== it.blake3) throw new Error(`art ${id} BLAKE3 mismatch`);
}
writeFileSync(LOCK, JSON.stringify(lock, null, 1) + '\n');
writeFileSync(LIST, JSON.stringify(IDS.map((id) => { const { title, artist, date, w, h } = lock.items[id]; return { file: `${id}.jpg`, title, artist, date, w, h }; }), null, 1) + '\n');
console.log(`art: ${IDS.length} paintings, ${(IDS.reduce((s, id) => s + lock.items[id].bytes, 0) / 1e6).toFixed(2)} MB`);
