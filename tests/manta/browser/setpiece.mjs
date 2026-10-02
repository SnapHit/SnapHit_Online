/* Stage 2 in the page: one explosion per crash on screen, one burst per cut
   crossing, nothing for a wreck, and nothing spent for what is off screen.
   WebGL2, headless. */
import { chromium } from '../lib/tools.mjs';
const O=('http://127.0.0.1:' + process.env.PORT);
const die=setTimeout(()=>{console.log('WATCHDOG');process.exit(3);},85000);
const b=await chromium.launch({executablePath:process.env.CHROME,
  args:['--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const p=await (await b.newContext({viewport:{width:412,height:915},deviceScaleFactor:1})).newPage();
p.setDefaultTimeout(30000); p.setDefaultNavigationTimeout(30000);
const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',c=>{if(c.type()==='error')errs.push(c.text());});
let bad=0; const ok=(n,c,x='')=>{if(!c)bad++;console.log((c?'  PASS  ':'  FAIL  ')+n+(x?'  ['+x+']':''));};
await p.goto(O+'/lab/manta/?tier=low&backend=webgl2&seed=4242',{waitUntil:'load'}).catch(e=>console.log('goto '+e.message));
await p.waitForFunction(()=>window.__labReady===true,null,{timeout:25000}).catch(()=>console.log('(no ready)'));
await p.waitForTimeout(1500);
const r=await p.evaluate(async()=>{
  const L=window.__lab, S=window.__sim, C=await import('/lab/manta/cut.js');
  L.pause();
  const snap=()=>({ fired:L.cut.fired, flashes:C.flashCount(), off:L.follower.offScreen });
  const step=(k=1)=>{ for(let i=0;i<k;i++) L.step(1/60); };
  const you=S.you, out={};
  const alive=S.rivals.filter(t=>!(t.dead>0));
  const [near, far, crossed]=alive;
  /* A: a bot crashes on screen, next to you. */
  near.x=you.x+60; near.z=you.z; S.seedTrail(near);
  let a=snap(); S.crash(near); step(1); let a1=snap(); step(30); let a2=snap();
  out.onScreen={ fired:a1.fired-a.fired, laterFires:a2.fired-a1.fired, flashSpent:a1.flashes-a.flashes };
  /* C: the same bot again, in its death beat: nothing. */
  let c=snap(); S.crash(near); S.cutAt(near,0,you); step(1); let c1=snap();
  out.wreck={ fired:c1.fired-c.fired, deadLeft:+near.dead.toFixed(2) };
  /* B: a bot crashes far off screen: nothing fires, nothing spent. */
  far.x=you.x+3000; far.z=you.z; S.seedTrail(far);
  let bq=snap(); S.crash(far); step(1); let b1=snap();
  out.offScreen={ fired:b1.fired-bq.fired, flashSpent:b1.flashes-bq.flashes, counted:b1.off-bq.off };
  /* D: a cut on screen, touched on two followers in one crossing: one burst. */
  crossed.x=you.x-80; crossed.z=you.z; S.seedTrail(crossed); crossed.followers.length=0;
  for(let i=0;i<8;i++) crossed.followers.push({x:you.x-80,z:you.z+19*(i+1),head:0,born:0,from:i});
  let d=snap(); S.cutAt(crossed,5,you); step(1); S.cutAt(crossed,3,you); step(1); let d1=snap();
  out.cut={ fired:d1.fired-d.fired };
  /* E: your own crash. */
  let e=snap(); S.crash(you); step(1); let e1=snap();
  out.yours={ fired:e1.fired-e.fired };
  /* F: no ghosts. Through the death beat and the restart, no slot of your
     train is drawn beyond the followers you really have. */
  let ghosts=0, worst=0;
  for(let k=0;k<150;k++){ step(1);
    const m=L.mantas, n=you.dead>0?0:1+you.followers.length; let drawn=0;
    for(let i=0;i<m.TRAIN_MAX;i++) if(m.aPos.getX(i)!==m.PARKED) drawn++;
    if(drawn>n){ ghosts++; worst=Math.max(worst,drawn-n); } }
  out.ghosts={ framesWithGhosts:ghosts, worst };
  return out;
}).catch(e=>({error:e.message}));
console.log(JSON.stringify(r));
if (r.error) { ok('the page ran the checks', false, r.error); }
else {
  ok('a crash on screen fires one explosion', r.onScreen.fired===1 && r.onScreen.laterFires===0, JSON.stringify(r.onScreen));
  ok('nothing fires for a train already in its death beat', r.wreck.fired===0, JSON.stringify(r.wreck));
  ok('a crash off screen fires nothing and spends no flash allowance', r.offScreen.fired===0 && r.offScreen.flashSpent===0 && r.offScreen.counted===1, JSON.stringify(r.offScreen));
  ok('a cut on screen fires one burst, and a crossing counts as one cut', r.cut.fired===1, JSON.stringify(r.cut));
  ok('your own crash fires its explosion', r.yours.fired===1, JSON.stringify(r.yours));
  ok('no manta of your train is drawn that the simulation does not have', r.ghosts.framesWithGhosts===0, JSON.stringify(r.ghosts));
}
ok('no page errors', errs.length===0, JSON.stringify(errs.slice(0,2)));
console.log('setpiece failures: '+bad);
clearTimeout(die); await b.close(); process.exit(bad?1:0);
