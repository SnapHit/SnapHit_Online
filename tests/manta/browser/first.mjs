/* 4D part 3: the protected first run in the page (design doc 10.8, sim.js
   protect). On the feedback page in solo, held at its first frame
   (?paused=1) and stepped by hand: your first run starts with no
   followers, at least three wild mantas within 200 units and no other
   leader within 450, guarded; the first recruit comes within 3 s of play;
   at 30 s a bot's short train is brought in to cross in front of you,
   from off the screen; after a crash the next run is not protected;
   ?first=0 and the lab page start as before. (The room's side is
   room-first/unit.mjs; the portal test checks the package starts
   guarded.) Run with lib/serve.sh. */
import { chromium } from '../lib/tools.mjs';
const O = 'http://127.0.0.1:' + process.env.PORT, X = +process.env.WATCHDOG_X || 1;
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 100000 * X);
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x ? '  [' + x + ']' : '')); };
const b = await chromium.launch({ executablePath: process.env.CHROME,
  args: ['--enable-unsafe-webgpu', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const errs = [];
async function open (ctx, url) {
  const p = await ctx.newPage(); p.setDefaultTimeout(30000 * X); p.setDefaultNavigationTimeout(30000 * X);
  p.on('console', c => { if (c.type() === 'error') errs.push(c.text().slice(0, 140)); });
  p.on('pageerror', e => errs.push('pageerror: ' + e.message.slice(0, 140)));
  await p.goto(O + url, { waitUntil: 'load' }).catch(e => console.log('goto ' + e.message));
  await p.waitForFunction(() => window.__labReady === true, null, { timeout: 25000 * X }).catch(() => console.log('(no ready)'));
  return p;
}
const start = p => p.evaluate(() => { const S = window.__sim, y = S.you;
  const near = S.wild.filter(m => m && m.alive && Math.hypot(m.x - y.x, m.z - y.z) < 200).length;
  const other = Math.min(...S.rivals.filter(t => !(t.dead > 0)).map(t => Math.hypot(t.x - y.x, t.z - y.z)));
  return { guard: !!y.guard, first: !!y.first, len: y.followers.length, near, other: Math.round(other) }; });
const Q = '?solo=1&tier=low&backend=webgl2&fx=off&hint=0&paused=1';
const phone = await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
{
  const p = await open(phone, '/lab/manta/play/' + Q);
  const a = await start(p);
  /* The page's controls write sim.input every step: stood aside, so the steering here holds. */
  await p.evaluate(() => { if (window.__lab.controls) window.__lab.controls.apply = () => {}; });
  ok('the first run starts guarded, with no followers, ' + a.near + ' wild mantas within 200 and the nearest other leader ' + a.other + ' away', a.guard && a.first && a.len === 0 && a.near >= 3 && a.other >= 450, JSON.stringify(a));
  /* Swim at the nearest wild manta, 0.1 s a step, for 3 s at most. */
  const r = await p.evaluate(() => { const L = window.__lab, S = window.__sim, y = S.you; const t0 = S.time;
    for (let i = 0; i < 30 && !y.followers.length; i++) { let best = null, bd = 1e9; for (const m of S.wild) if (m && m.alive) { const d = Math.hypot(m.x - y.x, m.z - y.z); if (d < bd) { bd = d; best = m; } }
      S.input.want = Math.atan2(-(best.x - y.x), -(best.z - y.z)); L.step(0.1); }
    return { t: +(S.time - t0).toFixed(2), len: y.followers.length }; });
  ok('the first recruit within 3 s of play (' + r.t + ' s)', r.len > 0 && r.t <= 3, JSON.stringify(r));
  /* On to 31 s, the leader held on a gentle circle in clear water. */
  const c = await p.evaluate(() => { const L = window.__lab, S = window.__sim, y = S.you; let k = 0, at = null;
    let len = null, ahead = null, dist = null, crossing = false;
    while (S.time - y.first.at < 31 && k++ < 400) { S.input.want = y.head + 0.4; L.step(at === null && S.time - y.first.at > 29.5 ? 1 / 60 : 0.25); if (y.dead > 0) break;
      if (y.first.crossed && at === null) { at = S.time - y.first.at; const o = S.rivals.find(t => t.id === y.first.crosser), fx = -Math.sin(y.head), fz = -Math.cos(y.head);
        if (o) { len = o.followers.length; crossing = !!o.crossing; ahead = Math.round((o.x - y.x) * fx + (o.z - y.z) * fz); dist = Math.round(Math.hypot(o.x - y.x, o.z - y.z)); } } }
    return { dead: y.dead > 0, crossed: y.first.crossed, at, id: y.first.crosser, len, crossing, ahead, dist }; });
  /* Brought in 300 ahead (less the step the leader turned through) and 700 to one side, out of a phone's view (a 412x915 screen shows about 257x570 units at the start). */
  ok('at 30 s a bot\'s short train (8) is brought in, from off the screen, to cross in front of you', !c.dead && c.crossed && c.id !== null && c.len >= 8 && c.len <= 9 && c.crossing && c.at >= 29.9 && c.at < 30.2 && c.ahead > 150 && c.dist > 650, JSON.stringify(c));
  const n = await p.evaluate(() => { const L = window.__lab, S = window.__sim; S.crash(S.you, null, 'reef'); for (let i = 0; i < 4; i++) L.step(0.5); S.you.go = true; for (let i = 0; i < 3; i++) L.step(0.1); return { dead: S.you.dead > 0, guard: !!S.you.guard, first: !!S.you.first, runs: S.you.runs }; });
  ok('after a crash the next run is not protected', !n.dead && !n.guard && !n.first, JSON.stringify(n));
  await p.close();
}
for (const [what, url] of [['?first=0', '/lab/manta/play/' + Q + '&first=0'], ['the lab page', '/lab/manta/' + Q.replace('solo=1&', '')]]) {
  const p = await open(phone, url);
  const a = await start(p);
  ok(what + ': the first run starts as before, unguarded', !a.guard && !a.first, JSON.stringify(a));
  await p.close();
}
ok('no console errors', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
clearTimeout(die); await b.close();
console.log(bad ? 'FAILED ' + bad : 'ALL PASS');
process.exit(bad ? 1 : 0);
