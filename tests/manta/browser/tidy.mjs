/* 2B part six, stage 1: the growing pool, tidied. Uploads per frame after
   growth match before; nothing replaced stays referenced; a follower past a
   bot's eighth lays a wake; debris colours hold through 10 -> 14 -> 6 bots.
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
await p.goto(O+'/lab/manta/?tier=low&backend=webgl2&seed=6161',{waitUntil:'load'}).catch(e=>console.log('goto '+e.message));
await p.waitForFunction(()=>window.__labReady===true,null,{timeout:25000}).catch(()=>console.log('(no ready)'));
await p.waitForTimeout(1500);

const r=await p.evaluate(async()=>{
  const L=window.__lab, S=window.__sim, F=L.follower, M=L.mantas, R=L.renderer();
  L.pause();
  const frame=()=>new Promise(res=>requestAnimationFrame(()=>res()));
  /* Count uploads of the pool's own five attributes, per rendered frame. */
  let uploads=0, by={};
  const names=()=>new Map([[M.aPos,'pos'],[M.aHead,'head'],[M.aSize,'size'],[M.aMotion,'motion'],[M.aTint,'tint']]);
  const orig=R.backend.updateAttribute.bind(R.backend);
  R.backend.updateAttribute=a=>{ const nm=names().get(a); if(nm){ uploads++; by[nm]=(by[nm]||0)+1; } return orig(a); };
  /* Frames drawn with the world standing still (step(0)), so gameplay -
     a recruit's colour fade, a glowing scatter - cannot change what needs
     uploading between the two windows. */
  const perFrame=async n=>{ uploads=0; by={}; for(let k=0;k<n;k++){ L.step(0); await frame(); } out.by=(out.by||[]).concat([JSON.stringify(by)]); return uploads/n; };
  const out={};
  await perFrame(3);
  out.before=await perFrame(10);
  /* Grow: a 3000-long train on the first bot. */
  const t=S.rivals[0]; t.dead=0;
  const old={ mesh:M.mesh, shadow:M.shadowMesh, attrs:[M.aPos,M.aHead,M.aSize,M.aMotion,M.aTint], cap:M.capacity };
  t.followers.length=0; for(let i=0;i<3000;i++) t.followers.push({x:t.x+19*(i+1),z:t.z,head:0,born:0,from:i%20});
  L.step(1/60); await frame(); L.step(1/60); await frame(); L.step(1/60); await frame();
  out.cap=[old.cap,M.capacity];
  out.after=await perFrame(10);
  /* Nothing replaced still referenced by the scene or the renderer. */
  const ros=[...R._objects._renderObjects];
  out.freed={ meshParent:old.mesh.parent===null, shadowParent:old.shadow.parent===null,
    renderObjects:ros.filter(ro=>ro.object===old.mesh||ro.object===old.shadow).length,
    attrsHeld:old.attrs.filter(a=>R._attributes.has(a)).length, retiring:M.retiring };
  t.followers.length=0; L.step(1/60); await frame();
  /* A bot of 20 on screen: something past its eighth is stamped. */
  const you=S.you; you.dead=0;
  t.x=you.x-100; t.z=you.z-200; t.head=Math.PI; S.seedTrail(t);
  t.followers.length=0; for(let i=0;i<20;i++) t.followers.push({x:t.x,z:t.z+19*(i+1),head:Math.PI,born:0,from:i%20});
  L.step(1/60); await frame(); L.step(1/60); await frame();
  const list=L.stamper.list;
  const past=list.filter(sl=>sl>=M.SPILL_BASE && t.followers.slice(8).some(q=>Math.abs(q.x-M.aPos.getX(sl))<0.01&&Math.abs(q.z-M.aPos.getZ(sl))<0.01));
  out.wake={ stamped:list.length, pastEighth:past.length };
  /* Debris colours through 10 -> 14 -> 6 bots. */
  const BL=(M.WILD_BASE-M.RIVAL_BASE)/M.RIVAL_LEN;
  const unit=v=>{ const n=Math.hypot(...v)||1; return v.map(x=>x/n); };
  const tintAt=i=>unit([M.aTint.getX(i),M.aTint.getY(i),M.aTint.getZ(i)]);
  const check=async (n, idx)=>{
    L.params.P.bots=n; S.setBotCount(n); L.step(1/60); await frame();
    const bot=S.rivals[idx]; bot.dead=0; bot.x=you.x+80; bot.z=you.z+150; S.seedTrail(bot);
    bot.followers.length=0; for(let i=0;i<6;i++) bot.followers.push({x:bot.x+19*(i+1),z:bot.z,head:0,born:0,from:i%20});
    L.step(1/60); await frame();
    const lead=RIVAL=M.RIVAL_BASE+(idx%BL)*M.RIVAL_LEN, want=tintAt(lead);
    S.crash(bot); L.step(1/60); await frame(); L.step(1/60); await frame();
    let debris=0, off=0;
    for(let j=0;j<S.wild.length && j<M.WILD_SLOTS;j++){ const q=S.wild[j];
      if(!q||!q.alive||!q.loose||q.wasColour!==bot.id||!(q.glow>0)) continue;
      debris++; const got=tintAt(M.WILD_BASE+j);
      if(Math.abs(got[0]-want[0])+Math.abs(got[1]-want[1])+Math.abs(got[2]-want[2])>0.02) off++; }
    return { bots:n, index:idx, id:bot.id, debris, off };
  };
  let RIVAL;
  out.colours=[await check(14, 12), await check(14, 3), await check(6, 4)];
  L.params.P.bots=10; S.setBotCount(10);
  R.backend.updateAttribute=orig;
  return out;
}).catch(e=>({error:e.message}));
console.log(JSON.stringify(r));
if(r.error) ok('the checks ran',false,r.error);
else {
  ok('uploads per frame after growth match those before it', r.after===r.before, 'before '+r.before.toFixed(1)+', after '+r.after.toFixed(1)+' per frame; capacity '+r.cap.join(' -> '));
  ok('no replaced mesh or buffer remains referenced', r.freed.meshParent && r.freed.shadowParent && r.freed.renderObjects===0 && r.freed.attrsHeld===0 && !r.freed.retiring, JSON.stringify(r.freed));
  ok('a follower past a bot\'s eighth leaves a wake', r.wake.pastEighth>0, r.wake.pastEighth+' of '+r.wake.stamped+' stamped slots are its followers past the eighth');
  ok('debris colours are right after the bot count moves 10 -> 14 -> 6', r.colours.every(c=>c.debris>0&&c.off===0), JSON.stringify(r.colours));
}
ok('no page errors', errs.length===0, JSON.stringify(errs.slice(0,3)));
console.log('tidy failures: '+bad);
clearTimeout(die); await b.close(); process.exit(bad?1:0);
