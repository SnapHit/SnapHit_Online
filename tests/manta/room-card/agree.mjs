/* 4E: the death card, the stats line and the score line agree, in a room
   and in solo. From a bug seen on the live site: a headless phone
   (412x915, touch) tapped Play on a first visit, sent no steering, joined
   the public room and hit the reef after about 15 s; the card read peak 2,
   "was 3", alive 0:00, while the stats line said best peak 5 and the score
   line peak 5, best 5. Four causes, all in what follow.js fed the card:
   - time alive summed the frame's dt, which renderer.js clamps to 0.1 s,
     so a page drawing a frame a second counted a room run of 40 s as 0:03;
   - the count-up ran on the same clamped dt, so on such a page it took ten
     seconds of the room's time, and was read half way (peak 2 of 5);
   - the best a run began with was read after that frame had folded the
     run's own peak in, so a first run whose first frame already carried
     recruits (a protected first run starts beside wild mantas; a slow
     frame holds several of the room's snapshots) read "was 3" of a best
     of 0;
   - the count went to the larger of this run's peak and the last run's
     (you.lastPeak), so a run shorter than the one before showed the one
     before's peak.
   And the stats line took a best from your drawn length, which in a room
   includes pickups the room may refuse.

   The room's own word is read off the WebSocket here in Node (roomcore.js
   decodeSnap), on this clock, so the checks do not depend on how slowly
   the page draws: when each run began and crashed, its peak, the guard
   and any bench.

   PART=room (wrangler dev, the public room): a fresh device: the name
     panel, Play, seated as a protected first run (the room's first word
     on your train guarded, run 1, at most two followers), at least
     three wild mantas within 200 of the seat in the first wild list;
     the first recruit and the distance to the reef straight ahead
     reported. No steering at all until it crashes (the shield slips
     trains, never the reef). Then, read once the count is done, which
     must be within COUNT_FOR of real time and a frame of the card
     showing: not benched as away during the run; the card's peak = the
     room's peak for the run = the score line's peak; the best line
     "your first best" (New best!), "was N" over a new best or "best N",
     N the room's best of the earlier runs; the stats and score lines'
     best both the best so far; the stats line's runs the room's; time
     alive the room's run, seat to wreck, within a second and a frame;
     the card naming what the room said got you. Two taps (skip, swim
     again) start a second, unguarded run, steered out to the reef,
     judged the same way. Screenshots agree-room-1.png, -2.png.
   PART=solo (?solo=1, paused and stepped by hand, as card.mjs): the same
     agreements for a protected first run left unsteered for 5 s then
     steered out to the reef, time alive against the simulation's clock;
     then a run laid longer than the best (New best!, "was N") and one
     shorter ("best N").
   The room part draws no frame for HITCH_MS (1200) as Play is tapped, as
   a slow page's frame does, so the room's first snapshots, recruits and
   all, land before the page's first frame as a player.
   Both when PART is unset. The room part loads the page with ?fx=off
   (README, slow containers): with the look on, a page here drew a frame
   every 3 to 7 s, sent its inputs as rarely, and the room benched it as
   away every few seconds, so its runs were a bot's. FX=on loads it with
   the look on, as the live page; the bench check then says if it was.

   DIRECT=1 tests/manta/lib/rooms.sh room-card/agree.mjs   (about 3 min on 2 cores) */
import { chromium } from '../lib/tools.mjs';
import { COUNT_FOR } from '../../../docs/lab/manta/card.js';
import { decodeSnap } from '../../../docs/lab/manta/roomcore.js';
const O = 'http://127.0.0.1:' + process.env.PORT, X = +process.env.WATCHDOG_X || 1, OUT = process.env.MANTA_OUT || '/tmp';
const PART = process.env.PART || '';
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 560000 * Math.min(X, 1));
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x ? '  [' + x + ']' : '')); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await chromium.launch({ executablePath: process.env.CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const errs = [];
async function phone () {
  const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  /* A recorder in the page, on its own timer (it runs between frames, however
     slow they are): the room's word on your train, the lines, the card. */
  await ctx.addInitScript(() => {
    window.__gaps = { last: 0, max: 0, n: 0 };
    const tick = t => { const g = window.__gaps; if (g.last) g.max = Math.max(g.max, t - g.last); g.last = t; g.n++; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  const p = await ctx.newPage(); p.setDefaultTimeout(30000 * X); p.setDefaultNavigationTimeout(60000 * X);
  p.on('console', c => { if (c.type() === 'error') errs.push(c.text().slice(0, 160)); });
  p.on('pageerror', e => errs.push('pageerror: ' + e.message.slice(0, 160)));
  return p;
}
const read = p => p.evaluate(() => {
  const S = window.__sim, y = S && S.you, R = window.__lab && window.__lab.room, me = R && R.me, C = window.__lab && window.__lab.card, c = C && C.state;
  return { at: performance.now(), dead: y ? y.dead || 0 : 0, peak: y ? y.peak : 0, lastPeak: y ? y.lastPeak : 0, how: y && y.crashHow, guarded: !!(y && y.guarded),
    me: me ? { dead: me.dead || 0, len: me.len || 0, g: !!me.g, x: me.x, z: me.z, h: me.h, runs: me.runs } : null, play: !!(R && R.play),
    card: c ? { shown: c.shown, t: c.t, to: c.to, newBest: c.newBest, ready: c.ready, alive: c.alive, bestAtStart: c.bestAtStart, text: c.text } : null,
    stats: (document.getElementById('stats') || {}).textContent || '', score: (document.getElementById('len') || {}).textContent || '',
    gap: window.__gaps.max, frames: window.__gaps.n, arenaR: S && S.params && S.params.arenaR, cruise: S && S.params && S.params.cruise, simTime: S ? S.time : 0 };
});
const num = (s, re) => { const m = String(s).match(re); return m ? +m[1] : null; };
const lines = s => ({ runs: num(s.stats, /runs (\d+)/), statsBest: num(s.stats, /best peak (\d+)/), scorePeak: num(s.score, /peak (\d+)/), scoreBest: num(s.score, /best (\d+)/) });
/* How far the leader would swim along its heading before the reef (forward is (-sin h, -cos h)). */
const toReef = (x, z, h, R) => { const dx = -Math.sin(h), dz = -Math.cos(h), bq = x * dx + z * dz, c = x * x + z * z - R * R; return -bq + Math.sqrt(Math.max(0, bq * bq - c)); };
const steerOut = p => p.evaluate(() => {
  if (window.__lab.controls) window.__lab.controls.apply = () => {};
  clearInterval(window.__out); window.__out = setInterval(() => { const y = window.__sim.you; window.__sim.input.want = Math.atan2(-y.x, -y.z); window.__sim.input.burst = false; }, 100);
});
/* The checks once the card's count is done: what each of the three says. */
function agree (tag, s, want) {
  const L = lines(s), c = s.card;
  ok(tag + ': the card counts to the peak the run reached, and the score line says the same peak', c.text.num === String(want.peak) && c.to === want.peak && L.scorePeak === want.peak,
     'card ' + c.text.num + ' (to ' + c.to + '), score line "' + s.score + '", the run\'s peak ' + want.peak);
  const bestText = want.before === 0 ? 'your first best' : want.peak > want.before ? 'was ' + want.before : 'best ' + want.before;
  ok(tag + ': the card\'s best line is "' + bestText + '" (best before the run ' + want.before + ', peak ' + want.peak + ')' + (want.peak > want.before ? ', with New best!' : ''),
     c.text.best === bestText && c.newBest === (want.peak > want.before), JSON.stringify({ best: c.text.best, newBest: c.newBest, bestAtStart: c.bestAtStart }));
  const best = Math.max(want.before, want.peak);
  ok(tag + ': the stats line\'s best peak and the score line\'s best are both ' + best, L.statsBest === best && L.scoreBest === best, '"' + s.stats + '" / "' + s.score + '"');
  ok(tag + ': the stats line counts ' + want.runs + ' run' + (want.runs > 1 ? 's' : ''), L.runs === want.runs, s.stats);
  const a = num(c.text.alive, /^(\d+):/) * 60 + num(c.text.alive, /:(\d+)$/);
  ok(tag + ': time alive ' + c.text.alive + ' is the run\'s ' + want.alive.toFixed(1) + ' s, within ' + want.slack.toFixed(1) + ' s', Math.abs(a - want.alive) <= want.slack,
     'card alive ' + c.alive.toFixed(2) + ' s, ' + c.text.alive);
}

if (!PART || PART === 'room') {
  const p = await phone();
  /* The room's own word on your train, read off the WebSocket here in Node,
     on this clock: when each run began and crashed, its peak, the guard,
     and any bench. Independent of how slowly the page draws. */
  const T0 = Date.now(), now = () => (Date.now() - T0) / 1000;
  const truth = new Map(), benched = [], gos = [];
  let firstMe = null, lastMe = null, seatNear = null;
  p.on('websocket', ws => {
    if (!/\/rooms\/ocean\//.test(ws.url())) return;
    ws.on('framesent', f => { if (typeof f.payload === 'string' && /"t":"go"/.test(f.payload)) gos.push(now()); });
    ws.on('framereceived', f => {
      const d = f.payload;
      if (typeof d === 'string') { try { const m = JSON.parse(d); if (m.t === 'benched') benched.push(now()); } catch (_) { /* not JSON */ } return; }
      const m = decodeSnap(d.buffer.slice(d.byteOffset, d.byteOffset + d.length));
      if (!m || !m.me) return;
      const me = m.me, t = now(); lastMe = me;
      if (!firstMe) firstMe = { ...me, at: t };
      /* Beside wild mantas? The first full wild list after the seat (five a second). */
      if (m.wa && !seatNear && firstMe && me.runs === firstMe.runs && !(me.dead > 0)) {
        const wild = m.wa.filter(w => !(w[4] & 1)), d = w => Math.hypot(w[1] - firstMe.x, w[2] - firstMe.z);
        const others = m.tr.filter(q => !q.dead && Math.hypot(q.x - me.x, q.z - me.z) > 1).map(q => Math.hypot(q.x - firstMe.x, q.z - firstMe.z));
        seatNear = { at: t - firstMe.at, near: wild.filter(w => d(w) <= 200).length, nearest: Math.round(Math.min(...wild.map(d))), leader: others.length ? Math.round(Math.min(...others)) : null };
      }
      let r = truth.get(me.runs);
      if (!r) truth.set(me.runs, r = { runs: me.runs, start: null, crash: null, peak: 0, how: null, g0: null, len0: null, recruitAt: null, guardTill: null });
      if (!(me.dead > 0) && r.start === null) { r.start = t; r.g0 = !!me.g; r.len0 = me.len; }
      if (me.g) r.guardTill = t;
      if (r.recruitAt === null && me.len >= 1) r.recruitAt = t;
      if (me.peak !== undefined) r.peak = me.peak;
      if (!(me.dead > 0)) r.peak = Math.max(r.peak, me.len);
      if (me.dead > 0 && r.crash === null) { r.crash = t; r.how = me.how; }
    });
  });
  const Q = '?tier=low' + (process.env.FX === 'on' ? '' : '&fx=off');
  await p.goto(O + '/lab/manta/play/' + Q, { waitUntil: 'load' });
  await p.waitForSelector('#playBtn', { state: 'visible', timeout: 60000 * X });
  ok('a fresh device: the name panel and its Play button', await p.isVisible('#namePanel'));
  await wait(2000);
  /* A hitch at Play, as the live page's slow frames: the page draws no
     frame for HITCH_MS (default 1200, under the room's 2 s away rule), so
     the seat and the room's next snapshots, a protected run's first
     recruits among them, are all in before the page's first frame. */
  const HITCH = process.env.HITCH_MS === undefined ? 1200 : +process.env.HITCH_MS;
  await p.evaluate(() => window.__lab.pause());
  await p.tap('#playBtn');
  await wait(HITCH);
  const h0 = await read(p);
  await p.evaluate(() => window.__lab.resume());
  console.log('  ' + HITCH + ' ms without a frame at Play: the room had given ' + (h0.me ? h0.me.len : 0) + ' recruits by the first frame');
  let t0 = Date.now();
  while (Date.now() - t0 < 60000 * X && !(firstMe && truth.get(firstMe.runs).start !== null)) await wait(50);
  ok('Play seats a player in the public room', !!firstMe, firstMe ? 'seated, run ' + firstMe.runs : 'no word from the room');
  if (!firstMe) { await b.close(); console.log('agree failures: ' + (bad + 1)); process.exit(1); }
  const r1 = truth.get(firstMe.runs), s0 = await read(p);
  /* The room seats you with no followers beside a knot and speaks after its next tick, so its first word can already carry a recruit (room-first/unit.mjs reads the seat itself). */
  ok('a protected first run: the room\'s first word says guarded, run 1, and at most two followers', r1.g0 && firstMe.runs === 1 && r1.len0 <= 2, JSON.stringify({ g: r1.g0, runs: firstMe.runs, len: r1.len0 }));
  for (let i = 0; i < 40 && !seatNear; i++) await wait(50);
  ok('it starts beside wild mantas: at least three within 200 units of the seat', !!seatNear && seatNear.near >= 3,
     seatNear ? seatNear.near + ' within 200 (the nearest ' + seatNear.nearest + ') in the first wild list, ' + seatNear.at.toFixed(2) + ' s after the seat; nearest other leader in view ' + seatNear.leader : 'no wild list');
  const reef = toReef(firstMe.x, firstMe.z, firstMe.h, s0.arenaR);
  console.log('  seat at ' + Math.round(Math.hypot(firstMe.x, firstMe.z)) + ' of ' + s0.arenaR + ' from the centre, ' + Math.round(reef) + ' units to the reef straight ahead (' + (reef / s0.cruise).toFixed(1) + ' s at cruise ' + s0.cruise + ')');
  /* The card a crash shows, read once its count is done; judged against the room's run. */
  const tap = () => p.touchscreen.tap(206, 300);
  async function judge (tag, before) {
    let shownAt = null, shownWall = null, doneAt = null, d; const t1 = Date.now();
    while (Date.now() - t1 < 300000 * X) {
      d = await read(p);
      if (d.card.shown && shownAt === null) { shownAt = d.at; shownWall = now(); }
      if (d.card.shown && d.card.text.num === String(d.card.to)) { doneAt = d.at; break; }
      await wait(50);
    }
    ok(tag + ': a crash, and its card', shownAt !== null, shownAt === null ? 'no card in 300 s' : '');
    if (shownAt === null) return null;
    ok(tag + ': the card\'s count is done within ' + COUNT_FOR + ' s of real time and a frame of being shown', doneAt !== null && doneAt - shownAt <= COUNT_FOR * 1000 + d.gap + 200,
       doneAt === null ? 'not done: ' + JSON.stringify(d.card.text) : ((doneAt - shownAt) / 1000).toFixed(2) + ' s, frames up to ' + (d.gap / 1000).toFixed(2) + ' s apart');
    await wait(300); d = await read(p);
    const run = [...truth.values()].filter(q => q.crash !== null && q.crash <= shownWall).pop(), earlier = [...truth.values()].filter(q => q.runs < run.runs && q.start !== null);
    const was = Math.max(before, ...earlier.map(q => q.peak));
    console.log('  ' + tag + ': the room\'s run ' + run.runs + ': ' + (run.how || '?') + ' after ' + (run.crash - run.start).toFixed(1) + ' s, peak ' + run.peak +
      (run.guardTill !== null ? ', guarded until ' + (run.guardTill - run.start).toFixed(1) + ' s' : '') + ', first recruit ' + (run.recruitAt === null ? 'none' : (run.recruitAt - run.start).toFixed(2) + ' s') +
      '; runs before it ' + JSON.stringify(earlier.map(q => [q.runs, q.peak, q.how])) + '; benched at ' + JSON.stringify(benched.map(t => +t.toFixed(1))) + ', go sent at ' + JSON.stringify(gos.map(t => +t.toFixed(1))) + ', runs began at ' + JSON.stringify([...truth.values()].map(q => [q.runs, q.start === null ? null : +q.start.toFixed(1)])) + '; frames ' + d.frames + ', longest gap ' + (d.gap / 1000).toFixed(2) + ' s');
    /* A page that draws a frame less often than every 2 s sends its inputs
       less often too, and the room benches it as away (rooms/ocean.js
       AWAY_MS): a bot takes the train, and brings a held one back. Such a
       run is not the case under test. */
    const inRun = benched.filter(t => t >= run.start - 2 && t <= run.crash);
    ok(tag + ': not benched as away during the run (the page\'s frames up to ' + (d.gap / 1000).toFixed(2) + ' s apart; the room benches at 2 s without an input)', inRun.length === 0,
       inRun.length ? 'benched at ' + JSON.stringify(inRun.map(t => +t.toFixed(1))) + ' s: too slow a page here, use the default ?fx=off' : '');
    agree(tag, d, { peak: run.peak, before: was, runs: earlier.length + 1, alive: run.crash - run.start, slack: 1 + d.gap / 1000 });
    ok(tag + ': the room said what got you, and the card says it: ' + (d.card.text.cause || '(nothing)'),
      run.how === 'reef' ? d.card.text.cause === 'You hit the reef' : /ran into|Head on|whale shark/.test(d.card.text.cause), run.how + ' / ' + d.card.text.cause);
    return { run, d };
  }
  /* No steering at all, as the live phone, until it crashes. */
  const j1 = await judge('room, first run', 0);
  if (j1) {
    const r = j1.run;
    /* Reported, not judged: left unsteered the leader swims at the knot's middle, which can be empty water (room-first/unit.mjs steers and judges it). */
    console.log('  room, first run: first recruit ' + (r1.recruitAt === null ? 'none' : (r1.recruitAt - r1.start).toFixed(2) + ' s') + ' after the seat, unsteered');
    await p.screenshot({ path: OUT + '/agree-room-1.png' });
    /* Two taps: skip the beat, swim again. Then steer out to the reef. */
    await wait(600);
    for (let i = 0; i < 6; i++) { const q = await read(p); if (q.card.ready) break; await tap(); await wait(400); }
    await tap();
    let back = null, tapAt = Date.now(); const t2 = Date.now();
    while (Date.now() - t2 < 60000 * X) {
      const n = [...truth.values()].find(q => q.runs > r.runs && q.start !== null); if (n) { back = n; break; }
      const q = await read(p); if (Date.now() - tapAt > 4000 && q.card.shown) { await tap(); tapAt = Date.now(); }
      await wait(100);
    }
    ok('the next run starts on a tap, unguarded', !!back && !back.g0, back ? JSON.stringify({ runs: back.runs, g: back.g0, len: back.len0 }) : 'not back');
    if (back) {
      await steerOut(p);
      for (let i = 0; i < 600 && (await read(p)).card.shown; i++) await wait(100);   // the first card gone with the new run
      const j2 = await judge('room, second run', 0);
      if (j2) await p.screenshot({ path: OUT + '/agree-room-2.png' });
    }
  }
  await p.context().close();
}

if (!PART || PART === 'solo') {
  const p = await phone();
  await p.goto(O + '/lab/manta/play/?solo=1&tier=low&backend=webgl2&fx=off&hint=0&paused=1', { waitUntil: 'load' });
  await p.waitForFunction(() => window.__labReady === true, null, { timeout: 30000 * X });
  await p.waitForTimeout(300);
  /* The first run: 5 s unsteered (beside the wild mantas it recruits), then out to the reef. */
  const r1 = await p.evaluate(() => {
    const L = window.__lab, S = window.__sim, y = S.you; L.pause();
    if (L.controls) L.controls.apply = () => {};
    const guarded = !!y.guarded, born = S.time;
    S.input.want = null;
    for (let i = 0; i < 50; i++) L.step(0.1);
    let k = 0; while (!(y.dead > 0) && k++ < 900) { S.input.want = Math.atan2(-y.x, -y.z); L.step(0.1); }
    return { guarded, alive: S.time - born, dead: y.dead > 0, how: y.crashHow, peak: y.peak };
  });
  ok('solo: a protected first run, and it ends at the reef', r1.guarded && r1.dead, JSON.stringify(r1));
  /* The count done: up to 150 driven sixtieths (the crash's slow motion stretches the scene's 0.8 s). Then the lines' 100 ms timer. */
  await p.evaluate(() => { for (let i = 0; i < 150 && window.__lab.card.state.t < 0.85; i++) window.__lab.step(1 / 60); });
  await wait(400);
  let s = await read(p);
  agree('solo, first run', s, { peak: r1.peak, before: 0, runs: 1, alive: r1.alive, slack: 1 });
  /* Two more runs: one laid longer than the first, one shorter, each crashed by hand on the reef. */
  const another = async n => {
    /* Two taps (skip, swim again), and the stats line's timer let see the new run. */
    const back = await p.evaluate(() => {
      const L = window.__lab, S = window.__sim, y = S.you, C = L.card;
      C.tap(); L.step(1 / 60); C.tap();
      for (let i = 0; i < 30 && y.dead > 0; i++) L.step(1 / 60);
      return { born: S.time, alive0: !(y.dead > 0), runs: +(document.getElementById('stats').textContent.match(/runs (\d+)/) || [0, 0])[1] };
    });
    for (let i = 0; i < 20 && lines(await read(p)).runs < back.runs + 1; i++) await wait(100);
    return p.evaluate(async ([n, back]) => {
    const L = window.__lab, S = window.__sim, y = S.you, C = L.card;
    const born = back.born, alive0 = back.alive0;
    /* 300 units in from the reef, facing out, the train laid behind. */
    const R = S.params.arenaR, a = Math.atan2(y.x, y.z);
    y.x = Math.sin(a) * (R - 300); y.z = Math.cos(a) * (R - 300); y.head = Math.atan2(-y.x, -y.z);
    if (n > 0) S.lay(n);
    let k = 0; while (!(y.dead > 0) && k++ < 200) { S.input.want = Math.atan2(-y.x, -y.z); L.step(0.1); }
    const out = { alive0, alive: S.time - born, dead: y.dead > 0, how: y.crashHow, peak: y.peak };
    for (let i = 0; i < 150 && C.state.t < 0.85; i++) L.step(1 / 60);
    return out;
    }, [n, back]);
  };
  /* The card ignores taps in the first 0.35 s of a crash, on the real clock. */
  await wait(500);
  const r2 = await another(r1.peak + 6);
  await wait(400); s = await read(p);
  ok('solo: a second run, laid at ' + (r1.peak + 6) + ', ends in a crash', r2.alive0 && r2.dead, JSON.stringify(r2));
  agree('solo, second run (a new best)', s, { peak: r2.peak, before: r1.peak, runs: 2, alive: r2.alive, slack: 1 });
  await wait(500);
  const r3 = await another(0);
  await wait(400); s = await read(p);
  ok('solo: a third run, short, ends in a crash', r3.alive0 && r3.dead, JSON.stringify(r3));
  agree('solo, third run (under the best)', s, { peak: r3.peak, before: Math.max(r1.peak, r2.peak), runs: 3, alive: r3.alive, slack: 1 });
  await p.context().close();
}

const real = errs.filter(e => !/WebSocket|favicon/.test(e));
ok('no page errors', real.length === 0, real.slice(0, 3).join(' | '));
await b.close(); clearTimeout(die);
console.log('agree failures: ' + bad); process.exit(bad ? 1 : 0);
