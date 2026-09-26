/* Rooms, the shared core (3C stage 4): the wire format a room speaks, and
 * the mirror that rebuilds trains from it. No DOM and no three, so the room
 * (in the Worker), the phone and the Node tests all run this same file.
 *
 * Phone -> room, JSON text:
 *   {t:'hello', build, view:{x,z,w,h}, watch, debug?}   first, after open
 *   {t:'view', x, z, w, h, watch}                 when the view moves
 *   watch is the bot the camera follows (-1 for none): the room always
 *   sends that train, wherever it is, so the camera can find it.
 *   {t:'ping', c}                                 the room answers {t:'pong', c}
 * Room -> phone:
 *   {t:'reload', build}                           a different build: reload
 *   {t:'init', build, seed, params}               then snapshots
 *   {t:'snap', n, time, tr:[...], wd:[...], ev:[...], bd:[...], truth?}
 *
 * A train in a snapshot: {id, x, z, h, s, len, pts, and b:1 when bursting,
 * dead:1 when dead}; pts are the path points [x, z, h, s] this phone has not
 * had yet. The first time a phone sees a train, and after it restarts, it
 * comes with fresh:1, its kind and runs, and its whole path. Followers are never sent: the phone lays them along the path
 * with the simulation's own placeFollowers, so they sit where the room has
 * them. Wild mantas near the view: [slot, x, z, head, flags, wasColour],
 * flags bit 0 loose, bit 1 sinking. Events near the view: {k, x, z}.
 * The board, whole: [[id, len], ...], longest first, only when it changed
 * (keep the last one).
 */
import { createMotion } from './motion.js';

export const PROTOCOL = 1;
export const SNAP_HZ = 20;
export const MARGIN = 400;               // units beyond the view a phone is sent
export const PATH_STEP = 6;              // path points at least this far apart

const r1 = v => Math.round(v * 10) / 10;
const r2 = v => Math.round(v * 100) / 100;

/* Is (x, z) inside the view plus the margin? */
export function near (view, x, z) {
  return Math.abs(x - view.x) <= view.w / 2 + MARGIN && Math.abs(z - view.z) <= view.h / 2 + MARGIN;
}

/* The room's side: one phone's snapshot, and what it remembers it sent. */
export function snapFor (sim, phone, n, events) {
  const view = phone.view, tr = [];
  for (const t of sim.rivals) {
    let seen = t.id === phone.watch || near(view, t.x, t.z);
    if (!seen && !(t.dead > 0)) for (const f of t.followers) if (near(view, f.x, f.z)) { seen = true; break; }
    if (!seen) continue;
    const had = phone.sent.get(t.id);
    const fresh = !had || had.runs !== t.runs;
    /* The path, thinned to a point every PATH_STEP units: the oldest point
       first when the phone has none, then whatever is new since. */
    let last = fresh ? -Infinity : had.s;
    const pts = [];
    for (const q of t.trail) {
      if (q.s < last + PATH_STEP) continue;
      pts.push([r1(q.x), r1(q.z), r2(q.h), r1(q.s)]); last = q.s;
    }
    phone.sent.set(t.id, { runs: t.runs, s: last });
    /* Only what changes goes every time: kind and runs on first sight,
       flags only when set (bytes matter on a 0.4 Mbit/s phone). */
    const q = { id: t.id, x: r1(t.x), z: r1(t.z), h: r2(t.head), s: r1(t.s), len: t.followers.length, pts };
    if (fresh) { q.fresh = 1; q.kind = t.kind || 'bot'; q.runs = t.runs; }
    if (t.bursting) q.b = 1;
    if (t.dead > 0) q.dead = 1;
    tr.push(q);
  }
  const wd = [];
  for (let i = 0; i < sim.wild.length; i++) {
    const w = sim.wild[i];
    if (!w || !w.alive || !near(view, w.x, w.z)) continue;
    wd.push([i, r1(w.x), r1(w.z), r2(w.head), (w.loose ? 1 : 0) | (w.sinking > 0 ? 2 : 0), w.glow > 0 ? w.wasColour : -1]);
  }
  const ev = [];
  for (const e of events) if ((e.kind === 'crash' || e.kind === 'cut') && near(view, e.x, e.z)) ev.push({ k: e.kind, x: r1(e.x), z: r1(e.z) });
  /* The board, whole, but only when it has changed since this phone's last. */
  const bd = sim.rivals.map(t => [t.id, t.dead > 0 ? 0 : t.followers.length]).sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 10);
  const key = bd.join(';');
  const snap = { t: 'snap', n, time: r2(sim.time), tr, wd, ev };
  if (key !== phone.board) { snap.bd = bd; phone.board = key; }
  if (phone.debug) snap.truth = tr.map(q => { const t = sim.rivals.find(o => o.id === q.id);
    return { id: t.id, x: t.x, z: t.z, f: t.followers.map(f => [f.x, f.z]) }; });
  return snap;
}

/* The phone's side: trains rebuilt from snapshots. */
export function createMirror (params) {
  const motion = createMotion(params);
  const trains = new Map();
  function apply (snap) {
    const seenNow = new Set();
    for (const q of snap.tr) {
      let t = trains.get(q.id);
      if (!t) { t = { id: q.id, trail: [], followers: [], runs: -1 }; trains.set(q.id, t); }
      if (q.fresh) { t.trail.length = 0; t.kind = q.kind; t.runs = q.runs; }
      for (const p of q.pts) t.trail.push({ x: p[0], z: p[1], h: p[2], s: p[3] });
      const need = (q.len + 3) * params.spacing + 120;
      while (t.trail.length > 2 && q.s - t.trail[0].s > need) t.trail.shift();
      Object.assign(t, { x: q.x, z: q.z, head: q.h, s: q.s, bursting: !!q.b, dead: q.dead ? 1 : 0, len: q.len, at: snap.time });
      while (t.followers.length < q.len) t.followers.push({ x: t.x, z: t.z, head: t.head, from: 0 });
      t.followers.length = q.len;
      if (!q.dead) motion.placeFollowers(t);
      seenNow.add(q.id);
    }
    return seenNow;
  }
  return { trains, apply, placeFollowers: motion.placeFollowers };
}
