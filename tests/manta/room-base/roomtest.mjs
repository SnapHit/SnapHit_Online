/* 3C stage 4: an ocean room under wrangler dev, with Node clients. */
import { readFileSync } from 'node:fs';
/* 3F: snapshots are binary (decodeSnap); the truth for a debug client
   follows each one as JSON {t:'truth', n, tr, wd}. TREE picks the lab. */
const TREE = process.env.TREE || decodeURIComponent(new URL('../../..', import.meta.url).pathname).replace(/\/$/, '');
const { createMirror, decodeSnap } = await import(TREE + '/docs/lab/manta/roomcore.js');
const PORT = +process.env.PORT, B = 'http://127.0.0.1:' + PORT, WSB = 'ws://127.0.0.1:' + PORT;
const BUILD = readFileSync(TREE + '/docs/lab/manta/panel.js', 'utf8').match(/export const BUILD = '([^']+)'/)[1];
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 280000);
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x ? '  [' + x + ']' : '')); };
const wait = ms => new Promise(r => setTimeout(r, ms));
/* A client: collects messages and bytes, rebuilds trains with the mirror. */
const V = (v, a) => { const m = { t: 'view', x: Math.round(v.x), z: Math.round(v.z), w: Math.round(v.w), h: Math.round(v.h) }; if (a >= 0) m.a = a; return m; };
const HI = (b, a, g) => { const m = { t: 'hi', b: String(b).replace(/\D/g, '').slice(2) }; if (a >= 0) m.a = a; if (g) m.g = 1; return m; };
function client (room, { build = BUILD, view = { x: 0, z: 0, w: 12000, h: 12000 }, watch = -1, debug = true } = {}) {
  const c = { msgs: [], snaps: [], bytes: [], init: null, reload: null, closed: null, mirror: null, match: [] };
  c.ws = new WebSocket(WSB + '/lab/manta/rooms/ocean/' + room, { headers: { Origin: B } });
  c.ws.binaryType = 'arraybuffer';
  c.opened = new Promise(res => { c.ws.onopen = () => { c.ws.send(JSON.stringify(HI(build, watch, debug))); c.ws.send(JSON.stringify(V(view, watch))); res(true); }; c.ws.onerror = () => res(false); });
  c.ws.onclose = e => { c.closed = { code: e.code, reason: e.reason }; };
  c.ws.onmessage = e => {
    const bin = typeof e.data !== 'string';
    c.bytes.push([Date.now(), bin ? e.data.byteLength : Buffer.byteLength(String(e.data))]);
    const m = bin ? decodeSnap(e.data) : JSON.parse(String(e.data));
    if (!m) return;
    if (m.t === 'init') { c.init = m; c.mirror = createMirror(m.params); }
    else if (m.t === 'reload') c.reload = m;
    else if (m.t === 'snap') { c.snaps.push(m.n); c.lastTime = m.time; c.lastN = m.n; if (c.mirror) c.mirror.apply(m); }
    else if (m.t === 'truth' && c.mirror && m.n === c.lastN) {
      m.truth = m.tr;
      { { let worst = 0, n = 0;
          for (const t of m.truth) { const r = c.mirror.trains.get(t.id); if (!r) continue;
            worst = Math.max(worst, Math.hypot(r.x - t.x, r.z - t.z)); n++;
            for (let k = 0; k < t.f.length; k++) worst = Math.max(worst, Math.hypot(r.followers[k].x - t.f[k][0], r.followers[k].z - t.f[k][1])); }
          c.match.push({ n: m.n, worst, trains: n, followers: m.truth.reduce((a, t) => a + t.f.length, 0) }); } }
    }
  };
  return c;
}
const close = c => { try { c.ws.close(1000, 'bye'); } catch (_) {} };

/* 1. Three phones in one room: rebuilt leaders and trains match the room's. */
{ const cs = [client('t1'), client('t1'), client('t1')];
  await Promise.all(cs.map(c => c.opened)); await wait(20000);
  const common = cs[0].match.map(m => m.n).filter(n => cs.every(c => c.match.some(m => m.n === n)));
  const worst = Math.max(...cs.flatMap(c => c.match.map(m => m.worst)));
  const fol = Math.max(...cs.flatMap(c => c.match.map(m => m.followers)));
  ok('three clients: every rebuilt leader and follower within one unit of the room, at the same snapshots', cs.every(c => c.init && c.match.length > 100) && common.length > 100 && worst <= 1,
     'worst ' + worst.toFixed(3) + ' units over ' + cs.map(c => c.match.length).join('/') + ' snapshots (' + common.length + ' shared), up to ' + fol + ' followers in one snapshot; seed ' + (cs[0].init && cs[0].init.seed));
  const leftAt = Math.max(...cs.map(c => c.lastTime));
  cs.forEach(close); await wait(3000);
  /* 2. Empty, it idles; a phone returning restarts it where it stopped. */
  const back = client('t1'); await back.opened; await wait(2000);
  const gap = back.init ? back.init.time - leftAt : NaN, ran = back.lastTime - (back.init ? back.init.time : 0);
  ok('the room steps nothing once the last client leaves, and restarts when one returns', back.init && Math.abs(gap) < 0.5 && ran > 1,
     'room clock ' + leftAt + ' s when the last left, ' + (back.init && back.init.time) + ' s when one returned 3 s later (' + gap.toFixed(2) + ' s moved while empty); then ' + ran.toFixed(2) + ' s in the next 2 s');
  close(back); }

/* 3. Bytes per second for a phone-sized view that follows the top bot. */
{ const c = client('t2', { view: { x: 0, z: 0, w: 385, h: 855 }, debug: false });
  await c.opened; await wait(1500);
  /* Follow the top bot like the phone: watch it and centre the view on it. */
  const follow = setInterval(() => { const m = c.mirror; if (!m) return; let top = null;
    for (const t of m.trains.values()) if (!t.dead && (!top || t.len > top.len)) top = t;
    const lastSnap = c.lastBd; }, 200);
  c.ws.addEventListener('message', e => { if (typeof e.data === 'string') return; const m = decodeSnap(e.data); if (!m) return;
    if (m.bd) c.board = m.bd; if (!c.board || !c.board.length) return;
    const id = c.board[0][0], t = c.mirror.trains.get(id);
    c.ws.send(JSON.stringify(V({ x: t ? t.x : 0, z: t ? t.z : 0, w: 385, h: 855 }, id))); });
  const t0 = Date.now(); await wait(30000); clearInterval(follow);
  const per = []; for (let k = 0; k < 30; k++) { const a = t0 + k * 1000; per.push(c.bytes.filter(([t]) => t >= a && t < a + 1000).reduce((s, [, b]) => s + b, 0)); }
  per.sort((a, b) => a - b);
  const med = (per[14] + per[15]) / 2, p95 = per[Math.ceil(0.95 * per.length) - 1];
  ok('bytes per second per client at the defaults: median under 8 KB/s', med < 8192, 'median ' + (med / 1024).toFixed(2) + ' KB/s, p95 ' + (p95 / 1024).toFixed(2) + ' KB/s, worst ' + (per[29] / 1024).toFixed(2) + ' KB/s over 30 s');
  close(c); }

/* 4. A client on a different build is told to reload. */
{ const c = client('t3', { build: 'an older build' }); await c.opened; await wait(1500);
  ok('a client on a different build is told to reload', c.reload && c.reload.build === BUILD && c.closed && c.closed.code === 4000 && !c.init, JSON.stringify({ reload: c.reload, closed: c.closed })); }

/* 5. A dropped client reconnects and resyncs. */
{ const a = client('t4'); await a.opened; await wait(3000);
  a.ws.close(4001, 'drop'); await wait(500);
  const b2 = client('t4'); await b2.opened; await wait(4000);
  const first = b2.match[0], worst = Math.max(...b2.match.map(m => m.worst));
  ok('a dropped client reconnects and resyncs: full state, and it matches at once', b2.init && first && first.worst <= 1 && worst <= 1 && b2.match.length > 30,
     'first snapshot after reconnect: ' + (first ? first.trains + ' trains, worst ' + first.worst.toFixed(3) : 'none') + '; worst over ' + b2.match.length + ' snapshots ' + worst.toFixed(3));
  close(b2); }

/* 6. A step's time inside workerd after five simulated minutes. From 4B
   the bench is the room's own ocean (20 bots, the solo manta swimming too,
   radius 2760, 570 wild, 8 blooms; 0.44 ms at the old defaults and ten
   bots), and the bar is 3 ms: Brief 4B's bar for a room step is 4 ms with
   20 phones' snapshots included, which room-size/cost.mjs measured at
   about 1 ms of it. */
{ const time = async n => { const t0 = performance.now(); const r = await (await fetch(B + '/lab/manta/rooms/bench?n=' + n)).json(); return { ms: performance.now() - t0, r }; };
  const a = await time(18000), b = await time(21600);
  const per = (b.ms - a.ms) / 3600;
  ok('a step inside workerd after five minutes (the room\'s ocean: 21 trains, radius 2760, 570 wild): under 3 ms', per > 0 && per < 3, per.toFixed(4) + ' ms a step (' + (per / 16.67 * 100).toFixed(1) + '% of a 60 Hz frame); 18000 steps took ' + a.ms.toFixed(0) + ' ms, 21600 took ' + b.ms.toFixed(0) + ' ms; at 5 min ' + JSON.stringify(a.r)); }

console.log('roomtest failures: ' + bad); clearTimeout(die); setTimeout(() => process.exit(bad ? 1 : 0), 300);
