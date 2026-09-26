/* Watch mode (?room=<name>): the phone's side of a room.
 *
 * The room runs the one simulation; this page only draws it. createRoomView
 * returns an object shaped like the simulation — you, rivals, trains, wild,
 * params, events, time, step() — so follow.js, stamp.js, roll.js, debug.js
 * and the drawer draw a room with the same code that draws the solo lab.
 *
 * WHY IT DRAWS THE PAST. Snapshots arrive twenty times a second and never
 * evenly, so drawing the newest one makes every train stutter. Everything is
 * drawn about 100 ms behind the room, between the two snapshots either side
 * of that moment, and the delay grows with the jitter actually measured.
 *
 * There is no human manta in a room. `you` is only where the camera looks:
 * the watched bot's leader. That bot is drawn once, with the rivals, and
 * follow.js keeps slot 0 parked while sim.watching is set.
 */
import { createMirror } from './roomcore.js';
import { DEF, zoomFor } from './simcore.js';

const lerp = (a, b, f) => a + (b - a) * f;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const JUMP = 300;                          // further than this in one snapshot is a teleport, not a swim

export function createRoomView ({ room, build, params: start, view }) {
  /* The room's numbers, never the drawer's: spacing decides where every
     follower sits, so it has to be the one the room placed them with. Filled
     in by init; one object, so the mirror's motion sees the update. */
  const params = Object.assign({}, DEF, start || {});
  const core = createMirror(params);
  const you = { id: -1, x: 0, z: 0, head: 0, s: 0, followers: [], dead: 0, peak: 0, lastPeak: 0, len: 0, watched: -1 };
  const rivals = [], wild = [], events = [], board = [];
  const drawn = new Map();                 // train id -> what is drawn for it
  const kinds = new Map();                 // train id -> personality, for the board
  const snaps = [], pending = [], gaps = [], offsets = [];
  let ws = null, retry = 0, backoff = 0.5, stopped = false, connected = false, everOpen = false;
  let rtt = null, delay = 0.1, offset = null, lastArrive = null, lastSnap = null, snapCount = 0;
  let watched = -1, viewDirty = true, sentView = null, viewAt = 0, pingAt = 0;

  /* ---------------------------------------------------------- the signal */
  const mark = document.createElement('div');
  mark.style.cssText = 'position:fixed;z-index:3;pointer-events:none;' +
    'top:calc(env(safe-area-inset-top,0px) + 50px);left:calc(env(safe-area-inset-left,0px) + 14px);' +
    'font:600 11px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;text-shadow:0 1px 3px #000a';
  document.body.appendChild(mark);
  function showSignal () {
    if (!connected) {
      mark.style.color = '#ff8a80';
      mark.textContent = '● ' + (navigator.onLine === false ? 'offline' : everOpen ? 'reconnecting…' : 'connecting…');
      return;
    }
    mark.style.color = rtt === null ? '#8fa6bb' : rtt < 150 ? '#7fe3d0' : rtt < 400 ? '#ffc46b' : '#ff8a80';
    mark.textContent = '● ' + (rtt === null ? '…' : Math.round(rtt) + ' ms');
  }
  showSignal();

  /* A different build in the room means this page is stale: say so and stop,
     rather than draw a world whose rules this page does not have. */
  function showReload () {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;inset:0;z-index:10;display:flex;align-items:center;justify-content:center;' +
      'background:#040912e6;color:#eaf4ff;font:600 17px/1.4 system-ui,sans-serif;text-align:center;padding:16px';
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = 'Reload.';
    b.style.cssText = 'font:inherit;color:#7fe3d0;background:none;border:0;padding:0 0 0 0.3em;text-decoration:underline;cursor:pointer';
    b.onclick = () => location.reload();
    d.append('A new version is ready.', b);
    document.body.appendChild(d);
  }

  /* ------------------------------------------------------------ the wire */
  const send = m => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };
  const viewNow = () => ({ x: you.x, z: you.z, w: view ? view.w : 1000, h: view ? view.h : 1000 });

  function connect () {
    if (stopped) return;
    let s;
    try { s = new WebSocket((location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/lab/manta/rooms/ocean/' + room); }
    catch (e) { later(); return; }
    ws = s;
    s.onopen = () => { everOpen = true; send({ t: 'hello', build, view: viewNow(), watch: watched }); };
    s.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (_) { return; } if (ws === s) receive(m); };
    s.onclose = () => { if (ws !== s) return; ws = null; connected = false; showSignal(); later(); };
  }
  /* Half a second, doubling to eight, reset by a good init: a room that is
     restarting for a deploy is back in seconds, one that is down is not
     hammered. */
  function later () {
    if (stopped) return;
    clearTimeout(retry);
    retry = setTimeout(connect, backoff * 1000);
    backoff = Math.min(backoff * 2, 8);
  }

  /* A new connection is a new phone to the room: it resends every path in
     full, so what this page remembers of the old one is thrown away. */
  function resync () {
    core.trains.clear(); drawn.clear();
    snaps.length = 0; pending.length = 0; gaps.length = 0; offsets.length = 0;
    rivals.length = 0; events.length = 0; board.length = 0;
    for (const w of wild) w.alive = false;
    offset = null; lastArrive = null; delay = 0.1;
  }

  function receive (m) {
    if (m.t === 'reload') { stopped = true; clearTimeout(retry); try { ws.close(); } catch (_) {} ws = null; connected = false; showSignal(); showReload(); return; }
    if (m.t === 'init') { Object.assign(params, m.params || {}); resync();
      /* Every bot's kind, once on joining, so the board says timid, greedy or
         bully for bots that have never been near you (3D). */
      for (const [id, k] of m.kinds || []) kinds.set(id, k); connected = true; backoff = 0.5; viewDirty = true; showSignal(); return; }
    if (m.t === 'pong') { rtt = performance.now() - m.c; showSignal(); return; }
    if (m.t === 'snap') snap(m);
  }

  function snap (m) {
    const at = performance.now() / 1000;
    core.apply(m);
    lastSnap = m; snapCount++;
    /* The room's clock against this one: the fastest recent arrival is the
       one least delayed by the network, so it is the best estimate. */
    offsets.push(at - m.time); if (offsets.length > 40) offsets.shift();
    offset = Math.min(...offsets);
    if (lastArrive !== null) { gaps.push(at - lastArrive); if (gaps.length > 40) gaps.shift(); }
    lastArrive = at;
    if (gaps.length > 4) {
      const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      const sd = Math.sqrt(gaps.reduce((a, g) => a + (g - mean) * (g - mean), 0) / gaps.length);
      delay = Math.min(0.4, Math.max(0.1, 0.1 + 2 * sd));
    }
    /* runs comes only with a fresh path, so each stored entry is stamped
       with the run the mirror held when it arrived: interpolating across a
       restart, or placing followers on another run's path, is then visible. */
    for (const q of m.tr) { const c = core.trains.get(q.id); q.run = c ? c.runs : -1; if (c && c.kind) kinds.set(q.id, c.kind); }
    snaps.push({ time: m.time, tr: new Map(m.tr.map(q => [q.id, q])), wd: new Map(m.wd.map(w => [w[0], w])) });
    while (snaps.length > 2 && m.time - snaps[1].time > 1) snaps.shift();
    for (const e of m.ev || []) pending.push({ time: m.time, kind: e.k, x: e.x, z: e.z });
    /* The board comes only when it changed: the last one stands until then. */
    if (m.bd) {
      board.length = 0;
      for (const [id, len] of m.bd) board.push({ id, kind: kinds.get(id) || 'bot', dead: 0, followers: { length: len } });
    } else for (const r of board) r.kind = kinds.get(r.id) || r.kind;
    /* The top bot until the player taps for another. */
    if (watched < 0 && board.length) watch(board[0].id);
  }

  function watch (id) { watched = id; you.watched = id; viewDirty = true; }
  /* A tap on the water moves to the next bot on the board, wrapping. The
     chip, the panel and the drawer are not the canvas, so they never do. */
  addEventListener('click', e => {
    if (!e.target || e.target.tagName !== 'CANVAS' || !board.length) return;
    const i = board.findIndex(b => b.id === watched);
    watch(board[(i + 1) % board.length].id);
  });

  /* The view, at most five times a second and only when it moved; a ping a
     second, which is also what keeps the signal mark honest. */
  function tick (now) {
    if (!connected) return;
    const v = viewNow();
    const moved = !sentView || Math.abs(v.x - sentView.x) + Math.abs(v.z - sentView.z) > 10 ||
                  Math.abs(v.w - sentView.w) > 1 || Math.abs(v.h - sentView.h) > 1;
    if ((viewDirty || moved) && now - viewAt >= 0.2) {
      send(Object.assign({ t: 'view' }, v, { watch: watched }));
      sentView = v; viewAt = now; viewDirty = false;
    }
    if (now - pingAt >= 1) { send({ t: 'ping', c: performance.now() }); pingAt = now; }
  }

  /* -------------------------------------------------------- one frame */
  const holes = [];
  const hole = i => holes[i] || (holes[i] = { id: -2 - i, hole: true, dead: 1, x: 0, z: 0, head: 0, followers: [] });

  /* The debug block's Pause and Step (3D): paused, what is drawn holds at one
     moment and Step moves it on by one step; the room carries on regardless,
     and unpausing returns to live. */
  let held = null;
  function step (dt, paused = false, owed = 0) {
    const now = performance.now() / 1000;
    mirror.time = now;                       // monotonic: the board's throttle and the join fade read it
    tick(now);
    if (!snaps.length || offset === null || stopped) return;
    let T = now - offset - delay;
    if (paused) {
      if (held === null) held = T;
      if (!(owed > 0)) return;              // held: nothing moves until Step
      held += owed; T = held; dt = owed;
    } else held = null;
    let A = snaps[0], B = snaps[0];
    if (T >= snaps[snaps.length - 1].time) A = B = snaps[snaps.length - 1];
    else for (let i = 0; i + 1 < snaps.length; i++) if (snaps[i + 1].time > T) { A = snaps[i]; B = snaps[i + 1]; break; }
    const f = B === A || T <= A.time ? 0 : Math.min(1, (T - A.time) / (B.time - A.time));

    /* Trains: the leader between the two snapshots, the followers laid along
       the stored path by the simulation's own placeFollowers. */
    for (const [id, qb] of B.tr) {
      const c = core.trains.get(id);
      if (!c) continue;
      const qa = A.tr.get(id) || qb, near = f < 0.5 ? qa : qb;
      const jump = qa.run !== qb.run || Math.abs(qb.x - qa.x) + Math.abs(qb.z - qa.z) > JUMP;
      const a = jump ? near : qa, b = jump ? near : qb;
      let t = drawn.get(id);
      if (!t) { t = { id, followers: [] }; drawn.set(id, t); }
      t.trail = c.trail; t.kind = c.kind || 'bot'; t.bursting = !!near.b; t.runs = near.run;
      t.x = lerp(a.x, b.x, f); t.z = lerp(a.z, b.z, f); t.s = lerp(a.s, b.s, f);
      t.head = a.h + wrap(b.h - a.h) * f;
      /* A path from a newer run cannot place an older run's followers: for
         the frame or two either side of a restart the train is not drawn. */
      t.dead = near.dead || near.run !== c.runs ? 1 : 0;
      const len = t.dead ? 0 : near.len;
      while (t.followers.length < len) t.followers.push({ x: t.x, z: t.z, head: t.head, from: -1, born: 0 });
      t.followers.length = len;
      if (len) core.placeFollowers(t);
    }
    /* Every bot keeps ONE index, its id less one, so its colour never changes
       (3D): not when it leaves the view, and not when you watch another. A
       bot out of view is a parked stand-in. */
    for (let i = 0; i < rivals.length; i++) rivals[i] = hole(i);
    for (const id of B.tr.keys()) {
      if (!(id >= 1) || !drawn.has(id)) continue;
      while (rivals.length < id) rivals.push(hole(rivals.length));
      rivals[id - 1] = drawn.get(id);
    }
    while (rivals.length && rivals[rivals.length - 1].hole) rivals.pop();

    /* The camera: on the watched leader, and held where it is while that
       train is in its death beat or not yet in the mirror. */
    const w0 = B.tr.has(watched) ? drawn.get(watched) : null;
    if (w0 && !w0.dead) { you.x = w0.x; you.z = w0.z; you.head = w0.head; you.s = w0.s; you.len = w0.followers.length; }

    /* Wild mantas by slot. A slot missing from the newer snapshot is gone
       from view. Glow and sinking arrive as flags, so they count down here. */
    for (const w of wild) w.seen = false;
    for (const [slot, b] of B.wd) {
      const a = A.wd.get(slot) || b;
      while (wild.length <= slot) wild.push({ x: 0, z: 0, head: 0, alive: false, loose: false, sinking: 0, glow: 0, wasColour: -1, colour: wild.length });
      const w = wild[slot], g = Math.abs(b[1] - a[1]) + Math.abs(b[2] - a[2]) > JUMP ? 1 : f, n = g < 0.5 ? a : b;
      w.x = lerp(a[1], b[1], g); w.z = lerp(a[2], b[2], g); w.head = a[3] + wrap(b[3] - a[3]) * g;
      w.alive = w.seen = true; w.loose = !!(n[4] & 1);
      w.sinking = n[4] & 2 ? (w.sinking > 0 ? Math.max(0.05, w.sinking - dt) : params.drain) : 0;
      if (n[5] >= 0) { w.wasColour = n[5]; w.glow = w.glow > 0 ? Math.max(0.05, w.glow - dt) : params.scatterGlow; }
      else w.glow = 0;
    }
    for (const w of wild) if (!w.seen) w.alive = false;

    /* Events once each, at the render delay, so the burst lands where the
       drawn trains are. Stale ones (a hidden tab) are dropped, not replayed. */
    pending.sort((p, q) => p.time - q.time);
    while (pending.length && pending[0].time <= T) {
      const e = pending.shift();
      if (e.time >= T - 0.5) events.push({ kind: e.kind, x: e.x, z: e.z });
    }
  }

  const mirror = {
    watching: true, params, you, rivals, trains: board, wild, events, time: 0,
    input: { want: null, burst: false }, blooms: [],
    step,
    zoom: () => zoomFor(you.len, params),
    botMix: () => { const m = {}; for (const r of rivals) if (!r.hole) m[r.kind || 'bot'] = (m[r.kind || 'bot'] || 0) + 1; return m; },
    setBotCount () {},                     // the room decides how many bots there are
    liveWild: () => wild.filter(w => w.alive),
    ambientWild: () => wild.filter(w => w.alive && !w.loose),
    debrisWild: () => wild.filter(w => w.alive && w.loose),
    /* For the browser checks: window.__lab.room. */
    room: {
      get connected () { return connected; }, get rtt () { return rtt; }, get delay () { return delay; },
      get snaps () { return snapCount; }, get lastSnap () { return lastSnap; }, get build () { return build; },
      get watched () { return watched; },
    },
  };
  addEventListener('online', showSignal); addEventListener('offline', showSignal);
  connect();
  return mirror;
}
