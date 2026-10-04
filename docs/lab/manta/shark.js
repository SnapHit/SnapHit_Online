/* THE WHALE SHARK (4A stage 5, design doc 7.1). Off by default.
 *
 * About every sharkEvery seconds (150) it enters at the reef and crosses
 * the arena on a slow, gently curving path at sharkSpeed a second (120,
 * slower than any manta), never changing course for anyone, and leaves
 * when it has passed out through the reef on the far side, about sharkStay
 * seconds (40) later. Its body is a capsule sharkLen long (320) and
 * sharkWide across (70), its head at (x, z) and its tail sharkLen behind.
 * It cuts any train it crosses, freeing everything behind the crossing as
 * glowing debris (a feast as well as a hazard), and a leader touching its
 * body crashes. Each train is cut at most once a second by it, so a train
 * lying across its path is not cut again every step as the body moves on
 * through the same water. It is never in the hash: its touches are judged
 * here, against its segment, and go through the rules (cutAt, crash) so
 * the events, the set pieces and the rooms see them as any other. Its own
 * appearance and leaving are recorded as kind 'shark'.
 *
 * Simulation only: follow.js draws it (a dark shape seen mostly by the
 * plankton it disturbs), radar.js outlines it, and bots.js steers round it.
 */
import { wrapAngle } from './simcore.js';

const TAU = Math.PI * 2;
const CUT_AGAIN = 1.0;        // seconds before the same train can be cut by it again
const MARGIN = 120;           // units past the reef where it starts and ends

export function createShark (ctx) {
  const { p, next } = ctx;
  const m = { alive: false, x: 0, z: 0, head: 0, turn: 0, since: 0, lastGone: 0, appeared: 0, cuts: 0, crashes: 0, tx: 0, tz: 0 };

  function record (what) {
    if (!ctx.events) return;
    ctx.events.push({ kind: 'shark', what, x: m.x, z: m.z, at: ctx.now ? ctx.now() : 0 });
    if (ctx.events.length > 256) ctx.events.shift();
  }
  /* Where its tail is: sharkLen behind the head along its heading. */
  function tail () { return { x: m.x + Math.sin(m.head) * p.sharkLen, z: m.z + Math.cos(m.head) * p.sharkLen }; }
  /* Distance from a point to its body's spine, head to tail. */
  function spineDist (x, z) {
    const t = tail(), ax = m.x, az = m.z, bx = t.x, bz = t.z;
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9;
    const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
    return Math.hypot(x - (ax + dx * u), z - (az + dz * u));
  }

  function appear () {
    /* In at the reef on one side, out roughly opposite: the heading points
       at a point across the arena, and a gentle constant turn bends the
       path, chosen once so it never changes course for anyone. */
    const a = next() * TAU, R = p.arenaR + MARGIN;
    m.x = Math.cos(a) * R; m.z = Math.sin(a) * R;
    const b = a + Math.PI + (next() - 0.5) * 1.2, tx = Math.cos(b) * R, tz = Math.sin(b) * R;
    m.head = Math.atan2(-(tx - m.x), -(tz - m.z));
    m.turn = (next() - 0.5) * 0.06;           // rad/s: over 40 s at most 1.2 rad of bend
    m.alive = true; m.since = ctx.now(); m.appeared++;
    record('appear');
  }
  function gone () { m.alive = false; m.lastGone = ctx.now(); record('leave'); }

  function step (dt) {
    const t = ctx.now();
    if (!(p.sharkOn >= 0.5)) { if (m.alive) gone(); return; }
    if (!m.alive) { if (t - m.lastGone >= p.sharkEvery) appear(); return; }
    m.head = wrapAngle(m.head + m.turn * dt);
    const v = p.sharkSpeed * dt;
    m.x -= Math.sin(m.head) * v; m.z -= Math.cos(m.head) * v;
    /* Out through the far reef with its whole body, or overstayed: gone. */
    const tl = tail();
    if ((t - m.since > 5 && Math.hypot(m.x, m.z) > p.arenaR + MARGIN && Math.hypot(tl.x, tl.z) > p.arenaR + MARGIN) || t - m.since > p.sharkStay + 20) { gone(); return; }
    /* Touches: a leader on its body crashes; a train it crosses is cut at
       the first follower on its body, once a second per train. */
    const half = p.sharkWide / 2, k = p.trainScale || 1;
    for (const tr of ctx.trains) {
      if (tr.dead > 0) continue;
      if (spineDist(tr.x, tr.z) <= half + p.leaderR * k) { ctx.rules.crash(tr, null, 'shark'); m.crashes++; continue; }
      if (tr.sharkCutAt !== undefined && t - tr.sharkCutAt < CUT_AGAIN) continue;
      const f = tr.followers;
      for (let i = 0; i < f.length; i++) {
        if (spineDist(f[i].x, f[i].z) <= half + p.followerR * k) {
          tr.sharkCutAt = t;
          if (ctx.rules.cutAt(tr, i, null, f[i].x, f[i].z)) m.cuts++;
          break;
        }
      }
    }
  }

  return { m, step, spineDist, tail };
}
