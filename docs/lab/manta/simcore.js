/* The simulation's constants and pure helpers: the parameter table, the
 * camera's zoom and view, the shared size-and-colour mix, and the spatial
 * hash. Nothing here holds state or draws a random number, which is why it
 * could move out of sim.js without changing a single step: the suites'
 * PASS and FAIL lines hash identically before and after.
 */
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
  /* THE PINK MANTA (4A stage 4, 7.1), every (P) value: on; the wait after
     the last was caught or left; its clearance from every leader when it
     appears; the distance at which it flees; its flee speed; the followers a
     catch adds; how long it stays uncaught before it dives. */
  pinkOn: 1, pinkWait: 60, pinkClear: 800, pinkNotice: 300, pinkFlee: 260, pinkReward: 10, pinkStay: 60,
  /* THE WHALE SHARK (4A stage 5, 7.1), off until Nathan has tried it: how
     often it appears, how long it stays, its speed, its length and width. */
  sharkOn: 0, sharkEvery: 150, sharkStay: 40, sharkSpeed: 120, sharkLen: 320, sharkWide: 70,
  /* v1.10 rule 3: a crash ends the run. The daze and the lone-leader stun
     are gone with it — there is no longer a you to daze. */
  deathBeat: 1.5,       // seconds before you are swimming again
  restartMin: 800,      // units from the crash, and clear of every train
  wildCount: 120,      // v1.10: 300 with instant respawn never ran dry
  regrow: 5,           // the refill time (3C/3D): each missing manta back within it on average
  drain: 3,            // seconds a surplus manta takes to fade out
  bots: 10,            // bot leaders, each on the one brain of 10.2
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
  zoomNear: 1.5,        // the camera at length 0 (3L, design doc 10.2)
  zoomFar: 0.4,         // never further out than this
  zoomHalf: 50,         // the length that doubles the visible area
  zoomEase: 1,          // seconds, the ease towards a wider view; twice that back in
};

/* THE CLOSE-UP CAMERA (3L, design doc 10.2): near / sqrt(1 + length / half),
   never below far. The visible area grows in proportion to 1 + length /
   half, so a long train fills about the same share of the screen however
   long it gets; the floor arrives near length 650 at the defaults. Pure, so
   the area rule can be checked at any length without running a frame. The
   easing over time is the camera's (follow.js). */
export function zoomFor (length, p = DEF) {
  const n = p.zoomNear ?? 1.5, f = p.zoomFar ?? 0.4, h = p.zoomHalf ?? 50;
  return Math.max(f, n / Math.sqrt(1 + Math.max(0, length) / h));
}

/* FOR TESTS ONLY: a train of `count` followers laid at once, its path an
   Archimedean spiral out from the arena's centre (pitch 120 units) with the
   leader at the outer end, so a 650-long train fits inside the reef. The
   solo lab's ?train=N and the staged room's ?mine=N use it. */
export function layLong (t, count, p) {
  const sp = p.spacing, step = sp / 4, total = (count + 40) * sp, b = 120 / TAU, pts = [];
  let th = 1, l = 0, x = b * th * Math.cos(th), z = b * th * Math.sin(th);
  pts.push({ x, z, l });
  while (l < total) {
    th += step / (b * Math.sqrt(1 + th * th));
    const nx = b * th * Math.cos(th), nz = b * th * Math.sin(th);
    l += Math.hypot(nx - x, nz - z); x = nx; z = nz;
    pts.push({ x, z, l });
  }
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], c = pts[Math.min(pts.length - 1, i + 1)];
    pts[i].h = Math.atan2(-(c.x - a.x), -(c.z - a.z));   // forward is (-sin h, -cos h)
  }
  t.trail.length = 0;
  for (const q of pts) t.trail.push({ x: q.x, z: q.z, h: q.h, s: t.s - (total - q.l) });
  const last = pts[pts.length - 1];
  t.x = last.x; t.z = last.z; t.head = last.h;
  t.followers.length = 0;
  for (let k = 0; k < count; k++) t.followers.push({ x: last.x, z: last.z, head: last.h, born: -100, from: -1 });
  return t;
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

export { TAU, wrapAngle };
