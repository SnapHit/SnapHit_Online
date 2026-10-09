/* 3O stage 1: OVERFLOW ROOMS, against wrangler dev started with
   --var LIVE_CAP:4 (DIRECT=1 VARS="--var LIVE_CAP:4"), so the cap can be
   reached with a few dozen phones rather than two hundred. Scripted phones
   (room-radar/playclient.mjs) ask /lab/manta/rooms/public for their room, as
   roomview.js does, then join it as players, one after another:
     45 joiners land 20, 20 and 5 (4B: 20 seats a room; 3O had 10, 10 and
     5 from 25); one leaves and the next joiner takes that
     seat; the cap holds (public and private rooms together); and the
     feedback page, every room full, starts solo with its one-line note. */
import { player } from '../room-radar/playclient.mjs';
import { chromium } from '../lib/tools.mjs';
const PORT = +process.env.PORT, B = 'http://127.0.0.1:' + PORT;
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 400000);
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x ? '  [' + x + ']' : '')); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const ask = async (addr) => { const r = await fetch(B + '/lab/manta/rooms/public', { method: 'POST', headers: { Origin: B, 'X-Test-Address': addr || 'a' } }); return r.ok ? (await r.json()).room : 'HTTP ' + r.status + ' ' + (await r.text()); };
const seated = c => c.inits.some(i => i.me);
async function join () {
  const room = await ask();
  if (!/^lobby/.test(room)) return { room, c: null };
  const c = player(PORT, room);
  await c.opened;
  for (let i = 0; i < 100 && !seated(c) && !c.full && !c.closed; i++) await wait(50);
  return { room, c, ok: seated(c) };
}
const count = list => { const m = {}; for (const j of list) if (j.ok) m[j.room] = (m[j.room] || 0) + 1; return m; };

/* 1. Forty-five players, one after another. */
const phones = [];
for (let i = 0; i < 45; i++) phones.push(await join());
const c1 = count(phones);
ok('45 players joining one after another land 20, 20 and 5 (lobby, lobby-2, lobby-3), every one seated', c1.lobby === 20 && c1['lobby-2'] === 20 && c1['lobby-3'] === 5 && phones.every(j => j.ok), JSON.stringify(c1));
/* A room's trains are the room's twenty, players and bots together: a
   player drives one of them, and bots drive the rest (ocean.js). */
const trains = [...new Set(phones.filter(j => j.ok).map(j => (j.c.inits.at(-1).kinds || []).length))];
ok('bots still fill every room: each overflow room has the same twenty trains as lobby, players and bots together', trains.length === 1 && trains[0] === 20, JSON.stringify(trains) + ' trains a room');

/* 2. One leaves lobby-2; the next joiner takes that seat. */
const leaver = phones.find(j => j.room === 'lobby-2');
leaver.c.ws.close(1000, 'bye'); await wait(2000);
const next = await join(); phones.push(next);
ok('when one leaves, the next joiner takes that seat', next.ok && next.room === 'lobby-2', next.room + (next.ok ? ', seated' : ', not seated'));

/* 2b. In the browser: lobby and lobby-2 are full, lobby-3 has 5. The
   feedback page with a saved name plays in lobby-3; a first visit (no name)
   watches lobby, and its Play, refused there as full, goes to lobby-3 too. */
const b = await chromium.launch({ executablePath: process.env.CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const errs = [];
async function page (named) {
  const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, hasTouch: true });
  if (named) await ctx.addInitScript(() => { try { localStorage.setItem('manta:name', 'tester 99'); } catch (_) {} });
  const p = await ctx.newPage(); p.setDefaultTimeout(30000); p.setDefaultNavigationTimeout(30000);
  p.on('pageerror', e => errs.push(e.message.slice(0, 160)));
  await p.goto(B + '/lab/manta/play/?backend=webgl2&tier=low', { waitUntil: 'load' }).catch(e => errs.push('goto ' + e.message));
  return { ctx, p };
}
const where = p => p.evaluate(() => { const R = window.__lab && window.__lab.room; return R ? { seat: R.seatRoom, me: !!R.me, play: R.play, url: location.search } : null; }).catch(() => null);
{
  const { ctx, p } = await page(true);
  await p.waitForFunction(() => window.__lab && window.__lab.room && window.__lab.room.me, null, { timeout: 20000 }).catch(() => {});
  const w = await where(p);
  ok('the feedback page plays in the public room with the most players and a free seat', w && w.me && w.seat === 'lobby-3' && !/solo/.test(w.url), JSON.stringify(w));
  await ctx.close();
}
await wait(2000);
{
  const { ctx, p } = await page(false);
  await p.waitForSelector('#nameBox', { state: 'visible', timeout: 20000 }).catch(() => {});
  await p.waitForFunction(() => window.__lab && window.__lab.room && window.__lab.room.connected, null, { timeout: 20000 }).catch(() => {});
  await p.fill('#nameBox', 'first visit').catch(() => {});
  await p.click('#playBtn').catch(e => errs.push('click ' + e.message));
  await p.waitForFunction(() => window.__lab.room.me, null, { timeout: 20000 }).catch(() => {});
  const w = await where(p);
  ok('a first visit\'s Play, with lobby full, swims in lobby-3 instead of watching', w && w.me && w.seat === 'lobby-3', JSON.stringify(w));
  await ctx.close();
}
await wait(2000);

/* 3. The cap: 4 live rooms. Fill lobby-3, then make a private room and join it: now 4 live, all full or private. */
for (let i = 0; i < 15; i++) phones.push(await join());
const c3 = count(phones.filter(j => j !== leaver));
ok('lobby-3 fills to 20 before anything new opens', c3['lobby-3'] === 20 && !c3['lobby-4'], JSON.stringify(c3));
const made = await fetch(B + '/lab/manta/rooms/new', { method: 'POST', headers: { Origin: B, 'X-Test-Address': 'cap-1' } });
const code = made.ok ? (await made.json()).code : null;
let priv = null; if (code) { priv = player(PORT, code); await priv.opened; for (let i = 0; i < 100 && !seated(priv); i++) await wait(50); }
ok('a private room is made and joined', !!code && seated(priv), code || made.status);
await wait(1500);
const over = await ask('cap-2');
ok('the cap holds: every public room full and 4 rooms live (private included), the next joiner is told every room is full', /^HTTP 503 every room is full/.test(over), over);
const made2 = await fetch(B + '/lab/manta/rooms/new', { method: 'POST', headers: { Origin: B, 'X-Test-Address': 'cap-3' } });
ok('and no new private room opens past the cap either', made2.status === 503, made2.status + ' ' + (await made2.text()));
/* The room refuses a 21st player itself, whatever the registry thought. */
const extra = player(PORT, 'lobby'); await extra.opened; for (let i = 0; i < 60 && !extra.full && !seated(extra); i++) await wait(50);
ok('a phone going straight to a full lobby is refused by the room', extra.full && !seated(extra), extra.full ? 'full' : 'seated?');

/* 4. The feedback page with every room full: solo, with the note. */
const { p } = await page(true);
await p.waitForURL(/solo=1/, { timeout: 30000 }).catch(() => {});
await wait(1500);
const st = await p.evaluate(() => ({ url: location.search, note: (document.getElementById('note') || {}).textContent || '', shown: !document.getElementById('noteRow').hidden })).catch(e => ({ url: 'ERR ' + e.message }));
ok('every room full: the feedback page starts solo with a one-line note', /solo=1/.test(st.url) && /note=full/.test(st.url) && st.shown && /Every room is full just now, so this is solo\./.test(st.note), st.url + ' | ' + st.note);
ok('no page errors', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
await b.close();
for (const j of phones) if (j.c) try { j.c.ws.close(); } catch (_) {}
try { priv && priv.ws.close(); extra.ws.close(); } catch (_) {}
console.log('overflow failures: ' + bad);
clearTimeout(die); process.exit(bad ? 1 : 0);
