/* Rooms, the shared core (3C stage 4): the wire format a room speaks, and
 * the mirror that rebuilds trains from it. No DOM and no three, so the room
 * (in the Worker), the phone and the Node tests all run this same file.
 *
 * Phone -> room, JSON text:
 *   {t:'hello', build, view:{x,z,w,h}, watch, debug?}   first, after open
 *   PLAY MODE: hello also carries play:true, token?, lagComp?; then
 *   {t:'in', seq, k, w, b?, d}: k is the room's simulation step the input
 *   is for, w the heading wanted (null: straight on), b:1 bursting, d how
 *   many steps behind k this phone is drawing the other trains.
 *   init adds me:{id, name, token} and names. A player's snapshots carry
 *   its own leader and its clock in the binary (flag 8 below); who drives
 *   what comes as {t:'names', names:[[id, name], ...]} whenever it changed.
 *   The player's own train is always in the trains. An 11th player gets
 *   {t:'full'} and is closed.
 *   {t:'view', x, z, w, h, watch}                 when the view moves
 *   watch is the bot the camera follows (-1 for none): the room always
 *   sends that train, wherever it is, so the camera can find it.
 *   {t:'ping', c}                                 the room answers {t:'pong', c}
 * Room -> phone, JSON text: {t:'reload', build}, {t:'init', build, seed,
 *   params, time, steps, kinds}, {t:'pong', c}, and under wrangler dev only
 *   {t:'truth', n, tr, wd} after snapshot n, for the tests.
 * Room -> phone, BINARY (3F): every snapshot, twenty times a second.
 *
 * WHY BINARY. A full ocean put some forty wild mantas and several long
 * trains in every phone's view, and as JSON that came to about 26 KB/s a
 * phone. Now positions are whole units relative to the view's centre (two
 * bytes each), headings are 1/256 of a turn (one byte), and the wild mantas
 * near the view go five times a second, not twenty: the phone smooths them
 * between (createWildStore). What cannot wait goes at once in every
 * snapshot: a wild manta appearing, changing (sinking, glowing) or leaving.
 *
 * The layout, little-endian:
 *   u8 1, u8 flags (1 board, 2 wild in full, 4 wild changes), u32 n,
 *   u32 k (the room's step), i32 cx, i32 cz (the view's centre, whole units)
 *   u8 trains; each: u8 id, u8 f (1 fresh, 2 bursting, 4 dead), i16 x,
 *     i16 z, u8 h, i32 s (1/16 unit), u16 len; if fresh u8 kind, u16 runs;
 *     u16 points; the first i16 x, i16 z, u8 h, i32 s, the rest i16 x,
 *     i16 z, u8 h, u16 ds (1/16 unit since the one before)
 *   u8 events; each: u8 kind (0 crash, 1 cut), i16 x, i16 z, u8 by: the
 *     leader that made the cut, or that crashed (255 none) (3H)
 *   board (flag 1): u8 rows; each u8 id, u16 len, longest first
 *   wild in full (flag 2): u16 count, then records
 *   wild changes (flag 4): u16 count, records; u16 count, slots gone (a
 *     slot both gone and in a record has a new manta in it: gone first)
 *   a player's own (flag 8): u8 f (1 dead, 2 bursting, 4 peak, 8 early,
 *     16 late, 32 ack), f32 x, f32 z, f32 h, i32 s, u16 len, u16 runs; if
 *     dead f32 seconds left, i16 crashX, i16 crashZ; if peak u16; if early
 *     i16 steps x10, u32 seq; if late u16; if ack u32
 *   a wild record: u16 slot, i16 x, i16 z, u8 h, u8 flags (1 loose,
 *     2 sinking), u8 colour it glows in (255 none)
 *
 * A train: its leader, and the path points this phone has not had yet. The
 * first time a phone sees a train, and after it restarts, it comes fresh,
 * with its kind, runs and whole path. Followers are never sent: the phone
 * lays them along the path with the simulation's own placeFollowers, so
 * they sit where the room has them.
 */
import { createMotion } from './motion.js';

export const PROTOCOL = 2;
export const SNAP_HZ = 20;
export const WILD_EVERY = 4;             // snapshots between full wild lists: 5 a second
export const MARGIN = 400;               // units beyond the view a phone is sent
export const PATH_STEP = 8;              // path points at least this far apart (0.2 units of curve error at the tightest turn)
export const WILD_TOL = 1;               // units a wild manta may stray from where the phone will carry it

const TAU = Math.PI * 2;
const KINDS = ['bot', 'timid', 'greedy', 'bully', 'strawman'];
const i16 = v => Math.max(-32768, Math.min(32767, Math.round(v)));
const ang = h => ((Math.round(h / TAU * 256) % 256) + 256) % 256;
const unang = a => (a > 128 ? a - 256 : a) * TAU / 256;
const s16 = s => Math.max(-2147483648, Math.min(2147483647, Math.round(s * 16)));

/* Is (x, z) inside the view plus the margin? */
export function near (view, x, z) {
  return Math.abs(x - view.x) <= view.w / 2 + MARGIN && Math.abs(z - view.z) <= view.h / 2 + MARGIN;
}

/* A growing little-endian buffer. */
function writer () {
  let buf = new ArrayBuffer(2048), dv = new DataView(buf), o = 0;
  const need = n => {
    if (o + n <= buf.byteLength) return;
    let size = buf.byteLength * 2; while (size < o + n) size *= 2;
    const nb = new ArrayBuffer(size); new Uint8Array(nb).set(new Uint8Array(buf, 0, o));
    buf = nb; dv = new DataView(buf);
  };
  return {
    u8 (v) { need(1); dv.setUint8(o, v); o += 1; },
    u16 (v) { need(2); dv.setUint16(o, Math.max(0, Math.min(65535, v | 0)), true); o += 2; },
    i16 (v) { need(2); dv.setInt16(o, i16(v), true); o += 2; },
    i32 (v) { need(4); dv.setInt32(o, v | 0, true); o += 4; },
    u32 (v) { need(4); dv.setUint32(o, v >>> 0, true); o += 4; },
    f32 (v) { need(4); dv.setFloat32(o, v, true); o += 4; },
    get at () { return o; },
    put8 (at, v) { dv.setUint8(at, v); },
    put16 (at, v) { dv.setUint16(at, v, true); },
    done () { return buf.slice(0, o); },
  };
}

/* The room's side: one phone's snapshot, and what it remembers it sent.
   Returns {data, truth}: data is the binary snapshot; truth, only for a
   debug phone under wrangler dev, is the room's unrounded state. */
export function snapFor (sim, phone, n, events, step = 0) {
  const view = phone.view, w = writer();
  const cx = Math.round(view.x), cz = Math.round(view.z);
  let full = !phone.wild || phone.wildTick <= 0;
  if (full) phone.wildTick = WILD_EVERY;
  phone.wildTick--;
  w.u8(1); const flagsAt = w.at; w.u8(0); w.u32(n); w.u32(step); w.i32(cx); w.i32(cz);
  let flags = 0;

  const countAt = w.at; w.u8(0); let count = 0;
  const truth = phone.debug ? { tr: [], wd: [] } : null;
  /* PLAY MODE: phone.me = the room's player record for a player. */
  const mine = phone.me ? phone.me.id : -1;
  for (const t of sim.rivals) {
    let seen = t.id === phone.watch || t.id === mine || near(view, t.x, t.z);
    if (!seen && !(t.dead > 0)) for (const f of t.followers) if (near(view, f.x, f.z)) { seen = true; break; }
    if (!seen) continue;
    const had = phone.sent.get(t.id);
    const fresh = !had || had.runs !== t.runs;
    /* The path, thinned to a point every PATH_STEP units: the oldest point
       first when the phone has none, then whatever is new since. */
    let last = fresh ? -Infinity : had.s;
    const pts = [];
    for (const q of t.trail) { if (q.s < last + PATH_STEP) continue; pts.push(q); last = q.s; }
    phone.sent.set(t.id, { runs: t.runs, s: last });
    w.u8(t.id);
    w.u8((fresh ? 1 : 0) | (t.bursting ? 2 : 0) | (t.dead > 0 ? 4 : 0));
    w.i16(t.x - cx); w.i16(t.z - cz); w.u8(ang(t.head)); w.i32(s16(t.s)); w.u16(t.followers.length);
    if (fresh) { const k = KINDS.indexOf(t.kind || 'bot'); w.u8(k < 0 ? 0 : k); w.u16(t.runs); }
    w.u16(pts.length);
    let ps = 0;
    pts.forEach((q, i) => {
      w.i16(q.x - cx); w.i16(q.z - cz); w.u8(ang(q.h));
      const s = s16(q.s);
      if (i === 0) w.i32(s); else w.u16(s - ps);
      ps = s;
    });
    count++;
    if (truth) truth.tr.push({ id: t.id, x: t.x, z: t.z, f: t.followers.map(f => [f.x, f.z]) });
  }
  w.put8(countAt, count);

  const evAt = w.at; w.u8(0); let ne = 0;
  for (const e of events) if ((e.kind === 'crash' || e.kind === 'cut') && near(view, e.x, e.z) && ne < 255) {
    const by = e.kind === 'cut' ? e.by : e.id;
    w.u8(e.kind === 'cut' ? 1 : 0); w.i16(e.x - cx); w.i16(e.z - cz); w.u8(Number.isInteger(by) && by >= 0 && by < 255 ? by : 255); ne++;
  }
  w.put8(evAt, ne);

  /* The board, whole, but only when it has changed since this phone's last. */
  const bd = sim.rivals.map(t => [t.id, t.dead > 0 ? 0 : t.followers.length]).sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 10);
  const key = bd.join(';');
  if (key !== phone.board) {
    flags |= 1; phone.board = key;
    w.u8(bd.length); for (const [id, len] of bd) { w.u8(id); w.u16(len); }
  }

  /* Wild mantas near the view: what the phone knows is phone.wild, slot ->
     {fc: flags and colour, and the last two samples it was sent}. In full
     every WILD_EVERY snapshots; between them only the ones that appeared,
     changed or left, AND any that has strayed more than WILD_TOL from where
     the phone will carry it on from its last two samples (the same rule as
     createWildStore): a manta turning hard is sent again at once, so what
     is drawn stays within a few units of the room. */
  const time = step / 60;
  const carried = e => {
    if (e.t0 === null || e.t0 === undefined) return [e.x1, e.z1];
    const dt = e.t1 - e.t0;
    if (!(dt > 0 && dt <= 0.5) || Math.abs(e.x1 - e.x0) + Math.abs(e.z1 - e.z0) >= 300) return [e.x1, e.z1];
    const g = Math.min(time - e.t1, 0.3) / dt;
    return [e.x1 + (e.x1 - e.x0) * g, e.z1 + (e.z1 - e.z0) * g];
  };
  /* A slot is refilled with a NEW manta object when one is recruited or
     sinks away (sim.js spawnWild), so the phone's samples are per object:
     a new one in an old slot is sent as that slot gone and a manta
     appearing, never as the old one jumping. */
  const keep = (i, fc, m) => {
    const old = phone.wild.get(i), same = old && old.obj === m;
    const e = same ? old : { obj: m, fc, t0: null, x0: 0, z0: 0, t1: null, x1: 0, z1: 0 };
    e.fc = fc;
    if (e.t1 !== time) { e.t0 = e.t1; e.x0 = e.x1; e.z0 = e.z1; }
    e.t1 = time; e.x1 = cx + i16(m.x - cx); e.z1 = cz + i16(m.z - cz);
    phone.wild.set(i, e);
  };
  const now = new Map();
  for (let i = 0; i < sim.wild.length; i++) {
    const m = sim.wild[i];
    if (!m || !m.alive || !near(view, m.x, m.z)) continue;
    const fl = (m.loose ? 1 : 0) | (m.sinking > 0 ? 2 : 0), col = m.glow > 0 && m.wasColour >= 0 ? m.wasColour & 255 : 255;
    now.set(i, [m, fl, col]);
    if (truth) truth.wd.push([i, m.x, m.z]);
  }
  const rec = (i, [m, fl, col]) => { w.u16(i); w.i16(m.x - cx); w.i16(m.z - cz); w.u8(ang(m.head)); w.u8(fl); w.u8(col); };
  if (full) {
    flags |= 2;
    w.u16(now.size); for (const [i, r] of now) rec(i, r);
    const was = phone.wild || new Map(), replaced = [];
    phone.wild = new Map();
    for (const [i, r] of now) {
      const e = was.get(i);
      if (e && e.obj !== r[0]) replaced.push(i);
      else if (e) phone.wild.set(i, e);
      keep(i, r[1] * 256 + r[2], r[0]);
    }
    if (replaced.length) { flags |= 4; w.u16(0); w.u16(replaced.length); for (const i of replaced) w.u16(i); }
  } else {
    const changed = [], gone = [];
    for (const [i, r] of now) {
      const e = phone.wild.get(i), is = r[1] * 256 + r[2];
      if (e && e.obj !== r[0]) { gone.push(i); phone.wild.delete(i); }
      const k = phone.wild.get(i);
      let send = !k || k.fc !== is;
      if (!send) { const [x, z] = carried(k); send = Math.hypot(x - r[0].x, z - r[0].z) > WILD_TOL; }
      if (send) { changed.push(i); keep(i, is, r[0]); }
    }
    for (const i of phone.wild.keys()) if (!now.has(i)) gone.push(i);
    for (const i of gone) if (!now.has(i)) phone.wild.delete(i);
    if (changed.length || gone.length) {
      flags |= 4;
      w.u16(changed.length); for (const i of changed) rec(i, now.get(i));
      w.u16(gone.length); for (const i of gone) w.u16(i);
    }
  }
  /* PLAY MODE (flag 8): the player's own leader, true and unrounded
     enough to predict from, and its clock: how early its inputs arrived
     (the worst since the last snapshot, with the newest seq that covers),
     how many came too late for their step. The wreck's place only while
     dead, the peak only when it moved, ack only for tests. */
  const t = phone.me ? sim.rivals.find(o => o.id === mine) : null;
  if (t) {
    const q = phone.me, peak = t.peak !== phone.mePeak, early = q.early !== null && q.early !== undefined;
    flags |= 8;
    w.u8((t.dead > 0 ? 1 : 0) | (t.bursting ? 2 : 0) | (peak ? 4 : 0) | (early ? 8 : 0) | (q.late ? 16 : 0) | (phone.debug ? 32 : 0));
    w.f32(t.x); w.f32(t.z); w.f32(t.head); w.i32(s16(t.s)); w.u16(t.followers.length); w.u16(t.runs);
    if (t.dead > 0) { w.f32(t.dead); w.i16(t.crashX - cx); w.i16(t.crashZ - cz); }
    if (peak) { w.u16(t.peak); phone.mePeak = t.peak; }
    if (early) { w.i16(Math.round(q.early * 10)); w.u32(q.earlySeq); q.early = null; }
    if (q.late) { w.u16(q.late); q.late = 0; }
    if (phone.debug) w.u32(q.ack);
  }
  w.put8(flagsAt, flags);
  return { data: w.done(), truth };
}

/* The phone's side: a binary snapshot as the object the mirror and the
   page read. Positions come back absolute, whole units; time is the room's
   step on its 60 Hz clock. */
export function decodeSnap (buf) {
  const dv = new DataView(buf); let o = 0;
  const u8 = () => dv.getUint8(o++);
  const u16 = () => { const v = dv.getUint16(o, true); o += 2; return v; };
  const i16 = () => { const v = dv.getInt16(o, true); o += 2; return v; };
  const i32 = () => { const v = dv.getInt32(o, true); o += 4; return v; };
  const u32 = () => { const v = dv.getUint32(o, true); o += 4; return v; };
  if (u8() !== 1) return null;
  const flags = u8(), n = u32(), k = u32(), cx = i32(), cz = i32();
  const tr = [];
  for (let c = u8(); c > 0; c--) {
    const id = u8(), f = u8();
    const q = { id, x: cx + i16(), z: cz + i16(), h: unang(u8()), s: i32() / 16, len: u16(), pts: [] };
    if (f & 1) { q.fresh = 1; q.kind = KINDS[u8()] || 'bot'; q.runs = u16(); }
    if (f & 2) q.b = 1;
    if (f & 4) q.dead = 1;
    let ps = 0;
    for (let i = 0, np = u16(); i < np; i++) {
      const x = cx + i16(), z = cz + i16(), h = unang(u8());
      ps = i === 0 ? i32() : ps + u16();
      q.pts.push([x, z, h, ps / 16]);
    }
    tr.push(q);
  }
  const ev = [];
  for (let c = u8(); c > 0; c--) { const kind = u8(); const e = { k: kind === 1 ? 'cut' : 'crash', x: cx + i16(), z: cz + i16() }, by = u8(); e.by = by === 255 ? -1 : by; ev.push(e); }
  const m = { t: 'snap', n, k, time: k / 60, tr, ev };
  if (flags & 1) { m.bd = []; for (let c = u8(); c > 0; c--) { const id = u8(); m.bd.push([id, u16()]); } }
  const rec = () => { const slot = u16(), x = cx + i16(), z = cz + i16(), h = unang(u8()), fl = u8(), col = u8(); return [slot, x, z, h, fl, col === 255 ? -1 : col]; };
  if (flags & 2) { m.wd = []; for (let c = u16(); c > 0; c--) m.wd.push(rec()); }
  if (flags & 4) { m.wa = []; for (let c = u16(); c > 0; c--) m.wa.push(rec()); m.wg = []; for (let c = u16(); c > 0; c--) m.wg.push(u16()); }
  if (flags & 8) {
    const f32 = () => { const v = dv.getFloat32(o, true); o += 4; return v; };
    const f = u8(), me = { x: f32(), z: f32(), h: f32(), s: i32() / 16, len: u16(), runs: u16() };
    if (f & 1) { me.dead = f32(); me.crashX = cx + i16(); me.crashZ = cz + i16(); }
    if (f & 2) me.b = 1;
    if (f & 4) me.peak = u16();
    if (f & 8) { m.e = i16() / 10; m.eq = u32(); }
    if (f & 16) m.l = u16();
    if (f & 32) me.ack = u32();
    m.me = me;
  }
  return m;
}

/* The wild mantas a phone knows, smoothed. Full lists come five times a
   second; changes (appearing, sinking, glowing, leaving) at once. Each
   manta keeps its samples from the last 1.5 s; at a moment T it is drawn
   between the two either side, or carried on from the last two for up to
   0.3 s when T is newer than both. It is in the water from its first sample
   to the moment it was said to be gone.
   3G: ONE ENTRY PER MANTA, NOT PER SLOT. A slot refilled by a new manta
   used to throw the old one's entry away at once, so the old manta
   vanished a render delay early; now each occupant keeps its own entry
   until it is gone at the drawn moment too, and out() is told which
   occupant (gen) it is drawing, so the page can start a new one's glow
   afresh rather than carry on the last one's. */
export const WILD_KEEP = 1.5;            // seconds of samples kept a manta
export function createWildStore () {
  const all = new Map();                   // slot -> [{ pts: [[time, x, z, h, flags, colour]], from, to, gen }], oldest first
  let gens = 0;
  function sample (time, r) {
    let list = all.get(r[0]);
    if (!list) { list = []; all.set(r[0], list); }
    let e = list[list.length - 1];
    if (!e || e.to <= time) { e = { pts: [], from: time, to: Infinity, gen: ++gens }; list.push(e); }
    e.pts.push([time, r[1], r[2], r[3], r[4], r[5]]);
    while (e.pts.length > 2 && time - e.pts[1][0] > WILD_KEEP) e.pts.shift();
  }
  const live = slot => { const list = all.get(slot); const e = list && list[list.length - 1]; return e && e.to === Infinity ? e : null; };
  function take (m) {
    /* Gone first: a slot gone and appearing in one snapshot is a new manta. */
    if (m.wg) for (const slot of m.wg) { const e = live(slot); if (e) e.to = m.time; }
    if (m.wd) {
      const listed = new Set();
      for (const r of m.wd) { sample(m.time, r); listed.add(r[0]); }
      for (const slot of all.keys()) if (!listed.has(slot)) { const e = live(slot); if (e) e.to = m.time; }
    }
    if (m.wa) for (const r of m.wa) sample(m.time, r);
  }
  /* Where each manta is at T: calls out(slot, x, z, h, flags, colour, gen). */
  function at (T, out) {
    for (const [slot, list] of all) {
      while (list.length && list[0].to <= T - 2) list.shift();
      if (!list.length) { all.delete(slot); continue; }
      for (const e of list) {
        if (T < e.from || T >= e.to) continue;
        const p = e.pts;
        let i = p.length - 1; while (i > 0 && p[i][0] > T) i--;
        const a = p[i], b = p[i + 1];
        let x = a[1], z = a[2], h = a[3];
        if (b && b[0] > a[0] && Math.abs(b[1] - a[1]) + Math.abs(b[2] - a[2]) < 300) {
          const f = Math.max(0, Math.min(1, (T - a[0]) / (b[0] - a[0])));
          x += (b[1] - a[1]) * f; z += (b[2] - a[2]) * f;
          h = a[3] + Math.atan2(Math.sin(b[3] - a[3]), Math.cos(b[3] - a[3])) * f;
        } else if (!b && i > 0) {
          const o = p[i - 1], dt = a[0] - o[0];
          if (dt > 0 && dt <= 0.5 && Math.abs(a[1] - o[1]) + Math.abs(a[2] - o[2]) < 300) {
            const g = Math.min(T - a[0], 0.3) / dt;
            x += (a[1] - o[1]) * g; z += (a[2] - o[2]) * g;
          }
        }
        out(slot, x, z, h, a[4], a[5], e.gen);
        break;
      }
    }
  }
  return { take, at, clear: () => all.clear(), get size () { return all.size; } };
}

/* How a drawn wild manta looks this frame: loose, sinking and glowing come
   as flags and count down here. A new occupant of the slot (a new gen)
   starts its own glow and sink from the top, never the last one's (3G). */
export function wildLook (w, fl, col, gen, dt, params) {
  if (w.gen !== gen) { w.gen = gen; w.glow = 0; w.sinking = 0; w.wasColour = -1; }
  w.loose = !!(fl & 1);
  w.sinking = fl & 2 ? (w.sinking > 0 ? Math.max(0.05, w.sinking - dt) : params.drain) : 0;
  if (col >= 0) { w.wasColour = col; w.glow = w.glow > 0 ? Math.max(0.05, w.glow - dt) : params.scatterGlow; }
  else w.glow = 0;
  return w;
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
