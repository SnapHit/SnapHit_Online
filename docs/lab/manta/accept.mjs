/* Acceptance tests 3, 4 and 6 of the design doc, in Node, against the real
 * simulation at the committed defaults (Nathan's values in params.js).
 *
 *   node accept.mjs 3 [from] [to]    upsets, seeds from..to-1 (default 0..50)
 *   node accept.mjs 4 [from] [to]    never-burst against always-burst
 *   node accept.mjs 6                coiling: can a lone leader get out?
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
  const s = botMatch(seed);
  const reach = (s.params.leaderR + s.params.followerR) * (s.params.trainScale || 1) + 30;
  let events = 0, cuts = 0, crashes = 0, reef = 0, topSeen = 0, longest = 0, topLost = 0;
  for (let i = 0; i < STEPS; i++) {
    /* The top train is the strictly longest living one, before the step. */
    let top = null, second = -1;
    for (const t of s.rivals) {
      if (t.dead > 0) continue;
      const n = t.followers.length;
      if (!top || n > top.followers.length) { if (top) second = Math.max(second, top.followers.length); top = t; }
      else second = Math.max(second, n);
    }
    if (top && top.followers.length <= second) top = null;   // a tie has no top
    const snap = new Map(s.rivals.map(t => [t, { n: t.followers.length, bursting: t.bursting,
      pts: [t, ...t.followers].map(q => ({ x: q.x, z: q.z })) }]));
    s.step();
    if (!top || top.followers.length === 0 && snap.get(top).n === 0) continue;
    if (snap.get(top).n < 3) continue;       // a "top" of two is not a top train
    topSeen++;
    const was = snap.get(top).n;
    if (was > longest) longest = was;
    const crashed = top.dead > 0;
    const cut = !crashed && top.cut === 0.25;
    if (!crashed && !cut) continue;
    topLost++;
    if (crashed && Math.hypot(top.crashX, top.crashZ) >= s.params.arenaR - 40) { reef++; continue; }
    /* Culprit: for a crash, whoever the leader ran into; for a cut, the
       bursting leader nearest the train's body, both from before the step. */
    let who = null, d = Infinity;
    if (crashed) {
      for (const o of s.rivals) {
        if (o === top) continue;
        for (const q of snap.get(o).pts) {
          const dd = Math.hypot(q.x - snap.get(top).pts[0].x, q.z - snap.get(top).pts[0].z);
          if (dd < d) { d = dd; who = o; }
        }
      }
    } else {
      for (const o of s.rivals) {
        if (o === top || !snap.get(o).bursting) continue;
        const L = snap.get(o).pts[0];
        for (const q of snap.get(top).pts) {
          const dd = Math.hypot(q.x - L.x, q.z - L.z);
          if (dd < d) { d = dd; who = o; }
        }
      }
    }
    if (!who || d > reach) continue;
    if (snap.get(who).n < was) { events++; if (crashed) crashes++; else cuts++; }
  }
  return { seed, events, cuts, crashes, topLost, reefCrashesOfTop: reef, longest, secondsWithTop: +(topSeen * STEP).toFixed(0) };
}

/* ---- Test 4: no dominant strategy -------------------------------------- */
function strategies (seed) {
  let never = null, always = null;
  const s = botMatch(seed, s => {
    never = s.rivals[0]; always = s.rivals[1];
    /* Otherwise identical: the same personality, the one dealt to the first. */
    for (const k of ['kind', 'greed', 'caution', 'aggression']) always[k] = never[k];
    never.pinBurst = true; always.pinBurst = true;
  });
  const peak = new Map(s.rivals.map(t => [t, 0]));
  for (let i = 0; i < STEPS; i++) {
    never.bursting = false;
    always.bursting = !always.dead && always.followers.length > 0;   // whenever it can pay
    s.step();
    for (const t of s.rivals) if (t.followers.length > peak.get(t)) peak.set(t, t.followers.length);
  }
  /* The board as follow.js sorts it: current length, longest first. */
  const board = [...s.rivals].sort((a, b) => b.followers.length - a.followers.length);
  const place = t => 1 + board.findIndex(o => o.followers.length === t.followers.length);
  return { seed, kind: never.kind, peakNever: peak.get(never), peakAlways: peak.get(always),
           placeNever: place(never), placeAlways: place(always) };
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

const [which, from = '0', to = '50'] = process.argv.slice(2);
const seeds = []; for (let k = +from; k < +to; k++) seeds.push(1000 + k);
const t0 = Date.now();
if (which === '3') {
  for (const seed of seeds) console.log('T3 ' + JSON.stringify(upsets(seed)));
} else if (which === '4') {
  for (const seed of seeds) console.log('T4 ' + JSON.stringify(strategies(seed)));
} else if (which === '6') {
  console.log('T6 ' + JSON.stringify(coiling()));
} else {
  console.log('usage: node accept.mjs 3|4|6 [from] [to]');
}
console.log('# ' + which + ' took ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
