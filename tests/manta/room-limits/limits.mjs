/* 3G stage 2: room limits, against wrangler dev started WITHOUT TEST_NAMES
   and with CODE_TTL_MS=4000, so codes expire in 4 s. */
import { readFileSync } from 'node:fs';
const TREE = process.env.TREE || decodeURIComponent(new URL('../../..', import.meta.url).pathname).replace(/\/$/, '');
const { decodeSnap } = await import(TREE + '/docs/lab/manta/roomcore.js');
const PORT = +process.env.PORT, B = 'http://127.0.0.1:' + PORT, WSB = 'ws://127.0.0.1:' + PORT, R = '/lab/manta/rooms/';
const BUILD = readFileSync(TREE + '/docs/lab/manta/panel.js', 'utf8').match(/export const BUILD = '([^']+)'/)[1];
const SHORT = BUILD.replace(/\D/g, '').slice(2);
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 85000);
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x ? '  [' + x + ']' : '')); };
const wait = ms => new Promise(r => setTimeout(r, ms));
let addr = 0;
const mint = async (o = {}) => { const r = await fetch(B + R + 'new', { method: o.method || 'POST', headers: Object.assign({ 'X-Test-Address': o.addr || ('a' + (++addr)) }, o.origin === null ? {} : { Origin: o.origin || B }) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (_) {} return { status: r.status, code: j && j.code, text: t }; };
import http from 'node:http';
/* The status a websocket upgrade gets: 101 when it would open, else the refusal. */
const status = (path, origin = B) => new Promise(res => {
  const q = http.get({ host: '127.0.0.1', port: PORT, path, headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', 'Sec-WebSocket-Version': '13', Origin: origin } });
  q.on('upgrade', (r, sock) => { sock.destroy(); res(101); });
  q.on('response', r => { r.resume(); res(r.statusCode); });
  q.on('error', () => res(0)); q.setTimeout(8000, () => { q.destroy(); res(-1); });
});
function sock (path, { hello = null, origin = B } = {}) {
  const c = { msgs: [], snaps: [], closed: null, open: false };
  c.ws = new WebSocket(WSB + path, { headers: { Origin: origin } }); c.ws.binaryType = 'arraybuffer';
  c.opened = new Promise(res => { c.ws.onopen = () => { c.open = true; if (hello) { c.ws.send(JSON.stringify(hello)); c.ws.send(JSON.stringify({ t: 'view', x: 0, z: 0, w: 400, h: 900 })); } res(true); }; c.ws.onerror = () => res(false); });
  c.ws.onmessage = e => { if (typeof e.data === 'string') { try { c.msgs.push(JSON.parse(e.data)); } catch (_) { c.msgs.push(e.data); } } else c.snaps.push(decodeSnap(e.data)); };
  c.ws.onclose = e => { c.closed = { code: e.code, reason: e.reason }; };
  c.send = m => { try { c.ws.send(typeof m === 'string' ? m : JSON.stringify(m)); } catch (_) {} };
  c.init = () => c.msgs.find(m => m && m.t === 'init');
  c.end = () => { try { c.ws.close(); } catch (_) {} };
  return c;
}
const watch = (path) => sock(path, { hello: { t: 'hi', b: SHORT } });
const player = (path, k) => sock(path, { hello: Object.assign({ t: 'hi', b: SHORT, p: 1, g: 1 }, k ? { k } : {}) });
const until = async (f, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (f()) return true; await wait(50); } return !!f(); };

/* 1. Names: lobby and issued codes only. */
{ const s = { lobby: await status(R + 'ocean/lobby'), invented: await status(R + 'ocean/my-room'), unissued: await status(R + 'ocean/abcdefgh'),
    echoOther: await status(R + 'room/whotest'), probe: await status(R + 'room/probe'), echo: (await fetch(B + R + 'echo')).status, };
  ok('an invented name is refused (404), an unissued code too, and echo rooms other than "probe"', s.invented === 404 && s.unissued === 404 && s.echoOther === 404, JSON.stringify(s));
  ok('lobby and the probe room still open (101); the edge echo still answers (426 to a plain GET)', s.lobby === 101 && s.probe === 101 && s.echo === 426, JSON.stringify(s)); }
/* 2. New codes: POST, right Origin, once per 10 s per address, 8 characters without look-alikes. */
{ const get = await mint({ method: 'GET' }), none = await mint({ origin: null }), evil = await mint({ origin: 'https://evil.example' });
  const a = await mint({ addr: 'same' }), a2 = await mint({ addr: 'same' }), b = await mint();
  ok('/new: GET 405, no Origin 403, another Origin 403', get.status === 405 && none.status === 403 && evil.status === 403, [get.status, none.status, evil.status].join('/'));
  ok('/new from this site returns an 8-character code without 0 o 1 l i', a.status === 200 && /^[2-9a-hjkmnp-z]{8}$/.test(a.code || ''), a.status + ' ' + a.code);
  ok('a second /new from the same address inside 10 s is refused (429); another address is not', a2.status === 429 && b.status === 200, a2.status + ' ' + JSON.stringify(a2.text) + ' / ' + b.status); }
/* 3. A code works, and two phones on it share a room; an Origin from elsewhere cannot join. */
{ const { code } = await mint(); const p = player(R + 'ocean/' + code), w = watch(R + 'ocean/' + code);
  await until(() => p.init() && w.init() && p.snaps.length > 5 && w.snaps.length > 5);
  const pi = p.init(), wi = w.init();
  ok('a code joins: a player and a watcher get the same room (seed, and the player is on the watcher\'s board)', pi && wi && pi.seed === wi.seed && pi.me && w.msgs.some(m => m.t === 'names' || m.t === 'init'), pi && ('seed ' + pi.seed + '/' + (wi && wi.seed) + ', me #' + pi.me.id + ' token ' + pi.me.token));
  ok('the token is 12 hex digits', /^[0-9a-f]{12}$/.test(pi && pi.me.token || ''), pi && pi.me.token);
  ok('a websocket from another Origin is refused (403), lobby and code alike', await status(R + 'ocean/lobby', 'https://evil.example') === 403 && await status(R + 'ocean/' + code, 'https://evil.example') === 403);
  /* 4. Oversize, flood and malformed. */
  const k0 = p.snaps.at(-1).k;
  const seat = pi.me.id; let seq = 1;
  p.send({ t: 'in', seq: seq++, w: 1.0 }); await wait(400);
  const ackOf = () => { for (let i = p.snaps.length - 1; i >= 0; i--) { const me = p.snaps[i].me; if (me && me.ack !== undefined) return me.ack; } return null; };
  const ack1 = ackOf();
  const bad = [ { t: 'in', seq: seq++, w: 'x' }, { t: 'in', seq: seq++, w: 1e9 }, { t: 'in', seq: 'a', w: 1 }, { t: 'in', seq: seq++, k: 1e15 }, { t: 'in', seq: seq++, d: -5 },
    { t: 'in', seq: seq++, b: 7 }, { t: 'in', seq: seq++, w: 1, d: 1e9 }, '{"t":"in","seq":99,"w":NaN}', '{"t":"in","seq":99,"w":Infinity}', 'null', '[1,2]', '42', '{"t":"view","x":"a","z":0,"w":1,"h":1}',
    { t: 'view', x: 0, z: 0, w: -1, h: 5 }, { t: 'ping', c: 'x' }, { t: 'hi', b: 5 }, { t: 'hi', b: SHORT, k: 'ZZ' } ];
  for (const m of bad) { p.send(m); await wait(40); }
  await wait(600);
  const ack2 = ackOf();
  ok('malformed messages (wrong types, NaN, infinities, out of range) are dropped: none is acked, the socket stays, the room steps on', p.closed === null && ack2 === ack1 && p.snaps.at(-1).k > k0 + 20, 'ack ' + ack1 + ' -> ' + ack2 + ', closed ' + JSON.stringify(p.closed) + ', steps ' + k0 + ' -> ' + p.snaps.at(-1).k);
  const s64 = '{"t":"ping","c":1' + '0'.repeat(64 - 18) + '}'; p.send(s64); await wait(400);
  ok('a 64-byte message is accepted', s64.length === 64 && p.closed === null, s64.length + ' bytes');
  p.send('{"t":"ping","c":1' + '0'.repeat(65 - 18) + '}'); await until(() => p.closed, 2000);
  ok('a 65-byte message closes the socket (1009)', p.closed && p.closed.code === 1009, JSON.stringify(p.closed));
  let n = 0; const t0 = Date.now(); while (Date.now() - t0 < 1500) { w.send({ t: 'ping', c: n++ }); await wait(40); }
  ok('25 messages a second for 1.5 s are fine', w.closed === null, n + ' sent');
  for (let i = 0; i < 40; i++) w.send({ t: 'ping', c: i }); await until(() => w.closed, 2000);
  ok('40 messages at once closes the socket (1008)', w.closed && w.closed.code === 1008, JSON.stringify(w.closed));
  for (const path of [R + 'echo', R + 'room/probe']) {
    const e1 = sock(path), e2 = sock(path), e3 = sock(path); await Promise.all([e1.opened, e2.opened, e3.opened]);
    e1.send('x'.repeat(64)); await wait(300); const echoed = e1.msgs.includes('x'.repeat(64));
    e2.send('x'.repeat(65)); for (let i = 0; i < 40; i++) e3.send('y' + i);
    await until(() => e2.closed && e3.closed, 2000);
    ok('the echo at ' + path.slice(R.length) + ' is under the same limits: 64 bytes echoed, 65 closed 1009, a flood closed 1008', echoed && e2.closed && e2.closed.code === 1009 && e3.closed && e3.closed.code === 1008, JSON.stringify([echoed, e2.closed, e3.closed]));
    e1.end();
  }
}
/* 5. Seats: at most 10 players (12 allowed; the ocean has 10 trains) and 4 watchers. */
{ const { code } = await mint(); const ps = [], ws = [];
  for (let i = 0; i < 11; i++) { ps.push(player(R + 'ocean/' + code)); await wait(60); }
  for (let i = 0; i < 5; i++) { ws.push(watch(R + 'ocean/' + code)); await wait(60); }
  await until(() => ps.every(c => c.init() || c.closed) && ws.every(c => c.init() || c.closed), 8000);
  const seated = ps.filter(c => c.init() && c.init().me).length, pfull = ps.filter(c => c.msgs.some(m => m.t === 'full')).length;
  const watching = ws.filter(c => c.init() && !c.closed).length, wfull = ws.filter(c => c.msgs.some(m => m.t === 'full')).length;
  ok('players: 10 seated, the 11th told the room is full', seated === 10 && pfull === 1, seated + ' seated, ' + pfull + ' full');
  ok('watchers: 4 watch, the 5th told the room is full', watching === 4 && wfull === 1, watching + ' watching, ' + wfull + ' full');
  const extra = []; for (let i = 0; i < 4; i++) extra.push(sock(R + 'ocean/' + code));
  await Promise.all(extra.map(c => c.opened)); await wait(300);
  ok('with 14 seated, two more sockets are let in to say hello and the next are refused before opening', extra.filter(c => c.open).length === 2 && extra.filter(c => !c.open).length === 2, extra.map(c => c.open ? 'open' : 'refused').join(','));
  for (const c of [...ps, ...ws, ...extra]) c.end();
  await wait(1500);
}
/* 6. Expiry (CODE_TTL_MS 4000): an unused code, and a code whose players left, are gone after 4 s; a live one is not. */
{ const unused = (await mint()).code, used = (await mint()).code, kept = (await mint()).code;
  const u = watch(R + 'ocean/' + used), k = watch(R + 'ocean/' + kept); await until(() => u.init() && k.init());
  u.end(); await wait(5200);
  const s = { unused: await status(R + 'ocean/' + unused), used: await status(R + 'ocean/' + used), kept: await status(R + 'ocean/' + kept) };
  ok('codes expire after the time with no players (unused 404, emptied 404) while a room with players stays (101)', s.unused === 404 && s.used === 404 && s.kept === 101, JSON.stringify(s));
  k.end(); await wait(1000);
}
/* 7. The cap: 20 live rooms, lobby included. */
{ const codes = []; for (let i = 0; i < 20; i++) codes.push((await mint()).code);
  const socks = [watch(R + 'ocean/lobby')]; for (let i = 0; i < 19; i++) socks.push(watch(R + 'ocean/' + codes[i]));
  await until(() => socks.every(c => c.init()), 15000); await wait(1000);
  const full = await mint(), twentieth = await status(R + 'ocean/' + codes[19]), again = watch(R + 'ocean/' + codes[3]), lobby2 = watch(R + 'ocean/lobby');
  await until(() => again.init() && lobby2.init(), 5000);
  ok('with 20 live rooms a new private room is refused with a clear message', full.status === 503 && /busy/.test(full.text), full.status + ' ' + JSON.stringify(full.text) + ', ' + socks.filter(c => c.init()).length + ' live');
  ok('and an idle code cannot start a 21st room, but a live room and lobby still take phones', twentieth === 503 && !!again.init() && !!lobby2.init(), 'idle code ' + twentieth + ', live room ' + !!again.init() + ', lobby ' + !!lobby2.init());
  socks[5].end(); again.end(); await wait(1500);
  const after = await mint();
  ok('when one room empties, a new private room can be made again', after.status === 200 && !!after.code, after.status + ' ' + after.code);
  for (const c of [...socks, lobby2]) c.end();
}
await wait(500);
console.log('limits failures: ' + bad); clearTimeout(die); process.exit(bad ? 1 : 0);
