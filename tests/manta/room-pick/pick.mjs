/* 3I: PICKUPS, through the delay proxy (PORT), with the phone's own code:
   roomplay.js for your train, roomcore.js for the wild mantas as the page
   draws them. The script swims at the nearest drawn wild manta.
   - pickup delay: from your drawn leader first within recruit radius of a
     drawn wild manta, to your drawn train getting longer;
   - wild error: each drawn wild manta against where the room has it at the
     same wall-clock moment (the truth, stamped with the room's clock). */
const TREE = process.env.TREE || decodeURIComponent(new URL('../../..', import.meta.url).pathname).replace(/\/$/, '');
const core = await import(TREE + '/docs/lab/manta/roomcore.js');
import { player } from './playclient.mjs';
const PORT = +process.env.PORT, LABEL = process.env.LABEL || 'proxy ' + PORT, SECS = +(process.env.SECS || 40);
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 88000);
const wait = ms => new Promise(r => setTimeout(r, ms));
const pct = (a, q) => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const room = process.env.ROOM || ('pk-' + Math.random().toString(36).slice(2, 7));
const store = core.createWildStore(), wclock = core.createWildClock ? core.createWildClock() : null;
const view = core.createWildView ? core.createWildView() : null;          // stage 2's shared drawing, when present
let drawn = new Map();                                                      // key -> [x, z, slot]
const c = player(PORT, room, { debug: true, script: c => {
  const P = c.play, you = c.you;
  if (!P.live || !P.me || you.dead > 0) { c.input.want = null; return; }
  let best = null, bd = 1e9;
  for (const [, p] of drawn) { const d = Math.hypot(p[0] - you.x, p[1] - you.z); if (d < bd) { bd = d; best = p; } }
  c.input.want = best ? Math.atan2(-(best[0] - you.x), -(best[1] - you.z)) : null;
} });
c.onSnap = m => { store.take(m); if (view) view.take(m); };
/* The room's truth: per slot, its last two positions with the room's time
   and wall clock, to put it where the room has it at any wall moment. */
const truth = new Map(); let tw = null;
/* Exact: what this phone drew at the room's own wall-clock moment of each
   truth (the drawn history interpolated to it), against the truth itself. */
const hist = new Map();                                                   // slot -> [[wall, x, z, gen]]
const errsExact = [], along = [], across = [], prevTruth = new Map();
c.onTruth = (m, simTime) => { if (simTime === null) return; tw = { sim: simTime, wall: m.w };
  for (const [i, x, z] of m.wd || []) { const h = hist.get(i); if (!h || h.length < 2 || h[0][0] > m.w || h[h.length - 1][0] < m.w) continue;
    let j = 1; while (j < h.length && h[j][0] < m.w) j++; const a = h[j - 1], b = h[j]; if (!b || a[3] !== b[3]) continue;
    const f = (m.w - a[0]) / Math.max(1e-6, b[0] - a[0]), dx = a[1] + (b[1] - a[1]) * f - x, dz = a[2] + (b[2] - a[2]) * f - z; errsExact.push(Math.hypot(dx, dz));
    const q = prevTruth.get(i); if (q) { const vx = x - q[0], vz = z - q[1], vl = Math.hypot(vx, vz); if (vl > 0.5) { along.push((dx * vx + dz * vz) / vl); across.push(Math.abs(dx * vz - dz * vx) / vl); } } }
  for (const [i, x, z] of m.wd || []) prevTruth.set(i, [x, z]);
  for (const [i, x, z] of m.wd || []) { const q = truth.get(i); truth.set(i, { t0: q ? q.t1 : null, x0: q ? q.x1 : 0, z0: q ? q.z1 : 0, t1: simTime, x1: x, z1: z }); } };
const roomAt = (i, wallMs) => { const q = truth.get(i); if (!q || !tw) return null;
  const T = tw.sim + (wallMs - tw.wall) / 1000; if (q.t1 < tw.sim - 0.001) return null;      // not in the latest truth: gone or out of view
  if (q.t0 === null || q.t1 <= q.t0) return [q.x1, q.z1];
  const f = (T - q.t1) / (q.t1 - q.t0); return [q.x1 + (q.x1 - q.x0) * f, q.z1 + (q.z1 - q.z0) * f]; };
await c.opened;
for (let k = 0; k < 100 && !(c.play.live && c.play.me); k++) await wait(50);
const R = c.params.recruitR || 30;
const errs = [], delays = [], touched = new Map(); let lastLen = null, lastT = performance.now(), frames = 0, deaths = 0, unpaired = 0;
const t0 = performance.now();
const timer = setInterval(() => {
  const now = performance.now(), dt = (now - lastT) / 1000; lastT = now; frames++;
  const tm = c.timing(); if (tm.offset === null) return;
  const nowS = now / 1000, T = nowS - tm.offset - tm.delay;
  const cur = new Map();
  if (view) view.at(nowS, tm.offset, c.rtt, dt, (slot, x, z, h, fl, col, gen) => cur.set(slot + ':' + gen, [x, z, slot]));
  else { const Tw = wclock(T - Math.max(0, core.wildDelayFor(tm.late) - tm.delay), dt);
    store.at(Tw, (slot, x, z, h, fl, col, gen) => cur.set(slot + ':' + gen, [x, z, slot])); }
  drawn = cur;
  const wall = Date.now();
  for (const [k, p] of cur) { const r = roomAt(p[2], wall); if (r) errs.push(Math.hypot(p[0] - r[0], p[1] - r[1]));
    let h = hist.get(p[2]); if (!h) { h = []; hist.set(p[2], h); } h.push([wall, p[0], p[1], k]); while (h.length && wall - h[0][0] > 1500) h.shift(); }
  const you = c.you;
  if (!c.play.live || you.dead > 0) { lastLen = null; touched.clear(); return; }
  for (const [k, p] of cur) if (!touched.has(k) && Math.hypot(p[0] - you.x, p[1] - you.z) <= R) touched.set(k, now);
  for (const [k, t] of touched) if (now - t > 3000) touched.delete(k);
  const L = you.followers.length;
  if (lastLen !== null && L > lastLen) for (let j = 0; j < L - lastLen; j++) {
    /* The manta that joined: a touched one no longer drawn in the water
       (the earliest such), else no pairing: a touch the room did not take. */
    let bk = null; for (const [k, t] of touched) if (!cur.has(k) && (bk === null || t < touched.get(bk))) bk = k;
    if (bk !== null) { delays.push(now - touched.get(bk)); touched.delete(bk); } else unpaired++; }
  lastLen = L;
}, 1000 / 60);
await wait(SECS * 1000); clearInterval(timer); clearInterval(c.timer); try { c.ws.close(); } catch (_) {}
const r = { pickups: delays.length, unpaired, delayMed: pct(delays, 0.5), delayP95: pct(delays, 0.95), errN: errsExact.length, errMed: pct(errsExact, 0.5), errP95: pct(errsExact, 0.95), errP99: pct(errsExact, 0.99), alongMed: pct(along, 0.5), alongP5: pct(along, 0.05), alongP95: pct(along, 0.95), acrossMed: pct(across, 0.5), acrossP95: pct(across, 0.95), roughMed: pct(errs, 0.5), roughP95: pct(errs, 0.95), rtt: c.rtt, frames };
console.log('[' + LABEL + '] ' + JSON.stringify(r, (k, v) => typeof v === 'number' ? +v.toFixed(1) : v));
clearTimeout(die); process.exit(0);
