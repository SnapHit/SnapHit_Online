/* Brief 3B stage 4: the static site and the rooms through wrangler dev. */
import { readFileSync } from 'node:fs'; import { createHash } from 'node:crypto'; import { request } from 'node:http';
const PORT = +process.env.PORT, B = 'http://127.0.0.1:' + PORT, D = decodeURIComponent(new URL('../../../docs', import.meta.url).pathname), WSB = 'ws://127.0.0.1:' + PORT;
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 80000);
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x ? '  [' + x + ']' : '')); };
const md5 = b => createHash('md5').update(b).digest('hex');
const get = async (p, h = {}) => { const r = await fetch(B + p, { headers: h, redirect: 'manual' });
  return { status: r.status, loc: r.headers.get('location') || '', body: Buffer.from(await r.arrayBuffer()) }; };
const nav = { 'Sec-Fetch-Mode': 'navigate', 'Accept': 'text/html' };
for (const [p, f] of [['/', 'index.html'], ['/play/hurtle', 'play/hurtle.html'], ['/lab/manta/', 'lab/manta/index.html'],
  ['/lab/manta/main.js', 'lab/manta/main.js'], ['/vendor/three/r186/three.core.js', 'vendor/three/r186/three.core.js'], ['/og.jpg', 'og.jpg'],
  ['/lab/manta/net/', 'lab/manta/net/index.html']]) {
  const r = await get(p, p.endsWith('/') || !p.includes('.') ? nav : {}), want = readFileSync(D + '/' + f);
  ok(p + ' is byte-identical to docs/' + f, r.status === 200 && md5(r.body) === md5(want), r.status + ', ' + r.body.length + ' bytes');
}
{ const r = await get('/play/hurtle.html', nav); ok('/play/hurtle.html still gives a 307', r.status === 307 && r.loc.endsWith('/play/hurtle'), r.status + ' -> ' + r.loc); }
const four = readFileSync(D + '/404.html');
for (const [label, h] of [['a navigation', nav], ['a plain fetch', {}]]) {
  const r = await get('/no-such-page-' + (h === nav ? 'nav' : 'fetch'), h);
  ok('a missing page (' + label + ') gives 404.html with a 404', r.status === 404 && md5(r.body) === md5(four), r.status + ', ' + r.body.length + ' bytes');
}
for (const p of ['/lab/manta/rooms/echo', '/lab/manta/rooms/room/probe']) { const r = await get(p); ok(p + ' without an upgrade gives 426', r.status === 426, r.status + ' ' + r.body.toString().trim()); }
for (const p of ['/lab/manta/rooms/nope', '/lab/manta/rooms/room/', '/lab/manta/rooms/room/Probe', '/lab/manta/rooms/room/' + 'a'.repeat(33), '/lab/manta/rooms/room/a/b']) {
  const r = await get(p); ok(p.slice(0, 50) + ' gives 404 from the Worker', r.status === 404 && r.body.toString().trim() === 'no such room', r.status + ' ' + r.body.toString().trim()); }
/* A raw upgrade with a chosen Origin, so the refusal can be seen as a status. */
const upgrade = (path, origin) => new Promise(res => { const h = { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==' };
  if (origin) h.Origin = origin;
  const q = request({ host: '127.0.0.1', port: PORT, path, headers: h });
  q.on('upgrade', (r, sock) => { sock.destroy(); res(r.statusCode); }); q.on('response', r => { r.resume(); res(r.statusCode); }); q.on('error', e => res('error ' + e.message)); q.end(); });
if (!process.env.SKIPRAW) for (const path of ['/lab/manta/rooms/echo', '/lab/manta/rooms/room/probe']) {
  const evil = await upgrade(path, 'https://evil.example'), none = await upgrade(path, null), site = await upgrade(path, 'https://snap-hit.online'), local = await upgrade(path, B);
  ok(path + ': a wrong Origin or none is refused with 403; this site and (under dev) localhost are accepted', evil === 403 && none === 403 && site === 101 && local === 101,
     'evil ' + evil + ', none ' + none + ', snap-hit.online ' + site + ', localhost ' + local);
}
const open = path => new Promise(res => { const w = new WebSocket(WSB + path, { headers: { Origin: B } }); const t = setTimeout(() => res(null), 8000);
  w.onopen = () => { clearTimeout(t); res(w); }; w.onerror = () => { clearTimeout(t); res(null); }; });
const ask = (w, msg) => new Promise(res => { const t = setTimeout(() => res('TIMEOUT'), 8000); w.onmessage = e => { clearTimeout(t); res(String(e.data)); }; w.send(msg); });
const echoTest = async path => { const w = await open(path); if (!w) return 'could not open'; const rtt = [];
  /* Paced (3O): the rooms close a socket over 30 messages a second (3G), so one ping every 40 ms. */
  for (let i = 0; i < 50; i++) { if (i) await new Promise(r => setTimeout(r, 40)); const t0 = performance.now(); const got = await ask(w, 'ping ' + i); if (got !== 'ping ' + i) { w.close(); return 'wrong: ' + got; } rtt.push(performance.now() - t0); }
  w.close(1000, 'done'); rtt.sort((a, b) => a - b); return 'ok, 50 echoes, median ' + rtt[25].toFixed(2) + ' ms, worst ' + rtt[49].toFixed(2) + ' ms (localhost)'; };
{ const r = await echoTest('/lab/manta/rooms/echo'); ok('the edge echo echoes', r.startsWith('ok'), r); }
{ const r = await echoTest('/lab/manta/rooms/room/probe'); ok('the room echo echoes', r.startsWith('ok'), r); }
/* "who" in the one echo room there is since 3G, "probe": any other room name
   is refused (404, checked above). The old half, "another room sees only
   itself", is retired: there is no second echo room to ask, and an issued
   room code opens an ocean, which does not answer "who" (room limits and
   issued codes are room-limits/limits.mjs's). */
await new Promise(r => setTimeout(r, 300));
{ const a = await open('/lab/manta/rooms/room/probe'), b2 = await open('/lab/manta/rooms/room/probe'), c = null;
  const wa = a && await ask(a, 'who'), wb = b2 && await ask(b2, 'who');
  ok('two connections to the probe room see each other in "who"', wa === '{"who":2}' && wb === '{"who":2}', 'room probe: ' + wa + ' / ' + wb);
  if (b2) b2.close(1000, 'x'); await new Promise(r => setTimeout(r, 300));
  const after = a && await ask(a, 'who'); ok('and when one leaves, "who" drops', after === '{"who":1}', 'after one closed: ' + after);
  for (const w of [a, c]) if (w) w.close(1000, 'done'); }
console.log('devcheck failures: ' + bad); clearTimeout(die); setTimeout(() => process.exit(bad ? 1 : 0), 200);
