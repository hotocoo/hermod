#!/usr/bin/env node
// Screenshots + frame times of the authored rooms via /dev/rooms (dev server). Native 1x resolution.
// node scripts/rooms-shots.mjs [--url http://localhost:3237] [--rooms chat,feed] [--tier high] [--out dir] [--ms 8000] [--online 6] [--w 1920 --h 1080] [--fps]
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
const arg = (k, d) => (process.argv.find((a) => a.startsWith('--' + k + '=')) || '').split('=')[1] ?? d;
const url = arg('url', 'http://localhost:3237'); const tier = arg('tier', 'high'); const out = arg('out', 'rooms-shots'); const ms = +arg('ms', '8000');
const W = +arg('w', '1920'), H = +arg('h', '1080'); const online = +arg('online', '6'); const fps = process.argv.includes('--fps');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=metal', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('pageerror', e.message)); page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('console', m.type(), m.text().slice(0, 300)); });
await page.goto(`${url}/dev/rooms?tier=${tier}&online=${online}`, { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => window.__rooms, null, { timeout: 180000 });
const rooms = arg('rooms', '') ? arg('rooms').split(',') : await page.evaluate(() => window.__rooms.rooms);
const results = [];
for (const id of rooms) {
  const t0 = Date.now();
  try { await page.evaluate(([i, o]) => window.__rooms.show(i, { online: o }), [id, online]); } catch (e) { console.error(id, 'FAILED', String(e).slice(0, 400)); continue; }
  await page.waitForTimeout(1500);
  const file = `${out}/${id}-${tier}.png`; await page.screenshot({ path: file }); const st = await page.evaluate(() => window.__rooms.stats());
  const r = { id, tier, build_ms: Date.now() - t0, stats: st }; if (fps) { r.fps = await page.evaluate((m) => window.__rooms.record(m), ms); r.pass = r.fps.low1pctFps >= 60; }
  console.log(JSON.stringify({ id, file, ...r.stats, fps: r.fps })); results.push(r);
}
writeFileSync(`${out}/results-${tier}.json`, JSON.stringify({ at: new Date().toISOString(), viewport: [W, H], results }, null, 1));
await browser.close();
