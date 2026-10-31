/* 4D part 2: the death card through a room, in plain Node with the room's
   own rooms/ocean.js (as room-budget/unit.mjs; no server, real timers).
   A seated phone steers straight for the reef until it crashes, then:

   - the snapshot carries what got it with the wreck (into: the train hit
     or -1, how: reef, head-on, leader, body or shark; PROTOCOL 6)
   - with h:1 in its hello the train holds, dead, past the 1.5 s beat (2.5
     s more here), and {t:'go'} brings it back as a new run
   - without h:1 it comes back by itself after the beat, as before
   - a held train whose player is benched (away) goes to a bot, which
     brings it back without a tap
   - {t:'go'} while alive does nothing, and a hello with h:2 is refused

   node tests/manta/room-card/unit.mjs   (about 60 s) */
import { readFileSync } from 'node:fs';
const TREE = decodeURIComponent(new URL('../../..', import.meta.url).pathname).replace(/\/$/, '');
const { createOcean } = await import(TREE + '/rooms/ocean.js');
const { decodeSnap, PROTOCOL } = await import(TREE + '/docs/lab/manta/roomcore.js');
const BUILD = readFileSync(TREE + '/docs/lab/manta/panel.js', 'utf8').match(/export const BUILD = '([^']+)'/)[1];
const env = { ASSETS: { async fetch (req) { return new Response(readFileSync(TREE + '/docs' + new URL(req.url).pathname, 'utf8')); } } };
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 150000 * (+process.env.WATCHDOG_X || 1));
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x ? '  [' + x + ']' : '')); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const digits = String(BUILD).replace(/\D/g, '').slice(2);

function sock () {
  const s = { got: [], closed: null, me: null };
  s.send = d => { if (typeof d === 'string') s.got.push(JSON.parse(d)); else { const m = decodeSnap(d); if (m && m.me) s.me = m.me; if (m && m.rd) s.rd = m.rd; } };
  s.close = code => { s.closed = code; };
  s.of = t => s.got.filter(m => m && m.t === t);
  return s;
}
/* A player that swims straight out to the reef and keeps its inputs coming. */
async function player (ocean, extra) {
  const s = sock(); ocean.join(s, true);
  await ocean.message(s, JSON.stringify({ t: 'hi', b: digits, p: 1, ...extra }));
  let seq = 0;
  s.timer = setInterval(() => {
    const m = s.me, w = m && !m.dead ? Math.atan2(-m.x, -m.z) : null;   // forward is (-sin, -cos): away from the centre
    ocean.message(s, JSON.stringify({ t: 'in', seq: ++seq, w: w === null ? null : Math.atan2(Math.sin(w), Math.cos(w)), d: 0 }));
  }, 200);
  return s;
}
const until = async (f, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (f()) return Date.now() - t0; await wait(50); } return -1; };

ok('the wire is protocol 6', PROTOCOL === 6, String(PROTOCOL));
const ocean = createOcean(env, new URL('http://127.0.0.1/lab/manta/rooms/ocean/card'), {});
ocean.setBudget({ r: 0, d: 0, left: 3600000 });
const A = await player(ocean, { h: 1 }), B = await player(ocean, {});
const seated = s => s.of('init').some(m => m.me);
ok('two players seated, one holding (h:1), one not', seated(A) && seated(B));
const ta = await until(() => A.me && A.me.dead > 0, 40000), tb = await until(() => B.me && B.me.dead > 0, 40000);
const how = ['reef', 'head-on', 'leader', 'body', 'shark'];
ok('both crash on the way out, and the wreck says what got them (into, how)', ta >= 0 && tb >= 0 && how.includes(A.me.how) && Number.isInteger(A.me.into) && (A.me.how === 'reef' ? A.me.into === -1 : A.me.into >= 0),
   JSON.stringify({ A: A.me && { how: A.me.how, into: A.me.into }, B: B.me && { how: B.me.how, into: B.me.into } }));
const runsA = A.me.runs, runsB = B.me.runs;
await wait(4000);
/* B swims for the reef again at once, so it may be down again by now: it came back if its run count moved on. */
ok('4 s later the holding player is still down; the other came back by itself', A.me.dead > 0 && A.me.runs === runsA && B.me.runs > runsB,
   JSON.stringify({ A: { dead: A.me.dead, runs: A.me.runs }, B: { dead: B.me.dead || 0, runs: B.me.runs } }));
await ocean.message(A, JSON.stringify({ t: 'go' }));
const tg = await until(() => A.me && !A.me.dead, 2000);
ok('{t:\'go\'} brings it back as a new run (' + tg + ' ms)', tg >= 0 && A.me.runs === runsA + 1, JSON.stringify({ runs: A.me.runs }));
await ocean.message(A, JSON.stringify({ t: 'go' }));
/* Down again, then benched: a bot holds it and brings it back with no tap. */
const t2 = await until(() => A.me && A.me.dead > 0, 40000), runs2 = A.me.runs;
await ocean.message(A, JSON.stringify({ t: 'away' }));
clearInterval(A.timer);
const benched = A.of('benched').length;
await wait(3500);
/* Snapshots stop with the seat: the room's own count, through a watcher's radar ([id, x, z, len, runs, alive]). */
const idA = A.of('init').find(m => m.me).me.id;
const W = sock(); ocean.join(W, true); await ocean.message(W, JSON.stringify({ t: 'hi', b: digits }));
await ocean.message(W, JSON.stringify({ t: 'view', x: 0, z: 0, w: 6000, h: 6000 }));
await wait(800);
const rA = (W.rd || []).find(r => r[0] === idA);
ok('a go sent while alive did nothing (the next crash still counted from the same run), and a held train whose player is benched is brought back by the bot holding it',
   t2 >= 0 && benched === 1 && runs2 === runsA + 1 && !!rA && rA[5] === 1 && rA[4] === runs2 + 1, JSON.stringify({ t2, benched, runs2, radar: rA }));
/* A hello with h:2 is malformed and refused, as any bad field is. */
const C = sock(); ocean.join(C, true); await ocean.message(C, JSON.stringify({ t: 'hi', b: digits, p: 1, h: 2 }));
await wait(300);
ok('a hello with h:2 is refused (not seated)', !seated(C), JSON.stringify(C.got.slice(0, 2)));
clearInterval(B.timer);
for (const s of [A, B, C, W]) ocean.leave(s);
clearTimeout(die);
console.log(bad ? 'FAILED ' + bad : 'ALL PASS');
process.exit(bad ? 1 : 0);
