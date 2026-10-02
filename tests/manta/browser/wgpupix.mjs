/* Can WebGPU pixels be read headless after all? A Playwright screenshot of the
   WebGPU canvas is frozen here. Try copying the canvas into a 2D canvas right
   after a frame instead, which reads the canvas itself rather than whatever
   the compositor last presented. */
import { chromium } from '../lib/tools.mjs';
const O=('http://127.0.0.1:' + process.env.PORT);
const die=setTimeout(()=>{console.log('WATCHDOG');process.exit(3);},80000);
const b=await chromium.launch({executablePath:process.env.CHROME,
  args:['--enable-unsafe-webgpu','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
for (const [q,label] of [['?tier=high','WebGPU'],['?tier=high&backend=webgl2','WebGL2']]) {
  const ctx=await b.newContext({viewport:{width:412,height:915},deviceScaleFactor:1});
  const p=await ctx.newPage(); p.setDefaultTimeout(30000); p.setDefaultNavigationTimeout(30000);
  await p.goto(O+'/lab/manta/'+q,{waitUntil:'load'}).catch(e=>console.log('  goto '+e.message));
  await p.waitForFunction(()=>window.__labReady===true,null,{timeout:25000}).catch(()=>{});
  await p.waitForTimeout(5000);
  const grab=()=>p.evaluate(async()=>{
    const gl=document.getElementById('gl');
    /* Draw one frame, then copy immediately in the same task. */
    window.__lab.pause(); window.__lab.step(0.35);
    const c=document.createElement('canvas'); c.width=gl.width; c.height=gl.height;
    const g2=c.getContext('2d'); g2.drawImage(gl,0,0);
    const d=g2.getImageData(0,0,c.width,c.height).data;
    let sum=0, n=0, nonzero=0;
    for(let i=0;i<d.length;i+=4*97){ sum+=d[i]+d[i+1]+d[i+2]; n++; if(d[i]+d[i+1]+d[i+2]>0)nonzero++; }
    return {mean:sum/n, n, nonzero, w:c.width, h:c.height};});
  const a=await grab();
  await p.waitForTimeout(600);
  const c2=await grab();
  console.log('  '+label.padEnd(7)+' canvas '+a.w+'x'+a.h+'  mean '+a.mean.toFixed(2)+
    ' then '+c2.mean.toFixed(2)+'   non-black samples '+a.nonzero+'/'+a.n+
    '   moved: '+(Math.abs(a.mean-c2.mean)>0.05?'YES':'no'));
  await ctx.close();
}
clearTimeout(die); await b.close(); process.exit(0);
