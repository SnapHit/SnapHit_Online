/* 3G stage 1: the review's six findings, each a test. Through the delay
   proxy (PORT). TREE: the lab whose roomcore/roomplay the phone runs. */
import { readFileSync } from 'node:fs';
import { player } from './playclient.mjs';
const TREE = process.env.TREE || decodeURIComponent(new URL('../../..', import.meta.url).pathname).replace(/\/$/, ''), LABEL = process.env.LABEL || '', PORT = +process.env.PORT;
const core = await import(TREE + '/docs/lab/manta/roomcore.js');
const { createWildStore, decodeSnap, createMirror } = core;
const BUILD = readFileSync(TREE + '/docs/lab/manta/panel.js', 'utf8').match(/export const BUILD = '([^']+)'/)[1];
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 85000);
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + '[' + LABEL + '] ' + n + (x ? '  [' + x + ']' : '')); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const room = p => p + '-' + Math.random().toString(36).slice(2, 7);
const jobs = [];
const namesHas = (c, id) => (c.names || []).some(([i]) => i === id);
const whenGone = (c, id, t0) => { for (const [t, ns] of c.namesLog) if (t >= t0 && !ns.some(([i]) => i === id)) return t - t0; return null; };

/* 1. SWITCHING APPS. Inputs stop (no word from the phone): benched within
   2 s; the page says away: benched at once; shown again, it takes its
   manta back; away past 15 s, the seat is freed and it gets a new one. */
jobs.push((async () => {
  const r = room('aw'), a = player(PORT, r), b = player(PORT, r), f = player(PORT, r);
  await Promise.all([a.opened, b.opened, f.opened]); await wait(4000);
  const A = a.init && a.init.me, Bm = b.init && b.init.me, F = f.init && f.init.me;
  const t0 = performance.now();
  a.hide(3000, false); b.hide(1500, true); f.hide(16500, true);
  await wait(2900);
  const aGone = whenGone(a, A.id, t0), bGone = whenGone(b, Bm.id, t0);
  await wait(2600);
  const aBack = a.inits.length > 1 && a.inits[a.inits.length - 1].me, bBack = b.inits.length > 1 && b.inits[b.inits.length - 1].me;
  ok('inputs stop for 2 s: a bot takes the manta, labelled as a bot', aGone !== null && aGone <= 3000, 'benched after ' + (aGone === null ? 'never' : Math.round(aGone) + ' ms') + ' of silence');
  ok('the page says it is hidden: benched at once', bGone !== null && bGone <= 1000, 'benched after ' + (bGone === null ? 'never' : Math.round(bGone) + ' ms'));
  ok('shown again within 15 s, each takes its own manta back', aBack && aBack.id === A.id && aBack.name === A.name && bBack && bBack.id === Bm.id && bBack.name === Bm.name,
     'a ' + A.id + ' -> ' + (aBack && aBack.id) + ', b ' + Bm.id + ' -> ' + (bBack && bBack.id));
  await wait(13000);
  const fBack = f.inits.length > 1 && f.inits[f.inits.length - 1].me;
  ok('away past 15 s, the seat is freed: back again, it gets a new manta', fBack && fBack.token !== F.token, 'old token ' + F.token.slice(0, 6) + '…, back with ' + (fBack ? fBack.token.slice(0, 6) + '… (' + fBack.name + ')' : 'nothing'));
  a.close(); b.close(); f.close();
})());

/* 2. DUPLICATED TAB. A second connection with a live token gets its own
   manta and token and never takes the first one's train. */
jobs.push((async () => {
  const r = room('dup'), a = player(PORT, r); await a.opened; await wait(3000);
  const A = a.init.me;
  const b = player(PORT, r, { token: A.token }); await b.opened; await wait(3000);
  const B = b.init && b.init.me;
  ok('a second connection with a live token gets a new manta and token; the first keeps its train',
     B && B.id !== A.id && B.token !== A.token && !a.closed && namesHas(a, A.id) && a.play.id === A.id,
     'first #' + A.id + ' ' + A.name + ', second #' + (B && B.id) + ' ' + (B && B.name) + '; first ' + (a.closed ? 'closed ' + a.closed.code : 'still open') + ', still named ' + namesHas(a, A.id));
  a.close(); b.close();
})());

/* 3. A BADLY LATE PING. One pong 1.5 s late: the clock is never jumped, so
   the manta never leaps ahead or sits still. */
jobs.push((async () => {
  const a = player(PORT, room('lp')); await a.opened; await wait(6000);
  a.stepLog = []; await wait(800);
  a.rtt = (a.rtt || 0) + 1500;               // what one badly late pong does
  await wait(4500);
  const log = a.stepLog; let maxStep = 0, zeroRun = 0, worstZero = 0;
  for (const [, d] of log) { maxStep = Math.max(maxStep, d); zeroRun = d === 0 ? zeroRun + 1 : 0; worstZero = Math.max(worstZero, zeroRun); }
  ok('one badly late ping: the manta never jumps ahead or pauses', log.length > 200 && maxStep <= 3 && worstZero <= 3,
     log.length + ' frames: most steps in one frame ' + maxStep + ', longest run of frames with no step ' + worstZero + '; samples ignored ' + (a.play.rttIgnored ?? 'n/a'));
  a.close();
})());

/* 4. JITTERY LINKS. Wild mantas drawn as the page draws them, frame by
   frame for 10 s: none strays more than 1 unit per 1/60 s from its own
   pace (a stall on one sample, then a jump). */
jobs.push((async () => {
  const B0 = 'http://127.0.0.1:' + PORT, ws = new WebSocket(B0.replace('http', 'ws') + '/lab/manta/rooms/ocean/' + room('ws'), { headers: { Origin: B0 } });
  ws.binaryType = 'arraybuffer';
  const store = createWildStore(), wview = core.createWildView ? core.createWildView() : null, offsets = [], gaps = []; let offset = null, lastA = null, delay = 0.1, sd = 0, mirror = null, board = null;
  ws.onopen = () => { ws.send(JSON.stringify({ t: 'hi', b: BUILD.replace(/\D/g, '').slice(2) })); ws.send(JSON.stringify({ t: 'view', x: 0, z: 0, w: 385, h: 855 })); };
  ws.onmessage = e => { if (typeof e.data === 'string') { const m = JSON.parse(e.data); if (m.t === 'init') mirror = createMirror(m.params); return; }
    const m = decodeSnap(e.data), at = performance.now() / 1000; if (!m || !mirror) return;
    mirror.apply(m); store.take(m); if (wview) wview.take(m); if (m.bd) board = m.bd;
    offsets.push(at - m.time); if (offsets.length > 40) offsets.shift(); offset = Math.min(...offsets);
    if (lastA !== null) { gaps.push(at - lastA); if (gaps.length > 40) gaps.shift(); } lastA = at;
    if (gaps.length > 4) { const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length; sd = Math.sqrt(gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length); delay = Math.min(0.4, Math.max(0.1, 0.1 + 2 * sd)); }
    if (board && board.length && Math.random() < 0.25) { const t = mirror.trains.get(board[0][0]); if (t) ws.send(JSON.stringify({ t: 'view', x: Math.round(t.x), z: Math.round(t.z), w: 385, h: 855, a: board[0][0] })); } };
  await wait(3000);
  const per = new Map(), prev = new Map(); let frames = 0, lastT = performance.now(); const wclock = core.createWildClock ? core.createWildClock() : null;
  const timer = setInterval(() => { if (offset === null) return; const now = performance.now(), dt = (now - lastT) / 1000; lastT = now; frames++;
    const T = now / 1000 - offset - delay, late = Math.max(...offsets) - offset, Tw0 = core.wildDelayFor ? T - Math.max(0, core.wildDelayFor(late) - delay) : T, Tw = wclock ? wclock(Tw0, dt) : Tw0;
    const cur = new Map(), put = (slot, x, z, h, fl, col, gen) => cur.set(slot + ':' + (gen || 0), [x, z]);
    if (wview) wview.at(now / 1000, offset, null, dt, put); else store.at(Tw, put);   // as the page draws them (3I: at the present)
    for (const [k, p] of cur) { const q = prev.get(k); if (q && dt > 0) { if (!per.has(k)) per.set(k, []); per.get(k).push(Math.hypot(p[0] - q[0], p[1] - q[1]) / dt / 60); } }
    prev.clear(); for (const [k, p] of cur) prev.set(k, p); }, 1000 / 60);
  await wait(10000); clearInterval(timer); try { ws.close(); } catch (_) {}
  let n = 0, hitches = 0, worst = 0; const all = [];
  for (const list of per.values()) { if (list.length < 10) continue; const s = list.slice().sort((a, b) => a - b), med = s[s.length >> 1];
    for (const v of list) { n++; all.push(v); const d = Math.abs(v - med); if (d > 1) hitches++; worst = Math.max(worst, d); } }
  all.sort((a, b) => a - b);
  ok('jittery link: wild mantas glide (no frame more than 1 unit per 1/60 s off a manta\'s own pace)', n > 2000 && hitches === 0,
     per.size + ' mantas, ' + n + ' manta-frames: movement per 1/60 s median ' + (all[all.length >> 1] || 0).toFixed(2) + ', p99 ' + (all[Math.floor(all.length * 0.99)] || 0).toFixed(2) + '; ' + hitches + ' hitches, worst off by ' + worst.toFixed(2) + '; jitter sd ' + (sd * 1000).toFixed(0) + ' ms');
})());

/* 5. A REUSED SLOT: the old manta stays until it is gone at the drawn
   moment, and the new one appears only then. */
{
  const st = createWildStore();
  st.take({ time: 1.0, wd: [[5, 0, 0, 0, 0, -1]] });
  st.take({ time: 1.2, wd: [[5, 10, 0, 0, 0, -1]] });
  st.take({ time: 1.25, wg: [5], wa: [[5, 100, 100, 0, 1, 3]] });
  const seen = T => { let got = null; st.at(T, (slot, x, z) => { if (slot === 5) got = [x, z]; }); return got; };
  const a = seen(1.1), b = seen(1.3);
  ok('a reused slot: the old manta is still drawn up to its own leaving, the new one only after', a && Math.abs(a[0] - 5) < 0.01 && b && b[0] === 100,
     'at 1.10 s ' + JSON.stringify(a) + ' (the old one, half way), at 1.30 s ' + JSON.stringify(b) + ' (the new one)');
}
/* 6. New debris in a reused slot starts its own glow, not the old one's. */
{
  const params = { drain: 3, scatterGlow: 2 };
  const look = core.wildLook || ((w, fl, col, gen, dt, p) => { /* the page before 3G, as it was */
    w.loose = !!(fl & 1); w.sinking = fl & 2 ? (w.sinking > 0 ? Math.max(0.05, w.sinking - dt) : p.drain) : 0;
    if (col >= 0) { w.wasColour = col; w.glow = w.glow > 0 ? Math.max(0.05, w.glow - dt) : p.scatterGlow; } else w.glow = 0; return w; });
  const w = { glow: 0, sinking: 0, wasColour: -1, gen: 0 };
  for (let i = 0; i < 90; i++) look(w, 1, 3, 1, 1 / 60, params);          // the old debris glowed for 1.5 s
  look(w, 1, 5, 2, 1 / 60, params);                                       // a new manta in the slot, glowing
  ok('new debris in a reused slot starts its own glow', Math.abs(w.glow - params.scatterGlow) < 1e-9 && w.wasColour === 5,
     'glow ' + w.glow.toFixed(2) + ' s left of ' + params.scatterGlow + ' (colour ' + w.wasColour + ')');
}
await Promise.all(jobs);
console.log('[' + LABEL + '] six failures: ' + bad); clearTimeout(die); setTimeout(() => process.exit(bad ? 1 : 0), 200);
