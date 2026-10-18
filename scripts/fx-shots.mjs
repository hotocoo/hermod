#!/usr/bin/env node
// Dev-only: screenshots of weather and lighting states for visual checks. node scripts/fx-shots.mjs --url=http://localhost:3100 --out=dir --quality=ultra
// shots entries: [name, hour, weather, [az, el, dist, tx, ty, tz]?] (close-up camera); --style=village|sanctuary
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const arg = (k, d) => (process.argv.find((a) => a.startsWith('--' + k + '=')) || '').split('=')[1] ?? d;
const url = arg('url', 'http://localhost:3100'); const out = arg('out', 'fx'); const q = arg('quality', 'ultra'); mkdirSync(out, { recursive: true });
const b = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--use-angle=metal'] }); const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
if (arg('flags', '')) await p.addInitScript((f) => { window.__lfx = JSON.parse(f); }, arg('flags', ''));
const logs = []; p.on('console', (m) => logs.push(m.type() + ': ' + m.text())); p.on('pageerror', (e) => console.error('page error:', e.message));
await p.goto(url + '/perf', { waitUntil: 'load', timeout: 180000 }); await p.waitForFunction(() => window.__perf, null, { timeout: 180000 }); await p.evaluate(() => window.__perf.ready);
const shots = JSON.parse(arg('shots', '[["day",14,"clear"],["night",21.5,"clear"],["rain",14,"rain"],["snow",14,"snow"]]'));
const style = arg('style', ''); if (style) await p.evaluate((st) => window.__town.setMapStyle(st), style);
for (const [n, h, w, cam, pk] of shots) { await p.evaluate((k) => { if (window.__fxu) window.__fxu.pomK.value = k ?? 1; }, pk); await p.evaluate(([h, w, q, ns]) => { window.__noStill = ns; return window.__perf.shot(h, w, q); }, [h, w, q, !arg('idle', '')]); if (arg('zoom', '') || arg('rot', '')) await p.evaluate(([z, r]) => { if (z) window.__town.zoomBy(z); if (r) window.__town.rotateBy(r); }, [+arg('zoom', '0'), +arg('rot', '0')]);
  for (let i = 0; i < +arg('steps', '14'); i++) { if (!arg('idle', '')) await p.mouse.move(700 + (i % 9) * 3, 450); await p.waitForTimeout(250); } if (cam) await p.evaluate(([c]) => { window.__camOverride = c; }, [cam]); else await p.evaluate(() => { window.__camOverride = null; }); if (cam) await p.waitForTimeout(1500);
 await p.screenshot({ path: `${out}/${n}-${q}.png` }); console.log('shot', n); }
console.log(logs.filter((l) => /BVH|path tracer|error|warn|worker|spike/i.test(l)).filter((l) => !/404/.test(l)).slice(0, +arg('logs', '40')).join('\n')); await b.close();
