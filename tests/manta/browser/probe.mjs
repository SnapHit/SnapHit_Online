/* Does the page compile its shaders on WebGL2? One page, console errors out. */
import { chromium } from '../lib/tools.mjs';
const O=('http://127.0.0.1:' + process.env.PORT);
const die=setTimeout(()=>{console.log('WATCHDOG');process.exit(3);},80000);
const b=await chromium.launch({executablePath:process.env.CHROME,
  args:['--enable-unsafe-webgpu','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const ctx=await b.newContext({viewport:{width:412,height:915},deviceScaleFactor:1});
const p=await ctx.newPage(); p.setDefaultTimeout(30000); p.setDefaultNavigationTimeout(30000);
const errs=[];
p.on('console',c=>{if(c.type()==='error')errs.push(c.text().replace(/\u0000/g,'').slice(0,120));});
p.on('pageerror',e=>errs.push('pageerror: '+e.message.slice(0,120)));
const warns=[]; p.on('console',c=>{if(c.type()==='warning')warns.push(c.text().replace(/\s+/g,' ').slice(0,200));});
const q=process.env.Q||'?tier=high&backend=webgl2';
await p.goto(O+'/lab/manta/'+q,{waitUntil:'load'}).catch(e=>console.log('goto '+e.message));
await p.waitForFunction(()=>window.__labReady===true,null,{timeout:25000}).catch(()=>console.log('(no ready)'));
await p.waitForTimeout(6000);
const info=await p.evaluate(()=>({ back:document.getElementById('chipBackend')?.textContent,
  err:(document.getElementById('err')?.textContent||'').slice(0,300),
  sub:(document.getElementById('sub')?.textContent||'').slice(0,200),
  count:window.__lab.mantas.count, vb:window.__lab.mantas.vertexBuffers,
  len:window.__sim?window.__sim.you.followers.length:-1 })).catch(e=>({error:e.message}));
console.log(q, JSON.stringify(info));
console.log('errors: '+JSON.stringify([...new Set(errs)]).slice(0,600));
console.log('warnings: '+JSON.stringify([...new Set(warns)]).slice(0,800));
console.log('chip: '+await p.evaluate(()=>document.getElementById('chip').textContent.replace(/\s+/g,' ').trim()).catch(()=>'?'));
clearTimeout(die); await b.close(); process.exit(0);
