/* 4A stage 1: the burst zoom. A burst widens the view a further 12 percent
   with a smoothstep ease out over 0.3 s and back over 0.6 s; the close-up
   camera's own zoom is untouched; the view the room is told (view.w) widens
   with it; reduced flash and motion halves it; the slider at 0 turns it off.
   The loop paused and stepped by exact seconds through __lab.step. */
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

/* ---------------------------------------------------------------- the burst zoom */
{
  const p = await open(desk, '/lab/manta/?tier=low&backend=webgl2&bots=0&train=40&hint=0');
  await p.evaluate(async () => { const m = await import('/lab/manta/params.js'); m.setParam('bots', 0); window.__lab.pause(); window.__lab.step(1 / 60); });
  const read = () => p.evaluate(() => ({ z: window.__lab.zoom(), d: window.__lab.zoomDrawn(), w: window.__lab.view.w, rw: window.__lab.roomView.w, rh: window.__lab.roomView.h, mix: window.__lab.follower.burstMix, len: window.__sim.you.followers.length }));
  const r0 = await read();
  await p.keyboard.down('Space');
  const seq = [];
  for (let k = 0; k < 3; k++) { await p.evaluate(() => window.__lab.step(0.1)); seq.push(await read()); }
  await p.evaluate(() => window.__lab.step(0.1)); const held = await read();
  await p.keyboard.up('Space');
  const back = [];
  for (let k = 0; k < 3; k++) { await p.evaluate(() => window.__lab.step(0.2)); back.push(await read()); }
  const ratio = r => r.d / r.z, sm = m => m * m * (3 - 2 * m), expect = m => 1 / (1 + 0.12 * sm(m));
  const near = (a, b, t = 0.004) => Math.abs(a - b) < t;
  ok('a burst widens the view 12% (zoom ratio 1/1.12 = 0.893) after 0.3 s and holds it', near(ratio(seq[2]), 1 / 1.12) && near(ratio(held), 1 / 1.12) && near(seq[2].w / r0.w, 1.12, 0.01), 'ratios ' + seq.map(r => ratio(r).toFixed(3)).join(' ') + ' held ' + ratio(held).toFixed(3) + ' view ' + Math.round(r0.w) + ' -> ' + Math.round(held.w));
  ok('it eases out: smoothstep at 0.1 and 0.2 s (' + expect(1 / 3).toFixed(3) + ', ' + expect(2 / 3).toFixed(3) + ')', near(ratio(seq[0]), expect(1 / 3)) && near(ratio(seq[1]), expect(2 / 3)), seq.slice(0, 2).map(r => ratio(r).toFixed(3)).join(' '));
  ok('it eases back over 0.6 s (0.2 s: ' + expect(2 / 3).toFixed(3) + ', 0.4 s: ' + expect(1 / 3).toFixed(3) + ', 0.6 s: 1)', near(ratio(back[0]), expect(2 / 3)) && near(ratio(back[1]), expect(1 / 3)) && near(ratio(back[2]), 1), back.map(r => ratio(r).toFixed(3)).join(' '));
  ok('the close-up camera\'s own zoom is untouched by it (follower.zoom at the curve, within its ease)', near(r0.z, held.z, 0.03), r0.z.toFixed(3) + ' ' + held.z.toFixed(3));
  ok('the drawn view widens with it: ' + Math.round(r0.w) + ' to ' + Math.round(held.w) + ' units, and back', near(held.w / r0.w, 1.12, 0.01) && near(back[2].w / r0.w, 1, 0.01));
  /* The room is told the base view: roomcore's 400-unit margin covers the widening, so bytes per phone do not change with a burst. */
  const margin = 400, extraW = (held.w - held.rw) / 2, extraH = (held.w / r0.w * r0.w * (915 / 412) - held.rh) / 2;
  ok('the view the room is told stays the base view through the burst (' + Math.round(r0.rw) + ' -> ' + Math.round(held.rw) + ' wide), and the room\'s 400-unit margin covers the widening (' + Math.round(extraW) + ' units in x)', near(held.rw / r0.rw, 1, 0.005) && near(held.rw / held.w, 1 / 1.12, 0.005) && extraW < margin, 'rw ' + held.rw.toFixed(1) + ' w ' + held.w.toFixed(1));
  /* Reduced motion halves it; the slider at 0 turns it off. */
  await p.evaluate(() => { const c = document.getElementById('reduceFlash'); c.checked = true; c.dispatchEvent(new Event('change')); });
  await p.keyboard.down('Space'); for (let k = 0; k < 4; k++) await p.evaluate(() => window.__lab.step(0.1)); const red = await read(); await p.keyboard.up('Space');
  for (let k = 0; k < 4; k++) await p.evaluate(() => window.__lab.step(0.2));
  ok('reduced flash and motion halves it (ratio 1/1.06 = 0.943)', near(ratio(red), 1 / 1.06), ratio(red).toFixed(3));
  await p.evaluate(async () => { const c = document.getElementById('reduceFlash'); c.checked = false; c.dispatchEvent(new Event('change')); const m = await import('/lab/manta/params.js'); m.setParam('burstZoom', 0); });
  await p.keyboard.down('Space'); for (let k = 0; k < 4; k++) await p.evaluate(() => window.__lab.step(0.1)); const off = await read(); await p.keyboard.up('Space');
  ok('the burst zoom slider at 0 turns it off (ratio 1)', near(ratio(off), 1) && off.len > 0, ratio(off).toFixed(3) + ' len ' + off.len);
  const spec = await p.evaluate(async () => { const m = await import('/lab/manta/params.js'); return m.SPEC.find(s => s.key === 'burstZoom'); });
  ok('the slider: burst zoom (%) 0 to 30, default 12', spec && spec.def === 12 && spec.min === 0 && spec.max === 30, JSON.stringify(spec));
  await p.close();
}
await desk.close();
const real = errs.filter(e => !/popErrorScope/.test(e));
ok('no console errors', real.length === 0, JSON.stringify([...new Set(real)]).slice(0, 400));
clearTimeout(die); await b.close(); process.exit(bad ? 1 : 0);
