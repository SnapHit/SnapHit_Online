/* 4A: pixel-for-pixel comparisons at a fixed seed and step on WebGL2.
   ?seed=7&paused=1&hint=0&tier=low: the loop stops at the first frame, the
   simulation and the light memory are held, and the page is stepped by
   exact sixtieths through __lab.step, then the canvas is read back.
     MODE=self   the same URL loaded twice draws the same pixels (the recipe is deterministic)
     MODE=ref    save the frame as REF (a PNG path), for a later comparison
     MODE=cmp    the frame against REF: identical, or how many pixels differ
   Q adds query terms to the second load in self mode, or to the only load
   otherwise (Q='look=classic'). STEPS (default 45) sixtieths before the shot. */
import { chromium, PNG } from '../lib/tools.mjs';
import fs from 'node:fs';
const O = 'http://127.0.0.1:' + process.env.PORT, OUT = process.env.MANTA_OUT || '/tmp';
const MODE = process.env.MODE || 'self', REF = process.env.REF || OUT + '/classic-ref.png', Q = process.env.Q || '', STEPS = +(process.env.STEPS || 45);
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 85000);
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x ? '  [' + x + ']' : '')); };
const b = await chromium.launch({ executablePath: process.env.CHROME,
  args: ['--enable-unsafe-webgpu', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const errs = [];
async function shot (q, name) {
  const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const p = await ctx.newPage(); p.setDefaultTimeout(30000); p.setDefaultNavigationTimeout(30000);
  p.on('console', c => { if (c.type() === 'error') errs.push(c.text().slice(0, 140)); });
  p.on('pageerror', e => errs.push('pageerror: ' + e.message.slice(0, 140)));
  await p.goto(O + '/lab/manta/?seed=7&paused=1&hint=0&tier=low&backend=webgl2' + (q ? '&' + q : ''), { waitUntil: 'load' }).catch(e => console.log('goto ' + e.message));
  await p.waitForFunction(() => window.__labReady === true && window.__labDrew === true, null, { timeout: 25000, polling: 100 }).catch(() => console.log('(no ready)'));
  await p.waitForTimeout(500);
  const r = await p.evaluate(n => { const L = window.__lab, S = window.__sim; const t0 = S.time; for (let i = 0; i < n; i++) L.step(1 / 60); return { t0, t: S.time, len: S.you.followers.length, seed: L.mantas && L.mantas.seed, zoom: L.zoom() }; }, STEPS);
  const path = OUT + '/' + name + '.png';
  /* The canvas alone: the interface is DOM and is not what the look changes. */
  const el = await p.$('#gl'); await el.screenshot({ path });
  await ctx.close();
  return { r, path };
}
const same = (a, c) => { const A = PNG.sync.read(fs.readFileSync(a)), C = PNG.sync.read(fs.readFileSync(c)); if (A.width !== C.width || A.height !== C.height) return { n: -1, pct: 100 }; let n = 0; for (let i = 0; i < A.data.length; i += 4) if (A.data[i] !== C.data[i] || A.data[i + 1] !== C.data[i + 1] || A.data[i + 2] !== C.data[i + 2]) n++; return { n, pct: 100 * n / (A.width * A.height) }; };
if (MODE === 'self') {
  const a = await shot('', 'classic-a'), c = await shot(Q, 'classic-b');
  const d = same(a.path, c.path);
  ok('the same seed and ' + STEPS + ' driven steps draw the same pixels twice (sim at 0 before, ' + a.r.t.toFixed(3) + ' s after, length ' + a.r.len + ' and ' + c.r.len + ')', a.r.t0 === 0 && c.r.t0 === 0 && d.n === 0 && a.r.len === c.r.len, d.n + ' pixels differ (' + d.pct.toFixed(3) + '%)');
} else if (MODE === 'ref') {
  const a = await shot(Q, 'classic-ref');
  fs.copyFileSync(a.path, REF);
  ok('reference saved to ' + REF + ' (sim ' + a.r.t.toFixed(3) + ' s, length ' + a.r.len + ')', a.r.t0 === 0, '');
} else {
  const a = await shot(Q, 'classic-cmp');
  const d = same(REF, a.path);
  ok('the frame matches the reference ' + REF + ' pixel for pixel (' + Q + ', ' + STEPS + ' steps, length ' + a.r.len + ')', a.r.t0 === 0 && d.n === 0, d.n + ' pixels differ (' + d.pct.toFixed(3) + '%)');
}
const real = errs.filter(e => !/popErrorScope/.test(e));
ok('no console errors', real.length === 0, JSON.stringify([...new Set(real)]).slice(0, 300));
clearTimeout(die); await b.close(); process.exit(bad ? 1 : 0);
