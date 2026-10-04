/* Stage 1 of 2B part five: every simulated manta is drawn, nothing solid is
   undrawn, and the pool grows. Five simulated minutes of ten growing bots,
   driven through the page's own drawing code (follow.js) without rendering,
   then the grown pool rendered for real. WebGL2, headless. */
import { chromium } from '../lib/tools.mjs';
const O=('http://127.0.0.1:' + process.env.PORT);
const die=setTimeout(()=>{console.log('WATCHDOG');process.exit(3);},88000);
const b=await chromium.launch({executablePath:process.env.CHROME,
  args:['--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const p=await (await b.newContext({viewport:{width:412,height:915},deviceScaleFactor:1})).newPage();
p.setDefaultTimeout(30000); p.setDefaultNavigationTimeout(30000);
const errs=[]; p.on('pageerror',e=>errs.push(e.message.slice(0,160))); p.on('console',c=>{if(c.type()==='error')errs.push(c.text().slice(0,160));});
let bad=0; const ok=(n,c,x='')=>{if(!c)bad++;console.log((c?'  PASS  ':'  FAIL  ')+n+(x?'  ['+x+']':''));};
await p.goto(O+'/lab/manta/?tier=low&backend=webgl2&seed=5151',{waitUntil:'load'}).catch(e=>console.log('goto '+e.message));
await p.waitForFunction(()=>window.__labReady===true,null,{timeout:25000}).catch(()=>console.log('(no ready)'));
await p.waitForTimeout(1500);

const run=await p.evaluate(()=>{
  const L=window.__lab, S=window.__sim, F=L.follower, M=L.mantas;
  L.pause();
  const key=(x,z)=>Math.round(x*4)*1e7+Math.round(z*4);
  let steps=0, mismatch=0, worstDiff=0, undrawnSolid=0, maxSim=0, maxLen=0, capStart=M.capacity;
  const firstBad=[];
  for (let i=0;i<18000;i++){
    S.step(); F.followCamera(1/60); steps++;
    let sim=0;
    if(!(S.you.dead>0)) sim+=1+S.you.followers.length;
    for(const t of S.rivals) if(!(t.dead>0)){ sim+=1+t.followers.length; if(t.followers.length>maxLen) maxLen=t.followers.length; }
    for(const w of S.wild) if(w&&w.alive) sim++;
    if(S.pink&&S.pink.alive) sim++;   // the pink manta (4A stage 4) is drawn in its own slot
    const n=M.drawn, P=M.aPos, drawn=new Set(); let d=0;
    for(let j=0;j<n;j++){ const x=P.getX(j); if(x!==M.PARKED){ d++; drawn.add(key(x,P.getZ(j))); } }
    if(d!==sim){ mismatch++; worstDiff=Math.max(worstDiff,Math.abs(d-sim)); if(firstBad.length<3) firstBad.push([i,sim,d]); }
    if(sim>maxSim) maxSim=sim;
    for(const t of [S.you,...S.rivals]){ if(t.dead>0) continue;
      /* The buffer holds 32-bit floats: compare what it can hold. */
      for(const q of [t,...t.followers]) if(!drawn.has(key(Math.fround(q.x),Math.fround(q.z)))) undrawnSolid++; }
  }
  return { steps, mismatch, worstDiff, undrawnSolid, maxSim, maxLen, capStart, capEnd:M.capacity, drawnEnd:M.drawn, firstBad };
}).catch(e=>({error:e.message}));
console.log(JSON.stringify(run));
if(run.error){ ok('the five-minute run completed',false,run.error); }
else {
  ok('simulated mantas equal drawn mantas, every step, for five simulated minutes', run.mismatch===0,
     run.steps+' steps, '+run.mismatch+' mismatched, worst '+run.worstDiff+'; most in the water '+run.maxSim+'; longest bot train '+run.maxLen);
  ok('no solid manta is ever undrawn', run.undrawnSolid===0, run.undrawnSolid+' undrawn leader or follower sightings');
}

/* The bot-count slider: fourteen bots (four past the fixed blocks), then
   six (four blocks left behind). Drawn must equal simulated throughout. */
const slider=await p.evaluate(()=>{
  const L=window.__lab, S=window.__sim, F=L.follower, M=L.mantas, out={};
  for (const [label,nb] of [['14 bots',14],['6 bots',6]]) {
    S.setBotCount(nb); let bad=0, worst=0;
    for (let i=0;i<1200;i++){ S.step(); F.followCamera(1/60);
      let sim=S.you.dead>0?0:1+S.you.followers.length; for(const t of S.rivals) if(!(t.dead>0)) sim+=1+t.followers.length; for(const w of S.wild) if(w&&w.alive) sim++;
    if(S.pink&&S.pink.alive) sim++;   // the pink manta (4A stage 4) is drawn in its own slot
      let d=0; for(let j=0;j<M.drawn;j++) if(M.aPos.getX(j)!==M.PARKED) d++;
      if(d!==sim){ bad++; worst=Math.max(worst,Math.abs(d-sim)); } }
    out[label]={ steps:1200, mismatched:bad, worst };
  }
  S.setBotCount(10); return out;
}).catch(e=>({error:e.message}));
console.log(JSON.stringify(slider));
ok('with the bot-count slider at 14 and then 6, drawn equals simulated every step',
   !slider.error && slider['14 bots'].mismatched===0 && slider['6 bots'].mismatched===0, JSON.stringify(slider));

/* The pool grows: a train of 3000, drawn in full and rendered. */
const grow=await p.evaluate(async()=>{
  const L=window.__lab, S=window.__sim, F=L.follower, M=L.mantas;
  const t=S.rivals.find(r=>!(r.dead>0)) || S.rivals[0]; t.dead=0;
  const before=M.capacity;
  t.followers.length=0; for(let i=0;i<3000;i++) t.followers.push({x:t.x+19*(i+1),z:t.z,head:0,born:0,from:i%20});
  F.followCamera(1/60);
  let sim=S.you.dead>0?0:1+S.you.followers.length; for(const r of S.rivals) if(!(r.dead>0)) sim+=1+r.followers.length; for(const w of S.wild) if(w&&w.alive) sim++;
    if(S.pink&&S.pink.alive) sim++;   // the pink manta (4A stage 4) is drawn in its own slot
  let d=0; for(let j=0;j<M.drawn;j++) if(M.aPos.getX(j)!==M.PARKED) d++;
  for(let k=0;k<4;k++){ L.step(1/60); await new Promise(r=>requestAnimationFrame(()=>r())); }
  const rows=[...document.querySelectorAll('#rows dt')].map(e=>[e.textContent,e.nextElementSibling?e.nextElementSibling.textContent:'']);
  const row=k=>{ const r=rows.find(x=>x[0].trim()===k); return r?r[1]:null; };
  const out={ before, after:M.capacity, drawn:M.drawn, sim, d, draws:row('draw calls'), passes:row('render passes'), vbuf:row('vertex buffers') };
  t.followers.length=0; F.followCamera(1/60); L.step(1/60);
  return out;
}).catch(e=>({error:e.message}));
console.log(JSON.stringify(grow));
if(grow.error) ok('the pool grows',false,grow.error);
else ok('the pool grows to draw a 3000-long train in full, and renders', grow.after>grow.before && grow.d===grow.sim && errs.length===0,
        'capacity '+grow.before+' -> '+grow.after+', drawing '+grow.drawn+', '+grow.d+' drawn of '+grow.sim+' simulated; draws '+grow.draws+'; passes '+grow.passes);

/* A bot train of 35 on screen beside you, rendered for a real-size shot. */
const shot=await p.evaluate(async()=>{
  const L=window.__lab, S=window.__sim, F=L.follower, M=L.mantas;
  const you=S.you; you.dead=0;
  const t=S.rivals.find(r=>r!==undefined); t.dead=0; t.x=you.x-120; t.z=you.z-300; t.head=Math.PI; S.seedTrail(t);
  t.followers.length=0; for(let i=0;i<35;i++) t.followers.push({x:t.x,z:t.z+19*(i+1),head:Math.PI,born:0,from:i%20});
  for (const id of ['board']) { const e=document.getElementById(id); if(e) e.style.visibility='hidden'; }
  F.followCamera(1/60); L.step(0); await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  F.followCamera(1/60); L.step(0); await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  const key=(x,z)=>Math.round(x*4)*1e7+Math.round(z*4); const drawn=new Set();
  for(let j=0;j<M.drawn;j++) if(M.aPos.getX(j)!==M.PARKED) drawn.add(key(M.aPos.getX(j),M.aPos.getZ(j)));
  let shown=0; for(const q of [t,...t.followers]) if(drawn.has(key(Math.fround(q.x),Math.fround(q.z)))) shown++;
  /* Reroll: the spill must come back in the train's new colour. */
  L.reroll(); F.followCamera(1/60);
  const base=M.RIVAL_BASE+S.rivals.indexOf(t)*M.RIVAL_LEN, T=M.aTint;
  let off=0; const lead=[T.getX(base),T.getY(base),T.getZ(base)];
  for(let j=M.SPILL_BASE;j<M.drawn;j++){ const px=M.aPos.getX(j),pz=M.aPos.getZ(j);
    if(!t.followers.some(q=>Math.abs(q.x-px)<0.01&&Math.abs(q.z-pz)<0.01)) continue;
    const d=Math.abs(T.getX(j)-lead[0])+Math.abs(T.getY(j)-lead[1])+Math.abs(T.getZ(j)-lead[2]); if(d>1e-4) off++; }
  return { len:t.followers.length, shown, viewH:L.view.h, offColourAfterReroll:off };
}).catch(e=>({error:e.message}));
await p.screenshot({path:(process.env.MANTA_OUT || '/tmp')+'/s1-train35.png'}).catch(()=>{});
console.log(JSON.stringify(shot));
if(!shot.error) ok('a bot train of 35 on screen: every follower drawn', shot.shown===shot.len+1, shot.shown+' of '+(shot.len+1)+' drawn');
if(!shot.error) ok('and after a Reroll its spilled followers wear the train\'s new colour', shot.offColourAfterReroll===0, shot.offColourAfterReroll+' off colour');
ok('no page errors', errs.length===0, JSON.stringify(errs.slice(0,3)));
console.log('pool failures: '+bad);
clearTimeout(die); await b.close(); process.exit(bad?1:0);
