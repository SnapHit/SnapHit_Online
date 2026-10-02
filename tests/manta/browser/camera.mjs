/* 3N: the two close-up camera checks zoom.mjs could not settle, re-proved
   with nothing able to crash the test train: no rival trains at all
   (?bots=0, before any spawn) and the train swims straight, so it cannot coil
   into itself. Everything runs on the injectable scene clock, one step at a
   time, and each reading is taken in the same step it describes.
     1. A restart's first frame is at the curve for the new train's length
        (close in), read on that same frame, not eased across the restart.
     2. A cut that halves the train: the view eases back in, at most 2% per
        1/60 s, and ends at the curve for the new length. The train never
        crashes while this runs. */
import { chromium } from '../lib/tools.mjs';
const O = 'http://127.0.0.1:' + process.env.PORT;
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 88000);
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x ? '  [' + x + ']' : '')); };
const b = await chromium.launch({ executablePath: process.env.CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, hasTouch: true })).newPage();
p.setDefaultTimeout(30000); p.setDefaultNavigationTimeout(30000);
const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0, 160))); p.on('console', c => { if (c.type() === 'error' && !/popErrorScope/.test(c.text())) errs.push(c.text().slice(0, 160)); });
await p.goto(O + '/lab/manta/?backend=webgl2&tier=low&seed=20261002&bots=0', { waitUntil: 'load' });
await p.waitForFunction(() => window.__labReady && window.__sim && window.__lab.zoom && window.__lab.zoom() !== null, null, { timeout: 30000 }).catch(() => {});
const P = await p.evaluate(() => { const P = window.__lab.params.P; return { zoomNear: P.zoomNear, zoomFar: P.zoomFar, zoomHalf: P.zoomHalf, bots: P.bots }; });
const curve = len => Math.max(P.zoomFar, P.zoomNear / Math.sqrt(1 + len / P.zoomHalf));
const rivals = await p.evaluate(() => (window.__sim.rivals || []).filter(t => t && !t.hole).length);
ok('no rival trains in the water (?bots=0)', P.bots === 0 && rivals === 0, 'bots ' + P.bots + ', rivals ' + rivals);

/* Swim straight on the scene clock: want = the heading it already has. */
await p.evaluate(() => { window.__straight = secs => { const L = window.__lab, S = window.__sim; for (let i = 0; i < secs * 4; i++) { S.input.want = S.you.head; L.step(0.25); } }; });

/* 1. The restart, first: the train starts near the centre, is laid to 650 and
   swims straight 5 s, so the view is well out when it dies. */
const rs = await p.evaluate(() => {
  const L = window.__lab, S = window.__sim;
  S.lay(650); window.__straight(5);
  const before = { zoom: L.zoom(), len: S.you.followers.length, dead: S.you.dead };
  const runs0 = S.you.runs; S.you.dead = 1.5;
  for (let i = 0; i < 400; i++) { L.step(1 / 60); if (S.you.runs !== runs0) return { before, i, zoom: L.zoom(), len: S.you.followers.length, x: S.you.x, z: S.you.z }; }
  return { before, i: -1 };
});
ok('the restart happened on the scene clock, from a live 650 train with the view well out', rs.i >= 0 && rs.before.dead === 0 && rs.before.len >= 600 && rs.before.zoom < 0.8 * P.zoomNear, 'step ' + rs.i + ', length ' + rs.before.len + ', zoom ' + rs.before.zoom.toFixed(3));
if (rs.i >= 0) {
  ok('a restart\'s first frame is at the curve for the new train\'s length, read on that frame', Math.abs(rs.zoom - curve(rs.len)) <= 0.01 * curve(rs.len), 'length ' + rs.len + ', zoom ' + rs.zoom.toFixed(3) + ', curve ' + curve(rs.len).toFixed(3) + ', out at ' + rs.before.zoom.toFixed(3) + ' the step before');
  ok('which is close in: the near zoom for a short train, no easing across the restart', rs.zoom >= 0.95 * P.zoomNear, 'zoomNear ' + P.zoomNear + ', zoom ' + rs.zoom.toFixed(3));
}

/* 2. The cut, from the restart's spot at the centre: lay 300, swim straight
   6 s (the reef is about 1,740 units out), cut to half, then 3 s in 1/60 s steps. */
const cut = await p.evaluate(() => {
  const L = window.__lab, S = window.__sim, runs0 = S.you.runs;
  S.lay(300); window.__straight(6);
  const before = { zoom: L.zoom(), len: S.you.followers.length, dead: S.you.dead, r: Math.hypot(S.you.x, S.you.z) };
  S.cutAt(S.you, Math.floor(before.len / 2) - 1, null);
  const steps = [];
  for (let i = 0; i < 180; i++) { S.input.want = S.you.head; const z0 = L.zoom(); L.step(1 / 60); steps.push([z0, L.zoom(), S.you.followers.length, S.you.dead]); }
  return { before, steps, runs0, runs: S.you.runs, r: Math.hypot(S.you.x, S.you.z) };
});
const first = cut.steps[0], last = cut.steps[cut.steps.length - 1];
let worst = 0; for (const [z0, z1] of cut.steps) worst = Math.max(worst, Math.abs(z1 / z0 - 1));
const crashed = cut.before.dead > 0 || cut.runs !== cut.runs0 || cut.steps.some(s => s[3] > 0);
ok('the test train never crashed through the lay, the swim and the cut', !crashed, 'runs ' + cut.runs0 + ' -> ' + cut.runs + ', ' + cut.before.r.toFixed(0) + ' -> ' + cut.r.toFixed(0) + ' units from the centre');
ok('before the cut the view was well out for the laid train', cut.before.zoom < 0.8 * P.zoomNear, 'length ' + cut.before.len + ', zoom ' + cut.before.zoom.toFixed(3) + ', curve ' + curve(cut.before.len).toFixed(3));
ok('the cut halves the train', first[2] <= Math.ceil(cut.before.len / 2) + 1, cut.before.len + ' -> ' + first[2]);
ok('the view does not jump on the cut: its first frame moves at most 2%', Math.abs(first[1] / first[0] - 1) <= 0.02, (100 * (first[1] / first[0] - 1)).toFixed(2) + '%');
ok('it eases back in: never more than 2% per 1/60 s step', worst <= 0.02, 'worst ' + (100 * worst).toFixed(2) + '% over ' + cut.steps.length + ' steps');
ok('and it comes in: nearer after three seconds than before the cut, towards the curve for the new length', last[1] > cut.before.zoom && last[1] <= curve(last[2]) * 1.02, 'zoom ' + cut.before.zoom.toFixed(3) + ' -> ' + last[1].toFixed(3) + ', curve at ' + last[2] + ' is ' + curve(last[2]).toFixed(3));
ok('no console errors', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
console.log('camera failures: ' + bad);
await b.close(); clearTimeout(die); process.exit(bad ? 1 : 0);
