/* Brief 3A, stage 1: the wild and mantas rows, the ordinary wild count and
   the two copy buttons, through pool growth and a burst of crashes.
   WebGL2, headless. */
import { chromium } from '../lib/tools.mjs';
const O=('http://127.0.0.1:' + process.env.PORT);
const die=setTimeout(()=>{console.log('WATCHDOG');process.exit(3);},88000);
const b=await chromium.launch({executablePath:process.env.CHROME,
  args:['--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const p=await (await b.newContext({viewport:{width:412,height:915},deviceScaleFactor:1})).newPage();
p.setDefaultTimeout(30000); p.setDefaultNavigationTimeout(30000);
const errs=[]; p.on('pageerror',e=>errs.push(e.message.slice(0,160))); p.on('console',c=>{if(c.type()==='error')errs.push(c.text().slice(0,160));});
let bad=0; const ok=(n,c,x='')=>{if(!c)bad++;console.log((c?'  PASS  ':'  FAIL  ')+n+(x?'  ['+x+']':''));};
await p.goto(O+'/lab/manta/?tier=low&backend=webgl2&seed=7373',{waitUntil:'load'}).catch(e=>console.log('goto '+e.message));
await p.waitForFunction(()=>window.__labReady===true,null,{timeout:25000}).catch(()=>console.log('(no ready)'));
const r=await p.evaluate(async()=>{
  const L=window.__lab, S=window.__sim, M=L.mantas;
  L.pause();
  const frame=()=>new Promise(res=>requestAnimationFrame(()=>res()));
  const row=k=>{ const d=[...document.querySelectorAll('#rows dt')].find(e=>e.textContent.trim()===k); return d&&d.nextElementSibling?d.nextElementSibling.textContent:null; };
  const truth=()=>{ let o=0,d=0; for(const w of S.wild){ if(!w||!w.alive) continue; if(w.loose) d++; else o++; } return {o,d,t:S.params.wildCount}; };
  const wantWild=()=>{ const t=truth(); return 'wild '+t.o+' of '+t.t+'  ·  debris '+t.d; };
  const wantMantas=()=>M.drawn+' drawn  ·  capacity '+M.capacity+'  ·  1 instanced mesh';
  const out={ start:truth(), worstOrdinary:0, checks:[] };
  let steps=0;
  const run=async n=>{ for(let i=0;i<n;i++){ L.step(1/60); steps++; const t=truth(); if(t.o>out.worstOrdinary) out.worstOrdinary=t.o; if(t.o>t.t) out.over=(out.over||0)+1; if(i%10===9) await frame(); } };
  /* Rows refresh once every 60 steps: step to just after a refresh, then read.
     3E: the page's own 60-step count is not aligned with this harness's, and
     with a 5 s refill the ordinary count moves nearly every step, so running
     a fixed 60 read the truth up to 59 steps after the row was written. Now
     it steps one at a time until the row is actually rewritten (a mutation on
     its cell), then reads the truth at that same step. */
  const rollCell=[...document.querySelectorAll('#rows dt')].find(e=>e.textContent.trim()==='your colour').nextElementSibling;
  const mo=new MutationObserver(()=>{}); mo.observe(rollCell,{childList:true,characterData:true,subtree:true});
  const toRefresh=async()=>{ mo.takeRecords(); for(let i=0;i<70;i++){ L.step(1/60); steps++; const t=truth(); if(t.o>out.worstOrdinary) out.worstOrdinary=t.o; if(t.o>t.t) out.over=(out.over||0)+1; if(mo.takeRecords().length) return; if(i%10===9) await frame(); } };
  const check=async label=>{ await toRefresh();
    const mantas=row('mantas'), roll=row('your colour');
    out.checks.push({ label, mantas, wantMantas:wantMantas(), mantasOk:mantas===wantMantas(),
      wildOk:!!roll&&roll.indexOf(wantWild())>=0, wild:wantWild(), rollHead:roll&&roll.slice(0,60) }); };
  await check('start');
  /* Pool growth: a 3000-long train on the first bot. */
  const t0=S.rivals[0]; t0.dead=0; t0.followers.length=0;
  for(let i=0;i<3000;i++) t0.followers.push({x:t0.x+19*(i+1),z:t0.z,head:0,born:0,from:i%20});
  await check('after the pool grew');
  /* A burst of crashes: every living bot, then the big train. */
  for(const t of S.rivals) if(!(t.dead>0)) S.crash(t);
  await run(1); await check('after a burst of crashes');
  await run(240); await check('four seconds later');
  /* The copy buttons, read from the fallback box (no clipboard headless). */
  const grab=async id=>{ const box=document.getElementById('plain'); box.value='';
    try{ Object.defineProperty(navigator,'clipboard',{value:undefined,configurable:true}); }catch(e){}
    document.getElementById(id).click(); for(let k=0;k<20&&!box.value;k++) await frame(); return box.value; };
  const values=await grab('copyValues'), report=await grab('copy');
  out.copy={ valuesWild:values.indexOf(wantWild())>=0, valuesMantas:values.indexOf('mantas: '+wantMantas())>=0,
    reportWild:report.indexOf(wantWild())>=0, reportMantas:report.indexOf('mantas: '+wantMantas())>=0,
    oldWords:/wild alive|in 1 instanced mesh/.test(values+report) };
  out.steps=steps; out.target=S.params.wildCount;
  return out;
}).catch(e=>({error:e.message}));
console.log(JSON.stringify(r));
if(r.error) ok('the checks ran',false,r.error);
else {
  ok('at the start the ordinary wild count is at its target, not above it', r.start.o<=r.start.t, 'ordinary '+r.start.o+' of '+r.start.t+', debris '+r.start.d);
  for(const c of r.checks){
    ok('mantas row correct '+c.label, c.mantasOk, c.mantas);
    ok('wild row correct '+c.label, c.wildOk, c.wild);
  }
  ok('the ordinary wild count never exceeds its target', !r.over && r.worstOrdinary<=r.target, 'most '+r.worstOrdinary+' of '+r.target+' over '+r.steps+' steps');
  ok('Copy values carries the split', r.copy.valuesWild&&r.copy.valuesMantas, JSON.stringify(r.copy));
  ok('the Copy report carries the split', r.copy.reportWild&&r.copy.reportMantas&&!r.copy.oldWords, JSON.stringify(r.copy));
}
ok('no page errors', errs.length===0, JSON.stringify(errs.slice(0,3)));
console.log('rows failures: '+bad);
clearTimeout(die); await b.close(); process.exit(bad?1:0);
