/* Does headless WebGPU draw here at all? Chromium 141 (the Playwright build)
   crashes r186's WebGPU path; puppeteer ships Chrome 153, which is what
   Nathan's phone runs. */
import { createRequire } from 'module';
const require = createRequire((process.env.MANTA_TOOLS || '').replace(/\/?$/, '/'));
const puppeteer = require('puppeteer');
const O=('http://127.0.0.1:' + process.env.PORT);
const die=setTimeout(()=>{console.log('WATCHDOG');process.exit(3);},80000);
const exe=process.env.CHROME || await puppeteer.executablePath();
console.log('  chrome: '+exe);
const b=await puppeteer.launch({executablePath:exe, headless:true,
  args:['--enable-unsafe-webgpu','--enable-features=Vulkan,UseSkiaRenderer',
        '--use-angle=swiftshader','--use-gl=angle','--ignore-gpu-blocklist','--no-sandbox']});
const p=await b.newPage();
await p.setViewport({width:412,height:915,deviceScaleFactor:2});
p.setDefaultTimeout(30000); p.setDefaultNavigationTimeout(30000);
const errs=[]; p.on('pageerror',e=>errs.push(String(e.message).slice(0,200)));
p.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text().slice(0,200));});
await p.goto(O+'/lab/manta/?tier=high',{waitUntil:'load'}).catch(e=>console.log('  goto '+e.message));
await p.waitForFunction('window.__labReady===true',{timeout:25000}).catch(()=>console.log('  (no ready)'));
await new Promise(r=>setTimeout(r,7000));
const info=await p.evaluate(()=>{
  const dts=[...document.querySelectorAll('#rows dt')],dds=[...document.querySelectorAll('#rows dd')];
  const row=n=>{const i=dts.findIndex(d=>d.textContent===n);return i<0?null:dds[i].textContent;};
  return {backend:document.getElementById('backend').textContent,
    draws:row('draw calls'), vbuf:row('vertex buffers'), lm:row('light memory'),
    fallback:row('fallback'), gpu:row('gpu'), err:document.getElementById('err').textContent.slice(0,200)};});
console.log('  backend row : '+info.backend);
console.log('  gpu         : '+info.gpu);
console.log('  draw calls  : '+info.draws+'   vertex buffers: '+info.vbuf);
if(info.err) console.log('  err box     : '+info.err.replace(/\n/g,' | '));
await p.screenshot({path:(process.env.MANTA_OUT || '/tmp')+'/wgpu.png'});
console.log('  page errors : '+JSON.stringify([...new Set(errs)]).slice(0,300));
clearTimeout(die); await b.close(); process.exit(0);
