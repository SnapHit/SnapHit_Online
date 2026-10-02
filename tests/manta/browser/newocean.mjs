/* 3B stage 1 (uncommitted patch): New ocean in the page. WebGL2, headless. */
import { chromium } from '../lib/tools.mjs';
const O=('http://127.0.0.1:' + process.env.PORT);
const die=setTimeout(()=>{console.log('WATCHDOG');process.exit(3);},85000);
const b=await chromium.launch({executablePath:process.env.CHROME,args:['--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const p=await (await b.newContext({viewport:{width:412,height:915},deviceScaleFactor:1})).newPage();
p.setDefaultTimeout(30000); p.setDefaultNavigationTimeout(30000);
const errs=[]; p.on('pageerror',e=>errs.push(e.message.slice(0,160))); p.on('console',c=>{if(c.type()==='error')errs.push(c.text().slice(0,160));});
let bad=0; const ok=(n,c,x='')=>{if(!c)bad++;console.log((c?'  PASS  ':'  FAIL  ')+n+(x?'  ['+x+']':''));};
await p.goto(O+'/lab/manta/?tier=low&backend=webgl2&seed=8181',{waitUntil:'load'}).catch(e=>console.log('goto '+e.message));
await p.waitForFunction(()=>window.__labReady===true,null,{timeout:25000}).catch(()=>console.log('(no ready)'));
const r=await p.evaluate(async()=>{ const L=window.__lab,S=window.__sim,M=L.mantas;
  const frame=()=>new Promise(res=>requestAnimationFrame(()=>res()));
  const ord=w=>w&&w.alive&&!w.loose&&!(w.sinking>0);
  L.pause(); for(let i=0;i<30;i++) L.step(1/60);
  const btn=document.getElementById('dbgNew'); if(!btn) return {error:'no New ocean button'};
  /* First at the committed defaults. */
  /* 3E: the count is read the moment New ocean has run, as the wild-300
     check below always was. At the committed 300 with a 5 s refill, 70 steps
     later ten bots have already recruited some and the refill has not caught
     up, which is play, not New ocean. The board is still read 70 steps on,
     once it has been drawn. */
  btn.click(); const ordinary0=S.wild.filter(ord).length;
  for(let i=0;i<70;i++){ L.step(1/60); if(i%10===9) await frame(); }
  const board=(document.getElementById('board')||{}).textContent||'';
  const atDefaults={ordinary:ordinary0, target:S.params.wildCount, arena:S.params.arenaR, names:(board.match(/bot \d+/g)||[]).map(x=>+x.slice(4)).sort((a,b)=>a-b).join(',')};
  /* Then at arena 2000 with wild 300. */
  L.params.P.wildCount=300; L.params.P.arenaR=2000;
  for(let i=0;i<2;i++) L.step(1/60);
  const before={arena:S.params.arenaR, ordinary:S.wild.filter(ord).length};
  btn.click();
  const after={arena:S.params.arenaR, ordinary:S.wild.filter(ord).length, past:S.wild.filter(w=>ord(w)&&Math.hypot(w.x,w.z)>S.params.arenaR-260+1e-6).length, you:S.you.followers.length, bots:S.rivals.length};
  let mismatch=0, steps=0;
  for(let i=0;i<600;i++){ L.step(1/60); steps++;
    let sim=S.you.dead>0?0:1+S.you.followers.length; for(const t of S.rivals) if(!(t.dead>0)) sim+=1+t.followers.length; for(const w of S.wild) if(w&&w.alive) sim++;
    let d=0; for(let j=0;j<M.drawn;j++) if(M.aPos.getX(j)!==M.PARKED) d++; if(d!==sim) mismatch++; if(i%20===19) await frame(); }
  /* Swim to the reef for a real-size look: you, 250 inside the wall. */
  S.you.x=0; S.you.z=-(S.params.arenaR-250); S.you.head=0; S.seedTrail(S.you);
  const near=S.wild.filter(w=>ord(w)&&S.params.arenaR-Math.hypot(w.x,w.z)<=150).length, all=S.wild.filter(ord).length;
  for(let i=0;i<3;i++){ L.step(1/60); await frame(); }
  return {atDefaults, before, after, mismatch, steps, near, all};
}).catch(e=>({error:e.message}));
await p.screenshot({path:(process.env.MANTA_OUT || '/tmp') + '/newocean-reef-412x915.png'}).catch(()=>{});
console.log(JSON.stringify(r));
if(r.error) ok('ran',false,r.error); else {
  ok('New ocean at the committed defaults starts at the wild count, and the board reads bot 1 to 10', r.atDefaults.ordinary===r.atDefaults.target && r.atDefaults.names.split(',').length>=9 && r.atDefaults.names.split(',').every(n=>+n>=1&&+n<=10), JSON.stringify(r.atDefaults));
  ok('New ocean at wild 300: the ordinary count starts at 300, on arena 2000 at once', r.after.ordinary===300&&r.after.arena===2000&&r.after.past===0&&r.after.you===0&&r.after.bots===10, JSON.stringify(r.before)+' -> '+JSON.stringify(r.after));
  ok('drawn equals simulated for 600 steps after it', r.mismatch===0, r.mismatch+' mismatched of '+r.steps);
  ok('after ten seconds, few ordinary wild near the reef', r.near/Math.max(r.all,1) <= 0.144*1.5, r.near+' of '+r.all+' within 150 of the reef');
}
ok('no page errors', errs.length===0, JSON.stringify(errs.slice(0,3)));
console.log('newocean failures: '+bad); clearTimeout(die); await b.close(); process.exit(bad?1:0);
