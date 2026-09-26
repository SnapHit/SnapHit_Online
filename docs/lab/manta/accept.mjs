/* Acceptance tests 3, 4 and 6 of the design doc, in Node, against the real
 * simulation at the committed defaults (Nathan's values in params.js).
 *
 *   node accept.mjs 3 [from] [to]    upsets, seeds from..to-1 (default 0..50)
 *   node accept.mjs 4 [from] [to] [cost]   timid, bully and the strawman,
 *                                          burst cost 0.35, 0.5 and 0.7
 *   node accept.mjs 6                coiling: can a lone leader get out?
 *   node accept.mjs crashes [from] [to]   crashes per bot per 5 min, by preset
 *   node accept.mjs 4h [from] [to] [costs]  test 4 as ruled: five timid, five bully;
 *                                          costs as one or a list, 0.6,0.7,0.8,1.0
 *   The recorded sweeps are in accept-sweeps.txt.
 *   node accept.mjs 4s [from] [to] [cost]  the same with the strawman as the bursting half
 *
 * MEASUREMENTS, NOT GATES. Nothing here is tuned to pass; each test prints
 * what it saw and one JSON line a later brief can compare against.
 *
 * Bot-only: the player's train is parked out of the water for the whole match
 * (dead for longer than the match lasts), so ten bots on the one brain of
 * 10.2 play each other. Nothing in sim.js is changed to do it; the only seams
 * used are the ones the page and the older suites already use: params, the
 * brain object and pinBurst.
 */
import { createSim, STEP } from './sim.js';
import { PRESETS } from './bots.js';
import { readFileSync } from 'node:fs';

/* params.js imports three for its uniforms, so Node cannot load it. Its
   defaults are read from the file itself instead, so there is still one
   source for Nathan's values and this cannot drift from the drawer. */
const P = {};
for (const m of readFileSync(new URL('./params.js', import.meta.url), 'utf8')
    .matchAll(/\{ key: '(\w+)',[^}]*?def: ([-\d.e]+)/g)) P[m[1]] = parseFloat(m[2]);

const MATCH = 5 * 60;                       // simulated seconds
const STEPS = Math.round(MATCH / STEP);

/* The same mapping main.js makes every step, from the drawer's names to the
   simulation's, so "Nathan's values" means what it means on the phone. The
   arena is set outright: on the page it takes effect at the first restart. */
function nathan (extra = {}) {
  return {
    cruise: P.cruise, burst: P.burstSpeed, turnCruise: P.turnCruise, turnBurst: P.turnBurst,
    recruitR: P.recruitR, spacing: P.spacing, wildCount: P.wildCount, regrow: P.regrow,
    wildSize: P.wildSize, bloomPull: P.bloomPull, trainScale: P.trainScale,
    arenaR: P.arenaR, arenaRWanted: P.arenaR, bots: P.bots,
    burstCost: P.burstCost, scatterGlow: P.scatterGlow, ...extra,
  };
}

function botMatch (seed, setup) {
  const s = createSim({ seed, params: nathan() });
  s.you.dead = 1e9;                         // parked: not in the water, never restarts
  s.you.followers.length = 0;
  if (setup) setup(s);
  return s;
}

/* ---- Test 3: upsets ---------------------------------------------------- */
function upsets (seed) {
  /* COUNTED FROM THE SIMULATION'S OWN EVENTS (2B part four): one per crash
     and one per cut crossing, each naming the other party. Part three's
     count read per-step flags, so one crossing counted several times and a
     wreck's frozen flag counted again through its death beat. */
  const s = botMatch(seed);
  let events = 0, cuts = 0, crashes = 0, reef = 0, topSeen = 0, longest = 0, topLost = 0;
  for (let i = 0; i < STEPS; i++) {
    /* The top train is the strictly longest living one, of three or more. */
    let top = null, second = -1;
    for (const t of s.rivals) {
      if (t.dead > 0) continue;
      const n = t.followers.length;
      if (!top || n > top.followers.length) { if (top) second = Math.max(second, top.followers.length); top = t; }
      else second = Math.max(second, n);
    }
    if (top && (top.followers.length <= second || top.followers.length < 3)) top = null;
    const len = new Map(s.rivals.map(t => [t.id, t.followers.length]));
    s.step();
    const evs = s.events.splice(0);
    if (!top) continue;
    topSeen++;
    const was = len.get(top.id);
    if (was > longest) longest = was;
    for (const e of evs) {
      if (e.id !== top.id) continue;
      topLost++;
      if (e.kind === 'crash' && e.into < 0) { reef++; continue; }
      const other = e.kind === 'crash' ? e.into : e.by;
      if (other >= 0 && len.get(other) < was) { events++; if (e.kind === 'crash') crashes++; else cuts++; }
    }
  }
  return { seed, events, cuts, crashes, topLost, reefCrashesOfTop: reef, longest, secondsWithTop: +(topSeen * STEP).toFixed(0) };
}

/* ---- Test 4: does bursting to cut pay? -------------------------------- */
/* Three behaviours in the same match, among seven bots the seed deals:
     timid     the timid dials, and never bursts (pinned);
     bully     the bully dials on the ordinary brain: bursts to cut when a
               train crosses close ahead, then goes after what it cut loose;
     strawman  the bully dials, but bursts whenever it can pay — the sanity
               check that burning followers for nothing loses.
   Cuts are credited to the bursting leader nearest the cut train's body,
   crashes to the train that crashed; both judged from before the step. */
const BEHAVIOURS = ['timid', 'bully', 'strawman'];

function strategies (seed, burstCost) {
  const s = createSim({ seed, params: nathan({ burstCost }) });
  s.you.dead = 1e9; s.you.followers.length = 0;
  const who = { timid: s.rivals[0], bully: s.rivals[1], strawman: s.rivals[2] };
  Object.assign(who.timid, PRESETS.timid, { kind: 'timid', pinBurst: true, bursting: false });
  Object.assign(who.bully, PRESETS.bully, { kind: 'bully' });
  Object.assign(who.strawman, PRESETS.bully, { kind: 'bully', pinBurst: true });
  const stat = new Map(s.rivals.map(t => [t, { peak: 0, cuts: 0, crashes: 0 }]));
  const reach = (s.params.leaderR + s.params.followerR) * (s.params.trainScale || 1) + 30;
  for (let i = 0; i < STEPS; i++) {
    who.timid.bursting = false;
    who.strawman.bursting = !who.strawman.dead && who.strawman.followers.length > 0;
    const pre = new Map(s.rivals.map(t => [t, { dead: t.dead > 0, bursting: t.bursting,
      pts: [t, ...t.followers].map(q => ({ x: q.x, z: q.z })) }]));
    s.step();
    for (const t of s.rivals) {
      const st = stat.get(t), was = pre.get(t);
      if (t.followers.length > st.peak) st.peak = t.followers.length;
      const crashed = !was.dead && t.dead > 0;
      if (crashed) st.crashes++;
      if (crashed || t.cut !== 0.25) continue;
      /* Cut this step: by the bursting leader nearest its body. */
      let by = null, bd = reach;
      for (const o of s.rivals) {
        if (o === t || !pre.get(o).bursting || pre.get(o).dead) continue;
        const L = pre.get(o).pts[0];
        for (const q of was.pts) { const d = Math.hypot(q.x - L.x, q.z - L.z); if (d < bd) { bd = d; by = o; } }
      }
      if (by) stat.get(by).cuts++;
    }
  }
  const best = Math.max(...s.rivals.map(t => t.followers.length));
  const leaders = s.rivals.filter(t => t.followers.length === best);
  const out = { seed, burstCost };
  for (const k of BEHAVIOURS) {
    const t = who[k], st = stat.get(t);
    out[k] = { top: leaders.length === 1 && leaders[0] === t ? 1 : 0, tied: leaders.length > 1 && leaders.includes(t) ? 1 : 0,
               end: t.followers.length, peak: st.peak, cuts: st.cuts, crashes: st.crashes };
  }
  return out;
}

function summarise (rows) {
  const n = rows.length, cost = rows[0].burstCost;
  const lines = [];
  for (const k of BEHAVIOURS) {
    const S = f => rows.reduce((a, r) => a + r[k][f], 0);
    const top = S('top'), share = top / n;
    lines.push({ burstCost: cost, behaviour: k, seeds: n, topsBoard: top, tiedTop: S('tied'), topShare: +share.toFixed(2),
      meanPeak: +(S('peak') / n).toFixed(2), meanEnd: +(S('end') / n).toFixed(2),
      cutsLanded: S('cuts'), crashes: S('crashes'), flag: k !== 'strawman' && share > 2 / 3 ? 'TOPS MORE THAN TWO IN THREE' : '' });
  }
  return lines;
}

/* ---- Test 6: coiling ---------------------------------------------------- */
function coiling () {
  const R = 150;                              // ring radius, units
  const spacing = P.spacing;
  const s = createSim({ seed: 606, params: nathan({ bots: 1, wildCount: 0, regrow: 1e9 }) });
  const lone = s.rivals[0];
  const k = s.params.trainScale || 1;
  const touch = (s.params.leaderR + s.params.followerR) * k;   // leader against a follower
  /* A train long enough to close the ring on itself, laid on the circle. */
  const N = Math.round(2 * Math.PI * R / spacing) - 1;
  const you = s.you;
  const at = a => ({ x: Math.cos(a) * R, z: Math.sin(a) * R });
  const p0 = at(0);
  you.x = p0.x; you.z = p0.z;
  you.head = Math.atan2(-(-Math.sin(0)), -(Math.cos(0)));    // forward along +a
  s.seedTrail(you);
  for (let i = 0; i < N; i++) you.followers.push({ x: p0.x, z: p0.z, head: you.head, born: 0, from: i });
  lone.x = 0; lone.z = 0; lone.head = 0; s.seedTrail(lone);
  lone.followers.length = 0;
  /* The brain is replaced for the lone leader: it holds still at the centre
     by facing the wall and not moving until an escape is tried. Positions
     are forced each step until the ring has formed. */
  let escape = null;
  s.brain.think = t => { t.bursting = false; t.want = escape === null ? t.head : escape; };
  const steer = () => {
    /* Tangential, with a pull back onto the circle: counter-clockwise. */
    const a = Math.atan2(you.z, you.x), r = Math.hypot(you.x, you.z);
    const tx = -Math.sin(a), tz = Math.cos(a);
    const pull = (R - r) / 40;
    const dx = tx + Math.cos(a) * pull, dz = tz + Math.sin(a) * pull;
    s.input.want = Math.atan2(-dx, -dz); s.input.burst = false;
  };
  /* Form the ring: the lone leader is pinned at the centre while the train
     laps twice, so its trail and followers lie on the circle. */
  for (let i = 0; i < Math.round((2 * 2 * Math.PI * R / P.cruise) / STEP); i++) {
    steer(); lone.x = 0; lone.z = 0; lone.dead = 0; s.step();
  }
  /* The wall: gaps between neighbours round the ring, tail back to leader. */
  const ring = [you, ...you.followers];
  let widest = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    widest = Math.max(widest, Math.hypot(a.x - b.x, a.z - b.z));
  }
  const radii = ring.map(q => Math.hypot(q.x, q.z));
  /* Now try every heading out, 72 of them. Each is a fresh sim that forms
     the same ring the same way, so every attempt starts from the same wall. */
  const outcomes = [];
  for (let h = 0; h < 72; h++) {
    const s2 = createSim({ seed: 606, params: nathan({ bots: 1, wildCount: 0, regrow: 1e9 }) });
    const y2 = s2.you, l2 = s2.rivals[0];
    y2.x = p0.x; y2.z = p0.z; y2.head = you.head; s2.seedTrail(y2);
    for (let i = 0; i < N; i++) y2.followers.push({ x: p0.x, z: p0.z, head: y2.head, born: 0, from: i });
    l2.x = 0; l2.z = 0; l2.head = 0; s2.seedTrail(l2); l2.followers.length = 0;
    let esc = null;
    s2.brain.think = t => { t.bursting = false; t.want = esc === null ? t.head : esc; };
    const st2 = () => {
      const a = Math.atan2(y2.z, y2.x), r = Math.hypot(y2.x, y2.z);
      const dx = -Math.sin(a) + Math.cos(a) * (R - r) / 40, dz = Math.cos(a) + Math.sin(a) * (R - r) / 40;
      s2.input.want = Math.atan2(-dx, -dz); s2.input.burst = false;
    };
    for (let i = 0; i < Math.round((2 * 2 * Math.PI * R / P.cruise) / STEP); i++) {
      st2(); l2.x = 0; l2.z = 0; l2.dead = 0; s2.step();
    }
    /* Release the lone leader on heading h and let it swim for 3 s. */
    esc = h / 72 * 2 * Math.PI; l2.head = esc;
    let fate = 'still inside';
    for (let i = 0; i < Math.round(3 / STEP); i++) {
      st2(); s2.step();
      if (l2.dead > 0) { fate = 'crashed'; break; }
      if (Math.hypot(l2.x, l2.z) > R + touch + 10) { fate = 'escaped'; break; }
    }
    outcomes.push(fate);
  }
  const tally = outcomes.reduce((m, f) => (m[f] = (m[f] || 0) + 1, m), {});
  return { N, R, spacing, touchDistance: touch, passableGap: 2 * touch,
           widestGap: +widest.toFixed(1), ringRadius: [Math.min(...radii).toFixed(0), Math.max(...radii).toFixed(0)],
           escapesTried: 72, tally };
}

/* ---- Test 4 as ruled in 2B part four ------------------------------------ */
/* Ten bots, split evenly and otherwise identical (the bully preset's greed
   and caution for all ten): five never burst (timid), five burst to cut and
   then collect what they cut (bully, the ordinary brain at aggression 1).
   With `strawman`, the bursting half bursts whenever it can pay instead. */
function halves (seed, burstCost, strawman = false) {
  const s = createSim({ seed, params: nathan({ burstCost }) });
  s.you.dead = 1e9; s.you.followers.length = 0;
  const G = PRESETS.bully.greed, C = PRESETS.bully.caution;
  const other = strawman ? 'strawman' : 'bully';
  s.rivals.forEach((t, i) => {
    const bursts = i % 2 === 1;
    Object.assign(t, { greed: G, caution: C, aggression: bursts ? 1 : 0, kind: bursts ? other : 'timid' });
    t.pinBurst = !bursts || strawman; t.bursting = false;
  });
  for (let i = 0; i < STEPS; i++) {
    for (const t of s.rivals) {
      if (t.kind === 'timid') t.bursting = false;
      else if (t.kind === 'strawman') t.bursting = !(t.dead > 0) && t.followers.length > 0;
    }
    s.step();
    s.events.length = 0;
  }
  const board = [...s.rivals].sort((a, b) => b.followers.length - a.followers.length);
  const topLen = board[0].followers.length, leaders = board.filter(t => t.followers.length === topLen);
  return { seed, burstCost, first: leaders.length === 1 ? leaders[0].kind : 'tie',
           top3: board.slice(0, 3).map(t => t.kind), topLen };
}
function summariseHalves (rows, other) {
  const n = rows.length, out = { burstCost: rows[0].burstCost, seeds: n };
  for (const k of ['timid', other]) {
    const firsts = rows.filter(r => r.first === k).length;
    const top3 = rows.reduce((a, r) => a + r.top3.filter(x => x === k).length, 0) / (3 * n);
    out[k] = { first: firsts, firstShare: +(firsts / n).toFixed(2), top3Share: +top3.toFixed(2) };
  }
  out.ties = rows.filter(r => r.first === 'tie').length;
  out.flag = ['timid', other].filter(k => out[k].firstShare > 2 / 3).map(k => k + ' TAKES FIRST MORE THAN TWO IN THREE').join('; ');
  return out;
}

/* ---- Crash rates: crashes per bot per five minutes, by preset ----------- */
function crashRates (seed) {
  const s = botMatch(seed);
  const by = {};
  for (const t of s.rivals) by[t.id] = { kind: t.kind, crashes: 0, reef: 0 };
  for (let i = 0; i < STEPS; i++) {
    const was = new Map(s.rivals.map(t => [t, t.dead > 0]));
    s.step();
    for (const t of s.rivals) {
      if (was.get(t) || !(t.dead > 0)) continue;
      by[t.id].crashes++;
      if (Math.hypot(t.crashX, t.crashZ) >= s.params.arenaR - 40) by[t.id].reef++;
    }
  }
  return Object.values(by);
}

const [which, from = '0', to = '50'] = process.argv.slice(2);
const seeds = []; for (let k = +from; k < +to; k++) seeds.push(1000 + k);
const t0 = Date.now();
if (which === '3') {
  for (const seed of seeds) console.log('T3 ' + JSON.stringify(upsets(seed)));
} else if (which === '4') {
  /* The burst cost sweep: pass one cost, or none for all three. */
  const costs = process.argv[5] ? [parseFloat(process.argv[5])] : [0.35, 0.5, 0.7];
  for (const cost of costs) {
    const rows = seeds.map(seed => strategies(seed, cost));
    for (const r of rows) console.log('T4 ' + JSON.stringify(r));
    for (const l of summarise(rows)) console.log('T4SUM ' + JSON.stringify(l));
  }
} else if (which === '4h' || which === '4s') {
  /* Costs as a list, "0.6,0.7,0.8,1.0", so the balance can be re-run after
     any tuning; the closest is where the two halves' first places differ
     least. A measurement, never a change of default. */
  const straw = which === '4s', other = straw ? 'strawman' : 'bully';
  const costs = process.argv[5] ? process.argv[5].split(',').map(parseFloat) : [0.35, 0.5, 0.7];
  let closest = null;
  for (const cost of costs) {
    const sum = summariseHalves(seeds.map(seed => halves(seed, cost, straw)), other);
    console.log('T4H ' + JSON.stringify(sum));
    const gap = Math.abs(sum.timid.first - sum[other].first);
    if (!closest || gap < closest.gap) closest = { burstCost: cost, gap };
  }
  if (costs.length > 1) console.log('T4H closest ' + JSON.stringify(closest));
} else if (which === 'crashes') {
  const tally = {};
  for (const seed of seeds) for (const r of crashRates(seed)) {
    const k = tally[r.kind] || (tally[r.kind] = { bots: 0, crashes: 0, reef: 0 });
    k.bots++; k.crashes += r.crashes; k.reef += r.reef;
  }
  for (const [kind, k] of Object.entries(tally))
    console.log('CRASHES ' + JSON.stringify({ kind, bots: k.bots, perBotPer5min: +(k.crashes / k.bots).toFixed(2),
      reefPerBotPer5min: +(k.reef / k.bots).toFixed(2) }));
} else if (which === '6') {
  console.log('T6 ' + JSON.stringify(coiling()));
} else {
  console.log('usage: node accept.mjs 3|4|6 [from] [to]');
}
console.log('# ' + which + ' took ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
