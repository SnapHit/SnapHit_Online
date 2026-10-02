/* 3F stage 2: compact snapshots through a delay proxy (PORT), watch mode,
   Node clients running the phone's own decoder and wild smoothing. */
import { readFileSync } from 'node:fs';
const TREE = process.env.TREE || decodeURIComponent(new URL('../../..', import.meta.url).pathname).replace(/\/$/, ''), LIB = process.env.LIB || TREE, LABEL = process.env.LABEL || '', PORT = +process.env.PORT;
const { createMirror, decodeSnap, createWildStore } = await import(LIB + '/docs/lab/manta/roomcore.js');
const BUILD = readFileSync(TREE + '/docs/lab/manta/panel.js', 'utf8').match(/export const BUILD = '([^']+)'/)[1];
const B = 'http://127.0.0.1:' + PORT, SECS = +(process.env.SECS || 30);
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 300000);
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + '[' + LABEL + '] ' + n + (x ? '  [' + x + ']' : '')); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const q = (a, p) => { a = a.slice().sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.ceil(p * a.length) - 1)] : NaN; };
/* A watching phone: follows the top bot like the page, a view at most five
   times a second when it moved, a ping a second, every byte counted. */
function phone (room, debug) {
const V = (v, a) => { const m = { t: 'view', x: Math.round(v.x), z: Math.round(v.z), w: Math.round(v.w), h: Math.round(v.h) }; if (a >= 0) m.a = a; return m; };
const HI = (b, a, g) => { const m = { t: 'hi', b: String(b).replace(/\D/g, '').slice(2) }; if (a >= 0) m.a = a; if (g) m.g = 1; return m; };
  const c = { bytes: [], init: null, mirror: null, wild: createWildStore(), trainErr: [], wildDrawn: [], wildNewest: [], truths: [], board: null, snaps: 0 };
  const ws = new WebSocket(B.replace('http', 'ws') + '/lab/manta/rooms/ocean/' + room, { headers: { Origin: B } });
  ws.binaryType = 'arraybuffer';
  const send = m => { const s = JSON.stringify(m); c.bytes.push([Date.now(), s.length]); try { ws.send(s); } catch (_) {} };
  let view = { x: 0, z: 0, w: 385, h: 855 }, sent = null, sentAt = 0, pingAt = 0, watch = -1;
  ws.onopen = () => { send(HI(BUILD, watch, debug)); send(V(view, watch)); };
  ws.onmessage = e => {
    const bin = typeof e.data !== 'string';
    c.bytes.push([Date.now(), bin ? e.data.byteLength : e.data.length]);
    const m = bin ? decodeSnap(e.data) : JSON.parse(e.data);
    if (!m) return;
    if (m.t === 'init') { c.init = m; c.mirror = createMirror(m.params); return; }
    if (m.t === 'snap') {
      c.snaps++; c.mirror.apply(m); c.wild.take(m); c.last = m;
      if (m.bd) c.board = m.bd;
      if (c.board && c.board.length) { watch = c.board[0][0]; const t = c.mirror.trains.get(watch); if (t) view = { x: t.x, z: t.z, w: 385, h: 855 }; }
      const now = Date.now();
      if (now - sentAt >= 200 && (!sent || Math.abs(view.x - sent.x) + Math.abs(view.z - sent.z) > 10 || sent.watch !== watch)) { send(V(view, watch)); sent = { ...view, watch }; sentAt = now; }
      if (now - pingAt >= 1000) { send({ t: 'ping', c: Math.round(performance.now()) }); pingAt = now; }
      return;
    }
    if (m.t === 'truth' && c.last && m.n === c.last.n) {
      for (const t of m.tr) { const r = c.mirror.trains.get(t.id); if (!r || r.dead) continue;
        let w = Math.hypot(r.x - t.x, r.z - t.z); t.f.forEach((f, k) => { if (r.followers[k]) w = Math.max(w, Math.hypot(r.followers[k].x - f[0], r.followers[k].z - f[1])); }); c.trainErr.push(w); }
      /* Wild as the phone draws them: at the moment two snapshots back
         (0.1 s, the least render delay), against the room's truth then;
         and at this snapshot's own moment, the worst case. */
      c.truths.push({ time: c.last.time, wd: m.wd }); if (c.truths.length > 3) c.truths.shift();
      const cmp = (tr, into) => { const got = new Map(); c.wild.at(tr.time, (slot, x, z) => got.set(slot, [x, z]));
        for (const [slot, x, z] of tr.wd) { const g = got.get(slot); if (g) into.push(Math.hypot(g[0] - x, g[1] - z)); } };
      cmp(c.truths[c.truths.length - 1], c.wildNewest);
      if (c.truths.length === 3) cmp(c.truths[0], c.wildDrawn);
    }
  };
  c.close = () => { try { ws.close(1000, 'bye'); } catch (_) {} };
  return c;
}
const room = 'c-' + Math.random().toString(36).slice(2, 7);
const watcher = phone(room, false), checker = phone(room, true);
await wait(3000); const t0 = Date.now(); await wait(SECS * 1000);
watcher.close(); checker.close();
const per = []; for (let k = 0; k < SECS; k++) { const a = t0 + k * 1000; per.push(watcher.bytes.filter(([t]) => t >= a && t < a + 1000).reduce((s, [, b]) => s + b, 0)); }
const med = q(per, 0.5) / 1024, p95 = q(per, 0.95) / 1024;
ok('bytes per phone, both directions: median at most 10 KB/s, 95th percentile at most 16 KB/s', med <= 10 && p95 <= 16,
   'median ' + med.toFixed(2) + ' KB/s, p95 ' + p95.toFixed(2) + ', worst ' + (Math.max(...per) / 1024).toFixed(2) + ' over ' + SECS + ' s; ' + watcher.snaps + ' snapshots');
const te = checker.trainErr;
ok('leaders and trains match the room to within 1 unit', te.length > 100 && Math.max(...te) <= 1, te.length + ' train checks, p95 ' + q(te, 0.95).toFixed(3) + ', worst ' + Math.max(...te).toFixed(3));
const wd = checker.wildDrawn, wn = checker.wildNewest;
ok('wild mantas as drawn (0.1 s back) within 3 units of the room', wd.length > 300 && Math.max(...wd) <= 3,
   wd.length + ' checks, p50 ' + q(wd, 0.5).toFixed(2) + ', p95 ' + q(wd, 0.95).toFixed(2) + ', worst ' + Math.max(...wd).toFixed(2) + '; at the newest moment worst ' + Math.max(...wn).toFixed(2));
console.log('[' + LABEL + '] compact failures: ' + bad); clearTimeout(die); setTimeout(() => process.exit(bad ? 1 : 0), 200);
