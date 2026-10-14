/* Brief 4B part 5: what a room does with the day's budget, in plain Node
   with the room's own rooms/ocean.js (no server; real timers, a moved
   clock where a test needs one). Phones are stand-in sockets.

   - the registry's answer reaches every phone as {t:'budget'} for the panel
   - at 80 percent a new player is told {t:'rest', until, c:0} and not
     seated; a player already seated stays; one taking back its own held
     manta (its token, within 15 s) is not new and is seated
   - a level older than 3 minutes, or from before 00:00 UTC, counts as
     nothing: the room carries on as if the guard could not be reached
   - a fresh room's first hello waits for the day's level, a second at most,
     and with the guard down nobody else waits
   - watchers too: a new one at 80 percent is not let in; one already in
     goes at 95 percent, and a room of watchers alone stops ticking
   - at 95 percent, in the staged room (its seat swims into the crossing
     train every 2.5 s), the player's crash reaches the phone first and
     {t:'rest', c:1} after it; the room closes the socket itself if the page
     has not left within 5 s
   - ?fake=80 refuses that phone alone; ?fake=95 lets it play and sends it
     solo after its crash, with the real level at nothing
   - the room counts the milliseconds it ticks, for the run-time allowance

   node tests/manta/room-budget/unit.mjs   (about 25 s) */
import { readFileSync } from 'node:fs';
const TREE = decodeURIComponent(new URL('../../..', import.meta.url).pathname).replace(/\/$/, '');
const { createOcean } = await import(TREE + '/rooms/ocean.js');
const { decodeSnap } = await import(TREE + '/docs/lab/manta/roomcore.js');
const BUILD = readFileSync(TREE + '/docs/lab/manta/panel.js', 'utf8').match(/export const BUILD = '([^']+)'/)[1];
const env = { ASSETS: { async fetch (req) { return new Response(readFileSync(TREE + '/docs' + new URL(req.url).pathname, 'utf8')); } } };
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 90000);
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x ? '  [' + x + ']' : '')); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const digits = String(BUILD).replace(/\D/g, '').slice(2);
const realNow = Date.now; let shift = 0; Date.now = () => realNow() + shift;

function sock () {
  const s = { got: [], closed: null, dead: false };
  s.send = d => { if (typeof d === 'string') s.got.push(JSON.parse(d)); else { const m = decodeSnap(d); s.got.push(m); if (m && m.me && m.me.dead) s.dead = true; } };
  s.close = code => { s.closed = code; };
  s.of = t => s.got.filter(m => m && m.t === t);
  return s;
}
async function hello (ocean, s, extra = {}) { await ocean.message(s, JSON.stringify({ t: 'hi', b: digits, p: 1, ...extra })); }
const seated = s => s.of('init').some(m => m.me);
let seqs = new Map();
const input = (ocean, s) => { const q = (seqs.get(s) || 0) + 1; seqs.set(s, q); return ocean.message(s, JSON.stringify({ t: 'in', seq: q, w: null, d: 0 })); };

/* 1-3: an ocean room. */
{
  let changes = 0;
  const ocean = createOcean(env, new URL('http://127.0.0.1/lab/manta/rooms/ocean/unit'), { onChange: () => changes++ });
  const a = sock(); ocean.join(a, true); await hello(ocean, a);
  const keepA = setInterval(() => input(ocean, a), 200);
  ocean.setBudget({ r: 0.5, d: 0.1, left: 60000 });
  const bu = a.of('budget').at(-1);
  ok('the day\'s use reaches every phone for the panel', seated(a) && bu && bu.r === 0.5 && bu.d === 0.1 && bu.f === 0, JSON.stringify(bu));
  ocean.setBudget({ r: 0.2, d: 0.85, left: 60000 });
  const b = sock(); ocean.join(b, true); await hello(ocean, b);
  const r = b.of('rest')[0], untilOff = r ? r.until - Date.now() : NaN;
  ok('at 80 percent of either allowance a new player is told rooms are resting and is not seated', !!r && r.c === 0 && !seated(b) && Math.abs(untilOff - 60000) < 1000, JSON.stringify(r) + ', returns in ' + Math.round(untilOff / 1000) + ' s');
  await wait(1600);
  ok('and the room closes that socket itself when the page has not left', b.closed === 4004, 'closed ' + b.closed);
  const snapsA = a.got.length; await wait(600);
  ok('a player already seated plays on', seated(a) && a.got.length > snapsA + 5 && !a.of('rest').length, (a.got.length - snapsA) + ' messages in 0.6 s, rest ' + a.of('rest').length);
  /* A player who drops and comes back with its token inside 15 s is not new. */
  const tok = a.of('init').find(m => m.me).me.token, idA = a.of('init').find(m => m.me).me.id;
  clearInterval(keepA); ocean.leave(a);
  const a2 = sock(); ocean.join(a2, true); await hello(ocean, a2, { k: tok });
  const me2 = (a2.of('init').find(m => m.me) || {}).me;
  ok('one taking back its own held manta with its token is let back in at 80 percent', !!me2 && me2.id === idA && !a2.of('rest').length, me2 ? 'seated as #' + me2.id + ' (was #' + idA + ')' : 'not seated');
  const keepA2 = setInterval(() => input(ocean, a2), 200);
  /* Stale: the same level, heard 181 s ago, is nothing. */
  shift = 181000;
  const c = sock(); ocean.join(c, true); await hello(ocean, c);
  ok('a level not heard for 3 minutes (the registry unreachable) counts as nothing: a new player is seated', seated(c) && !c.of('rest').length, seated(c) ? 'seated' : JSON.stringify(c.of('rest')));
  shift = 0;
  /* Midnight: a level whose day has ended is nothing. */
  ocean.setBudget({ r: 0.9, d: 0.9, left: 300 }); await wait(400);
  const d = sock(); ocean.join(d, true); await hello(ocean, d);
  ok('a level from before 00:00 UTC counts as nothing: a new player is seated', seated(d) && !d.of('rest').length, seated(d) ? 'seated' : 'refused');
  const f80 = sock(); ocean.join(f80, true, '80'); await hello(ocean, f80);
  ok('?fake=80 refuses that phone alone, with the real level at nothing', !!f80.of('rest')[0] && !seated(f80), JSON.stringify(f80.of('rest')[0]));
  const ms1 = ocean.takeRunMs(); await wait(1000); const ms2 = ocean.takeRunMs();
  ok('the room counts the milliseconds it ticks', ms2 > 900 && ms2 < 1150, ms2 + ' ms in a second (first take ' + ms1 + ')');
  clearInterval(keepA2);
  for (const s of [a2, c, d, f80]) ocean.leave(s);
  await wait(300); const idle = ocean.takeRunMs(); await wait(500);
  ok('and stops counting when the last phone has gone', !ocean.stepping && ocean.takeRunMs() === 0, 'stepping ' + ocean.stepping + ', ' + idle + ' ms at the stop');
  ok('the registry is told whenever the room changes who is in it (closes, rests)', changes >= 2, changes + ' changes');
}

/* 3b: a fresh room has not yet heard the day's level when its first
   player says hello: the hello waits for the first answer (a second at
   most), so no one slips in at 80 percent before the room knows. */
{
  const ocean = createOcean(env, new URL('http://127.0.0.1/lab/manta/rooms/ocean/first'), {});
  const p = sock(); ocean.join(p, true);
  const t0 = Date.now(), said = hello(ocean, p);
  setTimeout(() => ocean.setBudget({ r: 0.85, d: 0.1, left: 60000 }), 300);
  await said;
  ok('a fresh room\'s first player waits for the day\'s level, and at 80 percent is not seated', !seated(p) && !!p.of('rest')[0] && Date.now() - t0 >= 250, 'answered after ' + (Date.now() - t0) + ' ms: ' + JSON.stringify(p.of('rest')[0]));
  const q = sock(); ocean.join(q, true); const t1 = Date.now(); ocean.setBudget({ r: 0.1, d: 0.1, left: 60000 }); await hello(ocean, q);
  ok('once the level is known a hello waits for nothing', seated(q) && Date.now() - t1 < 200, (Date.now() - t1) + ' ms');
  ocean.leave(p); ocean.leave(q);
}

/* 3c: the guard down. Only the first hello in a fresh room waits (a second
   at most); a report answered with no level ends the wait at once; after
   either nobody waits again, so a broken guard never slows every join. */
{
  const ocean = createOcean(env, new URL('http://127.0.0.1/lab/manta/rooms/ocean/down'), {});
  const p = sock(); ocean.join(p, true); const t0 = Date.now(); await hello(ocean, p); const w0 = Date.now() - t0;
  const q = sock(); ocean.join(q, true); const t1 = Date.now(); await hello(ocean, q); const w1 = Date.now() - t1;
  ok('with the guard unreachable only the first hello in a fresh room waits, a second at most, and both are seated', seated(p) && seated(q) && w0 >= 900 && w0 < 1300 && w1 < 200, 'first waited ' + w0 + ' ms, second ' + w1 + ' ms');
  ocean.leave(p); ocean.leave(q);
  const o2 = createOcean(env, new URL('http://127.0.0.1/lab/manta/rooms/ocean/down2'), {});
  const r = sock(); o2.join(r, true); const t2 = Date.now(), said = hello(o2, r); setTimeout(() => o2.noBudget(), 100); await said; const w2 = Date.now() - t2;
  ok('and a report answered with no level ends the wait at once', seated(r) && w2 < 400, 'waited ' + w2 + ' ms');
  o2.leave(r);
}

/* 3d: watchers (a first visit's name panel, the lab watching). A new one at
   80 percent is told rooms are resting and is not let in, so it starts
   nothing ticking; one already in, pinging as a page on screen does, goes
   at 95 percent, and the room stops ticking once it has gone. */
{
  const ocean = createOcean(env, new URL('http://127.0.0.1/lab/manta/rooms/ocean/watch'), {});
  ocean.setBudget({ r: 0.85, d: 0.1, left: 60000 });
  const w = sock(); ocean.join(w, true); await ocean.message(w, JSON.stringify({ t: 'hi', b: digits }));
  ok('at 80 percent a new watcher is told rooms are resting, is not let in and starts nothing ticking', !!w.of('rest')[0] && w.of('rest')[0].c === 0 && !w.of('init').length && !ocean.stepping, JSON.stringify(w.of('rest')[0]) + ', inits ' + w.of('init').length + ', stepping ' + ocean.stepping);
  ocean.leave(w);
  ocean.setBudget({ r: 0.1, d: 0.1, left: 60000 });
  const v = sock(); ocean.join(v, true); await ocean.message(v, JSON.stringify({ t: 'hi', b: digits }));
  const ping = setInterval(() => ocean.message(v, JSON.stringify({ t: 'ping', c: 1 })), 500);
  await wait(300);
  const inBefore = v.of('init').length === 1 && ocean.stepping;
  ocean.setBudget({ r: 0.96, d: 0.1, left: 60000 }); await wait(300);
  const r = v.of('rest')[0];
  await wait(1500); clearInterval(ping);
  ok('a watcher already in, pinging, goes at 95 percent: told rooms are resting, closed by the room, and the room stops ticking', inBefore && !!r && r.c === 0 && v.closed === 4004 && !ocean.stepping, 'in ' + inBefore + ', ' + JSON.stringify(r) + ', closed ' + v.closed + ', stepping ' + ocean.stepping);
  ocean.leave(v);
}

/* 4-5: the staged room, where the seat crashes every 2.5 s. */
for (const [label, fake, level] of [['at 95 percent', '', 0.96], ['?fake=95 with the real level at nothing', '95', 0]]) {
  const ocean = createOcean(env, new URL('http://127.0.0.1/lab/manta/rooms/stage/unit'), { stage: 'cut' });
  const p = sock(); ocean.join(p, true, fake); await hello(ocean, p);
  const keep = setInterval(() => input(ocean, p), 200);
  if (level) ocean.setBudget({ r: level, d: 0.1, left: 60000 });
  let t = 0; while (t < 6000 && !p.of('rest').length) { await wait(100); t += 100; }
  const ri = p.got.findIndex(m => m && m.t === 'rest'), di = p.got.findIndex(m => m && m.me && m.me.dead);
  const rest = p.got[ri];
  ok(label + ': a seated player plays until it crashes, sees its crash, then is told rooms are resting', seated(p) && !!rest && rest.c === 1 && di >= 0 && di < ri, 'crash at message ' + di + ', rest at ' + ri + ' after ' + (t / 1000).toFixed(1) + ' s: ' + JSON.stringify(rest));
  clearInterval(keep);
  /* A resting player cannot say hello its way back in, with its token or without. */
  const tok = (p.of('init').find(m => m.me) || { me: {} }).me.token;
  const before = p.of('rest').length; await hello(ocean, p, { k: tok });
  ok(label + ': a resting player saying hello again, with its token, is not seated again', p.of('rest').length === before + 1 && p.of('init').filter(m => m.me).length === 1, (p.of('rest').length - before) + ' more rest, ' + p.of('init').filter(m => m.me).length + ' seat(s) in all');
  const fresh = sock(); ocean.join(fresh, true); await hello(ocean, fresh, { k: tok });
  const mine = (fresh.of('init').find(m => m.me) || {}).me;
  ok(label + ': and its manta is not held for its token: a new socket with it is a new player', level ? !!fresh.of('rest')[0] && !seated(fresh) : !!mine && mine.token !== tok, level ? 'refused as new at ' + level : (mine ? 'new token ' + mine.token.slice(0, 4) + '…' : 'not seated'));
  ocean.leave(fresh);
  const keepAlive = sock(); ocean.join(keepAlive, true); await ocean.message(keepAlive, JSON.stringify({ t: 'hi', b: digits }));
  await wait(5600);
  ok(label + ': the room closes its socket when the page has not left within 5 s', p.closed === 4004, 'closed ' + p.closed);
  ocean.leave(p); ocean.leave(keepAlive);
}

Date.now = realNow;
console.log('budget unit failures: ' + bad); clearTimeout(die); setTimeout(() => process.exit(bad ? 1 : 0), 200);
