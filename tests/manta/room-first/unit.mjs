/* 4D part 3: the protected first run through a room (design doc 10.8), in
   plain Node with the room's own rooms/ocean.js (as room-budget/unit.mjs;
   no server, real timers). The room is warmed for 20 s by a watcher, so
   bots have trains; then:

   - a hello with f:1 seats a fresh train as a new run (runs moved on, no
     followers) with at least three wild mantas within 200 units in its
     first snapshot, and none of the twenty trains' leaders within 450
   - steering at the nearest wild manta, its first recruit comes within 3 s
   - no bot cuts it in its first 25 s (the room's cut events naming it)
   - about 30 s in, a bot's short train (8, a new run) comes into its view
     from out of it and crosses in front of it
   - f:1 with a held train's token takes the train back as it is, and a
     hello without f is seated as before (a bot's train, as it was)

   node tests/manta/room-first/unit.mjs   (about 75 s) */
import { readFileSync } from 'node:fs';
const TREE = decodeURIComponent(new URL('../../..', import.meta.url).pathname).replace(/\/$/, '');
const { createOcean } = await import(TREE + '/rooms/ocean.js');
const { decodeSnap } = await import(TREE + '/docs/lab/manta/roomcore.js');
const BUILD = readFileSync(TREE + '/docs/lab/manta/panel.js', 'utf8').match(/export const BUILD = '([^']+)'/)[1];
const env = { ASSETS: { async fetch (req) { return new Response(readFileSync(TREE + '/docs' + new URL(req.url).pathname, 'utf8')); } } };
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 160000 * (+process.env.WATCHDOG_X || 1));
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x ? '  [' + x + ']' : '')); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const digits = String(BUILD).replace(/\D/g, '').slice(2);
const until = async (f, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (f()) return Date.now() - t0; await wait(50); } return -1; };

function sock () {
  const s = { got: [], snaps: [], me: null, wild: new Map(), tr: new Map(), ev: [] };
  s.send = d => {
    if (typeof d === 'string') { s.got.push(JSON.parse(d)); return; }
    const m = decodeSnap(d); if (!m) return;
    s.snaps.push(m); if (m.me) s.me = m.me;
    if (m.wd) { s.wild.clear(); for (const w of m.wd) s.wild.set(w[0], w); }
    if (m.wa) for (const w of m.wa) s.wild.set(w[0], w);
    if (m.wg) for (const g of m.wg) s.wild.delete(g);
    for (const t of m.tr) s.tr.set(t.id, { ...t, at: Date.now() });
    for (const e of m.ev) s.ev.push({ ...e, at: Date.now() });
    if (m.rd) s.rd = m.rd;
  };
  s.close = () => {};
  s.of = t => s.got.filter(m => m && m.t === t);
  return s;
}
const ocean = createOcean(env, new URL('http://127.0.0.1/lab/manta/rooms/ocean/first'), {});
ocean.setBudget({ r: 0, d: 0, left: 3600000 });
/* A watcher warms the room: bots grow trains. */
const W = sock(); ocean.join(W, true); await ocean.message(W, JSON.stringify({ t: 'hi', b: digits }));
await ocean.message(W, JSON.stringify({ t: 'view', x: 0, z: 0, w: 6000, h: 6000 }));
await wait(20000);
/* The crossing train comes in out of every phone's sight, a watcher's too:
   the watcher now looks at a corner (its radar still has every train). */
await ocean.message(W, JSON.stringify({ t: 'view', x: -2400, z: 0, w: 300, h: 300 }));
const runsBefore = new Map((W.rd || []).map(r => [r[0], r[4]]));
const lens = (W.rd || []).map(r => r[3]);
ok('warmed: the bots have trains', lens.filter(l => l >= 5).length >= 5, lens.join(','));

/* The first-run player: seated with f:1, steering at the nearest wild manta. */
const A = sock(); ocean.join(A, true);
await ocean.message(A, JSON.stringify({ t: 'hi', b: digits, p: 1, h: 1, f: 1 }));
await ocean.message(A, JSON.stringify({ t: 'view', x: 0, z: 0, w: 400, h: 890 }));
const t0 = Date.now();
const idA = A.of('init').find(m => m.me).me.id;
let seq = 0;
const steer = setInterval(() => {
  const m = A.me; let w = null;
  if (m && !m.dead) { let best = null, bd = Infinity; for (const q of A.wild.values()) { const d = Math.hypot(q[1] - m.x, q[2] - m.z); if (d < bd) { bd = d; best = q; } } if (best) w = Math.atan2(-(best[1] - m.x), -(best[2] - m.z)); }
  ocean.message(A, JSON.stringify({ t: 'in', seq: ++seq, w, d: 0 }));
}, 100);
await until(() => A.me && A.wild.size > 0, 3000);
const me0 = A.me, near = [...A.wild.values()].filter(q => Math.hypot(q[1] - me0.x, q[2] - me0.z) < 200).length;
const others = (W.rd || []).filter(r => r[0] !== idA && r[5]).map(r => Math.hypot(r[1] - me0.x, r[2] - me0.z));
ok('f:1 seats a fresh run: a new run with no followers, ' + near + ' wild mantas within 200, the nearest other leader ' + Math.round(Math.min(...others)) + ' away',
   me0.runs === (runsBefore.get(idA) || 0) + 1 && me0.len <= 1 && near >= 3 && Math.min(...others) >= 450, JSON.stringify({ runs: me0.runs, was: runsBefore.get(idA), len: me0.len }));
const tr = await until(() => A.me && A.me.len > 0, 6000);
ok('steering at the nearest wild manta, the first recruit within 3 s (' + (tr / 1000).toFixed(2) + ' s)', tr >= 0 && tr <= 3000);
/* Watch for 34 s: cuts naming A, and the crossing train. */
const seen = new Map();          // id -> first time in A's view after 25 s
while (Date.now() - t0 < 36000) {
  await wait(100);
  if (Date.now() - t0 < 25000) continue;
  for (const [id, t] of A.tr) if (id !== idA && t.at > Date.now() - 200 && !seen.has(id)) seen.set(id, { at: Date.now() - t0, len: t.len, fresh: !!t.fresh, x: t.x, z: t.z });
}
clearInterval(steer);
/* It never bursts, so its length can only fall by a cut or a crash: in its
   first 25 s, until any crash, it never falls. */
let drop = null, prev = 0, crashed = false;
for (const m of A.snaps) {
  if (!m.me || m.k / 60 < 0) continue;
  if (m.me.dead) { crashed = true; break; }
  if (m.me.len < prev && !drop) drop = { from: prev, to: m.me.len };
  prev = m.me.len;
  if (A.snaps.indexOf(m) > 25 * 20) break;
}
const cutEvents = W.ev.filter(e => e.k === 'cut' && e.at - t0 < 25000);
ok('no bot cut it in its first 25 s: its length never fell' + (crashed ? ' before its crash' : ''), !drop, JSON.stringify({ drop, crashed, length: prev, cutsInTheRoom: cutEvents.length }));
const crossers = [...seen].filter(([id, q]) => q.at >= 27000 && q.at <= 36000 && q.len >= 6 && q.len <= 10);
ok('about 30 s in, a short train (8) comes into view and crosses', crossers.length >= 1 || (A.me && A.me.dead), JSON.stringify(crossers.slice(0, 3)) + (A.me && A.me.dead ? ' (A was down)' : ''));
/* Without f, and with a held token, as before. */
const tok = A.of('init').find(m => m.me).me.token;
ocean.leave(A);
const A2 = sock(); ocean.join(A2, true); await ocean.message(A2, JSON.stringify({ t: 'hi', b: digits, p: 1, h: 1, f: 1, k: tok }));
await until(() => A2.me, 2000);
ok('f:1 with a held train\'s token takes it back as it is (no new run)', A2.me && A2.me.runs === A.me.runs, JSON.stringify({ was: A.me.runs, now: A2.me && A2.me.runs }));
const B = sock(); ocean.join(B, true); await ocean.message(B, JSON.stringify({ t: 'hi', b: digits, p: 1 }));
const idB = (B.of('init').find(m => m.me) || { me: {} }).me.id;
await until(() => B.me, 2000);
ok('a hello without f is seated as before: the bot\'s train as it was', B.me && B.me.runs === ((W.rd || []).find(r => r[0] === idB) || [])[4], JSON.stringify({ runs: B.me && B.me.runs }));
for (const s of [A2, B, W]) ocean.leave(s);
clearTimeout(die);
console.log(bad ? 'FAILED ' + bad : 'ALL PASS');
process.exit(bad ? 1 : 0);
