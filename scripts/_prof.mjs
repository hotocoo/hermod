import { chromium } from 'playwright';
const b=await chromium.launch({args:['--ignore-gpu-blocklist','--use-angle=metal']});const p=await b.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});
await p.goto('http://localhost:3237/perf');await p.waitForFunction(()=>window.__town);await p.evaluate(()=>window.__perf.ready);
await p.evaluate(()=>{window.__prof={};window.__town.setQuality('high');window.__town.setSpace({id:'t',sections:['chat','hearth','feed','board','skein','desk','arcade'],online:6,tier:3})});await p.waitForTimeout(30000);
for (const id of ['chat','desk']){await p.evaluate(()=>window.__town.leave());await p.waitForTimeout(1000);
await p.evaluate(i=>window.__town.approach(i),id);await p.waitForTimeout(1500);await p.evaluate(i=>new Promise(r=>{window.__town.enter(i,r);setTimeout(r,15000)}),id);await p.waitForTimeout(3000);
const r=await p.evaluate(()=>new Promise(res=>{const a=[];let n=0;const f=()=>{a.push({...window.__prof,t:performance.now()});if(++n<600)requestAnimationFrame(f);else res(a)};requestAnimationFrame(f)}));
const ms=r.map(x=>x.renderMs).sort((x,y)=>x-y);const fr=r.slice(1).map((x,i)=>x.t-r[i].t).sort((x,y)=>x-y);
console.log(id,'over20:',fr.filter(v=>v>20).length,'over33:',fr.filter(v=>v>33).length,'worst',fr.slice(-5).map(v=>v.toFixed(0)).join(','),'renderMs med',ms[300].toFixed(1),'max',ms[599].toFixed(1),'frame med',fr[300].toFixed(1),'p99',fr[594].toFixed(1),'calls',r[0].calls,'tris',r[0].tris,'programs',r[0].programs)}
await b.close();
