/* 3L stage 2: the radar in a room, through the delay proxy (PORT). The
   model (radar.js) fed by the room's channel and the init's paths, against
   the room's truth: each drawn head within 2 radar px (70 units on a 115 px
   radar of a 2000-unit arena) of where the room had that train at the
   moment the head stands for (RADAR_BEHIND plus half the round trip ago). */
const TREE = process.env.TREE || decodeURIComponent(new URL('../../..', import.meta.url).pathname).replace(/\/$/, '');
const { createRadarModel, RADAR_BEHIND } = await import(TREE + '/docs/lab/manta/radar.js');
import { player } from './playclient.mjs';
const PORT = +process.env.PORT, LABEL = process.env.LABEL || PORT;
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 85000);
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + '[' + LABEL + '] ' + n + (x ? '  [' + x + ']' : '')); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const pct = (a, q) => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const PX = 70;
const model = createRadarModel(), truths = [];
const c = player(PORT, 'rr-' + Math.random().toString(36).slice(2, 7), { debug: true, script: c => { const t = performance.now() / 1000; c.input.want = c.play.live ? c.you.head + 0.6 * Math.sin(t * 0.7) : null; c.input.burst = false; } });
let rds = 0, pathPts = 0;
c.onSnap = m => { if (!m.rd) return; rds++; const now = performance.now(); for (const r of m.rd) model.update(r[0], r[1], r[2], r[3], r[5], r[4], now, c.params.spacing || 19); };
c.onTruth = m => { truths.push({ w: m.w, at: Date.now(), tr: m.tr }); while (truths.length > 60) truths.shift(); };
await c.opened;
for (let k = 0; k < 100 && !c.init; k++) await wait(50);
if (c.init && c.init.rp) for (const [id, runs, pts] of c.init.rp) { model.setPath(id, runs, pts); pathPts += pts.length / 2; }
await wait(3000);
const errs = [], segs = []; let frames = 0;
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
    for (let i = 2; i < t.path.length; i += 2) segs.push(Math.hypot(t.path[i] - t.path[i - 2], t.path[i + 1] - t.path[i - 1]));
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
ok('no line ever streaks across the map: every path segment under 150 units (a restart starts a new line)', segs.length > 0 && Math.max(...segs) < 150, 'longest segment ' + Math.max(0, ...segs).toFixed(0) + ' units');
clearTimeout(die); process.exit(bad ? 1 : 0);
