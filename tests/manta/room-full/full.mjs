/* Brief 4B part 4, after the review: "every room is full" reaches solo with
   the plain note even after the page has joined, through wrangler dev
   (DIRECT=1). Run twice:

   MODE=play, VARS="--var LIVE_CAP:1": lobby full with 20 scripted players,
     so every room is full. A first visit watches lobby under its name
     panel, types a name and presses Play: the room says it is full and the
     page goes solo with "Every room is full just now, so this is solo."
   MODE=back, VARS="--var LIVE_CAP:2": a player in private room X hides its
     page and its socket drops (as the room's silent close does); X empties,
     and room Y takes the second live slot. Shown again, the page's way back
     into X is refused by the cap; it asks why (/status?room=X: "every room
     is busy") and goes solo with the full note, not "reconnecting…"
     forever. A first load of X's link at that moment goes solo with the
     full note too, inside the 5 s that would have said "could not be
     reached".
   No page errors (a refused socket's own console line aside), nothing
   off-origin. About 60 s a mode. */
import { readFileSync } from 'node:fs';
import { chromium } from '../lib/tools.mjs';
const PORT = +process.env.PORT, O = 'http://127.0.0.1:' + PORT, MODE = process.env.MODE || 'play', R = '/lab/manta/rooms/';
const TREE = decodeURIComponent(new URL('../../..', import.meta.url).pathname).replace(/\/$/, '');
const BUILD = readFileSync(TREE + '/docs/lab/manta/panel.js', 'utf8').match(/export const BUILD = '([^']+)'/)[1];
const digits = String(BUILD).replace(/\D/g, '').slice(2);
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 170000 * (+process.env.WATCHDOG_X || 1));
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + '[' + MODE + '] ' + n + (x ? '  [' + x + ']' : '')); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const post = async (path, addr) => { const r = await fetch(O + path, { method: 'POST', headers: { Origin: O, 'X-Test-Address': addr || 'fu-' + Math.random() } }); return { status: r.status, text: await r.text() }; };
/* A scripted phone: a player sending an input every 200 ms (never benched),
   or a watcher pinging every second (never silent). */
function phone (path, play = true) {
  const c = { init: null, opened: false, closed: null };
  const ws = new WebSocket('ws://127.0.0.1:' + PORT + path, { headers: { Origin: O } }); ws.binaryType = 'arraybuffer'; c.ws = ws;
  let seq = 0;
  c.ready = new Promise(res => { ws.onopen = () => { c.opened = true; const h = { t: 'hi', b: digits }; if (play) h.p = 1; ws.send(JSON.stringify(h)); res(true); }; ws.onerror = () => res(false); });
  ws.onmessage = e => { if (typeof e.data === 'string') { const m = JSON.parse(e.data); if (m.t === 'init') c.init = m; } };
  ws.onclose = e => { c.closed = e.code; };
  c.timer = setInterval(() => { if (ws.readyState !== 1) return; ws.send(JSON.stringify(play ? { t: 'in', seq: ++seq, w: null, d: 0 } : { t: 'ping', c: Math.floor(performance.now()) % 1e6 })); }, play ? 200 : 1000);
  c.end = () => { clearInterval(c.timer); try { ws.close(); } catch (_) {} };
  return c;
}
const b = await chromium.launch({ executablePath: process.env.CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const errs = [], off = [];
async function page (named) {
  const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, hasTouch: true });
  if (named) await ctx.addInitScript(() => { try { localStorage.setItem('manta:name', 'full tester'); } catch (_) {} });
  /* Every socket the page opens, so the test can drop one as a network would. */
  await ctx.addInitScript(() => { const W = window.WebSocket; window.__socks = [];
    window.WebSocket = function (...a) { const s = new W(...a); window.__socks.push(s); return s; };
    window.WebSocket.prototype = W.prototype; Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 }); });
  const p = await ctx.newPage(); p.setDefaultTimeout(30000 * (+process.env.WATCHDOG_X || 1)); p.setDefaultNavigationTimeout(30000 * (+process.env.WATCHDOG_X || 1));
  p.on('pageerror', e => errs.push(e.message.slice(0, 160)));
  p.on('console', c => { if (c.type() === 'error' && !/WebSocket connection to|Failed to load resource/.test(c.text())) errs.push(c.text().slice(0, 160)); });
  p.on('request', r => { const u = r.url(); if (!u.startsWith(O) && !u.startsWith(O.replace('http', 'ws')) && !/^(data|about|blob):/.test(u)) off.push(u); });
  p.ctx = ctx; return p;
}
const noteOf = p => p.evaluate(() => ({ url: location.search, note: (document.getElementById('note') || {}).textContent || '', sig: ([...document.querySelectorAll('div')].map(d => d.textContent).find(t => /^● /.test(t || '')) || '') })).catch(e => ({ url: 'ERR ' + e.message, note: '', sig: '' }));
const hide = (p, h) => p.evaluate(h => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => h ? 'hidden' : 'visible' });
  document.dispatchEvent(new Event('visibilitychange')); }, h);
const FULL_NOTE = /^Every room is full just now, so this is solo\.$/;
const phones = [];

if (MODE === 'play') {
  for (let i = 0; i < 20; i++) { const c = phone(R + 'ocean/lobby'); phones.push(c); await c.ready; }
  await wait(1500);
  const seated = phones.filter(c => c.init && c.init.me).length;
  const p = await page(false);
  await p.goto(O + '/lab/manta/play/?backend=webgl2&tier=low', { waitUntil: 'load' });
  const panel = await p.waitForSelector('#namePanel:not([hidden])', { timeout: 20000 }).then(() => true).catch(() => false);
  await p.waitForFunction(() => window.__lab && window.__lab.room && window.__lab.room.connected, null, { timeout: 20000 }).catch(() => {});
  await p.fill('#nameBox', 'late comer');
  const t0 = Date.now();
  await p.click('#playBtn');
  await p.waitForURL(/note=full/, { timeout: 20000 }).catch(() => {});
  const tSolo = Date.now() - t0; await wait(1200);
  const s = await noteOf(p);
  ok('lobby full and the cap at 1: a first visit watching under its name panel presses Play and goes solo with the full note', seated === 20 && panel && /solo=1/.test(s.url) && /note=full/.test(s.url) && FULL_NOTE.test(s.note),
     seated + ' seated; panel ' + panel + '; ' + s.url + ' | "' + s.note + '" ' + (tSolo / 1000).toFixed(1) + ' s after Play');
  await p.ctx.close();
}

if (MODE === 'back') {
  const w = phone(R + 'ocean/lobby', false); phones.push(w); await w.ready; await wait(800);
  const mx = await post(R + 'new', 'fu-x'), my = await post(R + 'new', 'fu-y');
  const X = mx.status === 200 ? JSON.parse(mx.text).code : null, Y = my.status === 200 ? JSON.parse(my.text).code : null;
  const p = await page(true);
  await p.goto(O + '/lab/manta/play/?backend=webgl2&tier=low&room=' + X, { waitUntil: 'load' });
  await p.waitForFunction(() => { const R = window.__lab && window.__lab.room; return R && R.connected && R.me; }, null, { timeout: 25000 }).catch(() => {});
  const inX = await p.evaluate(() => !!(window.__lab.room.me)).catch(() => false);
  /* Hidden, and its socket dropped. */
  await hide(p, true);
  await p.evaluate(() => { const s = window.__socks.at(-1); if (s) s.close(); });
  let open = null; for (let k = 0; k < 50; k++) { open = await post(R + 'status?room=' + Y); if (open.status === 200) break; await wait(100); }
  const y = phone(R + 'ocean/' + Y); phones.push(y); await y.ready; await wait(1500);
  const busy = await post(R + 'status?room=' + X);
  const socks0 = await p.evaluate(() => window.__socks.length);
  /* Shown again. */
  const t0 = Date.now();
  await hide(p, false);
  await p.waitForURL(/note=full/, { timeout: 25000 }).catch(() => {});
  const tSolo = Date.now() - t0; await wait(1200);
  const s = await noteOf(p);
  ok('set-up: lobby and private room X live, then X empties and Y takes the second slot of 2', !!X && !!Y && inX && open.status === 200 && !!(y.init && y.init.me) && busy.status === 503 && /busy/.test(busy.text),
     JSON.stringify({ X, Y, inX, yFirst: open.status, ySeated: !!(y.init && y.init.me), xNow: busy }));
  ok('shown again, the way back into X is refused by the cap and the page goes solo with the full note', /solo=1/.test(s.url) && /note=full/.test(s.url) && FULL_NOTE.test(s.note) && tSolo < 15000,
     s.url + ' | "' + s.note + '" ' + (tSolo / 1000).toFixed(1) + ' s after shown; sockets before showing ' + socks0);
  await p.ctx.close();
  const q = await page(true), t1 = Date.now();
  await q.goto(O + '/lab/manta/play/?backend=webgl2&tier=low&room=' + X, { waitUntil: 'load' });
  const tLoad = Date.now() - t1;
  await q.waitForURL(/note=(full|slow)/, { timeout: 20000 }).catch(() => {});
  const tq = Date.now() - t1; await wait(1200);
  const s2 = await noteOf(q);
  /* "Inside the 5 s" is the page's own: it starts its 5 s when the room
     starts trying (play/index.html) and goes solo with note=slow when they
     run out, so note=full is the proof. Until 4C this also asked for under
     5 s by the test's clock from the load event, which counts the page's
     modules and first frames too: 5.8 s once in 4C's first full suite
     pass on a 2-core container. The wall time is still printed, with a
     loose 15 s bar. */
  ok('a first load of X\'s link with the cap full goes solo with the full note, inside the page\'s 5 s (not "could not be reached")', /note=full/.test(s2.url) && FULL_NOTE.test(s2.note) && tq - tLoad < 15000,
     s2.url + ' | "' + s2.note + '" ' + ((tq - tLoad) / 1000).toFixed(1) + ' s after load');
  await q.ctx.close();
}
ok('no page errors, nothing off-origin', errs.length === 0 && off.length === 0, JSON.stringify(errs.slice(0, 3)) + ' ' + off.slice(0, 2).join(' '));
for (const c of phones) c.end();
await b.close();
console.log('full failures: ' + bad); clearTimeout(die); setTimeout(() => process.exit(bad ? 1 : 0), 200);
