/* Does a wake stay over the water it was laid on while the camera moves?
   The light memory re-centres in whole texels; if the shift were fractional,
   or in the wrong direction, a wake would swim across the ocean with the
   camera or smear. Measured in world coordinates, not screen ones. */
import { chromium } from '../lib/tools.mjs';
const O=('http://127.0.0.1:' + process.env.PORT);
const die=setTimeout(()=>{console.log('WATCHDOG');process.exit(3);},85000);
let bad=0; const ok=(n,c,x='')=>{if(!c)bad++;console.log((c?'  PASS  ':'  FAIL  ')+n+(x?'  ['+x+']':''));};
const b=await chromium.launch({executablePath:process.env.CHROME,
  args:['--enable-unsafe-webgpu','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const ctx=await b.newContext({viewport:{width:412,height:915},deviceScaleFactor:1});
const p=await ctx.newPage(); p.setDefaultTimeout(30000); p.setDefaultNavigationTimeout(30000);
const errs=[]; p.on('pageerror',e=>errs.push('pageerror: '+(e.stack||e.message).slice(0,250)));
p.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text().slice(0,200));});
await p.goto(O+'/lab/manta/?tier=high&backend=webgl2',{waitUntil:'load'}).catch(e=>console.log('  goto '+e.message));
await p.waitForFunction(()=>window.__labReady===true,null,{timeout:25000}).catch(()=>{});
await p.waitForTimeout(5000);
const r=await p.evaluate(async()=>{
  const L=window.__lab, S=window.__sim;
  if(!S) return {error:'no simulation on the page'};
  const lm=L.lm;
  const out={ startCam:[+S.you.x.toFixed(1), +S.you.z.toFixed(1)] };
  /* Where the light memory's square sits, and where it says a given patch of
     water is, before and after the camera has moved a long way. */
  const centre0=[lm.uCentre.value.x, lm.uCentre.value.y];
  const half0=lm.uHalf.value;
  /* Drive the leader in a straight line for a few seconds of sim time. */
  L.pause();
  S.input.want=null; S.input.burst=false;
  const before={x:S.you.x, z:S.you.z};
  for(let i=0;i<600;i++){ S.step(); }          // ten seconds of swimming
  /* The page's own follow step, as a frame would run it. */
  L.step(1/60);
  const centre1=[lm.uCentre.value.x, lm.uCentre.value.y];
  const texel=(lm.uHalf.value*2)/lm.size;
  const moved=Math.hypot(S.you.x-before.x, S.you.z-before.z);
  /* The square must have followed, and every step of it must be a whole
     number of texels. */
  const dx=(centre1[0]-centre0[0])/texel, dz=(centre1[1]-centre0[1])/texel;
  out.moved=+moved.toFixed(1);
  out.centreMoved=[+(centre1[0]-centre0[0]).toFixed(2), +(centre1[1]-centre0[1]).toFixed(2)];
  out.inTexels=[+dx.toFixed(4), +dz.toFixed(4)];
  out.texel=+texel.toFixed(3);
  out.lag=Math.hypot(S.you.x-centre1[0], S.you.z-centre1[1]);
  return out;});
if(r.error){ ok('the page has a simulation', false, r.error); }
else {
  console.log('  the leader swam '+r.moved+' units; the light memory square moved '+
    JSON.stringify(r.centreMoved)+' = '+JSON.stringify(r.inTexels)+' texels of '+r.texel);
  ok('the light memory follows the camera', Math.hypot(...r.centreMoved)>r.moved*0.5,
     'square moved '+Math.hypot(...r.centreMoved).toFixed(1)+' against '+r.moved);
  ok('and only ever by WHOLE texels',
     Math.abs(r.inTexels[0]-Math.round(r.inTexels[0]))<1e-3 &&
     Math.abs(r.inTexels[1]-Math.round(r.inTexels[1]))<1e-3, JSON.stringify(r.inTexels));
  ok('so the square never drifts off the camera', r.lag < r.texel*1.5,
     'lag '+r.lag.toFixed(2)+' units, under one texel of '+r.texel);
}
ok('no page or console errors', errs.length===0, JSON.stringify([...new Set(errs)]).slice(0,250));
console.log('\nwake failures: '+bad);
clearTimeout(die); await b.close(); process.exit(bad?1:0);
