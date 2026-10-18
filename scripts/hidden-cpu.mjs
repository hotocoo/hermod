#!/usr/bin/env node
// T-018 acceptance (docs/FEATURES.md): "Hidden window uses under 2% CPU". Dev-only, like perf-scene.mjs: opens /perf on the running dev server
// (or --url), lets the real town render, then measures whole-browser CPU (browser + GPU + renderer processes, from CDP SystemInfo) while the page is
// visible and again while it is hidden. Headless Chromium never reports a tab as hidden, so the hide is the page-visible contract itself:
// `document.hidden` / `visibilityState` are overridden and `visibilitychange` is dispatched, which is what the browser does for a minimized window.
// The town must cancel its frame loop on that event; the rAF count while hidden is asserted to be zero as well.
//   npm run perf:hidden [-- --quality=high --secs=10 --max=2 --url=http://localhost:3100 --out=perf-results]
import { loadavg } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k, d) => (process.argv.find((a) => a.startsWith('--' + k + '=')) || '').split('=')[1] ?? d;
const quality = arg('quality', 'high'); const secs = +arg('secs', '10'); const max = +arg('max', '2'); const out = arg('out', 'perf-results');
let url = arg('url', '');
const up = async (u) => { try { return (await fetch(u + '/perf')).ok; } catch { return false; } };
if (!url) for (const u of ['http://localhost:3100', 'http://localhost:3000']) if (await up(u)) { url = u; break; }
if (!url) { console.error('no dev server on :3100 or :3000; start `npm run dev` or pass --url'); process.exit(2); }
if (loadavg()[0] > 8) console.warn(`warning: load average ${loadavg()[0].toFixed(1)} (> 8): CPU shares are inflated by other work, rerun when quiet`);

const browser = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--use-angle=metal', '--enable-gpu-rasterization', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.goto(url + '/perf', { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => window.__perf, null, { timeout: 180000 }); await page.evaluate(() => window.__perf.ready);
await page.evaluate((q) => { window.__town.setQuality(q); window.__town.setClockMode('manual'); }, quality);
await page.waitForTimeout(4000);
// count rAF callbacks (the town's frame loop is the only rAF user on /perf once nothing records)
await page.evaluate(() => { window.__raf = 0; const r = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (cb) => r((t) => { window.__raf++; cb(t); }); });

const sys = await browser.newBrowserCDPSession();
const procs = async () => Object.fromEntries((await sys.send('SystemInfo.getProcessInfo')).processInfo.map((p) => [p.id, [p.type, p.cpuTime]]));
const measure = async () => {
  const [p0, t0, r0] = [await procs(), Date.now(), await page.evaluate(() => window.__raf)]; await page.waitForTimeout(secs * 1000); const [p1, t1, r1] = [await procs(), Date.now(), await page.evaluate(() => window.__raf)];
  const by = {}; let all = 0; for (const [id, [type, c]] of Object.entries(p1)) { const d = c - (p0[id]?.[1] ?? c); by[type] = +((by[type] ?? 0) + 100 * d / ((t1 - t0) / 1000)).toFixed(2); all += d; }
  return { cpuPct: +(100 * all / ((t1 - t0) / 1000)).toFixed(2), byProcess: by, frames: r1 - r0 };
};
const setHidden = (h) => page.evaluate((hide) => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hide }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hide ? 'hidden' : 'visible') });
  document.dispatchEvent(new Event('visibilitychange'));
}, h);

const visible = await measure();
// floor: a blank tab in a second browser of the same flags, so the idle cost of the browser and GPU processes is known and not blamed on the town
const fb = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--use-angle=metal', '--enable-gpu-rasterization'] }); await (await fb.newPage()).goto('about:blank');
const fs = await fb.newBrowserCDPSession(); const fsum = async () => (await fs.send('SystemInfo.getProcessInfo')).processInfo.reduce((a, p) => a + p.cpuTime, 0);
const [f0, ft0] = [await fsum(), Date.now()]; await page.waitForTimeout(secs * 1000); const floorPct = +(100 * ((await fsum()) - f0) / ((Date.now() - ft0) / 1000)).toFixed(2); await fb.close();
await setHidden(true); await page.waitForTimeout(1500); // let in-flight work drain
const hidden = await measure();
await setHidden(false); await page.waitForTimeout(1500);
const resumed = await page.evaluate(() => new Promise((res) => { const a = window.__raf; setTimeout(() => res(window.__raf - a), 1000); }));
const r = { quality, secs, visible, hidden, blankTabFloorPct: floorPct, framesAfterUnhide1s: resumed, maxPct: max, loadAvg: +loadavg()[0].toFixed(1), date: new Date().toISOString() };
const pass = visible.cpuPct > 20 && hidden.cpuPct < max && hidden.frames === 0 && resumed > 20;
console.log(JSON.stringify(r)); console.log(pass ? 'PASS' : 'FAIL', `visible ${visible.cpuPct}% (${visible.frames} frames), hidden ${hidden.cpuPct}% (${hidden.frames} frames, limit ${max}%), resumed ${resumed} frames/s`);
mkdirSync(out, { recursive: true }); writeFileSync(`${out}/hidden-cpu-${Date.now()}.json`, JSON.stringify({ ...r, pass }, null, 2));
await browser.close(); process.exit(pass ? 0 : 1);
