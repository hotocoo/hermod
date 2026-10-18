// Download pinned CC0 sources into assets/cache and verify BLAKE3 against assets.lock.json.
// First sight of an asset resolves URLs from the Poly Haven API and writes the lock; afterwards the lock is authoritative.
// Usage: node scripts/assets/fetch.mjs [--only id,id] [--update]
import { MODELS, MATERIALS, HDRIS } from './catalog.mjs';
import { API, CACHE, b3, ensureDir, exists, getBuf, getJson, join, md5, pool, readFile, readLock, writeFile, writeLock } from './lib.mjs';

const args = process.argv.slice(2);
const only = args.includes('--only') ? new Set(args[args.indexOf('--only') + 1].split(',')) : null;
const lock = readLock();
const RES = ['1k', '2k', '4k', '8k'];
const need = (px) => { const want = RES.find((r) => parseInt(r) * 1024 >= px) || '4k'; return want; };
const pick = (avail, want) => (avail[want] ? want : RES.filter((r) => avail[r]).sort((a, b) => Math.abs(parseInt(a) - parseInt(want)) - Math.abs(parseInt(b) - parseInt(want)))[0]);

async function planModel(e) {
  const [files, info] = await Promise.all([getJson(`${API}/files/${e.id}`), getJson(`${API}/info/${e.id}`)]);
  const res = pick(files.gltf, need(e.px[1]));
  const g = files.gltf[res].gltf;
  const f = { [`${e.id}.gltf`]: { url: g.url, md5: g.md5 } };
  for (const [k, v] of Object.entries(g.include)) f[k] = { url: v.url, md5: v.md5 };
  return { type: 'model', res, page: `https://polyhaven.com/a/${e.id}`, authors: Object.keys(info.authors || {}), files: f };
}
async function planMaterial(e) {
  const files = await getJson(`${API}/files/${e.id}`); const info = await getJson(`${API}/info/${e.id}`);
  const dif = files.Diffuse || files.col_1;
  const res = pick(dif, need(e.px[1]));
  const f = {};
  const add = (name, node) => { const j = node[res]?.jpg; if (j) f[name] = { url: j.url, md5: j.md5 }; };
  add('diff.jpg', dif); add('nor.jpg', files.nor_gl);
  if (files.arm) add('arm.jpg', files.arm); else { add('rough.jpg', files.Rough); if (files.AO) add('ao.jpg', files.AO); }
  if (files.Displacement) add('disp.jpg', files.Displacement);
  return { type: 'material', res, tileM: +(info.dimensions[0] / 1000).toFixed(3), page: `https://polyhaven.com/a/${e.id}`, authors: Object.keys(info.authors || {}), files: f };
}
async function planHdri(e) {
  const files = await getJson(`${API}/files/${e.id}`); const info = await getJson(`${API}/info/${e.id}`);
  const res = pick(files.hdri, e.px[1]);
  const h = files.hdri[res].hdr;
  return { type: 'hdri', res, page: `https://polyhaven.com/a/${e.id}`, authors: Object.keys(info.authors || {}), files: { [`${e.id}.hdr`]: { url: h.url, md5: h.md5 } } };
}

const todo = [
  ...MODELS.map((e) => ({ e, plan: planModel })), ...MATERIALS.map((e) => ({ e, plan: planMaterial })), ...HDRIS.map((e) => ({ e, plan: planHdri })),
].filter((x) => !only || only.has(x.e.id));

let bytes = 0, fails = [];
await pool(todo, 4, async ({ e, plan }) => {
  try {
    let a = lock.assets[e.id];
    if (!a || args.includes('--update')) a = lock.assets[e.id] = { id: e.id, ...(await plan(e)) };
    if (a.type === 'material' && !a.tileM) a.tileM = +((await getJson(`${API}/info/${e.id}`)).dimensions[0] / 1000).toFixed(3);
    const dir = join(CACHE, a.type, e.id, a.res);
    for (const [name, f] of Object.entries(a.files)) {
      const p = join(dir, name);
      let buf = (await exists(p)) ? await readFile(p) : null;
      if (buf && f.blake3 && b3(buf) !== f.blake3) buf = null;
      if (!buf) {
        buf = await getBuf(f.url);
        if (f.md5 && md5(buf) !== f.md5) f.md5Note = 'API md5 differs from served bytes; BLAKE3 pinned';
        if (f.blake3 && b3(buf) !== f.blake3) throw new Error(`BLAKE3 mismatch ${e.id}/${name}: lock ${f.blake3}`);
        await ensureDir(join(p, '..')); await writeFile(p, buf); bytes += buf.length;
      }
      f.blake3 ||= b3(buf); f.size = buf.length;
    }
    process.stdout.write('.');
  } catch (err) { fails.push(`${e.id}: ${err.message}`); process.stdout.write('x'); }
});
const sorted = Object.fromEntries(Object.entries(lock.assets).sort(([a], [b]) => a.localeCompare(b)));
lock.assets = sorted; writeLock(lock);
console.log(`\ndownloaded ${(bytes / 1048576).toFixed(1)} MB, ${Object.keys(lock.assets).length} locked`);
if (fails.length) { console.error('FAILED:\n' + fails.join('\n')); process.exit(1); }
