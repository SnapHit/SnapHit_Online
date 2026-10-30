/* 3L stage 2: the radar in a room, through the delay proxy (PORT). The
   model (radar.js) fed by the room's channel and the init's paths, against
   the room's truth: each drawn head within 2 radar px (70 units on a 115 px
   radar of a 2000-unit arena) of where the room had that train at the
   moment the head stands for (RADAR_BEHIND plus half the round trip ago). */
const TREE = process.env.TREE || decodeURIComponent(new URL('../../..', import.meta.url).pathname).replace(/\/$/, '');
const { createRadarModel, RADAR_BEHIND, RADAR_RES } = await import(TREE + '/docs/lab/manta/radar.js');
import { player } from './playclient.mjs';
const PORT = +process.env.PORT, LABEL = process.env.LABEL || PORT;
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 85000 * (+process.env.WATCHDOG_X || 1));
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + '[' + LABEL + '] ' + n + (x ? '  [' + x + ']' : '')); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const pct = (a, q) => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const PX = 70;
const model = createRadarModel(), truths = [];
const c = player(PORT, 'rr-' + Math.random().toString(36).slice(2, 7), { debug: true, script: c => { const t = performance.now() / 1000; c.input.want = c.play.live ? c.you.head + 0.6 * Math.sin(t * 0.7) : null; c.input.burst = false; } });
let rds = 0, pathPts = 0;
/* 4C: how long a segment may honestly be. The room ticks 20 times a second
   and catches up to 12 steps of 1/60 s in one tick when its ticks run late,
   so one 5 Hz report can carry more than 0.2 s of swimming (on a 2-core
   container: a segment of 157 units once, at burst speed 470). A point is
   added once it is RADAR_RES from the last one, so the segment ending at a
   point laid by a report is under RADAR_RES plus what the leader can swim at
   burst speed in the room time since that train's previous report (m.k,
   the room's step). A restart is a new run and starts a new line, so a
   streak across the map is any segment over that. */
const BURST = () => (c.params && c.params.burstSpeed) || 470;
const bound = new Map(), lastRep = new Map(); let worstDt = 0;
const key = (id, x, z) => id + ':' + x + ',' + z;
c.onSnap = m => {
  if (!m.rd) return; rds++; const now = performance.now();
  for (const r of m.rd) {
    const [id, x, z, len, runs, alive] = r, t0 = model.trains.get(id), n0 = t0 ? t0.path.length : 0;
    const lx = n0 ? t0.path[n0 - 2] : NaN, lz = n0 ? t0.path[n0 - 1] : NaN;
    const t = model.update(id, x, z, len, alive, runs, now, c.params.spacing || 19), n = t.path.length;
    const prev = lastRep.get(id);
    if (alive && n >= 4 && t.path[n - 2] === x && t.path[n - 1] === z && !(lx === x && lz === z) && prev && prev.runs === runs) {
      const dt = (m.k - prev.k) / 60; worstDt = Math.max(worstDt, dt);
      bound.set(key(id, x, z), RADAR_RES + BURST() * dt + 1);
    }
    lastRep.set(id, { k: m.k, runs });
  }
};
c.onTruth = m => { truths.push({ w: m.w, at: Date.now(), tr: m.tr }); while (truths.length > 60) truths.shift(); };
await c.opened;
for (let k = 0; k < 100 && !c.init; k++) await wait(50);
if (c.init && c.init.rp) for (const [id, runs, pts] of c.init.rp) { model.setPath(id, runs, pts); pathPts += pts.length / 2; lastRep.set(id, { k: c.init.steps, runs }); }
await wait(3000);
const errs = [], segs = [], over = []; let frames = 0;
const timer = setInterval(() => {
  frames++; const now = performance.now(), wall = Date.now() - RADAR_BEHIND - (c.rtt || 0) / 2;
  let a = null, b = null; for (const t of truths) { if (t.at <= wall) a = t; else { b = t; break; } }
  if (!a || !b) return;
  const f = (wall - a.at) / Math.max(1, b.at - a.at);
  for (const [id, t] of model.trains) {
    if (!t.alive) continue;
    const ta = a.tr.find(q => q.id === id), tb = b.tr.find(q => q.id === id); if (!ta || !tb) continue;
    const [hx, hz] = model.headAt(t, now);
    errs.push(Math.hypot(hx - (ta.x + (tb.x - ta.x) * f), hz - (ta.z + (tb.z - ta.z) * f)));
    for (let i = 2; i < t.path.length; i += 2) {
      const s = Math.hypot(t.path[i] - t.path[i - 2], t.path[i + 1] - t.path[i - 1]), b = bound.get(key(id, t.path[i], t.path[i + 1])) || 150;
      segs.push(s); over.push(s / b);
    }
  }
}, 1000 / 60);
await wait(20000); clearInterval(timer);
/* A second phone joining now gets every train's path, with the bots grown. */
const c2 = player(PORT, c.room || 'x', { debug: false });
const name2 = c.ws.url.split('/ocean/')[1]; try { c2.ws.close(); } catch (_) {}
const c3 = player(PORT, name2.split('?')[0], { debug: false }); await c3.opened; for (let k = 0; k < 100 && !c3.init; k++) await wait(50);
const rp2 = c3.init && c3.init.rp ? c3.init.rp : [], pts2 = rp2.reduce((s, r) => s + r[2].length / 2, 0), longest = rp2.reduce((s, r) => Math.max(s, r[2].length / 2), 0);
clearInterval(c3.timer); try { c3.ws.close(); } catch (_) {} clearInterval(c2.timer);
clearInterval(c.timer); try { c.ws.close(); } catch (_) {}
console.log('[' + LABEL + '] ' + JSON.stringify({ rds, pathPts, trains: model.trains.size, frames, errMed: +pct(errs, 0.5).toFixed(1), errP95: +pct(errs, 0.95).toFixed(1), segMax: +Math.max(0, ...segs).toFixed(0), rtt: Math.round(c.rtt || 0) }));
ok('the room sends the radar channel five times a second with every train, and every train\'s starting path on joining (one point a train in a fresh room; more once they have grown)', rds >= 80 && model.trains.size >= 10 && pathPts >= model.trains.size && rp2.length >= 10 && pts2 > rp2.length, rds + ' reports in 23 s, ' + model.trains.size + ' trains; paths at the first join ' + pathPts + ' points, at a join 23 s later ' + pts2 + ' points over ' + rp2.length + ' trains (longest ' + longest + ')');
ok('every drawn head within 2 radar px (70 units) of the room\'s position: 95th percentile', errs.length > 500 && pct(errs, 0.95) <= PX, errs.length + ' samples: median ' + pct(errs, 0.5).toFixed(1) + ', p95 ' + pct(errs, 0.95).toFixed(1) + ' units');
ok('no line ever streaks across the map: every path segment under ' + RADAR_RES + ' units plus a burst\'s swim in the room time between the reports that laid it (150 for the joining path; a restart starts a new line)', segs.length > 0 && Math.max(...over) < 1, 'longest segment ' + Math.max(0, ...segs).toFixed(0) + ' units, worst ' + (100 * Math.max(0, ...over)).toFixed(0) + '% of its bound, longest room time between two reports ' + worstDt.toFixed(3) + ' s');
clearTimeout(die); process.exit(bad ? 1 : 0);
