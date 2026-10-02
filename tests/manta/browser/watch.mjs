/* Stage 1: does the page now say when something goes wrong? */
import { chromium } from '../lib/tools.mjs';
const O=('http://127.0.0.1:' + process.env.PORT);
const KNOWN=/Instance dropped in popErrorScope/;
const isKnown=t=>KNOWN.test(String(t));
const die=setTimeout(()=>{console.log('WATCHDOG');process.exit(3);},85000);
let bad=0; const ok=(n,c,x='')=>{if(!c)bad++;console.log((c?'  PASS  ':'  FAIL  ')+n+(x?'  ['+x+']':''));};
const BACK=process.env.BACK||'gpu';
const b=await chromium.launch({executablePath:process.env.CHROME,
  args:['--enable-unsafe-webgpu','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const ctx=await b.newContext({viewport:{width:412,height:915},deviceScaleFactor:1});
const p=await ctx.newPage(); p.setDefaultTimeout(30000); p.setDefaultNavigationTimeout(30000);
const errs=[]; p.on('pageerror',e=>errs.push('pageerror: '+e.message.slice(0,200)));
const q = BACK==='gl' ? '?tier=high&backend=webgl2' : '?tier=high';
await p.goto(O+'/lab/manta/'+q,{waitUntil:'load'}).catch(e=>console.log('  goto '+e.message));
await p.waitForFunction(()=>window.__labReady===true,null,{timeout:25000}).catch(()=>console.log('  (no ready)'));
await p.waitForTimeout(5000);
const row=n=>p.evaluate(nn=>{const dts=[...document.querySelectorAll('#rows dt')],
  dds=[...document.querySelectorAll('#rows dd')];
  const i=dts.findIndex(d=>d.textContent===nn); return i<0?null:dds[i].textContent;},n);
const backend=await p.evaluate(()=>document.getElementById('backend').dataset.name);
console.log('  backend: '+backend);
const issues=await row('errors'), watch=await row('error watch'), vbuf=await row('vertex buffers');
console.log('  errors row      : '+JSON.stringify(issues));
console.log('  error watch row : '+watch);
console.log('  vertex buffers  : '+vbuf);
ok('the panel has an errors row with counts', issues!==null && /error/.test(issues), String(issues));
ok('the panel says what it is watching', watch!==null && watch!=='' && watch!=='no renderer', String(watch));
if (backend==='WebGPU') ok('the GPU device itself is watched on WebGPU', /device/.test(String(watch)), String(watch));
ok('vertex buffers still 6 of 8', /^6 of 8/.test(String(vbuf)), String(vbuf));

/* A console warning must be listed and must NOT mark the chip. */
const before=await p.evaluate(()=>document.querySelectorAll('#chip .warn').length);
await p.evaluate(()=>console.warn('lab self-test warning'));
await p.waitForTimeout(200);
const afterWarn=await row('errors');
const warnMark=await p.evaluate(()=>document.querySelectorAll('#chip .warn').length);
console.log('  after a console.warn : '+JSON.stringify(afterWarn));
ok('a warning is counted', /1 warning/.test(String(afterWarn)), String(afterWarn));
ok('a warning does not mark the chip', warnMark===before, 'marks '+before+' -> '+warnMark);

/* A console error must be listed AND mark the chip. */
await p.evaluate(()=>console.error('lab self-test error'));
await p.waitForTimeout(200);
const afterErr=await row('errors');
const errMark=await p.evaluate(()=>document.querySelectorAll('#chip .warn').length);
console.log('  after a console.error: '+JSON.stringify(afterErr));
ok('an error is counted and its text kept', /error/.test(String(afterErr)) && /self-test error/.test(String(afterErr)), String(afterErr));
ok('an error marks the chip', errMark>0, 'marks '+errMark);

/* An unhandled rejection on a page that is drawing is a mark, not a verdict. */
const headBefore=await p.evaluate(()=>document.getElementById('backend').className);
await p.evaluate(()=>{Promise.reject(new Error('lab self-test rejection'));});
await p.waitForTimeout(400);
const headAfter=await p.evaluate(()=>document.getElementById('backend').textContent);
const cls=await p.evaluate(()=>document.getElementById('backend').className);
console.log('  after a rejection on a drawing page: headline "'+headAfter+'" class "'+cls+'"');
ok('a drawing page is not declared FAILED by a stray rejection', !/FAILED/.test(headAfter) && cls!=='failed',
   headAfter+' / '+cls+' (was '+headBefore+')');

/* The original console is still the console. */
const passthrough=[];
p.on('console',m=>{if(m.type()==='error')passthrough.push(m.text());});
await p.evaluate(()=>console.error('lab passthrough check'));
await p.waitForTimeout(200);
ok('console.error still reaches the real console', passthrough.some(t=>/passthrough check/.test(t)),
   JSON.stringify(passthrough).slice(0,150));

const real=errs.filter(t=>!isKnown(t) && !/self-test rejection/.test(t));
const known=errs.filter(isKnown);
if(known.length) console.log('  (known environment artefact, '+known.length+'x: Instance dropped in popErrorScope)');
ok('no unexpected page errors', real.length===0, JSON.stringify([...new Set(real)]).slice(0,250));
console.log('\nwatch failures: '+bad);
clearTimeout(die); await b.close(); process.exit(bad?1:0);
