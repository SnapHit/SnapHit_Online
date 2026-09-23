/* How a manta moves: its speed and turn rate, the step that steers and then
 * swims along the heading, the reef that holds it, the path it leaves, and
 * the arc-length rule that puts every follower on that path.
 *
 * It reads the parameter table and nothing else — no generator, no world —
 * which is why it could leave sim.js without changing a step: the suites'
 * PASS and FAIL lines hash identically before and after.
 */
import { wrapAngle } from './simcore.js';

export function createMotion (p) {
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

  return { speedOf, turnRateOf, advance, hold, recordTrail, placeFollowers };
}
