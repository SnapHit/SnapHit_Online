/* Brief 4B part 5: the daily budget guard through wrangler dev. Run with
   NAMES=1 DIRECT=1 (TEST_NAMES lets this test reach the registry's test
   controls at /lab/manta/rooms/budget, which only a local request can).

   1. Counting: one player in lobby for 15 s sends a known number of
      messages; the registry's day then holds exactly that many messages,
      one room request for its connection, and the room's ticking time
      within 1.5 s. The guard sends nothing of its own: the registry
      requests are only the reports rooms already sent (join, seat, close).
   2. 80 percent (use added through the test control): a player already in
      lobby plays on; a new one is told rooms are resting until 00:00 UTC;
      the public game says so too, with the time.
   3. Watchers: at 80 percent the lab page watching is turned away and a
      first visit's name panel goes solo with the resting note. The lab
      panel's line: at 50 percent the lab page watching lobby shows
      "requests N%, time N%" from the room's report.
   4. The feedback page, in Sydney's time zone and Australian English: at
      ?fake=80 it goes solo saying rooms rest until 11:00 am; at ?fake=95 in
      the staged room the player crashes, sees the death card, then goes
      solo with the same note.
   5. 00:00 UTC: with the guard's clock set seconds before midnight and
      80 percent used, the public game refuses; after midnight it seats
      again and the day's count starts from nothing.
   6. The guard made to fail: the public game still seats players and the
      room plays on.
   NAMES=1 DIRECT=1 CHROME=... tests/manta/lib/rooms.sh room-budget/budget.mjs  (about 90 s) */
import { readFileSync } from 'node:fs';
import { chromium } from '../lib/tools.mjs';
const PORT = +process.env.PORT, O = 'http://127.0.0.1:' + PORT, R = '/lab/manta/rooms/';
const TREE = decodeURIComponent(new URL('../../..', import.meta.url).pathname).replace(/\/$/, '');
const BUILD = readFileSync(TREE + '/docs/lab/manta/panel.js', 'utf8').match(/export const BUILD = '([^']+)'/)[1];
const digits = String(BUILD).replace(/\D/g, '').slice(2);
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 240000 * (+process.env.WATCHDOG_X || 1));
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x ? '  [' + x + ']' : '')); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const budget = async (q = '') => (await fetch(O + R + 'budget' + q)).json();
const post = async path => { const r = await fetch(O + path, { method: 'POST', headers: { Origin: O, 'X-Test-Address': 'bu-' + Math.random() } }); return { status: r.status, text: await r.text() }; };
const midnight = t => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1); };
function phone (path, play = true) {
  const c = { got: [], sent: 0, opened: false, closed: null, snaps: 0, at: 0 };
  const ws = new WebSocket('ws://127.0.0.1:' + PORT + path, { headers: { Origin: O } }); ws.binaryType = 'arraybuffer'; c.ws = ws;
  c.send = m => { if (ws.readyState === 1) { ws.send(JSON.stringify(m)); c.sent++; } };
  c.ready = new Promise(res => { ws.onopen = () => { c.opened = true; c.at = Date.now(); const h = { t: 'hi', b: digits }; if (play) h.p = 1; c.send(h); res(true); }; ws.onerror = () => res(false); });
  ws.onmessage = e => { if (typeof e.data !== 'string') { c.snaps++; return; } c.got.push(JSON.parse(e.data)); };
  ws.onclose = e => { c.closed = e.code; };
  c.of = t => c.got.filter(m => m.t === t);
  c.seated = () => c.of('init').some(m => m.me);
  let seq = 0; c.keep = () => { c.timer = setInterval(() => c.send({ t: 'in', seq: ++seq, w: null, d: 0 }), 200); };
  c.end = () => { clearInterval(c.timer); try { ws.close(); } catch (_) {} };
  return c;
}

/* 1. Counting. */
{
  const before = await budget();
  const a = phone(R + 'ocean/lobby'); await a.ready;
  a.send({ t: 'view', x: 0, z: 0, w: 385, h: 855 }); a.keep();
  await wait(15000);
  const dur = Date.now() - a.at; a.end(); await wait(1500);
  const after = await budget(), du = k => after.use[k] - before.use[k];
  ok('every message the phone sent is counted, and its one connection', du('m') === a.sent && du('q') === 1, du('m') + ' counted of ' + a.sent + ' sent; room requests ' + du('q'));
  ok('the room\'s ticking time is counted within 1.5 s', Math.abs(du('ms') - dur) < 1500, du('ms') + ' ms counted for ' + dur + ' ms in the room');
  /* Registry requests between the two reads: the second read itself, and the room's reports (connection, seat, close: up to 4). */
  ok('the guard adds no request of its own: the registry heard only the reports rooms already send', du('reg') >= 3 && du('reg') <= 5, du('reg') + ' registry requests, one of them this test\'s own read');
  ok('the phone was sent the day\'s use for the panel', a.of('budget').length >= 1 && typeof a.of('budget').at(-1).r === 'number', JSON.stringify(a.of('budget').at(-1)));
  const lv = after.level, want = (after.use.m / 20 + after.use.q + after.use.reg) / 100000;
  ok('the level is the day\'s requests over 100,000 and run time over 13,000 GB-s at 0.128 a second', Math.abs(lv.r - want) < 1e-9 && Math.abs(lv.d - (after.use.ms / 1000 + 0.01 * after.use.reg) * 0.128 / 13000) < 1e-9, JSON.stringify(lv));
}

/* 2. 80 percent. */
let seatedA = null;
{
  seatedA = phone(R + 'ocean/lobby'); await seatedA.ready; seatedA.keep(); await wait(1500);
  await budget('?extra=0.85');
  const w = phone(R + 'ocean/lobby', false); await w.ready; await wait(1500);   // its join's report brings the room the new level
  const c = phone(R + 'ocean/lobby'); await c.ready; await wait(1200);
  const r = c.of('rest')[0], snaps = seatedA.snaps; await wait(1000);
  ok('at 80 percent a new player is told rooms are resting until 00:00 UTC and is not seated', !!r && r.c === 0 && !c.seated() && Math.abs(r.until - midnight(Date.now())) < 5000, JSON.stringify(r) + ' (midnight ' + midnight(Date.now()) + ')');
  ok('a player already in plays on', seatedA.seated() && seatedA.snaps > snaps + 10 && !seatedA.of('rest').length, (seatedA.snaps - snaps) + ' snapshots in a second');
  const pub = await post(R + 'public'), ms = +((/resting: (\d+)/.exec(pub.text) || [])[1]);
  ok('the public game says rooms are resting, with when they return', pub.status === 503 && Math.abs(ms - midnight(Date.now())) < 5000, pub.status + ' ' + pub.text);
  c.end(); w.end();
}

/* 3 and 4: the pages. */
const b = await chromium.launch({ executablePath: process.env.CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const errs = [];
async function page (named) {
  const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, hasTouch: true, locale: 'en-AU', timezoneId: 'Australia/Sydney' });
  if (named) await ctx.addInitScript(() => { try { localStorage.setItem('manta:name', 'budget tester'); } catch (_) {} });
  const p = await ctx.newPage(); p.setDefaultTimeout(30000); p.setDefaultNavigationTimeout(30000);
  p.on('pageerror', e => errs.push(e.message.slice(0, 160)));
  p.ctx = ctx; return p;
}
/* Watchers are under the guard too (4B review): at 85 percent the lab page
   watching is turned away and says so, and a first visit's name panel (a
   watcher until Play) goes solo with the resting note. At 50 percent the
   lab page watches and shows the day's use. */
const signalOf = () => ([...document.querySelectorAll('div')].map(d => d.textContent).find(t => /^● /.test(t || '')) || '');
{
  const p = await page(false);
  await p.goto(O + '/lab/manta/?backend=webgl2&tier=low&fx=off&room=lobby', { waitUntil: 'load' }).catch(e => errs.push('goto ' + e.message));
  await p.waitForFunction('/resting/.test((' + signalOf.toString() + ')())', null, { timeout: 15000 }).catch(() => {});
  const sig = await p.evaluate(signalOf).catch(() => ''), inits = await p.evaluate(() => !!(window.__lab && window.__lab.room && window.__lab.room.snaps)).catch(() => null);
  ok('at 80 percent the lab page watching is turned away and says rooms are resting', /rooms resting until/.test(sig) && inits === false, '"' + sig + '", snapshots ' + inits);
  await p.ctx.close();
  const q = await page(false);
  await q.goto(O + '/lab/manta/play/?backend=webgl2&tier=low&fx=off', { waitUntil: 'load' }).catch(e => errs.push('goto ' + e.message));
  await q.waitForURL(/note=rest/, { timeout: 20000 }).catch(() => {}); await wait(1200);
  const s = await q.evaluate(() => ({ url: location.search, note: (document.getElementById('note') || {}).textContent || '' })).catch(e => ({ url: 'ERR ' + e.message, note: '' }));
  ok('at 80 percent a first visit (the name panel watches) goes solo with the resting note', /solo=1/.test(s.url) && /note=rest/.test(s.url) && /^Rooms are resting until /.test(s.note), s.url + ' | "' + s.note + '"');
  await q.ctx.close();
}
await budget('?extra=0.5');
{
  const p = await page(false);
  await p.goto(O + '/lab/manta/?backend=webgl2&tier=low&fx=off&room=lobby', { waitUntil: 'load' }).catch(e => errs.push('goto ' + e.message));
  const lineOf = () => { const dt = [...document.querySelectorAll('dt')].find(e => e.textContent === 'rooms today'); return dt ? dt.textContent + ': ' + dt.nextElementSibling.textContent : ''; };
  await p.waitForFunction('/requests \\d+%, time \\d+%/.test((' + lineOf.toString() + ')())', null, { timeout: 15000 }).catch(() => {});
  const line = await p.evaluate(lineOf).catch(() => '');
  ok('the lab page\'s panel has the line "rooms today: requests N%, time N%"', /^rooms today: requests 5\d%, time 5\d%/.test(line), line);
  await p.ctx.close();
}
await budget('?extra=0');
seatedA.end(); await wait(500);
const noteOf = p => p.evaluate(() => ({ url: location.search, note: (document.getElementById('note') || {}).textContent || '', shown: !document.getElementById('noteRow').hidden })).catch(e => ({ url: 'ERR ' + e.message }));
{
  const p = await page(true);
  await p.goto(O + '/lab/manta/play/?backend=webgl2&tier=low&fx=off&fake=80', { waitUntil: 'load' }).catch(e => errs.push('goto ' + e.message));
  await p.waitForURL(/note=rest/, { timeout: 20000 }).catch(() => {}); await wait(1200);
  const s = await noteOf(p); await p.ctx.close();
  ok('?fake=80: the feedback page goes solo saying rooms rest until 11:00 am in Sydney (00:00 UTC)', /solo=1/.test(s.url) && /note=rest/.test(s.url) && s.shown && /^Rooms are resting until 11:00\s?am, so this is solo\.$/i.test(s.note), s.url + ' | "' + s.note + '"');
}
{
  const p = await page(true); let sawCard = false;
  await p.goto(O + '/lab/manta/play/?backend=webgl2&tier=low&fx=off&stage=cut&fake=95', { waitUntil: 'load' }).catch(e => errs.push('goto ' + e.message));
  await p.waitForFunction(() => window.__lab && window.__lab.room && window.__lab.room.me, null, { timeout: 20000 }).catch(() => {});
  for (let i = 0; i < 80 && !/note=rest/.test(await p.evaluate(() => location.search).catch(() => 'note=rest')); i++) {
    if (await p.evaluate(() => { const e = document.getElementById('beat'); return !!e && !e.hidden && getComputedStyle(e).display !== 'none'; }).catch(() => false)) sawCard = true;
    await wait(150);
  }
  await wait(1200);
  const s = await noteOf(p); await p.ctx.close();
  ok('?fake=95: in the room until the crash, the death card, then solo with the resting note', sawCard && /note=rest/.test(s.url) && s.shown && /^Rooms are resting until 11:00\s?am, so this is solo\.$/i.test(s.note), 'death card ' + sawCard + ' | ' + s.url + ' | "' + s.note + '"');
}

/* 5. 00:00 UTC. */
{
  const now = Date.now(), off = midnight(now) - 7000 - now;
  await budget('?clock=' + off); await budget('?extra=0.85');
  const pre = await post(R + 'public'), dayBefore = (await budget()).use.day;
  await wait(9000);
  const postMid = await post(R + 'public'), after = await budget();
  ok('at 00:00 UTC the count resets: refused just before midnight, seated just after, and the new day starts from nothing', pre.status === 503 && /resting/.test(pre.text) && postMid.status === 200 && after.use.day !== dayBefore && after.use.m === 0 && after.level.r < 0.001,
     'before: ' + pre.status + ' (' + dayBefore + '); after: ' + postMid.status + ' ' + postMid.text + ' (' + after.use.day + ', ' + JSON.stringify(after.use) + ')');
  await budget('?clock=0'); await budget('?extra=0');
}

/* 6. The guard fails. */
{
  await budget('?extra=0.85'); await budget('?fail=1');
  const pub = await post(R + 'public');
  const a = phone(R + 'ocean/' + (pub.status === 200 ? JSON.parse(pub.text).room : 'lobby')); await a.ready; a.keep(); await wait(2000);
  ok('the guard made to fail: the public game still seats players, and they play', pub.status === 200 && a.seated() && a.snaps > 20, pub.status + ' ' + pub.text + '; seated ' + a.seated() + ', ' + a.snaps + ' snapshots');
  a.end(); await budget('?fail=0'); await budget('?extra=0');
}

ok('no page errors', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
await b.close(); console.log('budget failures: ' + bad); clearTimeout(die); setTimeout(() => process.exit(bad ? 1 : 0), 300);
