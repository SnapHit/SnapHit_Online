import { chromium } from '../lib/tools.mjs';
const O=('http://127.0.0.1:' + process.env.PORT);
const KNOWN=/Instance dropped in popErrorScope/;
const isKnown=t=>KNOWN.test(String(t));
const die=setTimeout(()=>{console.log('WATCHDOG');process.exit(3);},80000);
let bad=0; const ok=(n,c,x='')=>{if(!c)bad++;console.log((c?'  PASS  ':'  FAIL  ')+n+(x?'  ['+x+']':''));};
const AREA=329160;
const b=await chromium.launch({executablePath:process.env.CHROME,
  args:['--enable-unsafe-webgpu','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
async function mk(vp){
  const ctx=await b.newContext({viewport:vp,deviceScaleFactor:2});
  const p=await ctx.newPage(); p.setDefaultTimeout(30000); p.setDefaultNavigationTimeout(30000);
  const rec={off:[],bad:[],errs:[],reqs:[]};
  p.on('request',r=>{const u=r.url();rec.reqs.push(u.replace(O,''));if(!u.startsWith(O)&&!/^(data|about|blob):/.test(u))rec.off.push(u);});
  p.on('response',r=>{if(r.status()>=400)rec.bad.push(r.status()+' '+r.url().replace(O,''));});
  p.on('console',c=>{if(c.type()==='error')rec.errs.push(c.text().slice(0,200));});
  p.on('pageerror',e=>rec.errs.push('pageerror: '+e.message.slice(0,220)));
  return {ctx,p,rec};
}
const state=p=>p.evaluate(()=>{
  const r={}; const dts=[...document.querySelectorAll('#rows dt')],dds=[...document.querySelectorAll('#rows dd')];
  dts.forEach((d,i)=>r[d.textContent]=dds[i].textContent);
  const c=document.getElementById('gl'), cam=window.__lab&&window.__lab.camera;
  return {rows:r, head:document.getElementById('backend').textContent,
    cls:document.getElementById('backend').className,
    sub:document.getElementById('sub').textContent,
    chipName:document.getElementById('chipBackend').textContent,
    chipFps:document.getElementById('chipFps').textContent,
    chipVisible:(()=>{const e=document.getElementById('chip');const r=e.getBoundingClientRect();
      return r.width>0&&r.height>0&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).visibility!=='hidden';})(),
    panelHidden:document.getElementById('panel').hidden,
    barHidden:document.getElementById('bar').hidden,
    expanded:document.getElementById('chip').getAttribute('aria-expanded'),
    errCls:document.getElementById('err').className,
    frustum: cam?{l:cam.left,r:cam.right,t:cam.top,bo:cam.bottom}:null,
    canvas:[c.width,c.height], css:[c.clientWidth,c.clientHeight],
    overflow:document.documentElement.scrollWidth-innerWidth,
    ready:window.__labReady===true};
});

for (const [label,vp] of [['portrait 412x915',{width:412,height:915}],['landscape 915x412',{width:915,height:412}]]) {
  console.log('\n== '+label+' ==');
  const {ctx,p,rec}=await mk(vp);
  /* ?scene=spike, because these checks are about the SCRIPT: the figure
     eight and the three rival trains it drives. Greybox stage 2 gave your
     train to the simulation and the script now runs only here. */
  await p.goto(O+'/lab/manta/?scene=spike',{waitUntil:'load'}).catch(e=>console.log('  goto '+e.message));
  await p.waitForFunction(()=>window.__labReady===true,null,{timeout:25000}).catch(()=>console.log('  (no ready)'));
  await p.waitForTimeout(2500);
  let s=await state(p);
  console.log('  head:',s.head,'| chip:',s.chipName,s.chipFps,'| view row:',s.rows['view']);
  ok('collapsed by default: chip shown, panel and bar hidden',
     s.chipVisible&&s.panelHidden&&s.barHidden&&s.expanded==='false',
     'chip='+s.chipVisible+' panelHidden='+s.panelHidden+' barHidden='+s.barHidden);
  ok('chip carries backend and fps', /WebGPU|WebGL2/.test(s.chipName)&&/fps/.test(s.chipFps), s.chipName+' '+s.chipFps);
  const f=s.frustum, W=f.r-f.l, H=f.t-f.bo, area=W*H;
  ok('camera area within 1% of 329,160', Math.abs(area-AREA)/AREA<0.01,
     W.toFixed(1)+' x '+H.toFixed(1)+' = '+Math.round(area)+' ('+((area-AREA)/AREA*100).toFixed(3)+'%)');
  ok('frustum aspect matches viewport', Math.abs((W/H)-(vp.width/vp.height))<0.001, (W/H).toFixed(4)+' vs '+(vp.width/vp.height).toFixed(4));
  ok('view row present', /units/.test(s.rows['view']||''), s.rows['view']);
  {const k=rec.errs.filter(isKnown), real=rec.errs.filter(t=>!isKnown(t));
   if(k.length) console.log('  (known environment artefact, '+k.length+'x: Instance dropped in popErrorScope — SwiftShader WebGPU teardown, not the page)');
   ok('no console errors', real.length===0, JSON.stringify([...new Set(real)]));}
  ok('no non-200', rec.bad.length===0, JSON.stringify(rec.bad));
  ok('off-origin zero', rec.off.length===0, JSON.stringify(rec.off));
  ok('no horizontal overflow', s.overflow<=0, String(s.overflow));
  ok('canvas fills viewport', s.css[0]===vp.width&&s.css[1]===vp.height, s.css.join('x'));
  const a=await p.locator('#gl').screenshot(); await p.waitForTimeout(700);
  const c2=await p.locator('#gl').screenshot();
  ok('animating (two shots 700ms apart differ)', Buffer.compare(a,c2)!==0);
  // expand
  await p.click('#chip'); await p.waitForTimeout(350);
  s=await state(p);
  ok('tap expands to the full panel', !s.panelHidden&&!s.barHidden&&s.expanded==='true');
  ok('all 31 rows present (3E: preload added)', Object.keys(s.rows).length=== 31 && 'preload' in s.rows, String(Object.keys(s.rows).length));
  /* 3A: the row reads what is drawn and the pool's capacity now. */
  { const m=/^(\d+) drawn  \u00b7  capacity (\d+)  \u00b7  1 instanced mesh$/.exec(s.rows['mantas']||'');
    ok('mantas row says what is drawn, the capacity and one mesh', !!m && +m[1]>=1071 && +m[2]>=+m[1], s.rows['mantas']); }
  ok('one instanced mesh, few draw calls (<=20 with the light memory and bloom passes)', Number(s.rows['draw calls'])>0 && Number(s.rows['draw calls'])<=20, s.rows['draw calls']);
  const inst=await p.evaluate(()=>{const m=window.__lab.mantas.mesh;
    const a=m.geometry.attributes.position;
    return {count:m.count, verts:a.count, tris:a.count/3, inst:m.isInstancedMesh===true};});
  console.log('  mesh:',JSON.stringify(inst));
  /* 1 leader + 300 follower slots + 9 rivals + 300 wild, all in one mesh. */
  ok('one thousand and seventy-one instances of one geometry', inst.count === 1071&&inst.inst===true, JSON.stringify(inst));
  if (vp.width < vp.height) {
    /* Drive the whole cycle and measure the four gaps in the train. Nathan saw
       the tail stretch through every turn; the test is that gap 4 never runs
       away from gap 1. */
    const sp = await p.evaluate(() => {
      const m = window.__lab.mantas, a = m.aPos, L = m.pathLength, v = 120;
      const gaps = [[],[],[],[]]; let worstSpread = 0, worstFrontBack = 0;
      for (let k = 0; k < 400; k++) {
        m.update((L / v) * (k / 400));            // one full lap
        const P = [];
        for (let i = 0; i < 5; i++) P.push([a.getX(i), a.getZ(i)]);
        const g = [];
        for (let i = 0; i < 4; i++) g.push(Math.hypot(P[i][0]-P[i+1][0], P[i][1]-P[i+1][1]));
        g.forEach((x, i) => gaps[i].push(x));
        worstSpread = Math.max(worstSpread, Math.max(...g) - Math.min(...g));
        worstFrontBack = Math.max(worstFrontBack, Math.abs(g[3] - g[0]));
      }
      const mean = arr => arr.reduce((s,x)=>s+x,0)/arr.length;
      return { means: gaps.map(g => +mean(g).toFixed(2)),
               mins: gaps.map(g => +Math.min(...g).toFixed(2)),
               maxs: gaps.map(g => +Math.max(...g).toFixed(2)),
               worstSpread: +worstSpread.toFixed(2), worstFrontBack: +worstFrontBack.toFixed(2),
               spacing: m.spacing, pathLength: +L.toFixed(1) };
    });
    console.log('  train gaps over one full lap (400 samples):');
    console.log('    mean per gap :', JSON.stringify(sp.means));
    console.log('    min  per gap :', JSON.stringify(sp.mins));
    console.log('    max  per gap :', JSON.stringify(sp.maxs));
    console.log('    worst spread within a frame :', sp.worstSpread);
    console.log('    worst |gap4 - gap1|         :', sp.worstFrontBack);
    console.log('    path length', sp.pathLength, ' spacing', sp.spacing);
    ok('gaps never run away toward the back', sp.worstFrontBack < 1.5, String(sp.worstFrontBack));
    ok('all four gaps within 5% of each other at all times', sp.worstSpread < sp.spacing*0.05, String(sp.worstSpread));
    ok('no positional bias: every gap has the same mean', Math.max(...sp.means)-Math.min(...sp.means) < 0.05, JSON.stringify(sp.means));

    /* EVERY train, not just yours. The three rival trains are placed by the
       same arc-length rule against their leader's recorded path, and a rival
       train that stretches on a bend would be the same bug as the one that
       was fixed in yours. Warmed up first: the trail starts empty, so the
       followers sit on the leader until it has swum far enough to hold
       them. */
    const rv = await p.evaluate(() => {
      const m = window.__lab.mantas, a = m.aPos, L = m.pathLength, v = 120;
      const lap = L / v;
      for (let k = 0; k < 240; k++) m.update(lap * (k / 240));       // warm up
      const per = [[],[],[]];
      for (let k = 0; k < 400; k++) {
        m.update(lap * (1 + k / 400));
        for (let r = 0; r < 3; r++) {
          const base = window.__lab.mantas.RIVAL_BASE + r * 3;
          for (let i = 0; i < 2; i++) {
            const A = [a.getX(base+i), a.getZ(base+i)], B = [a.getX(base+i+1), a.getZ(base+i+1)];
            per[r].push(Math.hypot(A[0]-B[0], A[1]-B[1]));
          }
        }
      }
      return per.map(g => ({ min: +Math.min(...g).toFixed(2), max: +Math.max(...g).toFixed(2),
                             mean: +(g.reduce((s2,x)=>s2+x,0)/g.length).toFixed(2) }));
    });
    console.log('  rival train gaps over a lap, against a spacing of ' + sp.spacing + ':');
    rv.forEach((g, i) => console.log('    rival ' + (i+1) + ': mean ' + g.mean + '  min ' + g.min + '  max ' + g.max));
    ok('every rival train holds its spacing within 1 unit over a lap',
       rv.every(g => Math.abs(g.min - sp.spacing) <= 1 && Math.abs(g.max - sp.spacing) <= 1),
       JSON.stringify(rv));
    ok('every gap close to the arc spacing', sp.means.every(m2 => Math.abs(m2-sp.spacing) < sp.spacing*0.04), JSON.stringify(sp.means));

    /* Every manta must swim along its own nose. Nose direction for heading h
       is (-sin h, -cos h); compare that with where it actually moved. This is
       the check that would have caught the singles crabbing. */
    const crab = await p.evaluate(() => {
      const m = window.__lab.mantas, aP = m.aPos, aH = m.aHead;
      const worst = new Array(10).fill(0); const DT = 1/60;
      let t = 0;
      m.update(t);
      for (let k = 0; k < 3600; k++) {           // a full minute at 60 Hz
        const p0 = [], h0 = [];
        for (let i = 0; i < 10; i++) { p0.push([aP.getX(i), aP.getZ(i)]); h0.push(aH.getX(i)); }
        t += DT; m.update(t);
        for (let i = 0; i < 10; i++) {
          const vx = aP.getX(i) - p0[i][0], vz = aP.getZ(i) - p0[i][1];
          const len = Math.hypot(vx, vz);
          if (len < 1e-4 || len > 20) continue;   // still, or wrapped
          const nx = -Math.sin(h0[i]), nz = -Math.cos(h0[i]);
          const d = Math.max(-1, Math.min(1, (vx*nx + vz*nz) / len));
          const a = Math.acos(d) * 180 / Math.PI;
          if (a > worst[i]) worst[i] = a;
        }
      }
      return worst.map(v => +v.toFixed(1));
    });
    const NAMES = ['leader','fol1','fol2','fol3','fol4','rivalA','rivalB','WILD','circA','circB'];
    console.log('  worst angle between travel and nose, over a simulated minute:');
    console.log('    ' + NAMES.map((n,i)=>n+'='+crab[i]+'°').join('  '));
    ok('every manta swims headfirst (worst < 6 degrees)', crab.every(v => v < 6), JSON.stringify(crab));
    ok('the three singles are the ones that were crabbing, now straight',
       crab[5] < 2 && crab[6] < 2 && crab[7] < 2, JSON.stringify(crab.slice(5,8)));
  }
  await p.screenshot({path:(process.env.MANTA_OUT || '/tmp')+'/s1-'+(vp.width>vp.height?'land':'port')+'-open.png'});
  await p.click('#chip'); await p.waitForTimeout(300);
  await p.screenshot({path:(process.env.MANTA_OUT || '/tmp')+'/s1-'+(vp.width>vp.height?'land':'port')+'.png'});
  console.log('  requests:',rec.reqs.length,JSON.stringify(rec.reqs));
  await ctx.close();
}

// forced webgl2 + cold/warm + copy, one context so the cache carries
console.log('\n== forced webgl2, cold/warm, copy ==');
{
  const ctx=await b.newContext({viewport:{width:412,height:915},deviceScaleFactor:2});
  await ctx.grantPermissions(['clipboard-read','clipboard-write']);
  const p=await ctx.newPage(); p.setDefaultTimeout(30000); p.setDefaultNavigationTimeout(30000);
  const errs=[],off=[]; let log=[];
  p.on('request',r=>{const u=r.url();log.push(u.replace(O,''));if(!u.startsWith(O)&&!/^(data|about|blob):/.test(u))off.push(u);});
  p.on('console',c=>{if(c.type()==='error')errs.push(c.text().slice(0,200));});
  p.on('pageerror',e=>errs.push('pageerror: '+e.message.slice(0,200)));
  const settle=async()=>{await p.waitForFunction(()=>window.__labReady===true,null,{timeout:25000}).catch(()=>{});
                         await p.waitForFunction(()=>document.querySelectorAll('#rows dd')[12].textContent!=='—',null,{timeout:25000}).catch(()=>{});
                         await p.waitForTimeout(300);};
  await p.goto(O+'/lab/manta/?backend=webgl2',{waitUntil:'load'}).catch(e=>console.log('goto '+e.message));
  await settle(); await p.click('#chip'); await p.waitForTimeout(250);
  let s=await state(p);
  ok('forced goes straight to WebGL2', s.head==='WebGL2'&&s.cls==='webgl2', s.head+'/'+s.cls);
  ok('forced shows no fallback note', s.errCls.indexOf('on')!==0, JSON.stringify(s.errCls));
  ok('forced sub line', s.sub==='fallback forced with ?backend=webgl2', s.sub);
  console.log('  bytes:',s.rows['vendor bytes']);
  log=[]; await p.click('#warm'); await p.waitForTimeout(600); await settle(); await p.click('#chip'); await p.waitForTimeout(250);
  s=await state(p);
  console.log('  warm bytes:',s.rows['vendor bytes']);
  ['three.webgpu.js','three.core.js','three.tsl.js'].forEach(k=>console.log('    '+k+': '+s.rows[k]));
  ok('warm reported', /^warm/.test(s.rows['load']), s.rows['load']);
  ok('rounding: three 0 KB files sum to 0 KB, not 1',
     /^0 KB over the wire/.test(s.rows['vendor bytes']), s.rows['vendor bytes']);
  log=[]; await p.click('#cold'); await p.waitForTimeout(600); await settle(); await p.click('#chip'); await p.waitForTimeout(250);
  s=await state(p);
  const vend=['three.webgpu.js','three.core.js','three.tsl.js'].map(f=>log.filter(u=>u.indexOf('/'+f)!==-1&&u.indexOf('cold=')!==-1).length);
  ok('cold re-fetches all three, stamped', vend.every(n=>n===1), JSON.stringify(vend));
  ok('cold reported', /^cold/.test(s.rows['load']), s.rows['load']);
  await p.click('#copy'); await p.waitForTimeout(400);
  const txt=await p.evaluate(()=>navigator.clipboard.readText()).catch(e=>'FAIL '+e.message);
  const labels=['load:','fallback:','navigator.gpu:','adapter:','gpu:','three:','viewport:','view:','mantas:','draw calls:','first frame:','timing (ms):','vendor bytes:','three.webgpu.js:','three.core.js:','three.tsl.js:','refresh:','fps (5s):','worst 1%:','build:','agent:'];
  ok('copy report carries all 21 rows', labels.every(k=>txt.includes(k)), labels.filter(k=>!txt.includes(k)).join(',')||'all present');
  ok('copy report indents the timing block', /timing \(ms\):\n  \S/.test(txt));
  ok('off-origin zero', off.length===0, JSON.stringify(off));
  {const k=errs.filter(isKnown), real=errs.filter(t=>!isKnown(t));
   if(k.length) console.log('  (known environment artefact, '+k.length+'x: Instance dropped in popErrorScope — SwiftShader WebGPU teardown, not the page)');
   ok('no console errors', real.length===0, JSON.stringify([...new Set(real)]));}
  await ctx.close();
}
console.log('\ns1 failures: '+bad);
clearTimeout(die); await b.close(); process.exit(bad?1:0);
