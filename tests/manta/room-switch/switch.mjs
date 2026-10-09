/* Brief 4B part 4: the switches Nathan changes from his phone, through
   wrangler dev (DIRECT=1). Run twice:

   MODE=off, with VARS="--var ROOMS_OPEN:false" (the dashboard switch off):
     every rooms request is refused 503 "rooms are off"; the feedback page
     goes solo with the plain note "Rooms are off for now, so this is solo."
     well inside the old 5 s, as a returning player, a first visit and a
     private room's link; the lab page says so in its signal and stops
     trying; no page errors, nothing off-origin.
   MODE=on, with no variables (rooms on, the live cap at its default 3):
     ?fake=off and ?fake=full give the off and full notes on the feedback
     page while a phone going straight to lobby still plays (the fake touches
     no one else); three live rooms (lobby and two private) refuse a fourth;
     wrangler.jsonc keeps dashboard variables (keep_vars) and declares
     neither switch, so no deploy overwrites them.
   MODE=cap2, with VARS="--var LIVE_CAP:2": lobby and one private room live
     refuse a second private room: the variable is read.

   The real every-seat-taken case (45 phones filling three rooms of 20) is
   room-overflow/overflow.mjs. */
import { readFileSync } from 'node:fs';
import { chromium } from '../lib/tools.mjs';
const PORT = +process.env.PORT, O = 'http://127.0.0.1:' + PORT, MODE = process.env.MODE || 'on';
const TREE = decodeURIComponent(new URL('../../..', import.meta.url).pathname).replace(/\/$/, '');
const BUILD = readFileSync(TREE + '/docs/lab/manta/panel.js', 'utf8').match(/export const BUILD = '([^']+)'/)[1];
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 170000);
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + '[' + MODE + '] ' + n + (x ? '  [' + x + ']' : '')); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const R = '/lab/manta/rooms/';
const post = async (path, addr) => { const r = await fetch(O + path, { method: 'POST', headers: { Origin: O, 'X-Test-Address': addr || 'sw-' + Math.random() } }); return { status: r.status, text: await r.text() }; };
/* A bare phone: says hello as a player (or watcher) and records what comes back. */
function phone (path, play = true) {
  const c = { msgs: [], init: null, opened: false, closed: null, status: null };
  const ws = new WebSocket('ws://127.0.0.1:' + PORT + path, { headers: { Origin: O } });
  ws.binaryType = 'arraybuffer'; c.ws = ws;
  c.ready = new Promise(res => {
    ws.onopen = () => { c.opened = true; const h = { t: 'hi', b: String(BUILD).replace(/\D/g, '').slice(2) }; if (play) h.p = 1; ws.send(JSON.stringify(h)); res(true); };
    ws.onerror = () => res(false);
  });
  ws.onmessage = e => { if (typeof e.data !== 'string') { c.snaps = (c.snaps || 0) + 1; return; } const m = JSON.parse(e.data); c.msgs.push(m); if (m.t === 'init') c.init = m; };
  ws.onclose = e => { c.closed = { code: e.code }; };
  c.end = () => { try { ws.close(); } catch (_) {} };
  return c;
}
const b = await chromium.launch({ executablePath: process.env.CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const errs = [], off = [];
async function page (named) {
  const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, hasTouch: true });
  if (named) await ctx.addInitScript(() => { try { localStorage.setItem('manta:name', 'switch tester'); } catch (_) {} });
  const p = await ctx.newPage(); p.setDefaultTimeout(30000); p.setDefaultNavigationTimeout(30000);
  p.on('pageerror', e => errs.push(e.message.slice(0, 160)));
  /* A refused socket is the browser's own console line, not the page's error. */
  p.on('console', c => { if (c.type() === 'error' && !/WebSocket connection to|Failed to load resource/.test(c.text())) errs.push(c.text().slice(0, 160)); });
  p.on('request', r => { const u = r.url(); if (!u.startsWith(O) && !u.startsWith(O.replace('http', 'ws')) && !/^(data|about|blob):/.test(u)) off.push(u); });
  p.ctx = ctx; return p;
}
const noteOf = p => p.evaluate(() => ({ url: location.search, note: (document.getElementById('note') || {}).textContent || '', shown: !!document.getElementById('noteRow') && !document.getElementById('noteRow').hidden, solo: !!window.__sim && !(window.__lab && window.__lab.room) })).catch(e => ({ url: 'ERR ' + e.message }));
async function soloNote (query, named, why) {
  const p = await page(named), t0 = Date.now();
  await p.goto(O + '/lab/manta/play/?backend=webgl2&tier=low' + query, { waitUntil: 'load' }).catch(e => errs.push('goto ' + e.message));
  const tLoad = Date.now() - t0;
  await p.waitForURL(new RegExp('note=' + why), { timeout: 20000 }).catch(() => {});
  const tSolo = Date.now() - t0;
  await wait(1200);
  const s = await noteOf(p); await p.ctx.close();
  return { ...s, tLoad, tSolo };
}
const OFF_NOTE = /^Rooms are off for now, so this is solo\.$/, FULL_NOTE = /^Every room is full just now, so this is solo\.$/;

if (MODE === 'off') {
  const pub = await post(R + 'public'), st = await post(R + 'status'), nw = await post(R + 'new');
  const ws = phone(R + 'ocean/lobby'); await ws.ready; await wait(800);
  const echo = await fetch(O + R + 'echo'); const echoText = await echo.text();
  ok('switched off: the public game, the status ask, a new room, a socket and the echo are all refused', pub.status === 503 && /rooms are off/.test(pub.text) && st.status === 503 && nw.status === 503 && !ws.opened && echo.status === 503 && /off/.test(echoText),
     JSON.stringify({ public: pub, status: st, new: nw.status, socket: ws.opened ? 'opened' : 'refused', echo: echo.status }));
  for (const [label, query, named] of [['a returning player', '', true], ['a first visit', '', false], ['a private room\'s link', '&room=23456789', true]]) {
    const s = await soloNote(query, named, 'off');
    ok(label + ': solo with the plain note, well inside the old 5 s', /note=off/.test(s.url) && s.solo && s.shown && OFF_NOTE.test(s.note) && s.tSolo - s.tLoad < 4000,
       s.url + ' | "' + s.note + '" | solo ' + ((s.tSolo - s.tLoad) / 1000).toFixed(1) + ' s after load');
  }
  { const p = await page(true); const asked = [];
    p.on('request', r => { if (r.url().includes(R)) asked.push(r.url().replace(O, '')); });
    await p.goto(O + '/lab/manta/?backend=webgl2&tier=low&room=lobby&play=1', { waitUntil: 'load' }).catch(e => errs.push('goto ' + e.message));
    await wait(4000); const sig = await p.evaluate(() => (document.getElementById('signal') || {}).textContent || '').catch(() => '');
    const n4 = asked.length; await wait(8000); const n12 = asked.length;
    ok('the lab page says rooms are off and stops trying', /rooms are off/.test(sig) && n12 === n4 && n4 <= 4, '"' + sig.trim() + '"; rooms requests ' + n4 + ' by 4 s, ' + n12 + ' by 12 s: ' + asked.slice(0, 4).join(' '));
    await p.ctx.close(); }
}

if (MODE === 'on') {
  const free = phone(R + 'ocean/lobby');
  for (const [why, re, label] of [['off', OFF_NOTE, 'off'], ['full', FULL_NOTE, 'full']]) {
    const s = await soloNote('&fake=' + why, true, why);
    ok('?fake=' + why + ': the feedback page goes solo with the "' + label + '" note', new RegExp('note=' + why).test(s.url) && s.solo && s.shown && re.test(s.note), s.url + ' | "' + s.note + '"');
  }
  await wait(500);
  ok('and the fake touches no one else: a phone going straight to lobby is seated and swimming', !!(free.init && free.init.me) && free.snaps > 20, (free.init && free.init.me ? 'seated as #' + free.init.me.id : 'not seated') + ', ' + (free.snaps || 0) + ' snapshots');
  /* The default cap: lobby (live, the phone above) and two private rooms. */
  const a = await post(R + 'new', 'cap-a'), b2 = await post(R + 'new', 'cap-b');
  const ca = JSON.parse(a.text).code, cb = JSON.parse(b2.text).code;
  const pa = phone(R + 'ocean/' + ca), pb = phone(R + 'ocean/' + cb); await pa.ready; await pb.ready; await wait(1500);
  const third = await post(R + 'new', 'cap-c');
  ok('the live room cap defaults to 3: lobby and two private rooms live, a third private room is refused', !!(pa.init && pb.init) && third.status === 503 && /busy/.test(third.text), JSON.stringify({ a: a.status, b: b2.status, third }));
  pa.end(); pb.end(); free.end();
  const cfg = readFileSync(TREE + '/wrangler.jsonc', 'utf8').replace(/^\s*\/\/.*$/gm, '');
  ok('wrangler.jsonc keeps the dashboard\'s variables through deploys and declares neither switch', /"keep_vars"\s*:\s*true/.test(cfg) && !/"vars"\s*:/.test(cfg) && !/"(ROOMS_OPEN|LIVE_CAP)"/.test(cfg), 'keep_vars ' + /"keep_vars"\s*:\s*true/.test(cfg));
}

if (MODE === 'cap2') {
  const lobby = phone(R + 'ocean/lobby', false);
  const a = await post(R + 'new', 'cap2-a'); const ca = JSON.parse(a.text).code;
  const pa = phone(R + 'ocean/' + ca); await lobby.ready; await pa.ready; await wait(1500);
  const second = await post(R + 'new', 'cap2-b');
  ok('LIVE_CAP 2 from the variable: lobby and one private room live, a second private room is refused', !!(lobby.init && pa.init) && second.status === 503 && /busy/.test(second.text), JSON.stringify({ first: a.status, second }));
  lobby.end(); pa.end();
}

ok('no page errors, nothing off-origin', errs.length === 0 && off.length === 0, JSON.stringify(errs.slice(0, 3)) + ' ' + off.slice(0, 2).join(' '));
await b.close(); console.log('switch failures: ' + bad); clearTimeout(die); setTimeout(() => process.exit(bad ? 1 : 0), 300);
