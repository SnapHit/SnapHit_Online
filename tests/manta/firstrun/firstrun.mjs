/* The protected first run, tuned by simulation (4D, design doc 10.8).

   A scripted new player swims first runs in a full ocean of 21 trains (the
   room's ocean: arena 2760, 570 wild mantas, 8 blooms, 20 bots, and the
   player), with the simulation's own code from docs/lab/manta/. It steers
   towards the nearest wild manta with some wobble, bursts now and then, and
   turns away from a train ahead about half the time (one roll per
   encounter). Each run is measured from its start to its crash, or to CAP
   seconds:

     recruit  seconds to the first follower
     crash    seconds to the first crash (null: none inside CAP)
     cuts60   cuts this player landed in its first 60 s

   MODE=before: every run starts as a restart does (restart(), 800 units or
   more from where the last run ended, clear of every train).
   MODE=after: every run is a protected first run (sim.protect()).
   MODE=later: protected first runs as in "after", each followed by one
   ordinary run, and only the ordinary runs are measured: the runs after a
   first run must be no easier than "before".

   The ocean is warmed for WARM seconds, then runs follow one another in
   the same ocean, so each starts in a lived-in sea at a new place; the
   ocean is made again every OCEAN runs from the next seed.

   Usage (one process per core, each well under 10 minutes):
     MODE=after RUNS=250 SEED=1 node tests/manta/firstrun/firstrun.mjs > out.json
     node tests/manta/firstrun/firstrun.mjs sum a.json b.json ...   # the table
   SET='{"firstNear":70,...}' overrides simulation values for tuning. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createSim, STEP } from '../../../docs/lab/manta/sim.js';

const TAU = Math.PI * 2;
const wrap = a => { a %= TAU; if (a > Math.PI) a -= TAU; if (a < -Math.PI) a += TAU; return a; };

if (process.argv[2] === 'sum') { summary(process.argv.slice(3)); process.exit(0); }

const MODE = process.env.MODE || 'after';
const RUNS = +(process.env.RUNS || 100), SEED = +(process.env.SEED || 1), CAP = +(process.env.CAP || 90);
const WARM = +(process.env.WARM || 60), OCEAN = +(process.env.OCEAN || 50);
const SET = process.env.SET ? JSON.parse(process.env.SET) : {};

/* The committed defaults, as the room reads them, scaled as the room's ocean. */
const P = {};
for (const m of readFileSync(decodeURIComponent(new URL('../../../docs/lab/manta/params.js', import.meta.url).pathname), 'utf8')
  .matchAll(/\{ key: '(\w+)',[^}]*?def: ([-\d.e]+)/g)) P[m[1]] = parseFloat(m[2]);
const params = {
  cruise: P.cruise, burst: P.burstSpeed, turnCruise: P.turnCruise, turnBurst: P.turnBurst,
  recruitR: P.recruitR, spacing: P.spacing, regrow: P.regrow, wildSize: P.wildSize, bloomPull: P.bloomPull,
  trainScale: P.trainScale, burstCost: P.burstCost, scatterGlow: P.scatterGlow,
  pinkOn: P.pinkOn, pinkWait: P.pinkWait, pinkClear: P.pinkClear, pinkNotice: P.pinkNotice, pinkFlee: P.pinkFlee, pinkReward: P.pinkReward, pinkStay: P.pinkStay,
  sharkOn: P.sharkOn, sharkEvery: P.sharkEvery, sharkStay: P.sharkStay, sharkSpeed: P.sharkSpeed, sharkLen: P.sharkLen, sharkWide: P.sharkWide,
  bots: 20, arenaR: 2760, arenaRWanted: 2760, wildCount: 570, blooms: 8, ...SET,
};

/* The scripted new player's own dice, apart from the ocean's. */
let st = (SEED * 2654435761) >>> 0;
const rnd = () => { st = (st + 0x6D2B79F5) >>> 0; let t = st; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

function makePlayer () {
  let phase = rnd() * TAU, burstLeft = 0, wob = 0;
  const met = new Map();              // train id -> { seen: time last seen ahead, away: did it roll to turn away }
  return function steer (s) {
    const you = s.you, t = s.time;
    /* The nearest wild manta it can see. */
    let best = null, bd = Infinity;
    for (const m of s.wild) {
      if (!m || !m.alive || m.sinking > 0) continue;
      const d = Math.hypot(m.x - you.x, m.z - you.z);
      if (d < bd) { bd = d; best = m; }
    }
    let want = best ? Math.atan2(-(best.x - you.x), -(best.z - you.z)) : you.head;
    /* Wobble: a slow sway plus a little drift, a thumb that is not precise. */
    wob += (rnd() - 0.5) * 0.08; wob *= 0.98;
    want += 0.45 * Math.sin(t * 1.6 + phase) + wob;
    /* A train ahead: once per encounter, a coin decides whether it turns away. */
    const fx = -Math.sin(you.head), fz = -Math.cos(you.head);
    let near = null, nd = 170;
    for (const o of s.trains) {
      if (o === you || o.dead > 0) continue;
      for (const q of [o, ...o.followers]) {
        const dx = q.x - you.x, dz = q.z - you.z, d = Math.hypot(dx, dz);
        if (d >= nd || (dx * fx + dz * fz) / (d || 1) < 0.35) continue;
        nd = d; near = { o, dx, dz };
      }
    }
    if (near) {
      let e = met.get(near.o.id);
      if (!e || t - e.seen > 1.5) { e = { away: rnd() < 0.5 }; met.set(near.o.id, e); }
      e.seen = t;
      if (e.away) {
        const side = (fx * near.dz - fz * near.dx) >= 0 ? 1 : -1;      // turn to the other side
        want = you.head + side * 1.6;
      }
    }
    /* Bursts now and then: about one every five seconds, for half a second
       or so, once it has a few to pay with. */
    if (burstLeft > 0) burstLeft -= STEP;
    else if (you.followers.length >= 3 && rnd() < STEP / 5) burstLeft = 0.3 + rnd() * 0.5;
    s.input.want = wrap(want); s.input.burst = burstLeft > 0;
  };
}

function ocean (seed) {
  const s = createSim({ seed, params: { ...params } });
  const steer = makePlayer();
  for (let i = 0; i < Math.round(WARM / STEP); i++) { steer(s); s.step(); s.events.length = 0; }
  return { s, steer };
}

/* One run from now: started by `begin`, measured until its crash or CAP. */
function run (s, steer, begin) {
  begin(s);
  const you = s.you, t0 = s.time, runs = you.runs;
  let recruit = null, crash = null, cuts60 = 0, cross = null, how = null, longest = 0, guarded = null, len15 = null;
  for (let i = 0; i < Math.round(CAP / STEP); i++) {
    steer(s); s.step();
    const t = s.time - t0;
    for (const e of s.events) {
      if (e.kind === 'cut' && e.by === you.id && t <= 60) cuts60++;
      if (e.kind === 'crash' && e.id === you.id && crash === null) { crash = t; guarded = !!you.guard; how = e.how + (e.into >= 0 && s.trains.find(q => q.id === e.into)?.crossing ? ' (crosser)' : ''); }
    }
    s.events.length = 0;
    if (recruit === null && you.followers.length > 0) recruit = t;
    if (you.first && you.first.crossed && cross === null) cross = you.first.crosser !== null;
    longest = Math.max(longest, you.followers.length);
    if (len15 === null && you.followers.length >= 15) len15 = t;
    if (crash !== null) break;
  }
  /* Back in the water for the next run: through the beat if it crashed. */
  if (crash !== null) { let k = 0; while (you.dead > 0 && k++ < 600) { steer(s); s.step(); s.events.length = 0; } }
  return { recruit, crash, cuts60, cross, how, longest, runs, guarded, len15 };
}

const restartHere = s => { s.you.crashX = s.you.x; s.you.crashZ = s.you.z; s.restart(s.you); };
const out = [];
let oc = null, seedN = SEED * 1000;
const t0 = Date.now();
for (let r = 0; r < RUNS; r++) {
  if (r % OCEAN === 0) oc = ocean(++seedN);
  const { s, steer } = oc;
  if (MODE === 'before') out.push(run(s, steer, restartHere));
  else if (MODE === 'after') out.push(run(s, steer, x => x.protect(x.you)));
  else if (MODE === 'later') { run(s, steer, x => x.protect(x.you)); out.push(run(s, steer, restartHere)); }
}
process.stdout.write(JSON.stringify({ mode: MODE, seed: SEED, runs: RUNS, cap: CAP, set: SET, secs: (Date.now() - t0) / 1000, out }) + '\n');

function summary (files) {
  const groups = new Map();
  for (const f of files) {
    const j = JSON.parse(readFileSync(f, 'utf8'));
    const k = j.mode + ' ' + JSON.stringify(j.set);
    if (!groups.has(k)) groups.set(k, { mode: j.mode, set: j.set, cap: j.cap, out: [] });
    groups.get(k).out.push(...j.out);
  }
  const q = (a, f) => { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(f * b.length))]; };
  for (const g of groups.values()) {
    const o = g.out, n = o.length;
    const rec = o.map(r => r.recruit === null ? Infinity : r.recruit);
    const cr = o.map(r => r.crash === null ? Infinity : r.crash);
    const fmt = v => v === null ? '-' : v === Infinity ? '>' + g.cap : v.toFixed(2);
    const hows = {}; for (const r of o) if (r.how) hows[r.how] = (hows[r.how] || 0) + 1;
    const crossed = o.filter(r => r.cross === true).length;
    console.log(JSON.stringify({ mode: g.mode, set: g.set, runs: n,
      recruitMedian: fmt(q(rec, 0.5)), recruitP95: fmt(q(rec, 0.95)), recruitWithin3: (rec.filter(v => v <= 3).length / n * 100).toFixed(1) + '%',
      crashMedian: fmt(q(cr, 0.5)), crashP25: fmt(q(cr, 0.25)),
      past60: (cr.filter(v => v > 60).length / n * 100).toFixed(1) + '%',
      cutsFirstMinute: (o.reduce((a, r) => a + r.cuts60, 0) / n).toFixed(3),
      runsWithACut: (o.filter(r => r.cuts60 > 0).length / n * 100).toFixed(1) + '%',
      crossed: crossed + '/' + n, how: hows,
      crashWhileGuarded: o.filter(r => r.guarded).length, crashBefore30: cr.filter(v => v <= 30).length,
      len15Median: fmt(q(o.map(r => r.len15 === null ? Infinity : r.len15), 0.5)) }));
  }
}
