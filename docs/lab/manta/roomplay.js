/* Play mode (?room=<name>&play=1): the player's own manta in a room.
 *
 * Imported only by roomview.js, and only used when &play=1 is in the URL, so
 * watch mode and the solo lab never run a line of it. No DOM: the Node tests
 * drive this same file.
 *
 * WHY THE LEADER IS PREDICTED. The room is the truth, but its answer is a
 * round trip old: steering that waited for it would feel like swimming in
 * syrup. So the phone steps its own leader the instant the finger moves,
 * with the simulation's own motion code (motion.js, the same advance, hold
 * and recordTrail the room's stepTrain uses) at the same fixed 1/60 steps.
 *
 * INPUTS ON THE ROOM'S CLOCK (3E). Every step here is numbered on the room's
 * own count, and every input names the step it is for. The phone runs a
 * little ahead of the room: its estimate of the step the room will be at
 * when an input sent now arrives (each snapshot's step plus the measured
 * round trip) plus a small lead for the jitter, so an input
 * reaches the room just before its step runs. The room applies it at that
 * step and says how early it arrived; the lead grows when inputs come too
 * close and shrinks slowly when they are needlessly early. 3D applied inputs
 * when they arrived, so the room's steering never lined up with the phone's
 * and every snapshot corrected the leader by 10 to 20 units.
 *
 * WHY IT IS RECONCILED, NOT TRUSTED. Every snapshot carries `me`, the room's
 * true state of this leader after step k. The prediction restarts from that
 * truth and replays this phone's own steps k+1 onward with the inputs it
 * gave them, which are the ones the room will apply. When they arrived in
 * time the replay lands exactly where the prediction already was; a crash,
 * the reef or a late input shows as a correction for one snapshot at most.
 *
 * WHY IT EASES. A correction drawn as a jump twenty times a second would
 * shimmer, so the difference is kept as a visual offset that shrinks to
 * nothing over 150 ms. A difference over 60 units is not a correction but a
 * different place (a restart, a reconnect, a long stall), and easing across
 * it would draw a manta swimming through things it never touched, so it
 * snaps.
 */
import { createMotion } from './motion.js';

const STEP = 1 / 60, STEP_MS = 1000 / 60;
const EASE = 0.15;                 // seconds for a correction to fade out
const SNAP = 60;                   // units: a bigger correction is drawn at once
const HIST = 256;                  // numbered local steps remembered (4 s)
const MAX_REPLAY = 120;            // steps: a longer replay means the clock is lost
/* FEWER MESSAGES (4B, design doc 10.6). On Cloudflare's free plan every
   incoming message is a twentieth of a billed request, and they run out
   first, so steering goes only when it has changed by a noticeable step
   (STEER_STEP, about three degrees): ordinary changes at most every GAP (10
   a second), and at least every BEAT one goes anyway (2 a second, well
   inside the room's 2 s away rule), carrying the exact heading, so one held
   a hair off is put right within half a second. A burst pressed or let go,
   a finger put down or lifted, and a sharp turn (SHARP, about 30 degrees)
   go at once, whatever the gap. Each message carries every step's input
   since the last: the phone steers only with what it has sent (frame(): a
   step uses sentWant), so every step between two messages had the input
   the first one named, from the step it named. Until 4B: every change of
   0.02 rad, every 50 ms at most, every 200 ms at least. */
const GAP = 100, BEAT = 500, STEER_STEP = 0.05, SHARP = 0.5;
const CAP = 16;                    // this phone's play messages in any second, of every kind: the room closes at 30, and the page's own (hello, name, away) are rare
/* The view and the ping (4B), sent from here in play rather than by the
   page: the room centres a player's view on its own leader, so only the
   view's size goes, when it changes by VIEW_GROW (the 400-unit margin
   covers far more), at most every VIEW_GAP; and the round trip's ping rides
   on a steering message once a second, alone only when none has for
   PING_ALONE. Every one of these counts against CAP. Until 4B: a view up
   to five times a second and a ping a second, six messages a second before
   any steering. */
const VIEW_GROW = 0.04, VIEW_GAP = 250, PING_EVERY = 1000, PING_ALONE = 1500;
const MSG_MAX = 64;                // bytes: the room's limit (worker.js)
const LEAD0 = 3;                   // steps ahead of the room to start with
const MARGIN = 1;                  // steps early an input should arrive, at worst
const SLEW = 0.1;                  // steps a frame the clock may be pulled
const WINDOW = 1500;               // ms of reports the lead is judged on
const LEAD_MAX = 45;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const r4 = v => Math.round(v * 1e4) / 1e4;

export function createPlay ({ room, params, core, you, input, send: wire, rtt, view, viewNow = null, now = () => performance.now() }) {
  const motion = createMotion(params);
  /* 3G: tokens became twelve hex digits, so the key changed with them and
     a stale 32-digit token cannot stick. */
  const KEY = 'manta:room-key:' + room;
  /* The predicted leader. Its trail is the room's path for this train up to
     the last true point, then the points this phone predicted beyond it, so
     placeFollowers lays the whole train along one unbroken path. */
  const pred = { x: 0, z: 0, head: 0, s: 0, turn: 0, bursting: false, trail: [], followers: [] };
  const hist = new Map();          // step -> {want, burst}: what this phone gave that step
  const corrections = [];          // units, one per snapshot with `me` while predicting
  const off = { x: 0, z: 0, h: 0, f: [], age: EASE };
  let myId = -1, name = null, me = null, ack = 0, seq = 0, runs = null;
  let sentWant = null, sentBurst = false, sentAt = -1e9, live = false, fresh = true;
  /* Every message this phone's play sends, for the cap; when the last ping
     went; the view's size as last sent. */
  const sentTimes = []; let pingAt = -1e9, aloneAt = -1e9, sampleAt = -1e9, viewAt = -1e9, sentView = null, viewDirty = true;
  const send = m => { sentTimes.push(now()); if (sentTimes.length > CAP + 4) sentTimes.shift(); wire(m); };
  const roomFor = t => { let n = 0; for (const v of sentTimes) if (t - v < 1000) n++; return n < CAP; };
  /* The ping's stamp: whole milliseconds, modulo a million so it stays
     short. Rounded down, never up: a stamp a fraction of a millisecond
     ahead of the clock made a round trip under half a millisecond (a room
     on the same machine) come back as a million. */
  const stamp = () => Math.floor(now()) % 1e6;
  /* THE RESTART GAP (3F). An offset may only be taken from a `you` that a
     frame has drawn from this prediction. At 300 ms and a few frames a
     second, two snapshots could arrive between frames just after a
     restart: the first snapped the prediction to the new place, and the
     second, taking that for a small correction, eased from the leader
     still drawn where the old run ended (frozen through the death beat,
     its followers cleared). The leader was then drawn 8 to 26 units away
     from its own followers, fading over a few frames. shown is set only
     once frame() has written `you` from pred, and cleared by every snap. */
  let shown = false;
  /* The clock: est is the room's step less now/STEP_MS, smoothed; clk is the
     offset this phone runs on, pulled towards est + lead; pk the last step
     simulated here. */
  let est = null, lead = LEAD0, clk = null, pk = -1, settled = true, leadSeq = 0;
  let reports = [], late = 0, reported = 0, leadMoves = 0;
  /* 3G: round trips seen lately, and the one the clock uses. A single
     sample far outside their spread (one late pong) is not believed: it
     moved the clock 30 steps at once, so the manta jumped ahead and later
     sat still while the clock came back. */
  const rtts = []; let lastRtt = null, rttUse = null, outliers = 0, rttIgnored = 0;
  function takeRtt (r) {
    if (r === null || r === undefined || r === lastRtt) return;
    lastRtt = r; sampleAt = now();
    if (rtts.length >= 3) {
      const sorted = rtts.slice().sort((a, b) => a - b), med = sorted[sorted.length >> 1];
      const mad = sorted.map(v => Math.abs(v - med)).sort((a, b) => a - b)[sorted.length >> 1];
      /* Far outside: past the median by three spreads and 60 ms. Three in a
         row are the link itself changing, and are believed. */
      if (Math.abs(r - med) > Math.max(60, 3 * mad) && outliers < 2) { outliers++; rttIgnored++; return; }
    }
    outliers = 0;
    rtts.push(r); if (rtts.length > 9) rtts.shift();
    const sorted = rtts.slice().sort((a, b) => a - b);
    rttUse = sorted[sorted.length >> 1];
  }

  function readToken () { try { const t = sessionStorage.getItem(KEY); return /^[0-9a-f]{12}$/.test(t || '') ? t : undefined; } catch (_) { return undefined; } }
  function keepToken (t) { try { if (t) sessionStorage.setItem(KEY, t); } catch (_) { /* play on without it */ } }

  /* ------------------------------------------------------------ the wire */
  const hello = () => { const h = { p: 1 }, t = readToken(); if (t) h.k = t; return h; };

  function onInit (m) {
    /* A new connection resends every path and may be a new room clock, so
       the next snapshot is a fresh start, not a correction to ease into. */
    fresh = true; live = false; shown = false; me = null; est = null; clk = null; pk = -1; hist.clear();
    reports = []; settled = true; leadSeq = seq; viewDirty = true;
    /* Seated afresh, the room's train holds no input (rooms/ocean.js seat):
       predict the same until this phone's first input, and send that at
       once rather than at the next beat. */
    sentWant = null; sentBurst = false; sentAt = -1e9;
    if (!m.me) return;
    myId = m.me.id; name = m.me.name || null; keepToken(m.me.token);
    you.id = myId; you.watched = myId;
  }

  /* The rules above (FEWER MESSAGES), checked once a frame. The room keeps
     the last input, so silence is not a loss; the beat keeps the earliness
     reports and d current. The input is for step k, the first this phone
     has not simulated yet, and holds from there until the next. */
  function maybeSend (t, connected, frameMs, k) {
    if (!connected || myId < 0) return;
    const since = t - sentAt;
    const w = input.want === null || input.want === undefined ? null : r4(wrap(input.want)), b = !!input.burst;
    const turn = w === null || sentWant === null ? 0 : Math.abs(wrap(w - sentWant));
    const urgent = b !== sentBurst || (w === null) !== (sentWant === null) || turn >= SHARP;
    /* A frame early rather than a frame late: checked once a frame, the beat
       must not slip past BEAT waiting for the next one. */
    const go = roomFor(t) && (urgent || (turn >= STEER_STEP && since >= GAP) || since + frameMs > BEAT);
    if (!go) return;
    seq++; sentWant = w; sentBurst = b; sentAt = t;
    /* d: how many steps behind this one the other trains are drawn here. */
    const v = view ? view() : null, m = { t: 'in', seq, k, w };
    if (b) m.b = 1;
    if (v !== null && v !== undefined) m.d = Math.max(0, Math.round(k - v));
    /* The ping rides along once a second, when it fits in the room's 64 bytes. */
    if (t - pingAt >= PING_EVERY) { m.c = stamp(); if (JSON.stringify(m).length <= MSG_MAX) pingAt = t; else delete m.c; }
    send(m);
  }

  /* The page calls this once a frame while connected, in play, in place of
     its own view and ping (roomview.js tick): the view's size when it has
     changed (the room centres it on this phone's leader), and a ping alone
     only when no steering message has carried one for PING_ALONE (before
     the first input, and while the clock is not running). */
  function tick () {
    const t = now();
    const v = viewNow ? viewNow() : null;
    if (v && myId >= 0) {
      const grown = !sentView || Math.abs(v.w - sentView.w) > sentView.w * VIEW_GROW || Math.abs(v.h - sentView.h) > sentView.h * VIEW_GROW;
      if ((viewDirty || grown) && t - viewAt >= VIEW_GAP && roomFor(t)) {
        send({ t: 'view', x: Math.round(v.x), z: Math.round(v.z), w: Math.round(v.w), h: Math.round(v.h), a: myId });
        sentView = v; viewAt = t; viewDirty = false;
      }
    }
    /* Alone only when no round trip has come back lately: a ping riding on
       an input the room refused gets no answer. */
    if (t - Math.max(sampleAt, aloneAt) >= PING_ALONE && roomFor(t)) { send({ t: 'ping', c: stamp() }); aloneAt = pingAt = t; }
  }

  /* One step of the leader, exactly as the room steps a player's train:
     burst only with a follower to pay with, steer then swim, the reef
     holds, the path records. (What a burst costs is the room's business:
     `len` says.) */
  function simulate (h) {
    pred.bursting = h.burst && pred.followers.length > 0;
    const fx = pred.x, fz = pred.z, s0 = pred.s;
    const moved = motion.advance(pred, h.want, STEP);
    motion.hold(pred, fx, fz, s0);
    motion.recordTrail(pred, moved);
  }
  const given = k => hist.get(k) || { want: sentWant, burst: sentBurst };

  /* ------------------------------------------------------------ the clock */
  function onSnap (m) {
    if (typeof m.k !== 'number' || myId < 0) return;
    const t = now(); takeRtt(rtt()); const r = rttUse;
    /* The step an input sent now would arrive at: this snapshot's step,
       plus the half round trip it took to get here, plus the half an input
       takes to get back. Not before a round trip is known: a guess of zero
       would put every input late for its first second. */
    if (r !== null && r !== undefined) {
      const sample = m.k + r / STEP_MS - t / STEP_MS;
      est = est === null ? sample : est + 0.1 * (sample - est);
    }
    if (typeof m.e === 'number') { reported++; if (m.eq > leadSeq && settled) reports.push([t, m.e]); }
    if (m.l) late += m.l;
    judgeLead(t);
    if (m.me) reconcile(m.me, m.k);
  }

  /* The lead: up at once by what the worst input missed the margin by, down
     by half a step when a whole second of reports was needlessly early.
     Reports about inputs sent before the clock settled on a new lead are
     not counted, or one late burst would be answered twice. */
  function judgeLead (t) {
    while (reports.length && t - reports[0][0] > WINDOW) reports.shift();
    if (!reports.length || !settled) return;
    let lo = Infinity; for (const q of reports) lo = Math.min(lo, q[1]);
    /* Small steps (3G): a step up at most, a half step down, so the clock
       is only ever nudged and the manta never visibly hurries or waits. */
    if (lo < MARGIN) moveLead(Math.min(LEAD_MAX, lead + Math.min(1, MARGIN - lo + 0.5)));
    else if (lo > MARGIN + 2.5 && t - reports[0][0] > 1000) moveLead(Math.max(0, lead - 0.5));
  }
  function moveLead (v) { lead = v; leadMoves++; reports = []; settled = false; }

  /* ----------------------------------------------------- reconciliation */
  function place () { if (pred.followers.length) motion.placeFollowers(pred); }

  function reconcile (m, K) {
    me = m;
    if (m.ack !== undefined) ack = m.ack;
    const restarted = runs !== null && m.runs !== undefined && m.runs !== runs;
    if (restarted) you.lastPeak = you.peak;
    if (m.runs !== undefined) runs = m.runs;
    you.runs = runs;   // the radar (3L) starts a new line on a new run
    if (m.peak !== undefined) you.peak = m.peak;
    /* DEAD: nothing to predict. The death beat counts down here from the
       moment the room said so; follow.js holds the wreck and shows the peak. */
    if (m.dead) {
      /* me.dead is the room's seconds left in the beat: start from it, then
         count on this clock so the pull-back is smooth between snapshots. */
      if (!(you.dead > 0)) you.dead = m.dead > 0 && m.dead <= params.deathBeat ? m.dead : params.deathBeat;
      you.crashX = typeof m.crashX === 'number' ? m.crashX : m.x;
      you.crashZ = typeof m.crashZ === 'number' ? m.crashZ : m.z;
      you.followers.length = 0; pred.followers.length = 0;
      live = false; fresh = true; shown = false;
      return;
    }
    if (pk < 0) return;                     // the clock has not started yet
    /* Further ahead of the room than a replay should ever reach: the clock
       is lost, so start it again from the estimate on the next frame. */
    if (pk - K > MAX_REPLAY) { clk = null; pk = -1; live = false; fresh = true; shown = false; return; }
    /* The room ahead of this phone (a stall here, or a lead gone wrong):
       nothing of ours to replay, so carry on from the truth. */
    const behind = K > pk;
    const wasLive = live && shown && !fresh && !restarted && !behind;
    const bx = pred.x, bz = pred.z;
    if (behind) pk = K;

    /* Back to the truth after step K. The room's path for this train, up to
       (not past) the true leader, then the leader itself as the first local
       point. */
    pred.x = m.x; pred.z = m.z; pred.head = m.h; pred.s = m.s; pred.turn = 0;
    const c = core.trains.get(myId), tr = [];
    if (c && (m.runs === undefined || c.runs === m.runs)) for (const q of c.trail) if (q.s < m.s - 0.01) tr.push(q);
    tr.push({ x: m.x, z: m.z, h: m.h, s: m.s });
    pred.trail = tr;
    const len = m.len || 0;
    while (pred.followers.length < len) pred.followers.push({ x: m.x, z: m.z, head: m.h });
    pred.followers.length = len;
    baseLen = len;

    /* The steps since, each with the input this phone gave it: the same
       inputs the room applies at the same steps, whenever they came in time. */
    for (let k = K + 1; k <= pk; k++) simulate(given(k));

    const size = wasLive ? Math.hypot(pred.x - bx, pred.z - bz) : 0;
    if (wasLive) { corrections.push(Math.round(size * 1000) / 1000); if (corrections.length > 6000) corrections.shift(); }
    place();
    /* THE OFFSET: from what is drawn now to the new prediction, for the
       leader and each follower that was drawn, so the whole train eases
       together and the first follower never parts from the leader. */
    if (!wasLive || size > SNAP) { off.x = off.z = off.h = 0; off.f.length = 0; off.age = EASE; shown = false; }
    else {
      off.x = you.x - pred.x; off.z = you.z - pred.z; off.h = wrap(you.head - pred.head);
      const n = Math.min(you.followers.length, pred.followers.length);
      off.f.length = n;
      for (let k = 0; k < n; k++) off.f[k] = { x: you.followers[k].x - pred.followers[k].x, z: you.followers[k].z - pred.followers[k].z };
      off.age = 0;
    }
    if (you.dead > 0) you.dead = 0;         // back in the water: snap, never ease
    live = true; fresh = false;
  }

  /* ---------------------------------------------------------- one frame */
  function frame (dt, paused, owed, connected) {
    /* Paused (the debug block), your manta holds; the room does not, so
       unpausing finds the clock far off and starts again from the truth. */
    if (paused) return;
    /* The beat runs on this clock; it holds its last moment until the room
       says the train is back, so the card never flickers off early. */
    if (me && me.dead && you.dead > 0) you.dead = Math.max(0.02, you.dead - dt);
    if (myId < 0 || est === null) return;
    const t = now();
    const aim = est + lead;
    /* Set once when the clock starts (or after it was lost); from then on
       only ever slewed, never jumped (3G). */
    if (clk === null) { clk = aim; settled = true; leadSeq = seq; }
    else {
      clk += Math.max(-SLEW, Math.min(SLEW, aim - clk));
      if (!settled && Math.abs(aim - clk) < 0.05) { settled = true; leadSeq = seq; }
    }
    const target = Math.floor(t / STEP_MS + clk);
    /* Lost (the first frame, a hidden tab, a long stall): start the count
       again here and wait for the next snapshot to put the leader back. */
    if (pk < 0 || target - pk > MAX_REPLAY || pk - target > MAX_REPLAY) {
      pk = target; hist.clear(); live = false; fresh = true; shown = false;
    }
    while (pk < target) {
      pk++;
      /* Connected, a step uses exactly what the room was told for it. */
      const h = connected ? { want: sentWant, burst: sentBurst } : { want: input.want, burst: !!input.burst };
      hist.set(pk, h); hist.delete(pk - HIST);
      if (live) simulate(h);
    }
    /* AFTER this frame's steps, for the next one. Sent before them, a long
       frame (a slow phone, a hitch) stamped its input for a step already
       behind this clock, and it reached the room late by the length of the
       frame: 40% late in a headless browser at a few frames a second. */
    maybeSend(t, connected, Math.min(dt, 0.05) * 1000, pk + 1);
    if (!live) return;
    off.age += dt;
    layout();
    shown = true;
  }

  /* Your train as drawn: the room's followers, then any pickups this phone
     predicted (3I), then any refused ones easing back into the follower
     ahead. Also run straight after a pickup, so it shows the same frame. */
  let baseLen = 0, extra = 0, leave = [];
  function layout () {
    const want = baseLen + extra + leave.length;
    while (pred.followers.length < want) { const l = pred.followers[pred.followers.length - 1] || pred; pred.followers.push({ x: l.x, z: l.z, head: l.head }); }
    pred.followers.length = want;
    place();
    const k = Math.max(0, 1 - off.age / EASE);
    you.x = pred.x + off.x * k; you.z = pred.z + off.z * k; you.head = wrap(pred.head + off.h * k);
    you.s = pred.s; you.bursting = pred.bursting; you.dead = 0;
    const f = you.followers, n = pred.followers.length;
    while (f.length < n) f.push({ x: pred.x, z: pred.z, head: pred.head, from: -1, born: 0 });
    f.length = n;
    for (let i = 0; i < n; i++) {
      /* A follower the offset never saw (just recruited) eases with the
         last one it did, or with the leader, so the train moves as one. */
      const p = pred.followers[i], o = i < off.f.length ? off.f[i] : off.f.length ? off.f[off.f.length - 1] : { x: off.x, z: off.z };
      f[i].x = o ? p.x + o.x * k : p.x; f[i].z = o ? p.z + o.z * k : p.z; f[i].head = p.head;
      f[i].unconfirmed = i >= baseLen && i < baseLen + extra;
    }
    for (let j = 0; j < leave.length; j++) {
      const i = n - leave.length + j, a = f[i], b = i > 0 ? f[i - 1] : you, g = leave[j];
      a.x += (b.x - a.x) * g; a.z += (b.z - a.z) * g; a.unconfirmed = true;
    }
    you.len = baseLen + extra;
  }
  /* Newest refusal first, right behind the held ones, the older (further
     eased) behind it: then a new refusal never reorders the tail, and each
     one only ever slides into the one ahead. */
  function setExtra (n, fracs) { extra = n; leave = fracs.slice().sort((a, b) => a - b); if (live && shown) layout(); }

  /* If the room is full the page falls back to watching: no inputs sent. */
  function stop () { live = false; shown = false; me = null; myId = -1; }

  return {
    hello, onInit, onSnap, frame, tick, stop, setExtra,
    get id () { return myId; }, get name () { return name; }, get me () { return me; },
    get corrections () { return corrections; }, get seq () { return seq; }, get ack () { return ack; },
    /* The clock, for the panel and the tests: steps ahead of the room, the
       inputs the room said came too late, and how many reports it sent. */
    get lead () { return lead; }, get late () { return late; }, get reported () { return reported; },
    get leadMoves () { return leadMoves; }, get step () { return pk; }, get live () { return live; },
    get sentBurst () { return sentBurst; },
    /* For the tests: the rules' numbers, so a harness can say what it held the phone to. */
    get rules () { return { GAP, BEAT, STEER_STEP, SHARP, CAP, VIEW_GROW, VIEW_GAP, PING_EVERY, PING_ALONE }; },
    get rttUse () { return rttUse; }, get rttIgnored () { return rttIgnored; },
  };
}
