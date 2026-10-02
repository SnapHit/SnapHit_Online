/* Stage 3: each touch scheme steers and bursts through PointerEvents dispatched
   on the canvas; the drawer still scrolls and taps with real touch input. */
import { chromium } from '../lib/tools.mjs';
const O=('http://127.0.0.1:' + process.env.PORT);
const die=setTimeout(()=>{console.log('WATCHDOG');process.exit(3);},85000);
const b=await chromium.launch({executablePath:process.env.CHROME,
  args:['--enable-unsafe-webgpu','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const ctx=await b.newContext({viewport:{width:412,height:915},deviceScaleFactor:1,hasTouch:true,isMobile:true});
const p=await ctx.newPage(); p.setDefaultTimeout(30000); p.setDefaultNavigationTimeout(30000);
const errs=[];
p.on('console',c=>{if(c.type()==='error')errs.push(c.text().slice(0,120));});
p.on('pageerror',e=>errs.push('pageerror: '+e.message.slice(0,120)));
await p.goto(O+'/lab/manta/?tier=low&backend=webgl2',{waitUntil:'load'}).catch(e=>console.log('goto '+e.message));
await p.waitForFunction(()=>window.__labReady===true,null,{timeout:25000}).catch(()=>console.log('(no ready)'));
await p.waitForTimeout(1500);

/* Helpers in the page: dispatch, wait two frames, read sim.input. */
await p.evaluate(()=>{
  const cv=window.__lab && document.querySelector('canvas');
  window.__t={
    cv,
    ev(type,id,x,y){ cv.dispatchEvent(new PointerEvent(type,{pointerId:id,pointerType:'touch',isPrimary:id===11,
      clientX:x,clientY:y,bubbles:true,cancelable:true,buttons:type==='pointerup'?0:1})); },
    frames(n){ return new Promise(r=>{ let k=0; const f=()=>{ if(++k>=n) r(); else requestAnimationFrame(f); }; requestAnimationFrame(f); }); },
    read(){ const i=window.__sim.input; const h=i.want;
      return { want:h, fx: h==null?null:+(-Math.sin(h)).toFixed(2), fz: h==null?null:+(-Math.cos(h)).toFixed(2), burst:!!i.burst }; },
  };
}).catch(e=>console.log('setup '+e.message));

const r={};
const run=async(label,fn)=>{ try{ r[label]=await p.evaluate(fn); }catch(e){ r[label]={error:e.message.slice(0,160)}; } };
const setScheme=async s=>p.evaluate(async s=>{ const m=await import('/lab/manta/params.js'); m.setParam('scheme',s); return m.P.scheme; },s);

// Where the leader is on screen, so "towards the finger" has a reference.
const W=412,H=915;

// ---- Scheme A
console.log('scheme', await setScheme(0));
await run('A steer right', async()=>{ const t=window.__t; t.ev('pointerdown',11,400,457); await t.frames(3); const a=t.read(); t.ev('pointerup',11,400,457); await t.frames(2); return a; });
await run('A steer up', async()=>{ const t=window.__t; t.ev('pointerdown',11,206,20); await t.frames(3); const a=t.read(); t.ev('pointerup',11,206,20); await t.frames(2); return a; });
await run('A single tap no burst', async()=>{ const t=window.__t; await new Promise(r=>setTimeout(r,400)); t.ev('pointerdown',11,10,457); await t.frames(3); const a=t.read(); t.ev('pointerup',11,10,457); await t.frames(2); return a; });
await run('A double-tap hold bursts', async()=>{ const t=window.__t; await new Promise(r=>setTimeout(r,400));
  const t0=performance.now(); t.ev('pointerdown',11,10,457); t.ev('pointerup',11,10,457); await new Promise(r=>setTimeout(r,80));
  const gap=Math.round(performance.now()-t0); t.ev('pointerdown',11,10,457); await t.frames(3); const a=t.read(); t.ev('pointerup',11,10,457); await t.frames(3); const after=t.read(); return {...a, gapMs:gap, burstAfterRelease:after.burst}; });

// ---- Scheme B
console.log('scheme', await setScheme(1));
await run('B first finger steers left, no burst', async()=>{ const t=window.__t; t.ev('pointerdown',11,10,457); await t.frames(3); return t.read(); });
await run('B second finger bursts, first still steers', async()=>{ const t=window.__t; t.ev('pointerdown',12,380,850); await t.frames(3); return t.read(); });
await run('B second lifted: no burst', async()=>{ const t=window.__t; t.ev('pointerup',12,380,850); await t.frames(3); const a=t.read(); t.ev('pointerup',11,10,457); await t.frames(2); return a; });

// ---- Scheme C
console.log('scheme', await setScheme(2));
await run('C stick drag right', async()=>{ const t=window.__t; t.ev('pointerdown',11,100,700); t.ev('pointermove',11,160,700); await t.frames(3);
  const ring=[...document.body.children].filter(d=>d.tagName==='DIV'&&d.style.borderRadius==='50%'&&d.style.display==='block').length; return {...t.read(), ringsShown:ring}; });
await run('C stick drag up', async()=>{ const t=window.__t; t.ev('pointermove',11,100,640); await t.frames(3); return t.read(); });
await run('C right half bursts', async()=>{ const t=window.__t; t.ev('pointerdown',12,330,700); await t.frames(3); return t.read(); });
await run('C release all', async()=>{ const t=window.__t; t.ev('pointerup',12,330,700); t.ev('pointerup',11,100,640); await t.frames(3);
  const ring=[...document.body.children].filter(d=>d.tagName==='DIV'&&d.style.borderRadius==='50%'&&d.style.display==='block').length; return {...t.read(), ringsShown:ring}; });
await run('C right half alone: burst, no steer', async()=>{ const t=window.__t; t.ev('pointerdown',13,330,300); await t.frames(3); const a=t.read(); t.ev('pointerup',13,330,300); await t.frames(2); return a; });

// ---- Canvas guards against pan, zoom and selection
await run('canvas css', ()=>{ const cs=getComputedStyle(window.__t.cv); return { touchAction:cs.touchAction, userSelect:cs.userSelect||cs.webkitUserSelect }; });

// ---- Copy values carries the scheme
await run('copy text', async()=>{ const m=await import('/lab/manta/params.js'); const t=m.paramText(); return t.split('\n').filter(l=>/scheme/.test(l)); });
await setScheme(0);

// ---- Drawer with real touch input: tap to open, drag to scroll, tap a slider
for (const l of Object.keys(r)) console.log(l.padEnd(44), JSON.stringify(r[l]));
try {
  const cdp=await ctx.newCDPSession(p);
  const tb=await p.locator('#drawerToggle').boundingBox();
  // The drawer toggle sits in the expanded panel; open the panel first if it is hidden.
  const vis=await p.locator('#drawerToggle').isVisible();
  if(!vis){ const pb=await p.evaluate(()=>{ const e=document.getElementById('panelToggle')||document.querySelector('[aria-controls]'); return e?e.id:null; }); console.log('panel toggle', pb); if(pb) await p.tap('#'+pb); await p.waitForTimeout(300); }
  await p.tap('#drawerToggle');
  await p.waitForTimeout(300);
  const open=await p.evaluate(()=>!document.getElementById('drawerBody').hidden);
  const bb=await p.locator('#drawerBody').boundingBox();
  const before=await p.evaluate(()=>document.getElementById('drawerBody').scrollTop);
  const x=bb.x+bb.width*0.15, y0=bb.y+bb.height*0.8, y1=bb.y+bb.height*0.15;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y:y0}]});
  for(let k=1;k<=10;k++){ await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y0+(y1-y0)*k/10}]}); await p.waitForTimeout(16); }
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await p.waitForTimeout(400);
  const after=await p.evaluate(()=>document.getElementById('drawerBody').scrollTop);
  // Tap the scheme slider's right end: it should move to C.
  const sl=p.locator('input[aria-label="touch scheme (A B C)"]');
  await sl.scrollIntoViewIfNeeded();
  const sb=await sl.boundingBox();
  await p.touchscreen.tap(sb.x+sb.width-3, sb.y+sb.height/2);
  await p.waitForTimeout(200);
  const sv=await p.evaluate(async()=>{ const m=await import('/lab/manta/params.js'); return m.P.scheme; });
  const page=await p.evaluate(()=>({ scrollY, scale: visualViewport.scale, overflowX: document.documentElement.scrollWidth-innerWidth }));
  console.log('drawer: toggle', tb?'found':'missing', '| opened by tap', open, '| scrollTop', before, '->', after, '| slider tap -> scheme', sv, '| page', JSON.stringify(page));
  await p.screenshot({path:(process.env.MANTA_OUT || '/tmp')+'/s3-drawer.png'});
} catch(e){ console.log('drawer check failed: '+e.message.slice(0,200)); }

console.log('errors: '+JSON.stringify([...new Set(errs)]).slice(0,600));
clearTimeout(die); await b.close(); process.exit(0);
