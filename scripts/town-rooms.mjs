#!/usr/bin/env node
// Live test in the real town (/perf page): for each section, approach + enter from the island, wait for the room, screenshot, record fps, leave.
// node scripts/town-rooms.mjs [--url http://localhost:3237] [--tier high|ultra] [--out dir] [--ms 8000]
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
const arg = (k, d) => (process.argv.find((a) => a.startsWith('--' + k + '=')) || '').split('=')[1] ?? d;
const url = arg('url', 'http://localhost:3237'); const tier = arg('tier', 'high'); const out = arg('out', 'town-rooms'); const ms = +arg('ms', '8000'); mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=metal', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const logs = []; page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/deprecated|removed|DevTools/.test(m.text())) logs.push(m.type() + ' ' + m.text().slice(0, 240)); }); page.on('pageerror', (e) => logs.push('pageerror ' + e.message));
await page.goto(`${url}/perf`, { waitUntil: 'load', timeout: 180000 }); await page.waitForFunction(() => window.__perf && window.__town, null, { timeout: 180000 }); await page.evaluate(() => window.__perf.ready);
await page.evaluate((t) => { window.__town.setQuality(t); window.__town.setSpace({ id: 'live-test', sections: ['chat', 'hearth', 'feed', 'board', 'skein', 'desk', 'arcade'], online: 6, tier: 3 }); }, tier); await page.waitForTimeout(6000);
const results = [];
for (const id of ['chat', 'feed', 'board', 'skein', 'desk', 'arcade']) {
  await page.evaluate(() => { window.__town.leave(); }); await page.waitForTimeout(1200);
  const before = logs.length;
  const t0 = Date.now(); await page.evaluate((i) => { window.__town.approach(i); }, id); await page.waitForTimeout(1800);
  await page.evaluate((i) => new Promise((res) => { window.__town.enter(i, res); setTimeout(res, 15000); }), id); await page.waitForTimeout(3500);
  const mode = await page.evaluate(() => window.__town.mode()); await page.screenshot({ path: `${out}/${id}-${tier}.png` });
  const fps = await page.evaluate((m) => new Promise((res) => { const a = []; let last = performance.now(); const t0 = last; const f = (n) => { a.push(n - last); last = n; if (n - t0 < m) requestAnimationFrame(f); else { a.shift(); const s = [...a].sort((x, y) => x - y); const avg = a.reduce((p, c) => p + c, 0) / a.length; const p99 = s[Math.floor(s.length * 0.99)]; res({ avg: +(1000 / avg).toFixed(1), low1: +(1000 / p99).toFixed(1), maxMs: +s[s.length - 1].toFixed(1) }); } }; requestAnimationFrame(f); }), ms);
  results.push({ id, mode, enterMs: Date.now() - t0, fps, logs: logs.slice(before) }); console.log(JSON.stringify(results.at(-1)));
}
writeFileSync(`${out}/results-${tier}.json`, JSON.stringify(results, null, 1)); await browser.close();
