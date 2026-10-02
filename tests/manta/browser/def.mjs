/* Stage 1's own checks: the committed defaults, the scene clock, the step hook. */
import { chromium } from '../lib/tools.mjs';
import fs from 'fs'; import { PNG } from '../lib/tools.mjs';
const O=('http://127.0.0.1:' + process.env.PORT);
const KNOWN=/Instance dropped in popErrorScope/;
const isKnown=t=>KNOWN.test(String(t));
const die=setTimeout(()=>{console.log('WATCHDOG');process.exit(3);},85000);
let bad=0; const ok=(n,c,x='')=>{if(!c)bad++;console.log((c?'  PASS  ':'  FAIL  ')+n+(x?'  ['+x+']':''));};
const b=await chromium.launch({executablePath:process.env.CHROME,
  args:['--enable-unsafe-webgpu','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const ctx=await b.newContext({viewport:{width:412,height:915},deviceScaleFactor:1,
  permissions:['clipboard-read','clipboard-write']});
const p=await ctx.newPage(); p.setDefaultTimeout(30000); p.setDefaultNavigationTimeout(30000);
const errs=[],off=[],bad4=[];
p.on('console',c=>{if(c.type()==='error')errs.push(c.text().slice(0,200));});
p.on('pageerror',e=>errs.push('pageerror: '+(e.stack||e.message).slice(0,300)));
p.on('request',r=>{const u=r.url(); if(!u.startsWith(O)&&!/^(data|about|blob):/.test(u))off.push(u);});
p.on('response',r=>{if(r.status()>=400)bad4.push(r.status()+' '+r.url().replace(O,''));});
await p.goto(O+'/lab/manta/?tier=high',{waitUntil:'load'}).catch(e=>console.log('  goto '+e.message));
await p.waitForFunction(()=>window.__labReady===true,null,{timeout:25000}).catch(()=>console.log('  (no ready)'));
await p.waitForTimeout(5000);

/* 3A: the committed defaults come from params.js itself, not a list typed
   in several briefs ago (it still said cruise 170). Every drawer row must
   show its def, within half a step; the touch scheme shows a letter. */
const SPECS=[...fs.readFileSync(decodeURIComponent(new URL('../../../docs/lab/manta/params.js', import.meta.url).pathname),'utf8')
  .matchAll(/\{ key: '(\w+)',\s*label: '([^']+)',\s*def: ([-\d.e]+),[^}]*?step: ([-\d.e]+)/g)]
  .map(m=>({key:m[1],label:m[2],def:parseFloat(m[3]),step:parseFloat(m[4])}));
const WANT=SPECS.map(x=>x.label);
const same=list=>{ const bad=[]; for(const x of SPECS){ const row=list.find(l=>l.startsWith(x.label+': '));
    if(!row){bad.push(x.label+' missing');continue;} let v=row.slice(x.label.length+2).trim();
    const n=/^[ABC]$/.test(v)?'ABC'.indexOf(v):parseFloat(v);
    if(!(Math.abs(n-x.def)<=x.step/2+1e-9)) bad.push(row+' (def '+x.def+')'); }
  if(list.length!==SPECS.length) bad.push(list.length+' rows for '+SPECS.length+' specs'); return bad; };
console.log('  '+SPECS.length+' committed defaults read from params.js; burst cost interval def '+(SPECS.find(x=>x.key==='burstCost')||{}).def);

await p.click('#chip'); await p.click('#drawerToggle');
const shown=await p.evaluate(()=>[...document.querySelectorAll('#drawerList .srow')]
  .map(r=>r.querySelector('.sname').textContent+': '+r.querySelector('.sval').textContent));
console.log('  the drawer on a fresh load:'); shown.forEach(l=>console.log('    '+l));
ok('the drawer shows every committed default from params.js', same(shown).length===0, JSON.stringify(same(shown)));
ok('burst cost interval shows 1.00', shown.includes('burst cost interval: 1.00'), shown.find(l=>l.startsWith('burst cost'))||'missing');
const live=await p.evaluate(()=>{const {P,U}=window.__lab.params;
  return {fade:P.fade,stamp:P.stamp,sparkle:U.sparkle.value,ribbon:U.ribbon.value,
    whiteness:U.whiteness.value,plankton:U.plankton.value,bloomStrength:P.bloomStrength,
    bloomRadius:P.bloomRadius,flap:U.flap.value,antialias:P.antialias,player:P.player,
    marks:U.marks.value,bloomThreshold:P.bloomThreshold,grain:U.grain.value};});
console.log('  live values the render reads: '+JSON.stringify(live));
{ const byKey=Object.fromEntries(SPECS.map(x=>[x.key,x]));
  const miss=Object.entries({fade:live.fade,stamp:live.stamp,sparkle:live.sparkle,ribbon:live.ribbon,whiteness:live.whiteness,
    plankton:live.plankton,bloomStrength:live.bloomStrength,bloomRadius:live.bloomRadius,flap:live.flap,antialias:live.antialias,
    marks:live.marks,bloomThreshold:live.bloomThreshold,grain:live.grain})
    .filter(([k,v])=>byKey[k]&&!(Math.abs(v-byKey[k].def)<=1e-6)).map(([k,v])=>k+' '+v+' vs '+byKey[k].def);
  ok('the committed values reach the live uniforms', miss.length===0, JSON.stringify(miss)); }

/* Drag things away, Reset, and check it comes back to the committed values. */
await p.evaluate(()=>{document.querySelectorAll('#drawerList input').forEach(i=>{
  i.value=i.max; i.dispatchEvent(new Event('input',{bubbles:true}));});});
await p.waitForTimeout(200);
await p.click('#resetValues'); await p.waitForTimeout(400);
const afterReset=await p.evaluate(()=>[...document.querySelectorAll('#drawerList .srow')]
  .map(r=>r.querySelector('.sname').textContent+': '+r.querySelector('.sval').textContent));
ok('Reset returns to the committed values', same(afterReset).length===0, JSON.stringify(same(afterReset)));

await p.click('#copyValues');
const said=await p.waitForFunction(()=>{const t=document.getElementById('copyValues').textContent;
  return t!=='Copy values'?t:false;},null,{timeout:6000}).then(h=>h.jsonValue()).catch(()=>null);
const copied=await p.evaluate(async()=>{try{return await navigator.clipboard.readText();}catch(e){return 'FAIL';}});
{
  /* Copy values now carries the roll as a last line: the sliders alone do not
     say which colour was on screen. */
  const lines=copied.split('\n');
  const sliders=lines.filter(l=>WANT.some(w=>l.startsWith(w+': ')));
  const roll=lines.find(l=>l.startsWith('your colour: '))||'';
  ok('Copy values carries the committed values', same(sliders).length===0, String(said)+' :: '+JSON.stringify(same(sliders)));
  ok('Copy values records the colour that was rolled',
     /^your colour: [a-z]+ +\u00b7 +seed \d+$/.test(roll), roll);
  ok('Copy values carries the wild and debris split and the mantas line',
     lines.some(l=>/^wild \d+ of \d+  \u00b7  debris \d+/.test(l)) && lines.some(l=>/^mantas: \d+ drawn  \u00b7  capacity \d+  \u00b7  1 instanced mesh$/.test(l)),
     lines.slice(-3).join(' | '));
}

/* --- the scene clock and the step hook --- */
await p.evaluate(()=>window.__lab.pause());
await p.waitForTimeout(300);
async function frame (tag) {
  const path=(process.env.MANTA_OUT || '/tmp')+'/def-'+tag+'.png';
  await p.screenshot({path});
  return PNG.sync.read(fs.readFileSync(path));
}
function diff (a,c){const A=a.data,C=c.data,W=a.width,H=a.height;let n=0,tot=0;
  const y0=Math.round(H*0.14),y1=Math.round(H*0.55);
  for(let y=y0;y<y1;y++)for(let x=0;x<W;x++){const i=(y*W+x)*4;
    const d=Math.abs(A[i]-C[i])+Math.abs(A[i+1]-C[i+1])+Math.abs(A[i+2]-C[i+2]);
    if(d){n++;tot+=d;}}
  return {pct:100*n/(W*(y1-y0)), mean:tot/(W*(y1-y0))};}

const t0=await p.evaluate(()=>window.__lab.step(0));
const a=await frame('a');
const t0b=await p.evaluate(()=>window.__lab.step(0));
const c=await frame('b');
const still=diff(a,c);
console.log('  stepping by zero seconds twice: '+still.pct.toFixed(3)+'% of ocean pixels differ, mean '+still.mean.toFixed(4)+
  '   (scene time '+t0.toFixed(4)+' then '+t0b.toFixed(4)+')');
ok('one scene clock: a zero-second step renders the identical frame',
   still.pct===0, still.pct.toFixed(4)+'% differ — a shader is still on the wall clock');
const t1=await p.evaluate(()=>window.__lab.step(0.5));
const d2=diff(a,await frame('c'));
console.log('  stepping half a second: '+d2.pct.toFixed(1)+'% of ocean pixels differ, mean '+d2.mean.toFixed(2)+
  '   (scene time '+t1.toFixed(3)+')');
ok('the step hook advances the scene', d2.pct>1 && Math.abs(t1-t0b-0.5)<1e-6, d2.pct.toFixed(2)+'%, dt '+(t1-t0b).toFixed(4));

const stamp=await p.evaluate(()=>{const dts=[...document.querySelectorAll('#rows dt')],
  dds=[...document.querySelectorAll('#rows dd')];
  const i=dts.findIndex(d=>d.textContent==='build'); return i<0?null:dds[i].textContent;});
console.log('  build stamp: '+stamp);
/* The stamp has to move with every commit that changes the page. 1G's two
   commits both left it reading 2026-09-22 08:45 UTC, so this is now a check
   and not a reminder: SESSION_AFTER is passed in from the shell. */
const after=process.env.SESSION_AFTER||'';
const stampMs=Date.parse(String(stamp).replace(' UTC','Z').replace(' ','T'));
const afterMs=Date.parse(after.replace(' UTC','Z').replace(' ','T'));
console.log('  the stamp reads '+stamp+'; this session began '+after);
ok('the build stamp is no older than this session',
   isFinite(stampMs) && isFinite(afterMs) && stampMs>=afterMs,
   String(stamp)+' against '+after);

/* A reload shows the committed values too. */
await p.reload({waitUntil:'load'});
await p.waitForFunction(()=>window.__labReady===true,null,{timeout:25000}).catch(()=>{});
await p.waitForTimeout(4000);
await p.click('#chip'); await p.click('#drawerToggle');
const afterLoad=await p.evaluate(()=>[...document.querySelectorAll('#drawerList .srow')]
  .map(r=>r.querySelector('.sname').textContent+': '+r.querySelector('.sval').textContent));
ok('a reload shows the committed values', same(afterLoad).length===0, JSON.stringify(same(afterLoad)));

{const k=errs.filter(isKnown), real=errs.filter(t=>!isKnown(t));
   if(k.length) console.log('  (known environment artefact, '+k.length+'x: Instance dropped in popErrorScope)');
   ok('no console errors', real.length===0, JSON.stringify([...new Set(real)]).slice(0,300));}
ok('no non-200', bad4.length===0, JSON.stringify(bad4));
ok('off-origin zero', off.length===0, JSON.stringify(off));
const ov=await p.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
ok('no horizontal overflow', ov<=0, String(ov));
console.log('\ndef failures: '+bad);
clearTimeout(die); await b.close(); process.exit(bad?1:0);
