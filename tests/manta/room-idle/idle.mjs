/* Brief 4B, the idle close: a page that has gone quiet no longer keeps its
   room ticking. Through wrangler dev, DIRECT=1. About 2 minutes.

   - a phone that keeps talking (a watcher's ping every second) is never
     closed, and its room never stops
   - the lab page in play mode, hidden (document.hidden faked and the event
     fired, as a tab switch fires it): it says it is away, its loop stops and
     it sends nothing more; the room closes its socket about 60 s later
   - still hidden, it does not reconnect (no new socket for 20 s)
   - shown again, it reconnects at once and is seated with snapshots coming
   - a retry armed while on screen that fires after the page is hidden
     parks too; shown, the page reconnects at once (4B review)
   - a page opened hidden whose first socket fails tries again and joins
   - no page errors, nothing off-origin */
import { readFileSync } from 'node:fs';
import { chromium } from '../lib/tools.mjs';
const O = 'http://127.0.0.1:' + process.env.PORT, ROOM = 'idle1';
const TREE = decodeURIComponent(new URL('../../..', import.meta.url).pathname).replace(/\/$/, '');
const BUILD = readFileSync(TREE + '/docs/lab/manta/panel.js', 'utf8').match(/export const BUILD = '([^']+)'/)[1];
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 260000);
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x ? '  [' + x + ']' : '')); };
const wait = ms => new Promise(r => setTimeout(r, ms));

/* The talker: a watcher in the same room, a ping every second. */
const talk = { pongs: 0, closed: null, snaps: 0 };
{ const ws = new WebSocket(O.replace('http', 'ws') + '/lab/manta/rooms/ocean/' + ROOM, { headers: { Origin: O } });
  ws.binaryType = 'arraybuffer'; talk.ws = ws;
  await new Promise(res => { ws.onopen = res; ws.onerror = res; });
  ws.onmessage = e => { if (typeof e.data !== 'string') { talk.snaps++; return; } if (JSON.parse(e.data).t === 'pong') talk.pongs++; };
  ws.onclose = e => { talk.closed = e.code; };
  ws.send(JSON.stringify({ t: 'hi', b: String(BUILD).replace(/\D/g, '').slice(2) })); ws.send(JSON.stringify({ t: 'view', x: 0, z: 0, w: 400, h: 900 }));
  talk.timer = setInterval(() => { try { ws.send(JSON.stringify({ t: 'ping', c: Math.floor(performance.now()) % 1e6 })); } catch (_) {} }, 1000); }

const b = await chromium.launch({ executablePath: process.env.CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
/* Every socket the page opens, so the test can drop one as a network would. */
const SOCKS = () => { const W = window.WebSocket; window.__socks = [];
  window.WebSocket = function (...a) { const s = new W(...a); window.__socks.push(s); return s; };
  window.WebSocket.prototype = W.prototype; Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 }); };
const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1 });
await ctx.addInitScript(SOCKS);
const p = await ctx.newPage();
p.setDefaultTimeout(30000);
const errs = [], off = [], socks = [];
p.on('console', c => { if (c.type() === 'error') errs.push(c.text().slice(0, 200)); });
p.on('pageerror', e => errs.push('pageerror: ' + e.message.slice(0, 200)));
p.on('request', r => { const u = r.url(); if (!u.startsWith(O) && !/^(data|about|blob):/.test(u)) off.push(u); });
p.on('websocket', w => { const s = { url: w.url(), at: Date.now(), closed: null, sent: [] }; socks.push(s);
  w.on('framesent', f => s.sent.push([Date.now(), typeof f.payload === 'string' ? (JSON.parse(f.payload).t || '?') : 'bin']));
  w.on('close', () => { s.closed = Date.now(); }); });
const state = () => p.evaluate(() => { const R = window.__lab && window.__lab.room; return R ? { connected: R.connected, snaps: R.snaps, id: R.id, hidden: document.hidden } : null; });
const until = async (f, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const s = await state().catch(() => null); if (s && f(s)) return s; await wait(250); } return null; };
const hide = h => p.evaluate(h => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => h ? 'hidden' : 'visible' });
  document.dispatchEvent(new Event('visibilitychange')); }, h);

await p.goto(O + '/lab/manta/?room=' + ROOM + '&play=1&backend=webgl2&tier=low', { waitUntil: 'load' });
const s0 = await until(s => s.connected && s.id >= 0 && s.snaps > 30, 30000);
ok('the page joins the room and is seated', !!s0, s0 ? 'seat #' + s0.id + ', ' + s0.snaps + ' snapshots' : 'not seated');

/* Hidden. */
const first = socks.at(-1), tHide = Date.now();
await hide(true);
await wait(3000);
const after = first ? first.sent.filter(([t]) => t > tHide + 500) : [];
ok('hidden, the page says it is away and then sends nothing', !!first && first.sent.some(([t, k]) => t >= tHide - 50 && k === 'away') && after.length === 0,
   first ? 'away ' + first.sent.some(([t, k]) => t >= tHide - 50 && k === 'away') + ', ' + after.length + ' messages after 0.5 s: ' + after.map(a => a[1]).join(' ') : 'no socket');
const t0 = Date.now(); while (Date.now() - t0 < 90000 && first && !first.closed) await wait(250);
const closedAfter = first && first.closed ? (first.closed - tHide) / 1000 : NaN;
ok('the room closes the silent socket about a minute later', closedAfter > 58 && closedAfter < 66, 'closed ' + closedAfter.toFixed(1) + ' s after the page was hidden');
const n = socks.length; await wait(20000);
ok('still hidden, the page does not reconnect', socks.length === n, (socks.length - n) + ' new sockets in 20 s');
ok('the phone that keeps talking stays connected, and its room ticks on', talk.closed === null && talk.pongs > 80 && talk.snaps > 1000, 'closed ' + talk.closed + ', ' + talk.pongs + ' pongs, ' + talk.snaps + ' snapshots');

/* Shown again. */
const tShow = Date.now(), snapsBefore = (await state()).snaps;
await hide(false);
const s1 = await until(s => s.connected && s.id >= 0 && s.snaps > snapsBefore + 20, 10000);
const back = socks.length > n ? (socks[n].at - tShow) / 1000 : NaN;
ok('shown again, it reconnects at once and is seated', !!s1 && back < 1.5, 'new socket ' + back.toFixed(2) + ' s after shown; ' + (s1 ? 'seat #' + s1.id + ', ' + s1.snaps + ' snapshots' : 'not seated'));
/* A retry armed while the page was on screen (its socket dropped, as in a
   deploy) and the page hidden before it fires: it parks, and reconnects
   only when shown (4B review). */
{
  const n0 = socks.length;
  await p.evaluate(() => { const s = window.__socks.at(-1); if (s) s.close(); });
  await wait(150);                                     // the close has armed the half-second retry, on screen
  await hide(true);
  await wait(3000);
  const hiddenNew = socks.length - n0;
  const tShow2 = Date.now(); await hide(false);
  const s2 = await until(s => s.connected && s.id >= 0, 10000);
  const back2 = socks.length > n0 ? (socks[n0].at - tShow2) / 1000 : NaN;
  ok('a retry armed before the page was hidden does not reconnect it while hidden; shown, it reconnects at once', hiddenNew === 0 && !!s2 && back2 >= 0 && back2 < 1.5,
     hiddenNew + ' new sockets while hidden; then one ' + back2.toFixed(2) + ' s after shown, ' + (s2 ? 'seat #' + s2.id : 'not seated'));
}
/* Before its first join a hidden page keeps trying (or the feedback page's
   five seconds would send it solo for nothing): opened in a hidden tab, its
   first socket failing before it opens, it tries again and joins. */
{
  /* Its own browser: in the same one as the page above, headless Chromium
     held this page's close event for about 30 s after the network had
     already failed the socket. */
  const b2 = await chromium.launch({ executablePath: process.env.CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
  const c2 = await b2.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1 });
  await c2.addInitScript(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    const W = window.WebSocket; let first = true;
    /* The first socket asks for a room name the Worker refuses (404) at once.
       (Closing it mid-handshake instead held its close event for about 30 s
       while another page in the same browser had a socket open.) */
    window.WebSocket = function (...a) { if (first) { first = false; a[0] = String(a[0]).replace(/ocean\/[^?]+/, 'ocean/no_such_room'); } return new W(...a); };
    window.WebSocket.prototype = W.prototype; Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 }); });
  const q = await c2.newPage();
  q.on('pageerror', e => errs.push('pageerror: ' + e.message.slice(0, 200)));
  await q.goto(O + '/lab/manta/?room=' + ROOM + '&play=1&backend=webgl2&tier=low', { waitUntil: 'load' });
  let j = null; const t0 = Date.now();
  while (Date.now() - t0 < 20000) { j = await q.evaluate(() => { const R = window.__lab && window.__lab.room; return R ? { connected: R.connected, id: R.id } : null; }).catch(() => null); if (j && j.connected && j.id >= 0) break; await wait(250); }
  ok('a page opened hidden, its first socket failing, tries again and makes its first join', !!j && j.connected && j.id >= 0, JSON.stringify(j) + ' after ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
  await b2.close();
}
ok('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
ok('zero off-origin requests', off.length === 0, off.slice(0, 3).join(' '));

clearInterval(talk.timer); try { talk.ws.close(); } catch (_) {}
await b.close();
console.log('idle failures: ' + bad); clearTimeout(die); setTimeout(() => process.exit(bad ? 1 : 0), 200);
