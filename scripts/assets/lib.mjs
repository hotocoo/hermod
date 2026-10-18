import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex } from '@noble/hashes/utils.js';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const CACHE = join(ROOT, 'assets/cache');
export const LOCK = join(ROOT, 'scripts/assets/assets.lock.json');
export const API = 'https://api.polyhaven.com';

export const b3 = (buf) => bytesToHex(blake3(buf));
export const md5 = (buf) => createHash('md5').update(buf).digest('hex');
export const readLock = () => (existsSync(LOCK) ? JSON.parse(readFileSync(LOCK, 'utf8')) : { version: 1, source: 'polyhaven', license: 'CC0-1.0', assets: {} });
export const writeLock = (l) => writeFileSync(LOCK, JSON.stringify(l, null, 1) + '\n');

export async function getJson(url, tries = 4) {
  for (let i = 0; ; i++) {
    try { const r = await fetch(url); if (!r.ok) throw new Error(`${r.status} ${url}`); return await r.json(); }
    catch (e) { if (i >= tries) throw e; await new Promise((s) => setTimeout(s, 800 * (i + 1))); }
  }
}
export async function getBuf(url, tries = 4) {
  for (let i = 0; ; i++) {
    try { const r = await fetch(url); if (!r.ok) throw new Error(`${r.status} ${url}`); return Buffer.from(await r.arrayBuffer()); }
    catch (e) { if (i >= tries) throw e; await new Promise((s) => setTimeout(s, 800 * (i + 1))); }
  }
}
/** Run async fn over items with bounded concurrency. */
export async function pool(items, n, fn) {
  const q = [...items]; const out = [];
  await Promise.all(Array.from({ length: n }, async () => { for (let it; (it = q.shift());) out.push(await fn(it)); }));
  return out;
}
export const ensureDir = (p) => mkdir(p, { recursive: true });
export async function exists(p) { try { await stat(p); return true; } catch { return false; } }
export { readFile, writeFile, join };
