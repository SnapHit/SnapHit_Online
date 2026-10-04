/* 4A stage 4: the pink manta on screen. Forced to appear next to you on a
   held page (?paused=1): drawn in its own slot where the simulation has
   it; dark from above (its own tint) and pink while its roll shows the
   belly; a pink dot on the radar where it is; a burst onto it catches it,
   adds ten followers at once and stamps a pink light burst where it was. */
import { chromium } from '../lib/tools.mjs';
const O = 'http://127.0.0.1:' + process.env.PORT, OUT = process.env.MANTA_OUT || '/tmp';
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 85000);
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x ? '  [' + x + ']' : '')); };
const b = await chromium.launch({ executablePath: process.env.CHROME, args: ['--enable-unsafe-webgpu', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const p = await ctx.newPage(); p.setDefaultTimeout(30000); p.setDefaultNavigationTimeout(30000);
const errs = []; p.on('console', c => { if (c.type() === 'error') errs.push(c.text().slice(0, 140)); }); p.on('pageerror', e => errs.push('pageerror: ' + e.message.slice(0, 140)));
await p.goto(O + '/lab/manta/?seed=7&paused=1&hint=0&tier=low&backend=webgl2&bots=0&train=20', { waitUntil: 'load' }).catch(e => console.log('goto ' + e.message));
await p.waitForFunction(() => window.__labReady === true && window.__labDrew === true, null, { timeout: 25000, polling: 100 }).catch(() => console.log('(no ready)'));
await p.evaluate(() => { for (let i = 0; i < 80; i++) window.__lab.step(1 / 60); });   // past the reveal
const h2f = h => { const e = (h >> 10) & 0x1f, m = h & 0x3ff; return e === 0 ? m / 1024 * Math.pow(2, -14) : (1 + m / 1024) * Math.pow(2, e - 15); };
/* Appear now, 90 units ahead of you, drifting with no roll. */
const r1 = await p.evaluate(async () => { const S = window.__sim, M = window.__lab.mantas, { PINK_SLOT } = await import('/lab/manta/mantas.js');
  const you = S.you, fx = -Math.sin(you.head), fz = -Math.cos(you.head);
  /* 90 units ahead, so it is on screen; its radar dot is checked later with it 700 units off, clear of your own marker. */
  S.pink.lastGone = -1e9; window.__lab.step(1 / 60); const pk = S.pink; pk.x = you.x + fx * 90; pk.z = you.z + fz * 90; pk.roll = -1; pk.rollAt = 1e9; window.__lab.step(1 / 60);
  const T = M.aTint; return { alive: pk.alive, slot: PINK_SLOT, drawn: [M.aPos.getX(PINK_SLOT), M.aPos.getZ(PINK_SLOT)], at: [pk.x, pk.z], tint: [T.getX(PINK_SLOT), T.getY(PINK_SLOT), T.getZ(PINK_SLOT)], size: M.aSize.getX(PINK_SLOT), lum: 0.2126 * T.getX(PINK_SLOT) + 0.7152 * T.getY(PINK_SLOT) + 0.0722 * T.getZ(PINK_SLOT), wildLum: (() => { const i = M.aTint; let s = 0, n = 0; for (let k = 0; k < 20; k++) { const w = 610 + k; s += 0.2126 * i.getX(w) + 0.7152 * i.getY(w) + 0.0722 * i.getZ(w); n++; } return s / n; })() }; });
ok('it is drawn in its own slot where the simulation has it', r1.alive && Math.abs(r1.drawn[0] - r1.at[0]) < 0.01 && Math.abs(r1.drawn[1] - r1.at[1]) < 0.01, JSON.stringify(r1.drawn) + ' vs ' + JSON.stringify(r1.at));
ok('from above it is dark: its tint\'s luminance ' + r1.lum.toFixed(3) + ' against a wild manta\'s ' + r1.wildLum.toFixed(3) + ' (a shape, not a light: between a fifth and a half)', r1.lum < 0.5 * r1.wildLum && r1.lum > 0.2 * r1.wildLum);
await p.screenshot({ path: OUT + '/pink-dark.png' });
/* The roll: belly up at 0.5. */
const r2 = await p.evaluate(async () => { const S = window.__sim, M = window.__lab.mantas, { PINK_SLOT } = await import('/lab/manta/mantas.js'); S.pink.roll = 0.5; S.pink.rollAt = 1e9; window.__lab.step(0); const T = M.aTint; const t = [T.getX(PINK_SLOT), T.getY(PINK_SLOT), T.getZ(PINK_SLOT)]; return { tint: t, size: M.aSize.getX(PINK_SLOT), roll: S.pink.roll }; });
ok('mid roll it flashes pink: red ' + r2.tint[0].toFixed(2) + ', green ' + r2.tint[1].toFixed(2) + ', blue ' + r2.tint[2].toFixed(2) + ', the span narrowed to ' + (r2.size / r1.size).toFixed(2), r2.tint[0] > 0.35 && r2.tint[1] < r2.tint[0] * 0.4 && r2.tint[2] > r2.tint[1] && r2.size < r1.size);
await p.screenshot({ path: OUT + '/pink-flash.png' });
/* The radar: a pink pixel where the dot should be. */
const r3 = await p.evaluate(() => { const R = window.__radar, S = window.__sim, cv = R.ui.canvas, g = cv.getContext('2d'); const you = S.you; S.pink.x = you.x + 700; S.pink.z = you.z - 300; window.__lab.step(0); const sc = R.last.scale, c = R.last.centre, pr = cv.width / cv.clientWidth; const x = Math.round((c + S.pink.x * sc) * pr), y = Math.round((c + S.pink.z * sc) * pr); const d = g.getImageData(Math.max(0, x - 4), Math.max(0, y - 4), 9, 9).data; let best = null; for (let i = 0; i < d.length; i += 4) { const [r, gg, b] = [d[i], d[i + 1], d[i + 2]]; if (r > 180 && gg < 150 && b > 120 && (!best || r > best[0])) best = [r, gg, b]; } return { best, x, y }; });
ok('a pink dot on the radar where it is', !!r3.best, JSON.stringify(r3));
/* The catch: you burst onto it. */
const r4 = await p.evaluate(async () => { const S = window.__sim, you = S.you, L = window.__lab, lm = L.lm; S.pink.roll = -1; const n0 = you.followers.length; S.pink.x = you.x; S.pink.z = you.z; const px = you.x, pz = you.z;
  window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })); L.step(1 / 60); L.step(1 / 60);
  window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }));
  const half = lm.uHalf.value, cx = lm.uCentre.value.x, cz = lm.uCentre.value.y, n = lm.size, u = (px - cx) / (2 * half) + 0.5, v = (pz - cz) / (2 * half) + 0.5; const tx = Math.max(1, Math.min(n - 2, Math.round(u * n)));
  let rr = 0, gg = 0, bb = 0; for (const ty of [Math.round(v * n), Math.round((1 - v) * n)]) { const y = Math.max(1, Math.min(n - 2, ty)); const d = await L.renderer.readRenderTargetPixelsAsync(lm.target, tx - 1, y - 1, 3, 3); for (let i = 0; i < d.length; i += 4) { rr = Math.max(rr, d[i]); gg = Math.max(gg, d[i + 1]); bb = Math.max(bb, d[i + 2]); } }
  return { n0, n1: you.followers.length, alive: S.pink.alive, caught: S.pink.caught, mem: [rr, gg, bb], half: lm.target.texture.type }; });
const mem = r4.mem.map(h2f);
ok('a burst onto it catches it and ten followers arrive at once: ' + r4.n0 + ' -> ' + r4.n1, !r4.alive && r4.caught === 1 && r4.n1 - r4.n0 >= 9 && r4.n1 - r4.n0 <= 10);
ok('a pink light burst is stamped where it was caught (memory r ' + mem[0].toFixed(3) + ', g ' + mem[1].toFixed(3) + ', b ' + mem[2].toFixed(3) + ')', mem[0] > 0.08 && mem[0] > 2 * mem[1] && mem[2] > mem[1]);
await p.screenshot({ path: OUT + '/pink-catch.png' });
const real = errs.filter(e => !/popErrorScope/.test(e));
ok('no console errors', real.length === 0, JSON.stringify([...new Set(real)]).slice(0, 300));
clearTimeout(die); await b.close(); process.exit(bad ? 1 : 0);
