/* The game, with nothing in it that knows how to draw.
 *
 * No imports from three, no uniforms, no DOM. That is the point: the rules
 * are steppable in Node thousands of times a second, so every one of them
 * has a test that runs in milliseconds instead of a browser that draws at
 * one frame a second. main.js reads this and paints it; this never looks
 * back.
 *
 * FIXED STEP, SEEDED. Every step is exactly 1/60, and every random choice
 * comes from the seeded generator, so a seed plus a list of inputs is a
 * reproducible run — which is what makes a failing acceptance test something
 * you can re-run rather than something you saw once.
 */
import { rng } from './palette.js';
import { createRules } from './rules.js';

export const STEP = 1 / 60;

/* Section 10.2's table. Spacing is the doc's 22 scaled with the spike's
   sizes, which went up 40% so a manta reads at 40 CSS pixels. */
export const DEF = {
  arenaR: 2000,
  cruise: 160,          // units a second, never zero
  burst: 340,
  turnCruise: 3.1,      // rad/s
  /* HIGHER rad/s and still a wider circle, which is the part that matters:
     radius is speed over turn rate, so a burst carves 340/4.1 = 83 units
     against a cruise's 160/3.1 = 52. Nathan set these on the phone. */
  turnBurst: 4.1,
  leaderR: 14,
  followerR: 10,
  spacing: 31,
  recruitR: 30,        // contact with a 20-unit wild manta, plus a margin
  burstCost: 0.35,      // seconds a follower
  scatterGlow: 4,
  /* v1.10 rule 3: a crash ends the run. The daze and the lone-leader stun
     are gone with it — there is no longer a you to daze. */
  deathBeat: 1.5,       // seconds before you are swimming again
  restartMin: 800,      // units from the crash, and clear of every train
  wildCount: 120,      // v1.10: 300 with instant respawn never ran dry
  regrow: 2,           // seconds a manta, up to the count, and never faster
  drain: 3,            // seconds a surplus manta takes to fade out
  wildSize: 20,        // wingspan, against 28 for a follower and 40 for a leader
  /* AN EVEN OCEAN. Every group used to steer at the nearest bloom with most
     of the distance closed each time it chose, so all thirty of them ended
     up in the same four places and the rest of the arena was empty: measured
     at an index of dispersion of 22.4 with 120 mantas, where a uniform
     scatter is 1. The bloom is a lean now, not a sink, it only leans while
     the bloom has room, and groups keep away from each other's targets. */
  bloomPull: 0.22,     // 1.0 is the old pull, 0 is none
  bloomHold: 2,        // groups a bloom will draw at once
  groupApart: 420,     // how far a group's target stays from another's
  /* A group is a loose company, not a pile. Every manta holds its own place
     in it, so four of them cover a stretch of water rather than a point —
     which is most of what the index of dispersion measures. */
  /* As a fraction of the gap between neighbouring group homes, not as a
     fixed distance. A company of four wants to cover a stretch of water
     without walking into the next company: at 20 mantas the homes are 1,300
     units apart and the group can afford to spread, at 120 they are 540
     apart and it cannot. One fixed number could not serve both — 300 gave
     1.38 at 120 and 1.77 at 20, and 430 gave 1.07 and 1.98. */
  groupSpread: 0.46,
  trainScale: 1,       // leaders and followers, visuals and collision alike
  followerSize: 28,
  leaderSize: 40,
  blooms: 4,
  zoomFar: 0.55,        // at length 300
  zoomLen: 300,
};

/* The camera's zoom, eased so a train growing past 300 does not keep pulling
   the world away. Pure, so the area rule can be checked at any length
   without running a frame. */
export function zoomFor (length, p = DEF) {
  const t = Math.min(Math.max(length / p.zoomLen, 0), 1);
  const e = t * t * (3 - 2 * t);
  return 1 + (p.zoomFar - 1) * e;
}

/* THE SAME-AREA RULE AT EVERY ZOOM. At zoom 1 every screen sees the same
   area of ocean; zooming out multiplies what you see by 1/zoom^2, so the
   area is VIEW_AREA / zoom^2 and the shape still follows the screen. */
export function viewFor (area, aspect, zoom) {
  const a = area / (zoom * zoom);
  const w = Math.sqrt(a * aspect);
  return { w, h: a / w };
}

/* SIZE AND COLOUR ARE THE SAME NUMBER, and both live here so the renderer
   and the tests cannot disagree about them. A recruit crosses from wild to
   train over half a second — 20 units wide and its own colour at 0, 28 and
   its train's at 1 — and a scattered manta crosses back as the last of its
   glow runs out, so what is food and what is a train reads at a glance. */
export const FADE = 0.5;
export function joinMix (f, time) {
  return Math.min(1, Math.max(0, (time - (f.born || 0)) / FADE));
}
export function looseMix (m) { return Math.min(1, Math.max(0, (m.glow || 0) / FADE)); }
export function sizeFor (mix, p = DEF) {
  return p.wildSize + (p.followerSize * (p.trainScale || 1) - p.wildSize) * mix;
}
/* What a leader is drawn at, which the train size slider moves too. */
export function leaderSize (p = DEF) { return p.leaderSize * (p.trainScale || 1); }

const TAU = Math.PI * 2;
const wrapAngle = a => { let d = a % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };

/* A UNIFORM SPATIAL HASH over every leader and follower circle. Recruiting
   and, in stage 3, crashing both ask "what is near this point", and asking
   300 wild mantas against a 40-long train is 12,000 comparisons a step done
   the obvious way. The grid is rebuilt each step because everything moves;
   with a cell the size of the biggest query radius, a query touches nine
   cells whatever the population. */
export function createHash (cell) {
  const map = new Map();
  const key = (cx, cz) => cx * 73856093 ^ cz * 19349663;
  return {
    clear () { map.clear(); },
    add (x, z, item) {
      const k = key(Math.floor(x / cell), Math.floor(z / cell));
      const bucket = map.get(k);
      if (bucket) bucket.push(item); else map.set(k, [item]);
    },
    /* Everything in the nine cells around a point. The caller still checks
       the real distance: a cell is a sieve, not an answer. */
    near (x, z, out) {
      out.length = 0;
      const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const bucket = map.get(key(cx + i, cz + j));
        if (bucket) for (const it of bucket) out.push(it);
      }
      return out;
    },
  };
}

export function createSim ({ seed = 1, params = {} } = {}) {
  const p = { ...DEF, ...params };
  const next = rng(seed >>> 0);
  let time = 0;

  /* Four static blooms, placed by the seed inside the reef. */
  const blooms = [];
  for (let i = 0; i < p.blooms; i++) {
    const a = next() * TAU, r = (0.35 + next() * 0.45) * p.arenaR;
    blooms.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, r: 260 + next() * 140 });
  }

  /* 300 wild mantas in small groups. A group shares a wander target that
     drifts towards the nearest bloom, which is what makes them gather where
     the plankton is without any of them being told to path anywhere. */
  /* GROUPS OF 3 TO 5 (10.2), so the count decides how many groups there are
     rather than the other way round. */
  const groupCap = [];
  let planned = 0;
  while (planned < p.wildCount) { const k = 3 + Math.floor(next() * 3); groupCap.push(k); planned += k; }
  const GROUPS = groupCap.length;
  /* EVERY GROUP HAS A HOME, and the homes are laid out rather than rolled.
     Thirty random targets over an arena thirty-two screens across cluster by
     construction — that is what a Poisson scatter does — and no amount of
     keeping-apart fixes it once two homes share a screen. The sunflower
     lattice (the golden angle, radius as the square root of the index) is
     the standard even cover of a disc, so the ocean is evenly occupied by
     construction and the wandering happens around that. */
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  /* The gap between neighbouring homes on the lattice, from the area each
     one has to itself. */
  const spreadOf = () => {
    const rr = Math.max(200, p.arenaR - 320);
    const gap = Math.sqrt(Math.PI * rr * rr / Math.max(1, GROUPS));
    return Math.min(520, Math.max(190, gap * p.groupSpread));
  };
  const groups = [];
  for (let g = 0; g < GROUPS; g++) {
    const a = g * GOLDEN, r = Math.sqrt((g + 0.5) / GROUPS) * (p.arenaR - 320);
    const hx = Math.cos(a) * r, hz = Math.sin(a) * r;
    groups.push({ x: hx, z: hz, hx, hz, t: next() * 6 });
  }
  const wild = [];
  const groupUsed = new Array(GROUPS).fill(0);
  function spawnWild (i, awayFrom) {
    /* Away from every leader, so nothing pops into existence on top of the
       player and is recruited in the same step. */
    let x = 0, z = 0;
    for (let tries = 0; tries < 12; tries++) {
      /* Clear of the reef as well as of every leader: a manta that regrows
         against the wall is one nobody can reach without crashing. */
      const a = next() * TAU, r = Math.sqrt(next()) * (p.arenaR - 260);
      x = Math.cos(a) * r; z = Math.sin(a) * r;
      let ok = true;
      for (const L of awayFrom) if (Math.hypot(x - L.x, z - L.z) < 400) { ok = false; break; }
      if (ok) break;
    }
    /* Into a group with room in it, so a group stays 3 to 5 strong. */
    let g = Math.floor(next() * GROUPS);
    for (let k = 0; k < GROUPS; k++) {
      const q = (g + k) % GROUPS;
      if (groupUsed[q] < groupCap[q]) { g = q; break; }
    }
    groupUsed[g]++;
    /* A FRESH OBJECT, never the recruited one reused. The one that joined
       your train is a follower now; this is a different animal that happens
       to keep the count at 300. Reusing it made "was it recruited from
       inside the radius" unanswerable, because the recruit was alive again
       by the time anything looked. */
    const m = {};
    m.x = x; m.z = z; m.head = next() * TAU; m.group = g;
    const oa = next() * TAU, orr = Math.sqrt(next()) * spreadOf();
    m.ox = Math.cos(oa) * orr; m.oz = Math.sin(oa) * orr;   // its place in the group
    m.speed = 40 + next() * 30;
    m.glow = 0;                 // seconds left glowing in an old train's colour
    m.wasColour = -1;           // which train it was in, while it glows
    m.colour = i;               // its slot in the deal; the renderer picks the hue
    m.alive = true;
    wild[i] = m;
    return m;
  }
  for (let i = 0; i < p.wildCount; i++) spawnWild(i, []);

  /* Rebuilt every step: every leader and follower circle in the world. */
  const hash = createHash(Math.max(p.recruitR, p.spacing) * 2);
  const scratch = [];

  /* A TRAIN. Yours and every rival's are the same object, because 6.1's
     rules are written about trains and not about the player: a rival crashes
     into you exactly the way you crash into it, and is cut the same way. */
  let nextId = 0;
  function makeTrain (x, z, head) {
    return {
      id: nextId++, x, z, head, turn: 0,
      bursting: false, dazed: 0, stunned: 0,   // kept at 0: nothing sets them now
      dead: 0,                // seconds of death beat left, 0 when swimming
      peak: 0,                // the longest this run has been
      lastPeak: 0,            // the score of the run that just ended
      runs: 0,
      crashX: 0, crashZ: 0,
      followers: [],
      trail: [],              // recent path, for the arc-length rule
      s: 0,                   // arc length travelled
      burstOwed: 0,           // seconds of burst not yet paid for
      rebuild: 0,             // a rival alone counts down to a new train
      want: null,             // a rival steers itself; yours comes from input
      crashed: 0,             // counts up for the renderer: a crash just happened
      cut: 0,
    };
  }
  const you = makeTrain(0, 0, 0);
  /* Seeded straight behind the leader, so the first recruits have a path to
     sit on instead of piling up on the spot until it has swum a train's
     length. Same trick the spike's rival trains needed after a wrap. */
  function seedTrail (t) {
    t.trail.length = 0;
    const back = 40 * p.spacing;
    for (let d = back; d >= 0; d -= p.spacing * 0.25)
      t.trail.push({ x: t.x + Math.sin(t.head) * -d, z: t.z + Math.cos(t.head) * d,
                     h: t.head, s: t.s - d });
  }
  seedTrail(you);

  /* What the player is asking for this step: a heading to steer towards, or
     null to hold course, plus whether burst is held. Set by the input layer
     and consumed here, so the simulation never reads a device. */
  const input = { want: null, burst: false };

  function speedOf (m) { return m.bursting ? p.burst : p.cruise; }
  function turnRateOf (m) { return m.bursting ? p.turnBurst : p.turnCruise; }

  /* Steer, then move along the heading. Never the other way round: writing a
     position as a function of the clock is what made the spike's loose
     mantas crab sideways. */
  function advance (m, want, dt) {
    const rate = turnRateOf(m);
    if (want !== null && want !== undefined) {
      const d = wrapAngle(want - m.head);
      const step = Math.max(-rate * dt, Math.min(rate * dt, d));
      m.head = wrapAngle(m.head + step);
      m.turn = step / dt;
    } else m.turn = 0;
    /* FORWARD IS (-sin, -cos), which is what every other part of this lab
       already means by a heading: movers.js moves its mantas that way and
       the shader points the nose that way at heading 0. Getting it mirrored
       in x cost Nathan a test session — the body only agreed with the travel
       direction when the heading was straight up or straight down, and
       everywhere else the manta visibly span as it turned. One convention,
       written down once. */
    const v = speedOf(m) * dt;
    m.x -= Math.sin(m.head) * v;
    m.z -= Math.cos(m.head) * v;
    m.s += v;
    return v;
  }

  /* The reef is a wall: the arena is a disc and nothing leaves it. Crashing
     into it arrives in stage 3; for now the leader is held inside so a test
     can run for minutes without it swimming to infinity. */
  function hold (m, fromX, fromZ, sBefore) {
    const d = Math.hypot(m.x, m.z), lim = p.arenaR - p.leaderR;
    let held = false;
    if (d > lim) { const k = lim / d; m.x *= k; m.z *= k; held = true; }
    /* ARC LENGTH IS DISTANCE ACTUALLY SWUM. Being held by the reef is not
       swimming, and letting s grow while the body stayed put made the path
       pile up: two followers resolved to the same point and their gap
       measured 0.002 against a spacing of 31. */
    m.s = sBefore + Math.hypot(m.x - fromX, m.z - fromZ);
    return held;
  }

  function recordTrail (m, moved) {
    const last = m.trail[m.trail.length - 1];
    if (!last || Math.hypot(m.x - last.x, m.z - last.z) > 1.5) {
      m.trail.push({ x: m.x, z: m.z, h: m.head, s: m.s });
      const need = (m.followers.length + 3) * p.spacing + 120;
      while (m.trail.length > 2 && m.s - m.trail[0].s > need) m.trail.shift();
    }
  }

  /* Where a follower sits: a fixed distance back along the leader's recorded
     path, measured by ARC LENGTH and interpolated between the two points
     that bracket it. Never the path's parameter, and never the last recorded
     point — both of those were bugs in the spike. */
  function placeFollowers (m) {
    const tr = m.trail;
    if (!tr.length) return;
    const headS = m.s;
    for (let k = 0; k < m.followers.length; k++) {
      const want = headS - (k + 1) * p.spacing;
      let a = tr[0], b = null;
      for (let q = tr.length - 1; q >= 0; q--) {
        if (tr[q].s <= want) { a = tr[q]; b = tr[q + 1] || { x: m.x, z: m.z, h: m.head, s: headS }; break; }
      }
      const f = b && b.s > a.s ? (want - a.s) / (b.s - a.s) : 0;
      const ff = m.followers[k];
      ff.x = b ? a.x + (b.x - a.x) * f : a.x;
      ff.z = b ? a.z + (b.z - a.z) * f : a.z;
      ff.head = b ? a.h + wrapAngle(b.h - a.h) * f : a.h;
    }
  }

  /* ONLY YOUR LEADER RECRUITS (rule 1, and 6.3 makes it explicit): a long
     train must not hoover up the ocean, and a dazed one must not collect the
     train it just lost. */
  /* Every distance a recruit was at when it joined, for the test that the
     radius is actually the radius. */
  const joinedAt = [];
  function recruit (t, cap) {
    if (t.dead > 0) return 0;
    if (t.followers.length >= cap) return 0;
    let joined = 0;
    hash.near(t.x, t.z, scratch);
    for (const m of scratch) {
      if (!m.isWild || !m.alive) continue;
      if (t.followers.length >= cap) break;
      if (m.fromTrain === t && m.immune > 0) continue;
      if (Math.hypot(m.x - t.x, m.z - t.z) > p.recruitR) continue;
      m.alive = false;
      if (t === you) joinedAt.push(+Math.hypot(m.x - t.x, m.z - t.z).toFixed(3));
      /* At the TAIL. The colour runs from the head out, which the renderer
         does by tinting every follower with the train's colour. */
      t.followers.push({ x: m.x, z: m.z, head: m.head, born: time, from: m.colour });
      joined++;
      /* A SCATTERED manta is not part of the ambient 300 and is not replaced;
         an ambient one is, so the ocean keeps its population. */
      /* NO INSTANT RESPAWN. v1.10: the ocean refills one manta every two
         seconds and no faster, so a busy patch runs dry and a train can only
         grow as fast as the water allows.

         THE ARRAY NEVER SHIFTS. A manta's slot is its colour — the deal gives
         each index a hue — so splicing a recruited manta out would recolour
         every manta behind it. Slots go dead and are reused instead. */
      m.alive = false;
      if (!m.loose && m.group !== undefined) groupUsed[m.group] = Math.max(0, groupUsed[m.group] - 1);
    }
    return joined;
  }

  function stepWild (dt) {
    for (let g = 0; g < GROUPS; g++) {
      const gr = groups[g];
      gr.t -= dt;
      if (gr.t <= 0) {
        gr.t = 4 + next() * 6;
        /* AROUND ITS OWN HOME, not anywhere. The old line closed most of the
           distance to the nearest bloom every time, which is a sink: thirty
           groups, four blooms, and nothing in between. */
        const wander = p.groupApart * 0.7;
        const wa = next() * TAU, wr = Math.sqrt(next()) * wander;
        let nx = gr.hx + Math.cos(wa) * wr, nz = gr.hz + Math.sin(wa) * wr;
        /* Then a lean towards the nearest bloom, and only while that bloom
           has room: plankton is an attractor, not something anyone collects,
           and a handful of groups at a time is what "gather" means. */
        let best = null, bd = Infinity;
        for (const bl of blooms) {
          const d = Math.hypot(bl.x - nx, bl.z - nz);
          if (d >= bd) continue;
          let held = 0;
          for (const o of groups) if (o !== gr && Math.hypot(o.x - bl.x, o.z - bl.z) < bl.r) held++;
          if (held >= p.bloomHold) continue;
          bd = d; best = bl;
        }
        if (best) {
          const pull = p.bloomPull * (0.35 + next() * 0.3);
          nx += (best.x - nx) * pull; nz += (best.z - nz) * pull;
        }
        gr.x = nx; gr.z = nz;
      }
    }
    for (const m of wild) {
      if (!m.alive) continue;
      if (m.glow > 0) m.glow = Math.max(0, m.glow - dt);
      if (m.immune > 0) { m.immune -= dt; if (m.immune <= 0) m.fromTrain = null; }
      const gr = groups[m.group];
      /* Forward is (-sin, -cos), the one convention in this lab. Written
         mirrored, these 300 would spin as they turned exactly the way the
         player's train did before 88a0679. */
      /* Towards its own place in the group, not the group's centre. */
      const tx = gr.x + (m.ox || 0), tz = gr.z + (m.oz || 0);
      const want = Math.atan2(-(tx - m.x), -(tz - m.z));
      const d = wrapAngle(want - m.head);
      m.head = wrapAngle(m.head + Math.max(-1.2 * dt, Math.min(1.2 * dt, d)));
      m.x -= Math.sin(m.head) * m.speed * dt;
      m.z -= Math.cos(m.head) * m.speed * dt;
      const r = Math.hypot(m.x, m.z), lim = p.arenaR - 30;
      if (r > lim) { const k = lim / r; m.x *= k; m.z *= k; m.head += Math.PI; }
    }
  }

  /* Three rival trains, on the same rules as yours. They wander towards a
     point that drifts, which is enough to bring them across your path. */
  const rivals = [];
  for (let r = 0; r < 3; r++) {
    const a = next() * TAU, d = 500 + next() * 700;
    const t = makeTrain(Math.cos(a) * d, Math.sin(a) * d, next() * TAU);
    t.aim = { x: next() * 800 - 400, z: next() * 800 - 400, t: 2 + next() * 5 };
    seedTrail(t);
    rivals.push(t);
  }
  const trains = [you, ...rivals];

  /* The rules live in rules.js. They read this context at call time, so the
     trains array can be finished after they are created. */
  const ruleCtx = { p, next, GROUPS, wild, scratch, hash, trains, you, blooms };
  const { scatter, crash, cutAt, resolveTouches, payForBurst, steerRival } = createRules(ruleCtx);

  function stepTrain (t, want, dt) {
    if (t.crashed > 0) t.crashed = Math.max(0, t.crashed - dt);
    if (t.cut > 0) t.cut = Math.max(0, t.cut - dt);
    const fromX = t.x, fromZ = t.z, sBefore = t.s;
    const moved = advance(t, want, dt);
    hold(t, fromX, fromZ, sBefore);
    recordTrail(t, moved);
  }

  /* WHERE YOU COME BACK. v1.10: at least 800 units from the crash and clear
     of every train, so you are not dropped back into the wreck you just made
     or on top of the rival that made it. Tries a ring of candidates and takes
     the first that is clear; the last resort is the furthest one tried, which
     cannot happen in an arena this size but must not be an infinite loop. */
  function restart (t) {
    let best = null, bestClear = -1;
    for (let k = 0; k < 40; k++) {
      const a = next() * TAU;
      const r = p.restartMin + next() * (p.arenaR - p.restartMin - 120);
      const x = t.crashX + Math.cos(a) * r, z = t.crashZ + Math.sin(a) * r;
      if (Math.hypot(x, z) > p.arenaR - 120) continue;
      let clear = Infinity;
      for (const o of trains) {
        if (o === t || o.dead > 0) continue;
        for (const q of [o, ...o.followers]) clear = Math.min(clear, Math.hypot(q.x - x, q.z - z));
      }
      if (clear > bestClear) { bestClear = clear; best = { x, z }; }
      if (clear > 300) break;
    }
    if (!best) best = { x: 0, z: 0 };
    /* A new arena, if one was asked for while the last run was going. */
    if (p.arenaRWanted && p.arenaRWanted !== p.arenaR) p.arenaR = p.arenaRWanted;
    t.x = best.x; t.z = best.z; t.head = next() * TAU;
    t.s = 0; t.followers.length = 0; t.bursting = false; t.burstOwed = 0;
    t.lastPeak = t.peak; t.peak = 0; t.runs++;
    t.dead = 0; t.crashed = 0; t.cut = 0; t.rebuild = 10;
    seedTrail(t);
  }

  /* One every regrow seconds, up to the count, into a slot that has gone
     dead and away from every leader. Never two in one step. */
  let regrowOwed = 0;
  /* THE LIVING POPULATION, SCATTERED ONES INCLUDED. This counted only the
     ambient slots, so a crash that put forty mantas in the water left the
     ocean forty over its target and regrowth carried on regardless: the
     count is what the target works against, however a manta got there. */
  function livingWild () {
    let n = 0;
    for (const w of wild) if (w && w.alive) n++;
    return n;
  }

  /* Over the target, nothing regrows and the surplus drains away: the
     scattered ones furthest from the player fade out first, over a few
     seconds each, so the ocean settles back without anything vanishing
     under your nose. */
  function drainSurplus (dt) {
    let live = 0, going = 0;
    for (const w of wild) {
      if (!w || !w.alive) continue;
      live++;
      if (w.fading > 0) going++;
    }
    for (const w of wild) {
      if (!w || !w.alive || !(w.fading > 0)) continue;
      w.fading -= dt;
      if (w.fading <= 0) w.alive = false;
    }
    let over = live - going - p.wildCount;
    if (over <= 0) return 0;
    /* Enough of them at once to cover the whole surplus, furthest from the
       player first, so a train of forty crashing does not leave the ocean
       over its target for two minutes. They still take their few seconds
       each to fade. */
    const spare = [];
    for (const w of wild) {
      if (!w || !w.alive || !w.loose || w.glow > 0 || w.fading > 0) continue;
      spare.push(w);
    }
    spare.sort((a, b) => Math.hypot(b.x - you.x, b.z - you.z) - Math.hypot(a.x - you.x, a.z - you.z));
    let started = 0;
    for (const w of spare) {
      if (over <= 0) break;
      w.fading = p.drain; over--; started++;
    }
    return started;
  }

  function regrowWild (dt) {
    const live = livingWild();
    if (live >= p.wildCount) { regrowOwed = 0; return 0; }
    regrowOwed += dt;
    if (regrowOwed < p.regrow) return 0;
    regrowOwed -= p.regrow;
    for (let i = 0; i < p.wildCount; i++) if (!wild[i] || !wild[i].alive) { spawnWild(i, trains); return 1; }
    return 0;
  }

  function step () {
    const dt = STEP;
    time += dt;
    /* 6.3: bursting needs a follower to pay with. Stage 1 lifted this gate
       because there was nothing to spend; the spending is here now, so the
       gate comes back with it. */
    /* THE DEATH BEAT. A crashed train is gone from the water while it runs:
       it does not swim, recruit, touch anything or appear in the hash. When
       it ends, it is a lone manta somewhere else. */
    for (const t of trains) {
      if (t.dead <= 0) continue;
      t.dead -= dt;
      if (t.dead <= 0) restart(t);
    }
    you.bursting = !you.dead && input.burst && you.followers.length > 0;
    payForBurst(you, dt);
    if (!you.dead) stepTrain(you, input.want, dt);
    if (you.followers.length > you.peak) you.peak = you.followers.length;
    for (const t of rivals) {
      if (t.dead > 0) continue;
      steerRival(t, dt);
      /* A rival bursts now and then, which is what makes it cut you. A test
         that is about the head-on rules pins it instead. */
      if (!t.pinBurst) t.bursting = t.followers.length > 0 && ((time * 0.37 + t.id) % 7) < 0.9;
      payForBurst(t, dt);
      stepTrain(t, t.want, dt);
      if (t.followers.length > t.peak) t.peak = t.followers.length;
    }
    stepWild(dt);
    drainSurplus(dt);
    regrowWild(dt);

    /* The hash carries every leader and follower circle, which is what both
       recruiting and crashing ask about. Wild mantas go in too, because
       recruiting asks the other way round. */
    hash.clear();
    for (const t of trains) {
      if (t.dead > 0) continue;
      t.isLeader = true; t.train = t; t.index = 0; t.isWild = false;
      hash.add(t.x, t.z, t);
      for (let k = 0; k < t.followers.length; k++) {
        const f = t.followers[k];
        f.isLeader = false; f.train = t; f.index = k; f.isWild = false;
        hash.add(f.x, f.z, f);
      }
    }
    for (const m of wild) if (m.alive) { m.isWild = true; m.train = null; hash.add(m.x, m.z, m); }

    resolveTouches();
    /* A rival that has been cut down to its leader gets its appetite back
       after about ten seconds, so there is always something to play against. */
    for (const t of rivals) if (!t.dead) recruit(t, t.rebuild <= 0 ? 8 : t.followers.length);
    if (!you.dead) recruit(you, 1e9);
    /* AFTER recruiting, so a manta that joined this step is already on the
       path rather than sitting wherever it was caught for a frame. */
    for (const t of trains) if (!t.dead) placeFollowers(t);
    return time;
  }

  return {
    get time () { return time; },
    params: p, blooms, you, rivals, trains, input, step, wild, groups, hash, joinedAt,
    liveWild: livingWild,
    scatter, crash, cutAt, makeTrain, seedTrail, restart,
    get length () { return you.followers.length; },
    zoom: () => zoomFor(you.followers.length, p),
    /* For tests and for the panel: the speed actually used this step. */
    speedOf, turnRateOf,
  };
}
