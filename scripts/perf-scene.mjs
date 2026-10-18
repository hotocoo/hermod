#!/usr/bin/env node
// Dev-only scene frame-time harness (never part of the production export: /perf is a dev.tsx page). Serves the app (or uses --url), opens /perf in Chromium
// at 1x render scale and records every scene for --ms while a synthetic pointer drag orbits the camera, then writes JSON (+ optional screenshots).
//   npm run perf:scene [-- --quality=high,ultra --ms=20000 --scene=island-t5-night --style=village,sanctuary --url=http://localhost:3000 --out=perf-results --shots=perf-results/shots]
import { spawn } from 'node:child_process';
import { loadavg } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k, d) => (process.argv.find((a) => a.startsWith('--' + k + '=')) || '').split('=')[1] ?? d;
const qualities = arg('quality', 'high,ultra').split(','); const ms = +arg('ms', '20000'); const only = arg('scene', ''); const out = arg('out', 'perf-results'); const shots = arg('shots', '');
let url = arg('url', ''); const port = +arg('port', '3231');

const load0 = loadavg()[0];
if (load0 > 8) console.warn(`warning: load average ${load0.toFixed(1)} (> 8): frame times will be noisy, rerun when the machine is quiet`);

let server = null;
const up = async (u) => { try { return (await fetch(u + '/perf')).ok; } catch { return false; } };
if (!url) {
  // reuse a dev server that is already running (next refuses a second one in the same dir), else start one
  for (const u of ['http://localhost:3100', 'http://localhost:3000']) if (await up(u)) { url = u; break; }
  if (!url) {
    server = spawn('npx', ['next', 'dev', '-p', String(port)], { stdio: 'ignore', detached: false }); url = `http://localhost:${port}`;
    for (let i = 0; i < 80 && !(await up(url)); i++) await new Promise((r) => setTimeout(r, 750));
  }
}
if (shots) mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--use-angle=metal', '--enable-gpu-rasterization', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const styles = arg('style', 'village,sanctuary').split(','); const results = [];
for (const style of styles) {
  // one fresh page per map style: ?style= picks the style of the first build, whose boot precompile (window.__perf.ready) is waited for before anything is recorded
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.on('console', (m) => { const t = m.text(); if (t.startsWith('[spike]') || t.startsWith('[prep]') || t.startsWith('[still]')) console.log(`[${style}] ` + t.slice(0, 260)); });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(url + '/perf?style=' + style, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__perf, null, { timeout: 180000 }); await page.evaluate(() => window.__perf.ready);
  const scenes = await page.evaluate(() => window.__perf.scenes);
  for (const quality of qualities) {
    for (const scene of scenes) {
      if (only && scene !== only) continue;
      const load = loadavg()[0]; const r = await page.evaluate(([s, m, q]) => window.__perf.run(s, m, q), [scene, ms, quality]);
      if (shots) await page.screenshot({ path: `${shots}/${style}-${scene}-${quality}.png` });
      // 60 Hz display: a perfect run reads 59.5 (16.8 ms) at the 1% mark
      const pass = r.low1pctFps >= 59; results.push({ ...r, style, pass, loadAvg: +load.toFixed(1), noisy: load > 8 });
      console.log(`${pass ? 'PASS' : 'FAIL'} ${style.padEnd(9)} ${scene.padEnd(18)} ${quality.padEnd(6)} avg ${r.avgFps} fps, 1% low ${r.low1pctFps} fps (spikes ${JSON.stringify(r.spikes)} p99 ${r.p99Ms} ms, max ${r.maxMs} ms, gi settle ${r.giSettleMs} ms, load ${load.toFixed(1)}${load > 8 ? ' NOISY' : ''})`);
    }
  }
  await page.close();
}
mkdirSync(out, { recursive: true }); const file = `${out}/scene-${styles.join('+')}-${Date.now()}.json`;
writeFileSync(file, JSON.stringify({ qualities, styles, ms, loadAvgStart: load0, loadAvgEnd: loadavg()[0], date: new Date().toISOString(), renderScale: 1, results }, null, 2)); console.log('wrote', file);
await browser.close(); server?.kill();
process.exit(results.every((r) => r.pass) ? 0 : 1);
