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
  recruitR: 40,
  burstCost: 0.35,      // seconds a follower
  scatterGlow: 4,
  daze: 3,
  stun: 1,
  wildCount: 300,
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
  const GROUPS = 30;
  const groups = [];
  for (let g = 0; g < GROUPS; g++) {
    const a = next() * TAU, r = next() * p.arenaR * 0.9;
    groups.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, t: next() * 6 });
  }
  const wild = [];
  function spawnWild (i, awayFrom) {
    /* Away from every leader, so nothing pops into existence on top of the
       player and is recruited in the same step. */
    let x = 0, z = 0;
    for (let tries = 0; tries < 12; tries++) {
      const a = next() * TAU, r = Math.sqrt(next()) * (p.arenaR - 60);
      x = Math.cos(a) * r; z = Math.sin(a) * r;
      let ok = true;
      for (const L of awayFrom) if (Math.hypot(x - L.x, z - L.z) < 400) { ok = false; break; }
      if (ok) break;
    }
    const g = Math.floor(next() * GROUPS);
    /* A FRESH OBJECT, never the recruited one reused. The one that joined
       your train is a follower now; this is a different animal that happens
       to keep the count at 300. Reusing it made "was it recruited from
       inside the radius" unanswerable, because the recruit was alive again
       by the time anything looked. */
    const m = {};
    m.x = x; m.z = z; m.head = next() * TAU; m.group = g;
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

  /* Your leader. It never stops: speed is cruise or burst, never zero. */
  const you = {
    x: 0, z: 0, head: 0, turn: 0,
    bursting: false, dazed: 0, stunned: 0,
    followers: [],          // arc lengths behind the head, filled in stage 2
    trail: [],              // recent path, for the arc-length rule
    s: 0,                   // arc length travelled
  };
  /* Seeded straight behind the leader, so the first recruits have a path to
     sit on instead of piling up on the spot until it has swum a train's
     length. Same trick the spike's rival trains needed after a wrap. */
  {
    const back = 40 * p.spacing;
    for (let d = back; d >= 0; d -= p.spacing * 0.25)
      you.trail.push({ x: you.x + Math.sin(you.head) * -d, z: you.z + Math.cos(you.head) * d,
                       h: you.head, s: -d });
  }

  /* What the player is asking for this step: a heading to steer towards, or
     null to hold course, plus whether burst is held. Set by the input layer
     and consumed here, so the simulation never reads a device. */
  const input = { want: null, burst: false };

  function speedOf (m) {
    if (m.stunned > 0) return p.cruise * 0.55;     // slowed, weak turning
    return m.bursting ? p.burst : p.cruise;
  }
  function turnRateOf (m) {
    if (m.stunned > 0) return p.turnCruise * 0.4;
    return m.bursting ? p.turnBurst : p.turnCruise;
  }

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
  function recruit () {
    if (you.dazed > 0) return 0;
    let joined = 0;
    hash.near(you.x, you.z, scratch);
    for (const m of scratch) {
      if (!m.isWild || !m.alive) continue;
      if (Math.hypot(m.x - you.x, m.z - you.z) > p.recruitR) continue;
      m.alive = false;
      joinedAt.push(+Math.hypot(m.x - you.x, m.z - you.z).toFixed(3));
      /* At the TAIL. The colour runs from the head out, which the renderer
         does by tinting every follower with your train's colour. */
      you.followers.push({ x: m.x, z: m.z, head: m.head, born: time, from: m.colour });
      joined++;
      spawnWild(wild.indexOf(m), [you]);
    }
    return joined;
  }

  function stepWild (dt) {
    for (let g = 0; g < GROUPS; g++) {
      const gr = groups[g];
      gr.t -= dt;
      if (gr.t <= 0) {
        /* A new target, biased towards the nearest bloom: plankton is an
           attractor, not something anyone collects. */
        gr.t = 4 + next() * 6;
        let best = blooms[0], bd = Infinity;
        for (const bl of blooms) { const d = Math.hypot(bl.x - gr.x, bl.z - gr.z); if (d < bd) { bd = d; best = bl; } }
        const pull = 0.55 + next() * 0.35;
        const a = next() * TAU, r = next() * 500;
        gr.x = gr.x + (best.x - gr.x) * pull + Math.cos(a) * r;
        gr.z = gr.z + (best.z - gr.z) * pull + Math.sin(a) * r;
      }
    }
    for (const m of wild) {
      if (!m.alive) continue;
      if (m.glow > 0) m.glow = Math.max(0, m.glow - dt);
      const gr = groups[m.group];
      /* Forward is (-sin, -cos), the one convention in this lab. Written
         mirrored, these 300 would spin as they turned exactly the way the
         player's train did before 88a0679. */
      const want = Math.atan2(-(gr.x - m.x), -(gr.z - m.z));
      const d = wrapAngle(want - m.head);
      m.head = wrapAngle(m.head + Math.max(-1.2 * dt, Math.min(1.2 * dt, d)));
      m.x -= Math.sin(m.head) * m.speed * dt;
      m.z -= Math.cos(m.head) * m.speed * dt;
      const r = Math.hypot(m.x, m.z), lim = p.arenaR - 30;
      if (r > lim) { const k = lim / r; m.x *= k; m.z *= k; m.head += Math.PI; }
    }
  }

  function step () {
    const dt = STEP;
    time += dt;
    /* NO FOLLOWER GATE YET, and that is deliberate. Bursting SPENDS
       followers (6.3), and the spending arrives in stage 3 with the cost
       interval; gating on a train you cannot recruit yet only made the
       drawer's two burst sliders untestable. Nathan held a double tap on the
       phone and nothing happened, because stage 1 has nothing to pay with.
       The gate comes back in stage 3, beside the thing it is paying for. */
    you.bursting = input.burst;
    if (you.dazed > 0) you.dazed = Math.max(0, you.dazed - dt);
    if (you.stunned > 0) you.stunned = Math.max(0, you.stunned - dt);
    const fromX = you.x, fromZ = you.z, sBefore = you.s;
    const moved = advance(you, input.want, dt);
    hold(you, fromX, fromZ, sBefore);
    recordTrail(you, moved);
    stepWild(dt);
    /* The hash carries every leader and follower circle, which is what both
       recruiting and (in stage 3) crashing ask about. Wild mantas go in too,
       because recruiting asks the other way round. */
    hash.clear();
    hash.add(you.x, you.z, you);
    for (const f of you.followers) hash.add(f.x, f.z, f);
    for (const m of wild) if (m.alive) { m.isWild = true; hash.add(m.x, m.z, m); }
    recruit();
    /* AFTER recruiting, so a manta that joined this step is already on the
       path rather than sitting wherever it was caught for a frame. */
    placeFollowers(you);
    return time;
  }

  return {
    get time () { return time; },
    params: p, blooms, you, input, step, wild, groups, hash, joinedAt,
    get length () { return you.followers.length; },
    zoom: () => zoomFor(you.followers.length, p),
    /* For tests and for the panel: the speed actually used this step. */
    speedOf, turnRateOf,
  };
}
