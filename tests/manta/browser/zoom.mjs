/* 3L stage 1: THE CLOSE-UP CAMERA, in the solo lab (static server on 8958).
   The eased zoom (window.__lab.zoom) against the curve at six lengths; its
   change per frame through growth and a cut; a restart close in; the light
   memory's square and texel through the range; the seabed's repeat far out
   (autocorrelation at the tile period); screenshots at both ends. */
import { chromium } from '../lib/tools.mjs';
import fs from 'fs'; import { PNG } from '../lib/tools.mjs';
const O = ('http://127.0.0.1:' + process.env.PORT), SP = (process.env.MANTA_OUT || '/tmp') || '/tmp';
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 88000);
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x ? '  [' + x + ']' : '')); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await chromium.launch({ executablePath: process.env.CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, hasTouch: true })).newPage();
p.setDefaultTimeout(30000); p.setDefaultNavigationTimeout(30000);
const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0, 160))); p.on('console', c => { if (c.type() === 'error' && !/popErrorScope/.test(c.text())) errs.push(c.text().slice(0, 160)); });
await p.goto(O + '/lab/manta/?backend=webgl2&tier=low&seed=20261002', { waitUntil: 'load' });
await p.waitForFunction(() => window.__labReady && window.__sim && window.__lab.zoom && window.__lab.zoom() !== null, null, { timeout: 30000 }).catch(() => {});
await p.evaluate(() => { window.__lab.params.P.bots = 0; });   // no bots: they cut a laid train
await wait(500);
const state = () => p.evaluate(() => { const L = window.__lab, S = window.__sim; return { zoom: L.zoom(), len: S.you.followers.length, ppu: L.view.pxPerUnit, lmHalf: L.lm ? L.lm.uHalf.value : null, lmSize: L.lm ? L.lm.size : null, lmSteps: L.lm ? L.lm.resteps : null, shHalf: L.shadows ? L.shadows.uHalf.value : null, shSize: L.shadows ? L.shadows.size : null, dead: S.you.dead, runs: S.you.runs }; });
const curve = (len, P) => Math.max(P.zoomFar, P.zoomNear / Math.sqrt(1 + len / P.zoomHalf));
const P = await p.evaluate(() => ({ zoomNear: window.__lab.params.P.zoomNear, zoomFar: window.__lab.params.P.zoomFar, zoomHalf: window.__lab.params.P.zoomHalf, zoomEase: window.__lab.params.P.zoomEase }));
/* Per-frame change through everything below: 2% per 1/60 s of frame time. */
await p.evaluate(() => { window.__zl = []; let last = null, lt = performance.now(); const f = () => { const z = window.__lab.zoom(), t = performance.now(); if (last !== null && z !== null) window.__zl.push([+(z / last).toFixed(5), +(t - lt).toFixed(1), window.__sim.you.followers.length, window.__sim.you.dead > 0 ? 1 : 0, window.__sim.you.runs, +z.toFixed(4)]); last = z; lt = t; requestAnimationFrame(f); }; requestAnimationFrame(f); });
/* The scene clock, driven: quarter-second steps (the ease caps its step at 0.25 s), each checked against 2% per 1/60 s. */
await p.evaluate(() => { window.__drive = secs => { const L = window.__lab, S = window.__sim; let worst = 0; for (let i = 0; i < secs * 4; i++) { S.input.want = S.you.head + 1.0; const z0 = L.zoom(), r0 = S.you.runs; L.step(0.25); const z1 = L.zoom(); if (z0 && z1 && S.you.runs === r0) worst = Math.max(worst, Math.abs(z1 / z0 - 1) / (0.02 * 15)); } window.__driveWorst = Math.max(window.__driveWorst || 0, worst); return L.zoom(); }; });
const drive = secs => p.evaluate(s => window.__drive(s), secs);
const settled = [], ends = {};
for (const len of [0, 25, 50, 100, 300, 650]) {
  await p.evaluate(n => window.__sim.lay(n), len);
  await drive(len === 0 ? 2 : 8); await wait(300);
  const s = await state(); settled.push({ len: s.len, laid: len, want: +curve(s.len, P).toFixed(4), got: +s.zoom.toFixed(4), ppu: +s.ppu.toFixed(3) });
  if (len === 0 || len === 650) { ends[len] = s; await p.screenshot({ path: SP + '/zoom-' + (len === 0 ? 'near' : 'far') + '-412x915.png' }); }
}
console.log(JSON.stringify(settled));
ok('settled, the zoom matches near / sqrt(1 + length / half), floored at far, at the laid lengths 0, 25, 50, 100, 300 and 650 (the train recruits a few more while driven; the curve is taken at the length read)', settled.every(q => Math.abs(q.got - q.want) <= 0.01 * q.want), settled.map(q => q.laid + ' (now ' + q.len + '): ' + q.got + ' (curve ' + q.want + ')').join(', '));
/* LABELS AND THE RADAR AT BOTH ENDS: the label boxes against their leaders projected through the camera; the radar's dots against the true positions. */
const ENDS = async () => p.evaluate(() => { const L = window.__lab, S = window.__sim, cam = L.camera, P = S.params || {}, R = window.__radar;
  const me = cam.matrixWorldInverse.elements, pe = cam.projectionMatrix.elements;
  const proj = (x, z) => { const vx = me[0] * x + me[8] * z + me[12], vy = me[1] * x + me[9] * z + me[13], vz = me[2] * x + me[10] * z + me[14]; const nx = pe[0] * vx + pe[4] * vy + pe[8] * vz + pe[12], ny = pe[1] * vx + pe[5] * vy + pe[9] * vz + pe[13]; return [(nx + 1) / 2 * innerWidth, (1 - ny) / 2 * innerHeight]; };
  const ppu = L.view.pxPerUnit, lift = ((P.spacing || 31) + (P.followerR || 10) * (P.trainScale || 1) + 2) * ppu + 3, leaders = [];
  if (!(S.you.dead > 0)) leaders.push(S.you); for (const t of S.rivals || []) if (t && !t.hole && !(t.dead > 0)) leaders.push(t);
  let worst = 0, n = 0; for (const e of document.querySelectorAll('#labels > div')) { if (e.style.display === 'none') continue; const r = e.getBoundingClientRect(), ax = r.left + r.width / 2, ay = r.bottom; let best = 1e9; for (const q of leaders) { const [sx, sy] = proj(q.x, q.z); best = Math.min(best, Math.hypot(ax - sx, ay - (sy - lift))); } worst = Math.max(worst, best); n++; }
  let rworst = 0, rn = 0; if (R && R.last) { const sc = R.last.scale, c = R.last.centre; for (const t of S.trains) { if (t.dead > 0) continue; const m = R.model.trains.get(t.id); if (!m) { rworst = 99; continue; } const [hx, hz] = R.model.headAt(m, performance.now()); rworst = Math.max(rworst, Math.hypot((hx - t.x) * sc, (hz - t.z) * sc)); rn++; } }
  return { labels: n, worst: +worst.toFixed(2), radarDots: rn, radarWorst: +rworst.toFixed(2), zoom: +L.zoom().toFixed(3) }; });
await p.evaluate(() => window.__sim.lay(0)); await drive(8); await wait(300); const endNear = await ENDS();
await p.evaluate(() => window.__sim.lay(650)); await drive(8); await wait(300); const endFar = await ENDS();
ok('labels track their leaders within 2 CSS px at both ends of the zoom range', endNear.labels >= 1 && endFar.labels >= 1 && endNear.worst <= 2 && endFar.worst <= 2, 'near (zoom ' + endNear.zoom + '): ' + endNear.labels + ' labels, worst ' + endNear.worst + ' px; far (zoom ' + endFar.zoom + '): ' + endFar.labels + ' labels, worst ' + endFar.worst + ' px');
ok('the radar\'s dots sit within 1 radar px of the true positions at both ends', endNear.radarDots >= 1 && endFar.radarDots >= 1 && endNear.radarWorst <= 1 && endFar.radarWorst <= 1, 'near worst ' + endNear.radarWorst + ' px over ' + endNear.radarDots + ' dots; far worst ' + endFar.radarWorst + ' px over ' + endFar.radarDots);
/* A WAKE STAYS WHERE IT WAS LAID THROUGH A ZOOM STEP (pixels, WebGL2): the light memory read back at the world point your leader passed a moment ago, before and after the square steps. */
const wake = await p.evaluate(async () => { const L = window.__lab, S = window.__sim, lm = L.lm, wait = ms => new Promise(r => setTimeout(r, ms)); if (!lm || !L.renderer) return { skip: 'no memory or renderer' };
  await wait(1500); const you = S.you, pt = you.trail[Math.max(0, you.trail.length - 30)] || you;   // a point a little behind the leader: freshly stamped
  const read = async () => { const half = lm.uHalf.value, cx = lm.uCentre.value.x, cz = lm.uCentre.value.y, n = lm.size, u = (pt.x - cx) / (2 * half) + 0.5, v = (pt.z - cz) / (2 * half) + 0.5;
    const tx = Math.round(u * n), out = { half, px: 0, far: 0 }; const peek = async (ty) => { const x0 = Math.max(0, Math.min(n - 5, tx - 2)), y0 = Math.max(0, Math.min(n - 5, ty - 2)); const d = await L.renderer.readRenderTargetPixelsAsync(lm.target, x0, y0, 5, 5); let mx = 0; for (let i = 0; i < d.length; i += 4) mx = Math.max(mx, d[i], d[i + 1], d[i + 2]); return mx; };
    out.px = Math.max(await peek(Math.round(v * n)), await peek(Math.round((1 - v) * n)));
    const fx = Math.max(0, Math.min(n - 5, (tx + (n >> 1)) % n)), fd = await L.renderer.readRenderTargetPixelsAsync(lm.target, fx, Math.max(0, Math.min(n - 5, Math.round(v * n))), 5, 5); for (let i = 0; i < fd.length; i += 4) out.far = Math.max(out.far, fd[i], fd[i + 1], fd[i + 2]); return out; };
  const before = await read(), steps0 = lm.resteps;
  /* Widen the view a lot: the square steps up within a second. */
  const P = L.params.P, near0 = P.zoomNear; P.zoomNear = 0.6; P.zoomFar = 0.4;
  for (let i = 0; i < 40 && lm.resteps === steps0; i++) L.step(0.25);
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const after = await read(); P.zoomNear = near0;
  return { before, after, stepped: lm.resteps - steps0 }; });
console.log('WAKE ' + JSON.stringify(wake));
ok('a wake stays where it was laid through a zoom step: the memory at that world point keeps at least a third of its light (fading aside) and stays well above clear water', !wake.skip && wake.stepped >= 1 && wake.before.px > 2 * Math.max(1, wake.before.far) && wake.after.px >= wake.before.px / 3 && wake.after.px > 2 * Math.max(1, wake.after.far), JSON.stringify(wake));
await p.evaluate(() => window.__sim.lay(0)); await drive(6);
/* A cut that halves the train, then a restart. */
await p.evaluate(() => window.__sim.lay(300)); await drive(8);
const zBefore = (await state()).zoom;
await p.evaluate(() => { const S = window.__sim; S.cutAt(S.you, 149, null); });
await drive(4);
const sCut = await state();
ok('after a cut from 300 to 150 the view comes back in, eased: nearer than before, towards the curve', sCut.len <= 151 && sCut.zoom > zBefore && sCut.zoom <= curve(150, P) * 1.02, 'length ' + sCut.len + ', zoom ' + zBefore.toFixed(3) + ' -> ' + sCut.zoom.toFixed(3) + ' (curve ' + curve(150, P).toFixed(3) + ')');
/* The restart, on the injectable clock: the death beat stepped through at 1/60 s a step, not waited for on wall time. */
await p.evaluate(() => { window.__sim.you.dead = 1.5; for (let i = 0; i < 100; i++) window.__lab.step(1 / 60); });
await p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); await wait(300);
const log = await p.evaluate(() => window.__zl), driveWorst = await p.evaluate(() => window.__driveWorst || 0);
let worst = 0, worstDt = 0, over = 0, n = 0, restartZoom = null, restartLen = null, restartAbs = null;
for (let i = 1; i < log.length; i++) { const [r, dt, len, dead, runs, z] = log[i];
  if (runs !== log[i - 1][4]) { restartZoom = r; restartLen = len; restartAbs = z; continue; }   // the restart's own frame is a cut, by design
  const cap = 0.02 * Math.max(1, dt / (1000 / 60)); n++; const ch = Math.abs(r - 1); if (ch / cap > worst) { worst = ch / cap; worstDt = dt; } if (ch > cap + 1e-6) over++; }
const sEnd = await state(); const afterRestart = sEnd.zoom;
ok('the zoom never changes by more than 2% per 1/60 s of frame time, through growth, the cut and the death beat (' + n + ' real frames and the driven quarter-second steps)', n > 10 && over === 0 && driveWorst <= 1, 'worst ' + (worst * 2).toFixed(2) + '% per 1/60 s on a ' + worstDt + ' ms frame; driven steps at most ' + (driveWorst * 30).toFixed(1) + '% per 0.25 s (cap 30%); frames over the cap: ' + over);
ok('a restart (clock driven past the death beat) starts close in: on its first frame the zoom is the curve for the new train\'s length, no easing across the cut', sEnd.runs > 0 && restartAbs !== null && Math.abs(restartAbs - curve(restartLen, P)) <= 0.01 * curve(restartLen, P), 'runs ' + sEnd.runs + ', first frame zoom ' + restartAbs + ' at length ' + restartLen + ' (curve ' + (restartLen !== null ? curve(restartLen, P).toFixed(3) : '?') + '), a ' + (restartZoom ? ((restartZoom - 1) * 100).toFixed(0) : '?') + '% step from the frame before; later ' + afterRestart.toFixed(3) + (restartZoom ? ', the restart frame itself stepped ' + ((restartZoom - 1) * 100).toFixed(0) + '%' : ''));
/* The light memory and the shadow target across the range. */
const near = ends[0], far = ends[650];
const tex = s => s.lmHalf && s.lmSize ? (2 * s.lmHalf / s.lmSize) * s.ppu : null, texS = s => s.shHalf && s.shSize ? (2 * s.shHalf / s.shSize) * s.ppu : null;
console.log('LM near: half ' + near.lmHalf.toFixed(0) + ' units, ' + near.lmSize + ' texels, ' + tex(near).toFixed(2) + ' px per texel; far: half ' + far.lmHalf.toFixed(0) + ', ' + tex(far).toFixed(2) + ' px per texel; re-covered ' + far.lmSteps + ' times across the range. Shadow near ' + texS(near).toFixed(2) + ' px per texel, far ' + texS(far).toFixed(2));
ok('the light memory covers the view at both ends (its square at least the view\'s long side) and re-covered itself in steps, not every frame', near.lmHalf * 2 >= 915 / near.ppu && far.lmHalf * 2 >= 915 / far.ppu && far.lmSteps >= 1 && far.lmSteps <= 16, 'steps ' + far.lmSteps);
/* The seabed's repeat far out: correlation of the picture with itself shifted by one tile (300 units), against a shift of 0.5 and 0.37 tiles. */
const corrAt = (png, shift) => { const { width: W, height: H, data } = png; let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, k = 0;
  for (let y = Math.round(H * 0.3); y < H * 0.85; y += 2) for (let x = 0; x + shift < W; x += 2) { const i = (y * W + x) * 4, j = (y * W + x + shift) * 4; const a = data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11, c = data[j] * 0.3 + data[j + 1] * 0.59 + data[j + 2] * 0.11; sx += a; sy += c; sxx += a * a; syy += c * c; sxy += a * c; k++; }
  const mx = sx / k, my = sy / k; return (sxy / k - mx * my) / Math.sqrt((sxx / k - mx * mx) * (syy / k - my * my) + 1e-9); };
for (const [tag, s] of [['near', near], ['far', far]]) { const png = PNG.sync.read(fs.readFileSync(SP + '/zoom-' + tag + '-412x915.png')); const tile = Math.round(300 * s.ppu);
  if (tile < 412) { const c1 = corrAt(png, tile), c5 = corrAt(png, Math.round(tile * 0.5)), c3 = corrAt(png, Math.round(tile * 0.37));
    console.log('SEABED ' + tag + ': tile ' + tile + ' px; correlation at one tile ' + c1.toFixed(3) + ', at half ' + c5.toFixed(3) + ', at 0.37 ' + c3.toFixed(3));
    ok('seabed ' + tag + ': no visible tiling (the picture is no more like itself one tile over than at an unrelated shift, within 0.15)', c1 - Math.max(c5, c3) < 0.15, 'tile ' + tile + ' px: ' + c1.toFixed(3) + ' vs ' + Math.max(c5, c3).toFixed(3)); } else console.log('SEABED ' + tag + ': a tile is ' + tile + ' px, wider than the screen'); }
ok('no page errors', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
await b.close(); console.log('zoom failures: ' + bad); clearTimeout(die); process.exit(bad ? 1 : 0);
