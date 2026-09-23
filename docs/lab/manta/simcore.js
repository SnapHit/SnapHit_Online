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
  /* v1.10 rule 3: a crash ends the run. The daze and the lone-leader stun
     are gone with it — there is no longer a you to daze. */
  deathBeat: 1.5,       // seconds before you are swimming again
  restartMin: 800,      // units from the crash, and clear of every train
  wildCount: 120,      // v1.10: 300 with instant respawn never ran dry
  regrow: 2,           // seconds a manta, up to the count, and never faster
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

export { TAU, wrapAngle };
