/* 3L stage 2: THE RADAR in the solo lab (static server on 8959). */
import { chromium } from '../lib/tools.mjs';
const O = ('http://127.0.0.1:' + process.env.PORT), SP = (process.env.MANTA_OUT || '/tmp') || '/tmp';
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 88000);
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x ? '  [' + x + ']' : '')); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await chromium.launch({ executablePath: process.env.CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, hasTouch: true })).newPage();
p.setDefaultTimeout(30000); p.setDefaultNavigationTimeout(30000);
const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0, 160))); p.on('console', c => { if (c.type() === 'error' && !/popErrorScope/.test(c.text())) errs.push(c.text().slice(0, 160)); });
await p.goto(O + '/lab/manta/?backend=webgl2&tier=low&seed=20261002', { waitUntil: 'load' });
await p.waitForFunction(() => window.__labReady && window.__sim && window.__radar && window.__radar.last, null, { timeout: 30000 }).catch(() => {});
await wait(7000);
const r1 = await p.evaluate(() => {
  const S = window.__sim, R = window.__radar, cv = R.ui.canvas, g = cv.getContext('2d'), pr = cv.width / cv.getBoundingClientRect().width;
  const info = R.last, sc = info.scale, c = info.centre, out = { dots: [], lines: [] };
  for (const t of S.trains) {
    if (t.dead > 0) continue;
    const m = R.model.trains.get(t.id); if (!m) { out.dots.push({ id: t.id, missing: true, off: 99 }); continue; }
    const [hx, hz] = R.model.headAt(m, performance.now());
    out.dots.push({ id: t.id, off: +Math.hypot((c + hx * sc) - (c + t.x * sc), (c + hz * sc) - (c + t.z * sc)).toFixed(2) });
    let worst = 0; for (const f of t.followers) { let best = 1e9; for (let i = 0; i < m.path.length; i += 2) best = Math.min(best, Math.hypot(m.path[i] - f.x, m.path[i + 1] - f.z)); worst = Math.max(worst, best); }
    out.lines.push({ id: t.id, len: t.followers.length, pts: m.path.length / 2, worst: +worst.toFixed(1) });
  }
  return out;
});
ok('every leader\'s dot sits within 1 radar px of its true position (' + r1.dots.length + ' trains)', r1.dots.length >= 10 && r1.dots.every(d => !d.missing && d.off <= 1), JSON.stringify(r1.dots.map(d => d.off)));
ok('each line follows its train: every follower within 60 units of its radar path', r1.lines.filter(l => l.len > 0).length >= 2 && r1.lines.every(l => l.worst <= 60), JSON.stringify(r1.lines.map(l => l.len + ':' + l.worst)));
const r2 = await p.evaluate(() => { const S = window.__sim, R = window.__radar, cv = R.ui.canvas, g = cv.getContext('2d'), pr = cv.width / cv.getBoundingClientRect().width, sc = R.last.scale, c = R.last.centre;
  const dealt = window.__lab.mantas.colours, hexOf = id => id === S.you.id ? dealt.mine.hex : dealt.rivals[(id - 1) % dealt.rivals.length].hex;
  const out = []; for (const t of S.trains) { if (t.dead > 0) continue; const h = hexOf(t.id), want = [(h >> 16) & 255, (h >> 8) & 255, h & 255];
    const d = g.getImageData(Math.round((c + t.x * sc) * pr), Math.round((c + t.z * sc) * pr), 1, 1).data;
    const exp = want.map((v, i) => 0.9 * v + 0.1 * [4, 9, 18][i]), err = Math.max(...exp.map((v, i) => Math.abs(v - d[i])));
    out.push({ id: t.id, err: Math.round(err), got: [d[0], d[1], d[2]], want }); } return out; });
ok('dot colours match the trains\' colours (sampled at the dots\' centres, within 40 per channel)', r2.length >= 10 && r2.every(q => q.err <= 40), r2.map(q => q.id + ':' + q.err).join(' '));
const r3 = await p.evaluate(async () => { const S = window.__sim, R = window.__radar, wait = ms => new Promise(r => setTimeout(r, ms));
  const bot = S.rivals.find(t => !(t.dead > 0) && t.followers.length >= 6) || S.rivals.find(t => !(t.dead > 0)), id = bot.id, cutBot = S.rivals.filter(t => t !== bot && !(t.dead > 0) && t.followers.length >= 2).sort((a, c) => c.followers.length - a.followers.length)[0];
  const before = R.last.drawn; S.crash(bot, null, 'reef'); await wait(600);
  const gone = !R.model.trains.get(id).alive, drawnAfter = R.last.drawn;
  let maxSeg = 0, restarted = false; const t0 = performance.now();
  while (performance.now() - t0 < 14000) { await new Promise(r => requestAnimationFrame(r)); const m = R.model.trains.get(id);
    if (!(bot.dead > 0)) restarted = true;
    if (m && m.alive) for (let i = 2; i < m.path.length; i += 2) maxSeg = Math.max(maxSeg, Math.hypot(m.path[i] - m.path[i - 2], m.path[i + 1] - m.path[i - 1])); if (restarted && performance.now() - t0 > 3000) break; }
  return { id, before, drawnAfter, gone, restarted, maxSeg: Math.round(maxSeg) }; });
ok('a crash removes the train from the radar', r3.gone && r3.drawnAfter === r3.before - 1, 'bot ' + r3.id + ': drawn ' + r3.before + ' -> ' + r3.drawnAfter);
ok('its restart starts a new line, never a streak across the map (longest segment under 150 units)', r3.restarted && r3.maxSeg < 150, 'restarted ' + r3.restarted + ', longest segment ' + r3.maxSeg);
await p.waitForFunction(() => !(window.__sim.you.dead > 0), null, { timeout: 15000 }).catch(() => {});
const box = await p.evaluate(() => window.__radar.ui.canvas.getBoundingClientRect().toJSON());
const cx = box.x + box.width / 2, cy = box.y + box.height / 2, cdp = await p.context().newCDPSession(p);
await p.evaluate(() => { window.__lab.params.P.scheme = 0; window.__sim.input.want = null; });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] }); await wait(700);
const wantA = await p.evaluate(() => window.__sim.input.want);
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await wait(1200);
await p.evaluate(() => { window.__lab.params.P.scheme = 2; window.__sim.input.burst = false; }); await wait(400);
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] }); await wait(700);
const burstC = await p.evaluate(() => window.__sim.input.burst);
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
ok('a touch over the radar steers in scheme A and bursts in scheme C (it passes through)', wantA !== null && burstC === true, 'A want ' + (wantA === null ? 'null' : wantA.toFixed(2)) + ', C burst ' + burstC + ' at ' + Math.round(cx) + ',' + Math.round(cy));
await p.evaluate(() => { window.__lab.params.P.scheme = 0; });
const r4 = await p.evaluate(async () => { const S = window.__sim, R = window.__radar, P = window.__lab.params.P, wait = ms => new Promise(r => setTimeout(r, ms));
  const you = S.you, sp = S.params.spacing, total = 540 * sp, b = 120 / (2 * Math.PI), pts = []; let th = 1, l = 0, x = b * Math.cos(1), z = b * Math.sin(1); pts.push({ x, z, l });
  while (l < total) { th += (sp / 4) / (b * Math.sqrt(1 + th * th)); const nx = b * th * Math.cos(th), nz = b * th * Math.sin(th); l += Math.hypot(nx - x, nz - z); x = nx; z = nz; pts.push({ x, z, l }); }
  you.trail.length = 0; for (const q of pts) you.trail.push({ x: q.x, z: q.z, h: 0, s: you.s - (total - q.l) }); you.x = x; you.z = z; you.followers.length = 0; for (let k = 0; k < 500; k++) you.followers.push({ x, z, head: 0, born: -100, from: -1 });
  await wait(800);
  const ms = []; for (let k = 0; k < 40; k++) { await new Promise(r => requestAnimationFrame(r)); ms.push(R.ui.ms); }
  ms.sort((a, c) => a - c);
  const trains = [...R.model.trains.values()].filter(t => t.alive).length, mine = R.model.trains.get(you.id), lenAtCost = you.followers.length, ptsAtCost = mine ? mine.path.length / 2 : 0;
  P.radarRange = 800; await wait(900); const last800 = JSON.parse(JSON.stringify(R.last)), pr800 = P.radarRange;
  const within = S.rivals.filter(t => !(t.dead > 0) && (t.followers.length >= you.followers.length || Math.hypot(t.x - you.x, t.z - you.z) <= 800)).length;
  const drawn800 = R.last.drawn; P.radarRange = 0; await wait(900); const drawn0 = R.last.drawn;
  /* A cut of your own long train: its line shortens to the new length. */
  const m0 = R.model.trains.get(you.id), ptsBefore = m0.path.length / 2, lenBefore = you.followers.length; S.cutAt(you, 250, null); await wait(900);
  const m1 = R.model.trains.get(you.id); let u = 0; for (let i = 2; i < m1.path.length; i += 2) u += Math.hypot(m1.path[i] - m1.path[i - 2], m1.path[i + 1] - m1.path[i - 1]);
  const cut = { lenBefore, lenAfter: you.followers.length, ptsBefore, ptsAfter: m1.path.length / 2, pathUnits: Math.round(u), spacing: S.params.spacing };
  return { cut, last800, pr800, lenAtCost, ptsAtCost, msMed: ms[20], msMax: ms[39], trains, minePts: mine ? mine.path.length / 2 : 0, len: you.followers.length, within, drawn800, drawn0, alive: S.rivals.filter(t => !(t.dead > 0)).length }; });
console.log('COST ' + JSON.stringify(r4));
ok('cost per frame with ' + r4.trains + ' trains, yours ' + r4.lenAtCost + ' long (' + r4.ptsAtCost + ' path points): median under 1 ms', r4.lenAtCost >= 500 && r4.trains >= 10 && r4.msMed < 1, 'median ' + r4.msMed.toFixed(3) + ' ms, max ' + r4.msMax.toFixed(3) + ' ms');
ok('range 800 hides trains shorter than yours beyond 800 units and shows the rest; 0 shows every train', r4.drawn800 === r4.within + 1 && r4.drawn0 === r4.alive + 1, 'at 800: drawn ' + r4.drawn800 + ' (expected ' + (r4.within + 1) + '); at 0: ' + r4.drawn0 + ' (expected ' + (r4.alive + 1) + ')');
ok('a cut shortens a line to the train\'s new length (your 500-long train cut at 250)', r4.cut.lenAfter < r4.cut.lenBefore && r4.cut.pathUnits <= r4.cut.lenAfter * r4.cut.spacing + 120 && r4.cut.ptsAfter < r4.cut.ptsBefore, JSON.stringify(r4.cut));
await p.screenshot({ path: SP + '/radar-solo-412x915.png' });
ok('no page errors', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
await b.close(); console.log('radar failures: ' + bad); clearTimeout(die); process.exit(bad ? 1 : 0);
