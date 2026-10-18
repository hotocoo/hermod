import { chromium } from 'playwright';
const flags = process.argv[2] || '{}'; const hour = +process.argv[3] || 21.5; const expr = process.argv[4] || 'window.__winLights.debug()';
const b = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--use-angle=metal'] }); const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await p.addInitScript((f) => { window.__lfx = JSON.parse(f); }, flags);
p.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 700), (e.stack||'').slice(0,600)));
await p.goto('http://localhost:3100/perf', { waitUntil: 'load' }); await p.waitForFunction(() => window.__perf, null, { timeout: 180000 }); await p.evaluate(() => window.__perf.ready);
await p.evaluate(([h]) => { window.__noStill = true; return window.__perf.shot(h, 'clear', 'ultra'); }, [hour]); for (let i = 0; i < 12; i++) { await p.mouse.move(700 + i, 450); await p.waitForTimeout(250); }
console.log(JSON.stringify(await p.evaluate(expr)));
await b.close();
