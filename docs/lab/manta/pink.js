/* THE PINK MANTA (4A stage 4, design doc 7.1).
 *
 * One at a time, appearing pinkWait seconds after the last was caught or
 * left, at least pinkClear units from every leader. It drifts like a wild
 * manta until a leader comes within pinkNotice, then flees at pinkFlee a
 * second, faster than a cruising leader and slower than a burst, so only a
 * burst catches it: a bursting leader within the recruit radius takes it,
 * and touching it without bursting does nothing, because it is never in
 * the hash. Catching it adds pinkReward followers at once, in the catcher's
 * colour. Left uncaught for pinkStay seconds, it dives and is gone. Every
 * (P) value is a parameter (simcore.js DEF, params.js sliders), and pinkOn
 * turns it off.
 *
 * Simulation only: no rendering here. The rooms Worker steps this with the
 * rest of the simulation, so a room decides every catch. follow.js draws it
 * (dark from above, pink when it rolls) and radar.js shows its dot. Every
 * appearance, catch and leaving is recorded in sim.events as kind 'pink'.
 *
 * The real one, off Lady Elliot Island, has a black back and a pink belly,
 * so from above it looks ordinary until it rolls: it rolls once every few
 * seconds while drifting and continuously while fleeing (roll runs 0 to 1
 * over a roll, -1 between), which is what the renderer shows.
 */
import { wrapAngle } from './simcore.js';

const TAU = Math.PI * 2;
const DRIFT_SPEED = 60;        // units a second while nobody is near
const DRIFT_TURN = 1.2;        // rad/s, a wild manta's
const FLEE_TURN = 3.0;         // rad/s: it can turn, it cannot outrun a burst
const EDGE = 300;              // it keeps this far inside the reef
const ROLL_FOR = 0.6;          // seconds, one roll while drifting
const ROLL_EVERY = [2.5, 4];   // seconds between rolls while drifting
const FLEE_ROLL = 0.9;         // seconds a roll while fleeing

export function createPink (ctx) {
  const { p, next } = ctx;
  const m = { alive: false, x: 0, z: 0, head: 0, state: 'idle', since: 0, lastGone: 0,
              appeared: 0, caught: 0, left: 0, lastCatcher: -1,
              tx: 0, tz: 0, wanderAt: -1, roll: -1, rollAt: 0 };

  const leaders = () => ctx.trains.filter(t => !(t.dead > 0));

  function record (what, by) {
    if (!ctx.events) return;
    ctx.events.push({ kind: 'pink', what, x: m.x, z: m.z, by: by ? by.id : -1, at: ctx.now ? ctx.now() : 0 });
    if (ctx.events.length > 256) ctx.events.shift();
  }

  /* Somewhere inside the reef at least pinkClear from every leader, from
     the seeded generator; forty tries, else wait for the next step. */
  function place () {
    const Ls = leaders(), R = Math.max(100, p.arenaR - EDGE);
    for (let k = 0; k < 40; k++) {
      const a = next() * TAU, r = Math.sqrt(next()) * R, x = Math.cos(a) * r, z = Math.sin(a) * r;
      let clear = true;
      for (const L of Ls) if (Math.hypot(x - L.x, z - L.z) < p.pinkClear) { clear = false; break; }
      if (clear) { m.x = x; m.z = z; m.head = next() * TAU; return true; }
    }
    return false;
  }

  function gone (why, by = null) {
    m.alive = false; m.state = 'idle'; m.lastGone = ctx.now(); m.roll = -1;
    if (why === 'catch') { m.caught++; m.lastCatcher = by ? by.id : -1; } else m.left++;
    record(why, by);
  }

  /* pinkReward followers at once, at the tail (placeFollowers lays them
     along the path on this same step), in the catcher's colour: from -1,
     so the renderer dresses them as the train's. */
  function catchBy (L) {
    const n = Math.max(0, Math.round(p.pinkReward)), t = ctx.now();
    for (let k = 0; k < n; k++) L.followers.push({ x: L.x, z: L.z, head: L.head, born: t, from: -1, pink: true });
    if (L.followers.length > L.peak) L.peak = L.followers.length;
    gone('catch', L);
  }

  function step (dt) {
    const t = ctx.now();
    if (!(p.pinkOn >= 0.5)) { if (m.alive) gone('off'); return; }
    if (!m.alive) {
      if (t - m.lastGone >= p.pinkWait && place()) {
        m.alive = true; m.since = t; m.appeared++; m.state = 'drift';
        m.wanderAt = -1; m.roll = -1; m.rollAt = t + ROLL_EVERY[0] + next() * (ROLL_EVERY[1] - ROLL_EVERY[0]);
        record('appear');
      }
      return;
    }
    /* A bursting leader within the recruit radius catches it; the nearest
       first, so two cannot share it. */
    let near = null, nd = Infinity;
    for (const L of leaders()) {
      const d = Math.hypot(L.x - m.x, L.z - m.z);
      if (d < nd) { nd = d; near = L; }
      if (L.bursting && d <= p.recruitR * (p.trainScale || 1) && (!near || d <= nd)) { catchBy(L); return; }
    }
    if (near && near.bursting && nd <= p.recruitR * (p.trainScale || 1)) { catchBy(near); return; }
    if (t - m.since >= p.pinkStay) { gone('leave'); return; }

    const fleeing = near !== null && nd < p.pinkNotice;
    m.state = fleeing ? 'flee' : 'drift';
    let want;
    if (fleeing) {
      /* Straight away from the leader, bent inward as the reef nears so it
         never pins itself against the wall. */
      let ax = m.x - near.x, az = m.z - near.z;
      const an = Math.hypot(ax, az) || 1; ax /= an; az /= an;
      const r = Math.hypot(m.x, m.z) || 1, lim = p.arenaR - EDGE;
      if (r > lim * 0.8) { const k = Math.min(2.5, (r - lim * 0.8) / (lim * 0.2) * 2.5); ax += (-m.x / r) * k; az += (-m.z / r) * k; }
      want = Math.atan2(-ax, -az);
    } else {
      if (m.wanderAt < 0 || t >= m.wanderAt || Math.hypot(m.tx - m.x, m.tz - m.z) < 40) {
        const a = next() * TAU, r = Math.sqrt(next()) * (p.arenaR - EDGE);
        m.tx = Math.cos(a) * r; m.tz = Math.sin(a) * r; m.wanderAt = t + 3 + next() * 3;
      }
      want = Math.atan2(-(m.tx - m.x), -(m.tz - m.z));
    }
    const rate = fleeing ? FLEE_TURN : DRIFT_TURN, d = wrapAngle(want - m.head);
    m.head = wrapAngle(m.head + Math.max(-rate * dt, Math.min(rate * dt, d)));
    /* Forward is (-sin, -cos), the one convention in this lab. */
    const v = (fleeing ? p.pinkFlee : DRIFT_SPEED) * dt;
    m.x -= Math.sin(m.head) * v; m.z -= Math.cos(m.head) * v;
    const r2 = Math.hypot(m.x, m.z), lim2 = p.arenaR - 40;
    if (r2 > lim2) { const k = lim2 / r2; m.x *= k; m.z *= k; }

    /* The roll: continuous while fleeing, now and then while drifting. */
    if (fleeing) m.roll = ((t - m.since) % FLEE_ROLL) / FLEE_ROLL;
    else if (m.roll >= 0) { m.roll += dt / ROLL_FOR; if (m.roll >= 1) { m.roll = -1; m.rollAt = t + ROLL_EVERY[0] + next() * (ROLL_EVERY[1] - ROLL_EVERY[0]); } }
    else if (t >= m.rollAt) m.roll = 0;
  }

  return { m, step };
}
