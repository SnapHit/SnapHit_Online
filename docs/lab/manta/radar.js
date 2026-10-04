/* THE RADAR (3L, design doc 7.1 and 10.6): a small circular map of the
 * whole arena, bottom right, every train live as a line along its path in
 * its own colour with a dot at its leader, so you can hunt or evade. Full
 * information, by Nathan's decision; the "range for smaller trains" setting
 * is there to test against it.
 *
 * Interface, not light: a 2D canvas over the page, never in the WebGL
 * scene, so vertex buffers stay at 6 of 8. Pointer events pass through it,
 * so a touch over it still steers and bursts. The four-conditions harness
 * hides #radar as it hides the labels. North up and fixed: the camera
 * never rotates. The rim is the reef line.
 *
 * The model is shared with the tests (Node): positions come as samples
 * (5 Hz from a room, every frame in solo), and a head is drawn SMOOTHLY
 * between the last two samples, a sample behind the latest. A train's line
 * is its leader's path at RADAR_RES units a point, trimmed to its length
 * times the follower spacing: in solo straight from the simulation's trail,
 * in a room the path the room sends on joining plus the leader's samples
 * since. A new run (runs changes) starts a new line, never a line across
 * the jump; a crashed train is not drawn; a cut shortens the trim. */
export const RADAR_RES = 60;             // units between path points (P)
export const RADAR_BEHIND = 220;         // ms behind the latest sample a room's heads are drawn

export function createRadarModel () {
  const trains = new Map();              // id -> { x, z, len, alive, runs, path: [x, z, ...] (oldest first), a: [t, x, z], b: [t, x, z], instant }
  function get (id) { let t = trains.get(id); if (!t) { t = { x: 0, z: 0, len: 0, alive: false, runs: undefined, path: [], a: null, b: null, instant: false }; trains.set(id, t); } return t; }
  /* The path trimmed to the train's length, from the newest point back. */
  function trim (t, spacing) {
    const keep = t.len * spacing + RADAR_RES; let acc = 0, i = t.path.length - 2;
    while (i >= 2) { acc += Math.hypot(t.path[i] - t.path[i - 2], t.path[i + 1] - t.path[i - 1]); if (acc > keep) break; i -= 2; }
    if (i > 0) t.path.splice(0, i);
  }
  return {
    trains,
    /* A path the room sends on joining: newest point first. */
    setPath (id, runs, pts) { const t = get(id); t.runs = runs; t.path = []; for (let i = pts.length - 2; i >= 0; i -= 2) t.path.push(pts[i], pts[i + 1]); },
    /* A sample: a room's 5 Hz report, or the simulation each frame (instant). */
    update (id, x, z, len, alive, runs, tMs, spacing, instant = false) {
      const t = get(id);
      if (t.runs !== runs || !alive) { if (t.runs !== runs) t.path = []; t.a = t.b = null; }
      t.runs = runs; t.len = len; t.alive = !!alive; t.instant = instant; t.x = x; t.z = z;
      if (!alive) return t;
      const n = t.path.length;
      if (n < 2 || Math.hypot(x - t.path[n - 2], z - t.path[n - 1]) >= RADAR_RES) t.path.push(x, z);
      trim(t, spacing);
      t.a = t.b; t.b = [tMs, x, z];
      return t;
    },
    remove (id) { trains.delete(id); },
    /* Solo: the path straight from the simulation's trail ({x, z, s}), at
       RADAR_RES units a point back to the train's length, oldest first. */
    pathFromTrail (id, trail, len, spacing) {
      const t = get(id), out = []; let need = trail.length ? trail[trail.length - 1].s : 0; const keep = len * spacing + RADAR_RES, s0 = need;
      for (let i = trail.length - 1; i >= 0; i--) { const q = trail[i]; if (s0 - q.s > keep) break; if (q.s <= need) { out.push(q.x, q.z); need -= RADAR_RES; } }
      t.path = []; for (let i = out.length - 2; i >= 0; i -= 2) t.path.push(out[i], out[i + 1]);
    },
    /* Where a train's head is drawn at nowMs. */
    headAt (t, nowMs) {
      if (t.instant || !t.a || !t.b) return [t.x, t.z];
      const T = nowMs - RADAR_BEHIND;
      if (T >= t.b[0]) return [t.b[1], t.b[2]];
      const f = Math.max(0, Math.min(1, (T - t.a[0]) / Math.max(1, t.b[0] - t.a[0])));
      return [t.a[1] + (t.b[1] - t.a[1]) * f, t.a[2] + (t.b[2] - t.a[2]) * f];
    },
  };
}

/* The canvas. size: CSS px of the disc; opacity: the disc's; arenaR: units;
   you: { id, x, z, len } (the watched train, watching) or null; view: { w, h }
   units; colourOf(id): a CSS colour; range: 0, or the units within which a
   train shorter than yours shows. */
export function createRadar () {
  const cv = document.createElement('canvas');
  cv.id = 'radar'; cv.setAttribute('aria-hidden', 'true');
  cv.style.cssText = 'position:fixed;z-index:3;pointer-events:none;right:calc(env(safe-area-inset-right,0px) + 10px);' +
    'bottom:calc(env(safe-area-inset-bottom,0px) + var(--radar-bottom, 10px));width:120px;height:120px';
  document.body.appendChild(cv);
  let cssSize = 0, dpr = 0, lastMs = 0, drawnCount = 0;
  const g = cv.getContext('2d');
  function draw (model, o, nowMs) {
    const t0 = performance.now();
    const size = o.size, pr = Math.min(3, window.devicePixelRatio || 1);
    if (size !== cssSize || pr !== dpr) { cssSize = size; dpr = pr; cv.style.width = cv.style.height = size + 'px'; cv.width = cv.height = Math.round(size * pr); }
    const s = cv.width, c = s / 2, R = c - 1.5 * pr, scale = R / Math.max(1, o.arenaR);
    const X = x => c + x * scale, Z = z => c + z * scale;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, s, s);
    g.beginPath(); g.arc(c, c, R, 0, Math.PI * 2);
    g.fillStyle = 'rgba(4,9,18,' + o.opacity + ')'; g.fill();
    g.lineWidth = 1 * pr; g.strokeStyle = 'rgba(230,241,251,0.55)'; g.stroke();
    g.save(); g.beginPath(); g.arc(c, c, R, 0, Math.PI * 2); g.clip();
    const you = o.you, yourLen = you ? you.len : 0; drawnCount = 0; let hidden = 0;
    const line = (t, head, width, alpha, col, dot) => {
      g.strokeStyle = col; g.globalAlpha = alpha; g.lineWidth = width * pr; g.lineCap = 'round'; g.lineJoin = 'round';
      const p = t.path;
      if (p.length >= 2) { g.beginPath(); g.moveTo(X(p[0]), Z(p[1])); for (let i = 2; i < p.length; i += 2) g.lineTo(X(p[i]), Z(p[i + 1])); g.lineTo(X(head[0]), Z(head[1])); g.stroke(); }
      g.fillStyle = col; g.beginPath(); g.arc(X(head[0]), Z(head[1]), dot * pr / 2, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 1;
    };
    for (const [id, t] of model.trains) {
      if (!t.alive || (you && id === you.id)) continue;
      if (o.range > 0 && you && t.len < yourLen && Math.hypot(t.x - you.x, t.z - you.z) > o.range) { hidden++; continue; }
      line(t, model.headAt(t, nowMs), 1.5, 0.9, o.colourOf(id), 3); drawnCount++;
    }
    if (you) {
      const t = model.trains.get(you.id);
      const head = t ? model.headAt(t, nowMs) : [you.x, you.z];
      if (t && t.alive) { line(t, head, 2, 1, o.colourOf(you.id), 4); drawnCount++; g.strokeStyle = 'rgba(230,241,251,0.9)'; g.lineWidth = 1 * pr; g.beginPath(); g.arc(X(head[0]), Z(head[1]), 3 * pr, 0, Math.PI * 2); g.stroke(); }
      /* Your view, faint. */
      g.strokeStyle = 'rgba(230,241,251,0.35)'; g.lineWidth = 1 * pr;
      g.strokeRect(X(you.x - o.view.w / 2), Z(you.z - o.view.h / 2), o.view.w * scale, o.view.h * scale);
    }
    /* THE WHALE SHARK (4A stage 5): a dark-grey capsule from head to tail,
       its true width at radar scale, from the moment it appears. */
    if (o.shark) { g.globalAlpha = 0.85; g.strokeStyle = 'rgba(150,160,172,0.9)'; g.lineCap = 'round'; g.lineWidth = Math.max(2, o.shark.w * scale) ; g.beginPath(); g.moveTo(X(o.shark.t.x), Z(o.shark.t.z)); g.lineTo(X(o.shark.x), Z(o.shark.z)); g.stroke(); g.globalAlpha = 1; }
    /* THE PINK MANTA (4A stage 4): a pink dot from the moment it appears, so
       everyone sees the chase; last, so nothing covers it. */
    if (o.pink) { g.globalAlpha = 1; g.fillStyle = '#ff5fb7'; g.beginPath(); g.arc(X(o.pink.x), Z(o.pink.z), 2.2 * pr, 0, Math.PI * 2); g.fill(); g.strokeStyle = 'rgba(255,230,245,0.8)'; g.lineWidth = 0.8 * pr; g.stroke(); }
    g.restore();
    lastMs = performance.now() - t0;
    return { scale: scale / pr, centre: c / pr, drawn: drawnCount, hidden, range: o.range, yourLen, ms: lastMs };
  }
  return { draw, canvas: cv, get ms () { return lastMs; } };
}
