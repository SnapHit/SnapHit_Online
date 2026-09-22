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
  cruise: 170,          // units a second, never zero
  burst: 300,
  turnCruise: 3.5,      // rad/s
  turnBurst: 2.6,       // bursts turn wider
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

  /* Your leader. It never stops: speed is cruise or burst, never zero. */
  const you = {
    x: 0, z: 0, head: 0, turn: 0,
    bursting: false, dazed: 0, stunned: 0,
    followers: [],          // arc lengths behind the head, filled in stage 2
    trail: [],              // recent path, for the arc-length rule
    s: 0,                   // arc length travelled
  };

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
    const v = speedOf(m) * dt;
    m.x += Math.sin(m.head) * v;
    m.z -= Math.cos(m.head) * v;
    m.s += v;
    return v;
  }

  /* The reef is a wall: the arena is a disc and nothing leaves it. Crashing
     into it arrives in stage 3; for now the leader is held inside so a test
     can run for minutes without it swimming to infinity. */
  function hold (m) {
    const d = Math.hypot(m.x, m.z), lim = p.arenaR - p.leaderR;
    if (d > lim) { const k = lim / d; m.x *= k; m.z *= k; return true; }
    return false;
  }

  function recordTrail (m, moved) {
    const last = m.trail[m.trail.length - 1];
    if (!last || Math.hypot(m.x - last.x, m.z - last.z) > 1.5) {
      m.trail.push({ x: m.x, z: m.z, h: m.head, s: m.s });
      const need = (m.followers.length + 2) * p.spacing + 80;
      while (m.trail.length > 2 && m.s - m.trail[0].s > need) m.trail.shift();
    }
  }

  function step () {
    const dt = STEP;
    time += dt;
    you.bursting = input.burst && you.followers.length > 0;
    if (you.dazed > 0) you.dazed = Math.max(0, you.dazed - dt);
    if (you.stunned > 0) you.stunned = Math.max(0, you.stunned - dt);
    const moved = advance(you, input.want, dt);
    hold(you);
    recordTrail(you, moved);
    return time;
  }

  return {
    get time () { return time; },
    params: p, blooms, you, input, step,
    zoom: () => zoomFor(you.followers.length, p),
    /* For tests and for the panel: the speed actually used this step. */
    speedOf, turnRateOf,
  };
}
