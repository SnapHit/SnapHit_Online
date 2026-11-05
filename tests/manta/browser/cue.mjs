/* 4D ruling 1(b): the shield, taught (shieldcue.js). On the feedback page
   in solo, held at its first frame and stepped by hand (the page's
   controls stood aside, as first.mjs does):
     a bot's train laid across your path while you are guarded: you slip
     under it (no crash), a ring shows on your leader and, the first time,
     "First minute: you slip under trains" just below it;
     a second slip: the ring again, the words not again;
     on past 60 s in clear water: the guard ends, a ring fades out and
     "Now trains are deadly" shows, once; a later run says nothing;
     reduced flash and motion: the same words, the ring not growing;
     at 800x450 with a mouse and 360x800 as a phone, pixel ratio 1: the
     words on screen, at least 13 px, and clear of the board, radar,
     score and stats lines, your name and the hint (screenshots
     cue-<w>x<h>.png).
   Run with lib/serve.sh. */
import { chromium } from '../lib/tools.mjs';
const O = 'http://127.0.0.1:' + process.env.PORT, X = +process.env.WATCHDOG_X || 1, OUT = process.env.MANTA_OUT || '/tmp';
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 160000 * X);
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x ? '  [' + x + ']' : '')); };
const b = await chromium.launch({ executablePath: process.env.CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const errs = [];
async function open (ctx, url) {
  const p = await ctx.newPage(); p.setDefaultTimeout(30000 * X); p.setDefaultNavigationTimeout(30000 * X);
  p.on('console', c => { if (c.type() === 'error') errs.push(c.text().slice(0, 140)); });
  p.on('pageerror', e => errs.push('pageerror: ' + e.message.slice(0, 140)));
  await p.goto(O + url, { waitUntil: 'load' }).catch(e => console.log('goto ' + e.message));
  await p.waitForFunction(() => window.__labReady === true, null, { timeout: 25000 * X }).catch(() => console.log('(no ready)'));
  await p.evaluate(() => { window.__lab.pause(); if (window.__lab.controls) window.__lab.controls.apply = () => {}; });
  return p;
}
/* A bot's train of 12 laid straight across your path, 40 units ahead; your leader swims straight on through it. */
const slipThrough = (p, i = 0) => p.evaluate(i => {
  const L = window.__lab, S = window.__sim, y = S.you, r = S.rivals[i], P = S.params;
  const fx = -Math.sin(y.head), fz = -Math.cos(y.head), rx = -fz, rz = fx, hd = Math.atan2(rx, rz);
  const cx = y.x + fx * 40, cz = y.z + fz * 40, sp = P.spacing;
  r.dead = 0; r.followers.length = 0; r.trail.length = 0;
  /* Its leader 6 spacings to your left, heading further left; its body trails back across your path. */
  for (let d = 60 * sp; d >= 0; d -= sp / 4) r.trail.push({ x: cx - rx * 6 * sp + Math.sin(hd) * d, z: cz - rz * 6 * sp + Math.cos(hd) * d, h: hd, s: r.s - d });
  r.x = cx - rx * 6 * sp; r.z = cz - rz * 6 * sp; r.head = hd;
  for (let k = 0; k < 12; k++) r.followers.push({ x: r.x, z: r.z, head: hd, born: -100, from: -1 });
  /* Steered straight as the first run's crossing train is (a bot's: the shield never bends another player's train). */
  r.human = null; r.crossing = { until: S.time + 5, head: hd };
  S.input.want = y.head; S.input.burst = false;
  const runs = y.runs; let slips = 0; const push = S.events.push.bind(S.events);
  for (let i = 0; i < 30; i++) { L.step(1 / 60); }
  const st = L.follower.shieldCue.state;
  r.crossing = null;
  return { dead: y.dead > 0, runs: y.runs === runs, guarded: !!y.guarded, ...st };
}, i);
const rect = (p, sel) => p.evaluate(s => { const e = typeof s === 'string' ? document.querySelector(s) : null; if (!e) return null; const cs = getComputedStyle(e); if (cs.display === 'none' || e.hidden) return null; const q = e.getBoundingClientRect(); return q.width ? { x: q.x, y: q.y, right: q.right, bottom: q.bottom, font: parseFloat(cs.fontSize), text: e.textContent } : null; }, sel);
const Q = '/lab/manta/play/?solo=1&tier=low&backend=webgl2&fx=off&paused=1&bots=20';
for (const [w, h, touch] of [[800, 450, false], [360, 800, true]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch });
  const p = await open(ctx, Q);
  await p.evaluate(() => { for (let i = 0; i < 8; i++) window.__lab.step(0.2); });   // past the first swim's reveal
  const a = await slipThrough(p);
  ok(w + 'x' + h + ': guarded, you slip under a train: no crash, the ring and "First minute: you slip under trains"', !a.dead && a.runs && a.guarded && a.rings === 1 && a.ring && a.text === 'First minute: you slip under trains', JSON.stringify(a));
  await p.evaluate(() => new Promise(r => requestAnimationFrame(() => { window.__lab.step(1 / 60); r(); })));
  const say = await rect(p, '#shieldCue div[role=status]');
  const hud = {}; for (const id of ['board', 'radar', 'len', 'stats', 'meName', 'hint', 'sound']) hud[id] = await rect(p, '#' + id);
  const lab = await p.evaluate(() => [...document.querySelectorAll('#labels div')].filter(d => d.style.display !== 'none').map(d => { const q = d.getBoundingClientRect(); return { x: q.x, y: q.y, right: q.right, bottom: q.bottom }; }));
  await p.screenshot({ path: OUT + '/cue-' + w + 'x' + h + '.png' });
  const over = Object.entries(hud).filter(([k, q]) => q && say && !(say.right <= q.x || q.right <= say.x || say.bottom <= q.y || q.bottom <= say.y)).map(([k]) => k);
  const overLabel = lab.some(q => say && !(say.right <= q.x || q.right <= say.x || say.bottom <= q.y || q.bottom <= say.y));
  ok(w + 'x' + h + ': the words on screen at ' + (say && say.font) + ' px, clear of the board, radar, score, stats, your name, the hint, the sound pill and the names in the water', !!say && say.x >= 0 && say.right <= w && say.y >= 0 && say.bottom <= h && say.font >= 13 && over.length === 0 && !overLabel, (over.join(' ') || 'clear') + (overLabel ? ' over a name' : '') + ' ' + JSON.stringify(say));
  if (w === 800) {
    await p.waitForTimeout(400);
    const b2 = await slipThrough(p, 1);   // another train: under the same one again within 0.6 s is the same slip, as a cut is the same crossing
    ok('a second slip: the ring again, the words not again', !b2.dead && b2.rings === 2 && b2.ring && b2.slipTold && b2.text !== 'First minute: you slip under trains', JSON.stringify(b2));
    /* On past 60 s, in clear water: every rival out of the way. */
    const e = await p.evaluate(() => { const L = window.__lab, S = window.__sim, y = S.you;
      for (const r of S.rivals) { r.x = y.x + 1500 + r.id * 40; r.z = y.z + 1500; r.followers.length = 0; r.crossing = { until: S.time + 120, head: 0 }; }
      let k = 0; while (y.guard && k++ < 400) { S.input.want = y.head + 0.3; L.step(0.25); }
      for (let i = 0; i < 3; i++) L.step(1 / 60);
      return { dead: y.dead > 0, guarded: !!y.guarded, t: +(S.time - y.first.at).toFixed(2), ended: y.guardEnded, ...L.follower.shieldCue.state }; });
    ok('in clear water the guard ends after 60 s: a ring fading out and "Now trains are deadly"', !e.dead && !e.guarded && e.t >= 60 && e.endTold && e.ring && e.text === 'Now trains are deadly', JSON.stringify(e));
    await p.screenshot({ path: OUT + '/cue-end-800x450.png' });
    const f = await p.evaluate(() => { const L = window.__lab, S = window.__sim; S.crash(S.you, null, 'reef'); for (let i = 0; i < 8; i++) L.step(0.25); S.you.go = true; for (let i = 0; i < 4; i++) L.step(0.25); for (let i = 0; i < 20; i++) L.step(0.25); return { ...L.follower.shieldCue.state, guarded: !!S.you.guarded }; });
    ok('a later run is not guarded and says nothing more', !f.guarded && f.text === '' && f.rings === e.rings, JSON.stringify(f));
  }
  await ctx.close();
}
{
  const ctx = await b.newContext({ viewport: { width: 800, height: 450 }, deviceScaleFactor: 1, hasTouch: false });
  const p = await open(ctx, Q);
  await p.evaluate(() => { const c = document.getElementById('reduceFlash'); c.checked = true; c.dispatchEvent(new Event('change')); for (let i = 0; i < 8; i++) window.__lab.step(0.2); });
  const a = await slipThrough(p);
  const tf = await p.evaluate(() => window.__lab.follower.shieldCue.ringEl.style.transform);
  ok('reduced flash and motion: the same words, the ring at its own size (no growing)', a.text === 'First minute: you slip under trains' && /scale\(1(\.000)?\)/.test(tf), tf);
  await ctx.close();
}
const real = errs.filter(e => !/status of 501/.test(e));
ok('no console errors', real.length === 0, JSON.stringify(real.slice(0, 3)));
clearTimeout(die); await b.close();
console.log(bad ? 'FAILED ' + bad : 'ALL PASS');
process.exit(bad ? 1 : 0);
