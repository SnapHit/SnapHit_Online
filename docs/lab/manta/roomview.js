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
 * Snapshots arrive as binary (roomcore.js, 3F). Wild mantas come five
 * times a second and are smoothed between (createWildStore); trains, paths,
 * events and the board come twenty times a second.
 *
 * There is no human manta in a room. `you` is only where the camera looks:
 * the watched bot's leader. That bot is drawn once, with the rivals, and
 * follow.js keeps slot 0 parked while sim.watching is set.
 *
 * PLAY MODE (&play=1, roomplay.js) is the exception: `you` is the player's
 * own train, predicted on this phone and drawn in slot 0 in the player's
 * colour. Its rivals index stays a parked hole, so it is never drawn twice
 * and every other train keeps its colour. Everything else is drawn exactly
 * as in watch mode.
 */
import { createMirror, createWildView, createPickups, createHits, decodeSnap, wildLook, cleanName } from './roomcore.js';
import { NAME_KEY } from './labels.js';
import { createRadarModel } from './radar.js';
import { createPlay } from './roomplay.js';
import { DEF, zoomFor } from './simcore.js';

const lerp = (a, b, f) => a + (b - a) * f;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const JUMP = 300;                          // further than this in one snapshot is a teleport, not a swim

export function createRoomView ({ room, build, params: start, view, name: nameNow = () => null, play: playing = false }) {
  /* The room's numbers, never the drawer's: spacing decides where every
     follower sits, so it has to be the one the room placed them with. Filled
     in by init; one object, so the mirror's motion sees the update. */
  const params = Object.assign({}, DEF, start || {});
  const core = createMirror(params), wildView = createWildView();
  const radar = createRadarModel();        // the radar's trains (3L), fed by the room's channel
  /* THE PINK MANTA (4A stage 4): what the room sends (flag 32), drawn at
     the render delay between its last two samples like the trains, with
     the roll and the flee from the newest. A catch you make is predicted:
     bursting within the recruit radius of where it is drawn hides it and
     plays the catch at once; the room's own catch event confirms it, and
     the followers arrive with the room's lengths. If the room still sends
     it a second later, it was not caught and it shows again. */
  const pinkView = { a: null, b: null, roll: -1, flee: false, predictedAt: 0 };
  const pink = { alive: false, x: 0, z: 0, head: 0, roll: -1, state: 'drift', caught: 0 };
  const you = { id: -1, x: 0, z: 0, head: 0, s: 0, followers: [], dead: 0, peak: 0, lastPeak: 0, len: 0, watched: -1 };
  const rivals = [], wild = [], events = [], board = [];
  const drawn = new Map();                 // train id -> what is drawn for it
  const kinds = new Map();                 // train id -> personality, for the board
  const names = new Map();                 // train id -> player's name, for trains a player drives
  const input = { want: null, burst: false };   // written by the touch controls in play mode
  const snaps = [], pending = [], gaps = [], offsets = [];
  let ws = null, retry = 0, backoff = 0.5, stopped = false, connected = false, everOpen = false;
  /* OVERFLOW ROOMS (3O): a player in the public game asks the rooms which
     public room to swim in ("lobby", "lobby-2", ...) and keeps it for every
     reconnect; refused there as full, it asks again. allFull: every room
     is full, and the page goes solo. Watching stays on "lobby". */
  const publicGame = room === 'lobby' && new URLSearchParams(location.search).get('stage') !== 'cut';   // never the staged test room
  let seatRoom = null, foundFull = '', allFull = false, asking = false;
  let rtt = null, delay = 0.1, offset = null, lastArrive = null, lastSnap = null, snapCount = 0;
  let wildNow = null;
  /* Predicted pickups (3I): play mode only. The limit is your round trip
     (the longest of the last five) plus 100 ms. */
  let pickups = playing ? createPickups() : null; const rtts5 = [];
  /* Your own hits, played at once (3K, roomcore.js createHits). */
  let hits = playing ? createHits() : null;
  const pickupLimit = () => (rtts5.length ? Math.max(...rtts5) : 300) + 100;
  let watched = -1, viewDirty = true, sentView = null, viewAt = 0, pingAt = 0;
  let play = null;                         // play mode (roomplay.js), made once `send` exists

  /* ---------------------------------------------------------- the signal */
  const mark = document.createElement('div'), sig = document.createElement('span');
  mark.id = 'signal';
  mark.style.cssText = 'position:fixed;z-index:3;pointer-events:none;display:flex;align-items:center;gap:6px;' +
    'top:calc(env(safe-area-inset-top,0px) + 50px);left:calc(env(safe-area-inset-left,0px) + 14px);' +
    'font:600 11px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;text-shadow:0 1px 3px #000a';
  sig.style.whiteSpace = 'pre';
  mark.appendChild(sig);
  document.body.appendChild(mark);
  /* Your name as the room has it (a typed one once the room took it). */
  const myName = () => play ? (names.get(play.id) || play.name || null) : null;
  function showSignal () {
    if (pencil) pencil.hidden = !(connected && play && play.id >= 0);
    if (!connected) {
      mark.style.color = '#ff8a80';
      sig.textContent = '● ' + (navigator.onLine === false ? 'offline' : everOpen ? 'reconnecting…' : 'connecting…');
      return;
    }
    mark.style.color = rtt === null ? '#8fa6bb' : rtt < 150 ? '#7fe3d0' : rtt < 400 ? '#ffc46b' : '#ff8a80';
    sig.textContent = '● ' + (rtt === null ? '…' : Math.round(rtt) + ' ms') + (myName() ? '  ' + myName() : '');
  }

  /* THE PENCIL (3J): by your name in play, it opens a text field with Done
     and Cancel. The name is cleaned here as the room cleans it, sent in its
     own message, kept on this phone, and changed at most once every 5 s. */
  let pencil = null, editor = null, namedAt = -1e9;
  const btn = 'font:600 13px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#dff6ee;min-height:30px;padding:0 12px;' +
    'background:rgba(4,9,18,.75);border:1px solid rgba(120,190,210,.4);border-radius:999px;cursor:pointer';
  function sendName (n) { if (n) send({ t: 'nm', n }); }
  function setName (raw) {
    const n = cleanName(raw);
    if (!n) return 'empty';
    if (performance.now() - namedAt < 5000) return 'soon';
    namedAt = performance.now();
    try { localStorage.setItem(NAME_KEY, n); } catch (_) { /* this visit only */ }
    typedName = n; sendName(n);
    return 'ok';
  }
  let typedName = null;
  function makePencil () {
    pencil = document.createElement('button');
    pencil.type = 'button'; pencil.textContent = '\u270e'; pencil.hidden = true;
    pencil.setAttribute('aria-label', 'Change your name');
    pencil.style.cssText = btn + ';pointer-events:auto;min-height:26px;padding:0 8px;font-size:14px';
    mark.appendChild(pencil);
    pencil.addEventListener('click', () => {
      if (editor) return;
      editor = document.createElement('div');
      editor.style.cssText = 'position:fixed;z-index:7;pointer-events:auto;display:flex;flex-wrap:wrap;gap:6px;align-items:center;' +
        'top:calc(env(safe-area-inset-top,0px) + 74px);left:calc(env(safe-area-inset-left,0px) + 10px);max-width:calc(100vw - 20px);' +
        'padding:8px;background:rgba(4,9,18,.9);border:1px solid rgba(120,190,210,.35);border-radius:12px';
      const box = document.createElement('input'), done = document.createElement('button'), cancel = document.createElement('button'), note = document.createElement('div');
      box.type = 'text'; box.maxLength = 64; box.value = myName() || ''; box.setAttribute('aria-label', 'Your name'); box.setAttribute('enterkeyhint', 'done');
      box.style.cssText = 'flex:1 1 140px;min-width:0;font:16px system-ui,sans-serif;color:#eaf4ff;background:rgba(0,0,0,.35);border:1px solid rgba(120,190,210,.45);border-radius:8px;padding:6px 8px';
      done.type = 'button'; done.textContent = 'Done'; done.style.cssText = btn;
      cancel.type = 'button'; cancel.textContent = 'Cancel'; cancel.style.cssText = btn;
      note.style.cssText = 'flex-basis:100%;font:12px system-ui,sans-serif;color:#ffe2a8'; note.hidden = true;
      const close = () => { if (editor) { editor.remove(); editor = null; } };
      const ok = () => { const r = setName(box.value);
        if (r === 'soon') { note.textContent = 'One change every 5 seconds: try again in a moment.'; note.hidden = false; return; }
        close(); showSignal(); };
      done.addEventListener('click', ok); cancel.addEventListener('click', close);
      box.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); });
      editor.append(box, done, cancel, note);
      document.body.appendChild(editor);
      box.focus(); box.select();
    });
  }
  if (playing) makePencil();
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
  /* The step the other trains are drawn at, on the room's count: what an
     input tells the room this phone was looking at, for lag compensation. */
  const viewStep = () => offset === null || !snaps.length ? null : (performance.now() / 1000 - offset - delay) * 60;
  if (playing) play = createPlay({ room, params, core, you, input, send, rtt: () => rtt, view: viewStep });
  /* For tests against a local room only (the room ignores both elsewhere):
     ?lagcomp=0 turns lag compensation off, ?truth=1 asks for the true state. */
  const q = new URLSearchParams(location.search);
  function hello () {
    /* 3G: every message to the room is at most 64 bytes, so the hello is
       terse (b the build's digits, p play, k token, a watching, l lag compensation off,
       g truth) and the view follows in its own message. */
    const h = { t: 'hi', b: String(build).replace(/\D/g, '').slice(2) };   // '2609270805'
    if (watched >= 0) h.a = watched;
    if (play) Object.assign(h, play.hello());
    if (play && q.get('lagcomp') === '0') h.l = 0;
    if (q.get('truth') === '1') h.g = 1;
    return h;
  }
  function viewMsg (v) {
    const m = { t: 'view', x: Math.round(v.x), z: Math.round(v.z), w: Math.round(v.w), h: Math.round(v.h) };
    if (watched >= 0) m.a = watched;
    return m;
  }

  function connect () {
    if (stopped || asking) return;
    if (publicGame && play && !seatRoom) {
      asking = true;
      fetch('/lab/manta/rooms/public' + (foundFull ? '?full=' + foundFull : ''), { method: 'POST', cache: 'no-store' })
        .then(r => r.ok ? r.json().then(j => { if (/^lobby(-\d+)?$/.test(j.room)) seatRoom = j.room; })
                        : r.status === 503 ? r.text().then(t => { if (/full/.test(t)) allFull = true; }) : null)
        .catch(() => { /* the page's own five seconds decide */ })
        .then(() => { asking = false; foundFull = ''; if (allFull) { showSignal(); return; } if (seatRoom) connect(); else later(); });
      return;
    }
    const target = publicGame && play ? seatRoom : room;
    let s;
    /* ?stage=cut asks for the staged cut room, which only wrangler dev has
       (tests: a train of your own to burst with); anywhere else it is a 404
       and the page simply retries. */
    const kind = q.get('stage') === 'cut' ? 'stage/' : 'ocean/';
    /* ?xb=1 with the staged room (3H, tests only): bot 2 cuts your train. */
    const extra = kind === 'stage/' && q.get('xb') === '1' ? '?xb=1' : '';
    try { s = new WebSocket((location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/lab/manta/rooms/' + kind + target + extra); }
    catch (e) { later(); return; }
    ws = s;
    s.binaryType = 'arraybuffer';
    s.onopen = () => { everOpen = true; send(hello()); send(viewMsg(viewNow())); if (play) sendName(typedName || cleanName(nameNow() || '')); };
    s.onmessage = e => {
      let m; try { m = typeof e.data === 'string' ? JSON.parse(e.data) : decodeSnap(e.data); } catch (_) { return; }
      if (m && ws === s) receive(m);
    };
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
    core.trains.clear(); drawn.clear(); wildView.clear();
    snaps.length = 0; pending.length = 0; gaps.length = 0; offsets.length = 0;
    rivals.length = 0; events.length = 0; board.length = 0; names.clear();
    for (const w of wild) w.alive = false;
    offset = null; lastArrive = null; delay = 0.1;
  }

  function receive (m) {
    if (m.t === 'reload') { stopped = true; clearTimeout(retry); try { ws.close(); } catch (_) {} ws = null; connected = false; showSignal(); showReload(); return; }
    /* A room with ten players already: watch it instead of playing. */
    if (m.t === 'full' && publicGame && play) { foundFull = seatRoom || room; seatRoom = null; return; }   // the close that follows asks again
    if (m.t === 'full') { if (!play) return; play.stop(); play = null;
      mirror.watching = true; watched = -1; you.watched = -1; you.followers.length = 0; you.dead = 0; showSignal(); return; }
    if (m.t === 'init') { Object.assign(params, m.params || {}); resync(); setNames(m.names); radar.trains.clear(); for (const r of m.rp || []) if (Array.isArray(r) && r.length === 3) radar.setPath(r[0], r[1], r[2]); if (pickups) pickups.reset(); if (hits) hits.reset();
      if (play) { play.onInit(m); if (play.id >= 0) watched = play.id; }
      /* Every bot's kind, once on joining, so the board says timid, greedy or
         bully for bots that have never been near you (3D). */
      for (const [id, k] of m.kinds || []) kinds.set(id, k); connected = true; backoff = 0.5; viewDirty = true; showSignal(); return; }
    if (m.t === 'pong') { rtt = performance.now() - m.c; rtts5.push(rtt); if (rtts5.length > 5) rtts5.shift(); showSignal(); return; }
    if (m.t === 'names') { setNames(m.names); return; }
    /* The room benched this player (no inputs for 2 s, or the page said it
       was hidden): rejoin at once if the page is showing, with the token,
       which takes the manta back while the bot still holds it. */
    if (m.t === 'benched') { if (play && !document.hidden) send(hello()); return; }
    if (m.t === 'snap') snap(m);
  }

  /* Players by name, bots by number and kind: whole, whenever it comes. */
  function setNames (list) {
    if (!list) return;
    names.clear();
    for (const [id, n] of list) names.set(id, n);
  }

  function snap (m) {
    const at = performance.now() / 1000;
    core.apply(m);
    lastSnap = m; snapCount++;
    /* The radar's channel (3L): every train, five times a second; your own
       train comes from your own leader each frame in play (follow.js). */
    if (m.rd) { const nowMs = performance.now(), sp = params.spacing || 19; for (const r of m.rd) if (!(play && r[0] === play.id)) radar.update(r[0], r[1], r[2], r[3], r[5], r[4], nowMs, sp); }
    if (m.pk) { pinkView.a = pinkView.b; pinkView.b = { t: m.time, x: m.pk.x, z: m.pk.z, h: m.pk.h }; pinkView.roll = m.pk.roll; pinkView.flee = m.pk.flee; }
    else { pinkView.a = pinkView.b = null; pinkView.predictedAt = 0; }
    setNames(m.names);
    /* After the mirror took this snapshot's paths: the prediction lays its
       followers along this train's path, up to the true leader. */
    if (play) play.onSnap(m);
    if (play && pickups && m.me) { if (m.me.dead) pickups.reset(); else pickups.confirm(m.me.len || 0, wildView.ended, performance.now(), pickupLimit()); }
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
    snaps.push({ time: m.time, tr: new Map(m.tr.map(q => [q.id, q])) });
    wildView.take(m);
    while (snaps.length > 2 && m.time - snaps[1].time > 1) snaps.shift();
    /* Events naming your leader are about your train, which is drawn now,
       not in the past: they are not held to the render delay (3K). One that
       confirms a hit already played plays nothing more; any other (the reef,
       a hit not predicted) plays now, a crash with your camera's shake.
       Everyone else's are held so they land where their trains are drawn. */
    for (const e of m.ev || []) {
      if (e.k === 'pink') {
        /* Your own predicted catch, confirmed: nothing more to play. */
        if (e.what === 'catch' && play && e.by === play.id && pinkView.predictedAt) { pinkView.predictedAt = 0; pink.caught++; continue; }
        if (e.what === 'catch') pink.caught++;
        pending.push({ time: m.time, kind: 'pink', what: e.what, x: e.x, z: e.z, by: e.by });
        continue;
      }
      if (hits && play && play.id >= 0 && e.by === play.id) {
        if (!hits.confirm({ kind: e.k, x: e.x, z: e.z })) events.push({ kind: e.k, x: e.x, z: e.z, by: e.by, id: e.k === 'crash' ? you.id : undefined });
        continue;
      }
      pending.push({ time: m.time, kind: e.k, x: e.x, z: e.z, by: e.by });
    }
    /* The board comes only when it changed: the last one stands until then. */
    if (m.bd) {
      board.length = 0;
      /* The player's own row is `you`, which the board marks as yours. */
      for (const [id, len] of m.bd) board.push(play && id === play.id ? you
        : { id, kind: kinds.get(id) || 'bot', name: names.get(id), dead: 0, followers: { length: len } });
    } else for (const r of board) if (r !== you) { r.kind = kinds.get(r.id) || r.kind; r.name = names.get(r.id); }
    /* The top bot until the player taps for another. */
    if (!play && watched < 0 && board.length) watch(board[0].id);
  }

  function watch (id) { watched = id; you.watched = id; viewDirty = true; }
  /* A tap on the water moves to the next bot on the board, wrapping. The
     chip, the panel and the drawer are not the canvas, so they never do. */
  addEventListener('click', e => {
    if (play || !e.target || e.target.tagName !== 'CANVAS' || !board.length) return;   // in play a tap steers
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
      send(viewMsg(v));
      sentView = v; viewAt = now; viewDirty = false;
    }
    if (now - pingAt >= 1) { send({ t: 'ping', c: Math.round(performance.now()) }); pingAt = now; }
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
    /* Your own leader first, on its own clock: it is not drawn in the past. */
    if (play && !stopped) play.frame(dt, paused, owed, connected);
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
      if (!(id >= 1) || !drawn.has(id) || (play && id === play.id)) continue;   // yours is slot 0
      while (rivals.length < id) rivals.push(hole(rivals.length));
      rivals[id - 1] = drawn.get(id);
    }
    while (rivals.length && rivals[rivals.length - 1].hole) rivals.pop();

    /* The camera: on the watched leader, and held where it is while that
       train is in its death beat or not yet in the mirror. */
    const w0 = !play && B.tr.has(watched) ? drawn.get(watched) : null;
    if (w0 && !w0.dead) { you.x = w0.x; you.z = w0.z; you.head = w0.head; you.s = w0.s; you.len = w0.followers.length; }

    /* Wild mantas by slot, smoothed between the five-a-second samples
       (roomcore.js). One that is not in the water at T is gone from view.
       Glow and sinking arrive as flags, so they count down here. */
    for (const w of wild) w.seen = false;
    /* Wild mantas where they are now, not in the past with the trains
       (3I, roomcore.js createWildView). Paused, they hold with the rest. */
    const wdt = paused ? dt : wildNow === null ? 0 : now - wildNow;   // real time: a frame's dt is capped
    wildNow = now;
    /* Pickups are judged on what you see: your leader as drawn against
       each wild manta as drawn. Loose debris is left to the room. */
    const wl = pickups && play && play.live && !paused ? [] : null;
    wildView.at(now, offset, rtt, wdt, (slot, x, z, h, fl, col, gen) => {
      if (pickups && pickups.hides(slot, gen)) return;
      if (wl && !(fl & 1)) wl.push([slot, gen, x, z]);
      while (wild.length <= slot) wild.push({ x: 0, z: 0, head: 0, alive: false, loose: false, sinking: 0, glow: 0, wasColour: -1, colour: wild.length, gen: 0 });
      const w = wild[slot];
      w.x = x; w.z = z; w.head = h;
      w.alive = w.seen = true;
      wildLook(w, fl, col, gen, dt, params);
    }, paused);
    for (const w of wild) if (!w.seen) w.alive = false;
    if (wl) { const t = performance.now(); pickups.touch(you, wl, params.recruitR, t); pickups.tidy(t); play.setExtra(pickups.held, pickups.leaving(t)); }
    /* Your own hit, the frame your drawn leader touches a drawn train (3K):
       its flash, shockwave and (a crash) shake play now, where you saw it. */
    if (hits && play && play.live && !paused) {
      const t = performance.now();
      hits.expire(t, (rtts5.length ? Math.max(...rtts5) : 300) + 150, !(you.dead > 0));
      const h = hits.detect(you, rivals, params, t);
      if (h) events.push({ kind: h.kind, x: h.x, z: h.z, by: play.id, id: h.kind === 'crash' ? you.id : undefined, predicted: true });
    }

    /* Events once each, at the render delay, so the burst lands where the
       drawn trains are. Stale ones (a hidden tab) are dropped, not replayed. */
    pending.sort((p, q) => p.time - q.time);
    while (pending.length && pending[0].time <= T) {
      const e = pending.shift();
      if (e.time >= T - 0.5) events.push({ kind: e.kind, what: e.what, x: e.x, z: e.z, by: e.by });
    }
    /* The pink manta at T, between its last two samples. */
    {
      const a = pinkView.a, b = pinkView.b;
      const hidden = pinkView.predictedAt && performance.now() - pinkView.predictedAt < 1000;
      if (b && !hidden) {
        const f = a && b.t > a.t ? Math.max(0, Math.min(1, (T - a.t) / (b.t - a.t))) : 1;
        pink.x = a ? a.x + (b.x - a.x) * f : b.x; pink.z = a ? a.z + (b.z - a.z) * f : b.z; pink.head = b.h;
        pink.roll = pinkView.roll; pink.state = pinkView.flee ? 'flee' : 'drift'; pink.alive = true;
      } else pink.alive = false;
      if (pink.alive && play && play.live && !paused && !pinkView.predictedAt && input.burst && you.len > 0 && Math.hypot(you.x - pink.x, you.z - pink.z) <= (params.recruitR || 30) * (params.trainScale || 1)) {
        pinkView.predictedAt = performance.now();
        events.push({ kind: 'pink', what: 'catch', x: pink.x, z: pink.z, by: play.id, predicted: true });
      }
    }
  }

  const mirror = {
    watching: !play, params, you, rivals, trains: board, wild, events, time: 0, radar, pink,
    input, blooms: [],
    step,
    zoom: () => zoomFor(you.len, params),
    botMix: () => { const m = {}; for (const r of rivals) if (!r.hole) m[r.kind || 'bot'] = (m[r.kind || 'bot'] || 0) + 1; return m; },
    setBotCount () {},                     // the room decides how many bots there are
    liveWild: () => wild.filter(w => w.alive),
    ambientWild: () => wild.filter(w => w.alive && !w.loose),
    debrisWild: () => wild.filter(w => w.alive && w.loose),
    /* Labels (3J): a player's name by train id, and your own. */
    nameOf: id => names.get(id) || null,
    youName: () => myName(),
    /* For the tests: change your name as the pencil does. */
    setName,
    /* For the tests: your predicted hits so far (3K). */
    get hitStats () { return hits ? hits.stats : null; },
    /* For the browser checks: window.__lab.room. */
    room: {
      get connected () { return connected; }, get rtt () { return rtt; }, get delay () { return delay; },
      get snaps () { return snapCount; }, get lastSnap () { return lastSnap; }, get build () { return build; },
      get watched () { return watched; },
      /* Play mode: the correction sizes (units, one per snapshot) and the
         input sequence the room has acknowledged. */
      get play () { return !!play; }, get me () { return play ? play.me : null; },
      /* The public room this player swims in, and whether every room was full (3O). */
      get seatRoom () { return seatRoom; }, get allFull () { return allFull; },
      get corrections () { return play ? play.corrections : []; }, get seq () { return play ? play.seq : 0; },
      get ack () { return play ? play.ack : 0; }, get name () { return play ? play.name : null; },
      /* Play mode's clock (3E): steps ahead of the room, inputs the room
         said came too late for their step, and earliness reports received. */
      get lead () { return play ? play.lead : null; }, get late () { return play ? play.late : 0; },
      get reported () { return play ? play.reported : 0; }, get id () { return play ? play.id : -1; },
    },
  };
  addEventListener('online', showSignal); addEventListener('offline', showSignal);
  /* PLAY MODE (3G): a hidden page says so, and the room gives the manta to
     a bot at once rather than letting it swim on the last input; shown
     again, the page rejoins with its token. */
  document.addEventListener('visibilitychange', () => {
    if (!play) return;
    if (document.hidden) send({ t: 'away' }); else send(hello());
  });
  /* WATCHING TO PLAYING IN PLACE (3K): the first visit's Play joins as a
     player on the open connection, no reload. A second hello on the same
     socket seats it (rooms/ocean.js); your name follows in its message. */
  function startPlaying (name) {
    if (play || stopped) return false;
    playing = true;
    if (publicGame && !seatRoom) seatRoom = room;   // seated in place on the lobby connection; full there, it asks
    play = createPlay({ room, params, core, you, input, send, rtt: () => rtt, view: viewStep });
    pickups = createPickups(); hits = createHits();
    if (!pencil) makePencil();
    mirror.watching = false; watched = -1; you.watched = -1; you.followers.length = 0; you.dead = 0;
    const n = cleanName(name || '');
    if (n) { typedName = n; try { localStorage.setItem(NAME_KEY, n); } catch (_) { /* this visit only */ } }
    send(hello()); send(viewMsg(viewNow())); sendName(typedName || cleanName(nameNow() || ''));
    showSignal();
    return true;
  }
  mirror.startPlaying = startPlaying;
  connect();
  return mirror;
}
