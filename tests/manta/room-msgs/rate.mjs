/* Brief 4B part 1b (and part 3's before and after): incoming messages per
   player per second, by type, on four inputs, through lib/rooms.sh:

   thumb  a scripted thumb on touch scheme A (steer towards the finger), in
          an ocean room among bots: the finger's angle from the leader
          wanders slowly (two slow swings, 0.30 rad at 0.13 Hz and 0.12 rad
          at 0.37 Hz) with a small tremor (0.012 and 0.008 rad at 9.1 and
          6.3 Hz); every 5 to 9 s a sharp turn sweeps it 1.6 to 2.6 rad in
          150 ms; every 3 to 5 s a burst is held 0.5 to 1.0 s. The schedule
          is fixed (a seeded generator), so every run is the same trace.
   corr   room-play/playtest.mjs's corrections phone: steering 0.6 rad
          either side of its heading at 0.7 rad/s, no burst.
   bytes  playtest.mjs's bytes phone: 0.8 rad at 0.9 rad/s, bursting when
          sin(0.3 t) > 0.8.
   cut    playtest.mjs's staged cut phone: steering at the crossing bot's
          follower and bursting within 160 units, in the staged room.

   Each counts every message the phone sends (the phone's own roomplay.js
   for steering, the page's rule for the view and the ping:
   room-msgs/playclient.mjs) over MEASURE_S seconds after a 4 s start, and
   for each burst press: how long until a message carrying it left the
   phone, and how many steps after the one the phone was on it was stamped
   for. Also the corrections to the phone's own leader and the inputs the
   room said came late, so part 3 can be checked against them.

   NAMES=1 DELAYS="20:0 150:50 300:100" tests/manta/lib/rooms.sh room-msgs/rate.mjs
   PARTS (thumb,corr,bytes,cut), MEASURE_S (60). */
import { player } from './playclient.mjs';
const PORT = +process.env.PORT, LABEL = process.env.LABEL || '', PARTS = (process.env.PARTS || 'thumb,corr,bytes,cut').split(',');
const MEASURE_S = +(process.env.MEASURE_S || 60);
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, (MEASURE_S + 60) * 1000);
const wait = ms => new Promise(r => setTimeout(r, ms));
const room = p => p + '-' + Math.random().toString(36).slice(2, 7);
const q = (a, p) => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]; };
const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN;

/* The thumb's schedule, from a fixed seed. */
function schedule (seed, secs) {
  let s = seed >>> 0; const r = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const turns = [], bursts = [];
  for (let t = 2 + r() * 3; t < secs; t += 5 + r() * 4) turns.push({ at: t, by: (r() < 0.5 ? -1 : 1) * (1.6 + r() * 1.0) });
  for (let t = 1.5 + r() * 2; t < secs; t += 3 + r() * 2) bursts.push({ at: t, len: 0.5 + r() * 0.5 });
  return { turns, bursts };
}
const SCHED = schedule(4242, MEASURE_S + 30);
function thumb (t) {
  let a = 0.30 * Math.sin(2 * Math.PI * 0.13 * t + 1) + 0.12 * Math.sin(2 * Math.PI * 0.37 * t + 2)
        + 0.012 * Math.sin(2 * Math.PI * 9.1 * t) + 0.008 * Math.sin(2 * Math.PI * 6.3 * t + 0.5);
  for (const k of SCHED.turns) { if (t >= k.at + 0.15) a += k.by; else if (t > k.at) a += k.by * (t - k.at) / 0.15; }
  const burst = SCHED.bursts.some(b => t >= b.at && t < b.at + b.len);
  return { want: Math.atan2(Math.sin(a), Math.cos(a)), burst };
}

const SCRIPTS = {
  thumb: { opts: {}, script: (c, t0) => { if (!c.play.live) { c.input.want = null; c.input.burst = false; return; }
    if (c.base === undefined) c.base = c.you.head;   // the finger starts ahead of the manta
    const th = thumb(performance.now() / 1000 - t0); c.input.want = Math.atan2(Math.sin(c.base + th.want), Math.cos(c.base + th.want)); c.input.burst = th.burst; } },
  corr: { opts: {}, script: c => { const t = performance.now() / 1000;
    c.input.want = c.play.live ? c.you.head + 0.6 * Math.sin(t * 0.7) : null; c.input.burst = false; } },
  bytes: { opts: {}, script: c => { const t = performance.now() / 1000;
    c.input.want = c.play.live ? c.you.head + 0.8 * Math.sin(t * 0.9) : null; c.input.burst = Math.sin(t * 0.3) > 0.8; } },
  cut: { opts: { stage: true }, script: c => {
    const P = c.play, you = c.you;
    if (!P.live || !P.me) { c.input.want = null; c.input.burst = false; return; }
    const d = c.shown(2);
    if (!d || d.dead || !d.followers.length) { c.input.want = null; c.input.burst = false; return; }
    const f = d.followers[Math.min(10, d.followers.length >> 1)];
    c.input.want = Math.atan2(-(f.x - you.x), -(f.z - you.z));
    c.input.burst = Math.hypot(f.x - you.x, f.z - you.z) < 160 && you.followers.length > 0; } },
};

async function one (name) {
  const S = SCRIPTS[name];
  let t0 = null;
  const c = player(PORT, room('rate-' + name), { ...S.opts, debug: true, tag: name, script: c => { if (t0 === null) t0 = performance.now() / 1000; S.script(c, t0); } });
  await c.opened; await wait(4000);
  const a = performance.now(), corr0 = c.play.corrections.length, late0 = c.play.late;
  await wait(MEASURE_S * 1000);
  const b = performance.now(); c.close();
  const msgs = c.msgs.filter(([t]) => t >= a && t < b), secs = (b - a) / 1000;
  const by = {}; for (const [, type] of msgs) by[type] = (by[type] || 0) + 1;
  const rate = Object.fromEntries(Object.entries(by).map(([k, v]) => [k, +(v / secs).toFixed(2)]));
  const sizes = msgs.filter(([, type]) => type === 'in').map(([, , n]) => n);
  /* Each burst press: the first steering message after it that carries a burst. */
  const press = [];
  for (const [t, step] of c.presses) {
    if (t < a || t >= b) continue;
    const m = c.ins.find(e => e.t >= t - 0.5 && e.b);
    if (m) press.push({ ms: m.t - t, steps: m.k - step });
  }
  const corr = c.play.corrections.slice(corr0).sort((x, y) => x - y);
  const perSec = []; for (let k = 0; k < Math.floor(secs); k++) perSec.push(msgs.filter(([t]) => t >= a + k * 1000 && t < a + (k + 1) * 1000).length);
  return { name, secs: +secs.toFixed(1), total: +(msgs.length / secs).toFixed(2), rate, inBytesMax: sizes.length ? Math.max(...sizes) : 0, inBytesMean: +mean(sizes).toFixed(1),
    worstSecond: Math.max(...perSec), presses: press.length, pressMs: { mean: +mean(press.map(p => p.ms)).toFixed(1), max: press.length ? +Math.max(...press.map(p => p.ms)).toFixed(1) : NaN },
    pressSteps: { mean: +mean(press.map(p => p.steps)).toFixed(2), max: press.length ? Math.max(...press.map(p => p.steps)) : NaN },
    corr: { n: corr.length, p95: +q(corr, 0.95).toFixed(3), worst: corr.length ? +corr[corr.length - 1].toFixed(3) : NaN, snaps: corr.filter(v => v > 60).length },
    late: c.play.late - late0, lead: c.play.lead, full: c.full, seated: !!(c.init && c.init.me) };
}

const rows = await Promise.all(PARTS.map(one));
for (const r of rows) {
  console.log('[' + LABEL + '] ' + r.name.padEnd(5) + ' total ' + r.total.toFixed(2) + ' messages a second (' + Object.entries(r.rate).map(([k, v]) => k + ' ' + v).join(', ') + '); worst second ' + r.worstSecond +
    '; steering messages ' + r.inBytesMean + ' bytes mean, ' + r.inBytesMax + ' max; ' + r.presses + ' burst presses left the phone after ' + r.pressMs.mean + ' ms mean (' + r.pressMs.max + ' max), stamped ' + r.pressSteps.mean + ' steps ahead mean (' + r.pressSteps.max + ' max)' +
    '; corrections ' + r.corr.n + ' p95 ' + r.corr.p95 + ' worst ' + r.corr.worst + ' snaps ' + r.corr.snaps + '; late inputs ' + r.late + '; lead ' + r.lead + (r.seated ? '' : ' NOT SEATED'));
}
console.log('[' + LABEL + '] json ' + JSON.stringify(rows));
clearTimeout(die); setTimeout(() => process.exit(rows.every(r => r.seated) ? 0 : 1), 300);
