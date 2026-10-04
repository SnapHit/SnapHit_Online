/* 4A stage 1: the controls hint. It shows the mouse-and-keys line on a
   desktop and the hold-and-double-tap line on a phone, on the lab page and
   the feedback page; it is visible while it shows, fades after about five
   seconds on a real clock, and goes at once on the first burst; ?hint=0
   keeps it off. Headless frames are slow here, so a step is forced where a
   frame is needed. */
import { chromium } from '../lib/tools.mjs';
const O = 'http://127.0.0.1:' + process.env.PORT;
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 85000);
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x ? '  [' + x + ']' : '')); };
const b = await chromium.launch({ executablePath: process.env.CHROME,
  args: ['--enable-unsafe-webgpu', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const errs = [];
async function open (ctx, url) {
  const p = await ctx.newPage(); p.setDefaultTimeout(30000); p.setDefaultNavigationTimeout(30000);
  p.on('console', c => { if (c.type() === 'error') errs.push(c.text().slice(0, 140)); });
  p.on('pageerror', e => errs.push('pageerror: ' + e.message.slice(0, 140)));
  await p.goto(O + url, { waitUntil: 'load' }).catch(e => console.log('goto ' + e.message));
  await p.waitForFunction(() => window.__labReady === true, null, { timeout: 25000 }).catch(() => console.log('(no ready)'));
  await p.waitForTimeout(800);
  return p;
}
const TAU = Math.PI * 2, wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const desk = await b.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1, hasTouch: false });

/* ---------------------------------------------------------------- the hint */
{
  const p = await open(desk, '/lab/manta/?tier=low&backend=webgl2');
  const h0 = await p.evaluate(() => { const H = window.__lab.hint, e = document.getElementById('hint'); return { shown: H && H.shown, text: H && H.text, mode: H && H.mode, display: e && getComputedStyle(e).display, touchMq: matchMedia('(hover: none) and (pointer: coarse)').matches }; });
  ok('desktop: the hint shows the mouse-and-keys line', h0.shown === true && h0.text === 'Mouse or arrow keys to steer · hold click or space to burst' && h0.display === 'block', JSON.stringify(h0));
  await p.waitForTimeout(1200);
  const op1 = await p.evaluate(() => getComputedStyle(document.getElementById('hint')).opacity);
  const early = await p.evaluate(() => { window.__lab.step(1 / 60); return window.__lab.hint.shown; });
  await p.waitForTimeout(4500);
  const h1 = await p.evaluate(() => { window.__lab.step(1 / 60); return { shown: window.__lab.hint.shown }; });
  await p.waitForTimeout(900);
  const h1b = await p.evaluate(() => { const e = document.getElementById('hint'); return { opacity: getComputedStyle(e).opacity, display: getComputedStyle(e).display }; });
  ok('it is visible while it shows (opacity ' + op1 + ' at 1.2 s, still shown) and fades after five seconds', +op1 > 0.5 && early === true && h1.shown === false && +h1b.opacity === 0 && h1b.display === 'none', JSON.stringify({ h1, h1b }));
  await p.close();
  const p2 = await open(desk, '/lab/manta/?tier=low&backend=webgl2&train=10');
  await p2.evaluate(() => window.__lab.pause());
  await p2.keyboard.down('Space');
  const h2 = await p2.evaluate(() => { window.__lab.step(1 / 60); return { shown: window.__lab.hint.shown, bursting: window.__sim.you.bursting }; });
  await p2.waitForTimeout(400);
  const h2b = await p2.evaluate(() => getComputedStyle(document.getElementById('hint')).opacity);
  await p2.keyboard.up('Space');
  ok('the first burst fades it at once (gone on that step, faded within 0.4 s)', h2.bursting === true && h2.shown === false && +h2b < 0.3, JSON.stringify({ h2, h2b }));
  await p2.close();
  const phone = await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const p3 = await open(phone, '/lab/manta/?tier=low&backend=webgl2');
  const h3 = await p3.evaluate(() => { const H = window.__lab.hint; return { shown: H.shown, text: H.text, touchMq: matchMedia('(hover: none) and (pointer: coarse)').matches }; });
  ok('touch: the hint shows the hold-and-double-tap line', h3.shown === true && h3.text === 'Hold where you want to swim · double-tap and hold to burst', JSON.stringify(h3));
  await p3.close();   // one page at a time: a second page rendering in the context starves the first
  const p4 = await open(phone, '/lab/manta/play/?solo=1&tier=low&backend=webgl2');
  const h4 = await p4.evaluate(() => { const H = window.__lab.hint, e = document.getElementById('hint'); return { shown: H && H.shown, text: H && H.text, display: e && getComputedStyle(e).display }; });
  ok('the feedback page shows it too (solo)', h4.shown === true && h4.text === 'Hold where you want to swim · double-tap and hold to burst' && h4.display === 'block', JSON.stringify(h4));
  await p4.close();
  const p5 = await open(phone, '/lab/manta/?tier=low&backend=webgl2&hint=0');
  const h5 = await p5.evaluate(() => ({ hint: window.__lab.hint, el: !!document.getElementById('hint') }));
  ok('?hint=0 keeps it off', h5.hint === null && h5.el === false, JSON.stringify(h5));
  await p5.close(); await phone.close();
}

await desk.close();
const real = errs.filter(e => !/popErrorScope/.test(e));
ok('no console errors', real.length === 0, JSON.stringify([...new Set(real)]).slice(0, 400));
clearTimeout(die); await b.close(); process.exit(bad ? 1 : 0);
