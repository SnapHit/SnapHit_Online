/* A room's ocean (3C stage 4): the lab's own simulation, run by the Room
 * Durable Object as the referee, and sent to each phone as snapshots of
 * what is near its view (roomcore.js has the wire format).
 *
 * The simulation starts with the committed defaults, read from the same
 * params.js the phones load (through the assets binding, so the numbers
 * cannot drift), and a seed of its own, when the first phone says hello. It
 * steps at 60 Hz from a timer while at least one phone is here and the
 * timer stops when the last one leaves, so an empty room goes idle. The
 * solo human manta is kept out of the water. Snapshots go as binary (3F);
 * everything else, both ways, stays JSON text.
 *
 * PLAY MODE (3D stage 4, inputs on the room's clock from 3E): a hello with
 * play:true takes over the first bot not driven by a player. Each input says
 * which simulation step it is for; the room queues it and applies it at that
 * step, or on the next step if it came late, setting that train's t.human =
 * {want, burst, rewind}. The simulation steps it like a bot whose brain does
 * not think. Every snapshot tells the player how early its inputs arrived,
 * so the phone can keep them just ahead of when they are needed. A dropped
 * player's train is held by the brain for HOLD_MS, and a hello with the same
 * token takes it back.
 *
 * THE STAGED CUT (3E, tests only): /lab/manta/rooms/stage/<name> exists only
 * under wrangler dev (worker.js answers 404 anywhere else). It is an ocean
 * with every bot but two out of the water: bot 1, the player's seat, and bot
 * 2 scripted to cross the player's path, both put back every CYCLE steps, so
 * a test can make a cut attempt every couple of seconds.
 */
import { createSim, STEP } from '../docs/lab/manta/sim.js';
import { snapFor, SNAP_HZ, cleanName } from '../docs/lab/manta/roomcore.js';
import { RADAR_RES } from '../docs/lab/manta/radar.js';   // the radar's starting paths (3L); the live channel rides in the snapshot
import { layLong } from '../docs/lab/manta/simcore.js';

/* The committed defaults and the build stamp, from the deployed files. */
async function loadDefaults (env, url) {
  const text = async path => (await env.ASSETS.fetch(new Request(new URL(path, url)))).text();
  const [params, panel] = await Promise.all([text('/lab/manta/params.js'), text('/lab/manta/panel.js')]);
  const P = {};
  for (const m of params.matchAll(/\{ key: '(\w+)',[^}]*?def: ([-\d.e]+)/g)) P[m[1]] = parseFloat(m[2]);
  const build = (panel.match(/export const BUILD = '([^']+)'/) || [])[1] || 'unknown';
  return { P, build };
}

/* The same mapping from drawer values to the simulation the page uses. */
const simParams = P => ({
  cruise: P.cruise, burst: P.burstSpeed, turnCruise: P.turnCruise, turnBurst: P.turnBurst,
  recruitR: P.recruitR, spacing: P.spacing, wildCount: P.wildCount, regrow: P.regrow,
  wildSize: P.wildSize, bloomPull: P.bloomPull, trainScale: P.trainScale,
  arenaR: P.arenaR, arenaRWanted: P.arenaR, bots: P.bots,
  burstCost: P.burstCost, scatterGlow: P.scatterGlow,
  /* The pink manta (4A stage 4): the room's own, as every gameplay value. */
  pinkOn: P.pinkOn, pinkWait: P.pinkWait, pinkClear: P.pinkClear, pinkNotice: P.pinkNotice, pinkFlee: P.pinkFlee, pinkReward: P.pinkReward, pinkStay: P.pinkStay,
});

const MAX_PLAYERS = 10;           // at most 12 (3G); the ocean has ten trains to drive
const MAX_WATCHERS = 4;
const MAX_SOCKETS = MAX_PLAYERS + MAX_WATCHERS + 2;   // the rest are still saying hello
const HOLD_MS = 15000;            // a dropped player's train waits this long for its token
const AWAY_MS = 2000;             // no inputs this long and a player is away (3G): benched as for a drop
const REWIND_MAX = 15;            // steps (250 ms); the simulation keeps no more
const AHEAD_MAX = 120;            // an input stamped further ahead than this is applied at that
const QUEUE_MAX = 64;             // inputs a player may have waiting
const CYCLE = 150;                // the staged cut: steps between put-backs (2.5 s)
/* Names, never typed: a word from each list, unique in the room. */
const FIRST = ['coral', 'amber', 'silver', 'misty', 'swift', 'quiet', 'bright', 'lucky', 'salty', 'sunny', 'deep', 'blue'];
const SECOND = ['fox', 'otter', 'heron', 'comet', 'pebble', 'kelp', 'wave', 'finch', 'drift', 'lantern', 'tide', 'moth'];
const hex = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, '0')).join('');

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(+v) ? +v : lo));
/* MALFORMED INPUT IS DROPPED, NEVER SIMULATED (3G): wrong types, NaN,
   infinities and anything out of range, whole message and all. */
const num = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const opt = (v, ok) => v === undefined || ok(v);
const watchOk = v => Number.isInteger(v) && v >= -1 && v < 1e4;
const inOk = (m, steps) => Number.isSafeInteger(m.seq) && m.seq > 0 &&
  opt(m.k, k => Number.isSafeInteger(k) && Math.abs(k - steps) <= 36000) &&
  opt(m.w, w => w === null || num(w, -7, 7)) && opt(m.b, b => b === 0 || b === 1) && opt(m.d, d => num(d, 0, 600));
const viewOk = m => num(m.x, -1e6, 1e6) && num(m.z, -1e6, 1e6) && num(m.w, 0, 1e5) && num(m.h, 0, 1e5) && opt(m.a, watchOk);
const hiOk = m => typeof m.b === 'string' && m.b.length <= 24 && opt(m.k, k => typeof k === 'string' && /^[0-9a-f]{12}$/.test(k)) &&
  opt(m.p, p => p === 0 || p === 1) && opt(m.a, watchOk) && opt(m.l, l => l === 0) && opt(m.g, g => g === 1);
const viewOf = m => ({ x: clamp(m && m.x, -1e5, 1e5), z: clamp(m && m.z, -1e5, 1e5),
                       w: clamp(m && m.w, 100, 6000), h: clamp(m && m.h, 100, 6000) });

export function createOcean (env, url, opts = {}) {
  const phones = new Map();           // socket -> what this phone has been sent
  const staged = opts.stage === 'cut';
  /* The crossing train's length, 20 unless a test asks (?len=, 2 to 40). */
  const crossLen = Math.round(clamp(url.searchParams.get('len') || 20, 2, 40));
  const botCuts = staged && url.searchParams.get('xb') === '1';
  const race = staged && url.searchParams.get('xb') === '2';
  /* ?mine=N (3L, tests only): the seated train laid at N at once, no put-backs. */
  const mine = staged ? Math.round(clamp(url.searchParams.get('mine') || 0, 0, 650)) : 0;
  let sim = null, build = null, seed = 0;
  let timer = null, last = 0, owed = 0, n = 0, steps = 0;
  const ready = loadDefaults(env, url).then(d => {
    build = d.build;
    seed = crypto.getRandomValues(new Uint32Array(1))[0];
    sim = createSim({ seed, params: simParams(d.P) });
    sim.params.history = true;          // the ring lag compensation reads (sim.js)
    /* Under wrangler dev only (--var PINK_WAIT:4 PINK_STAY:40): the pink
       manta in seconds rather than a minute, for the room tests. A deploy
       sets neither, so production keeps the drawer's defaults. */
    if (env && env.PINK_WAIT > 0) sim.params.pinkWait = +env.PINK_WAIT;
    if (env && env.PINK_STAY > 0) sim.params.pinkStay = +env.PINK_STAY;
    sim.you.dead = 1e9; sim.you.followers.length = 0;   // no human manta yet
    if (staged) stage();
  });

  /* PLAYERS. phone.player = {id, name, token, ack, lagComp} while a person
     drives train id; `held` keeps a dropped one's token for HOLD_MS. */
  const held = new Map();             // token -> {id, name, until}
  const trainOf = id => sim.rivals.find(t => t.id === id);
  const players = () => { const a = []; for (const p of phones.values()) if (p.player) a.push(p.player); return a; };
  let names = [];                     // [[id, name], ...] for every train a player drives
  function renameAll () { names = players().map(q => [q.id, q.name]).sort((a, b) => a[0] - b[0]); }
  function forgetHeld (now) { for (const [tok, h] of held) if (h.until <= now) held.delete(tok); }
  function newName () {
    const taken = new Set([...players().map(q => q.name), ...[...held.values()].map(h => h.name)]);
    for (let k = 0; k < 200; k++) {
      const w = crypto.getRandomValues(new Uint32Array(2));
      const name = FIRST[w[0] % FIRST.length] + ' ' + SECOND[w[1] % SECOND.length];
      if (!taken.has(name)) return name;
    }
    let i = 2; while (taken.has('manta ' + i)) i++;
    return 'manta ' + i;
  }
  /* Take a train for a player: its own held one back by token, else the
     first bot nobody drives or holds, else the hold that ends soonest. */
  function seat (phone, m) {
    const now = Date.now();
    forgetHeld(now);
    const driven = new Set(players().map(q => q.id));
    const tok = typeof m.k === 'string' ? m.k : '';
    let id = -1, name = '', token = '';
    if (tok) {
      /* A TOKEN IS ONE LIVE CONNECTION'S (3G). Only a manta the room is
         holding for it (a drop, or a player benched as away) can be taken
         back. A second connection with a token still in use, a duplicated
         tab, gets a manta and a token of its own and never takes the
         first one's train. */
      const h = held.get(tok);
      if (h && trainOf(h.id) && !driven.has(h.id)) { id = h.id; name = phone.wantName || h.name; token = tok; held.delete(tok); }
    }
    if (id < 0) {
      if (driven.size >= MAX_PLAYERS) return null;
      const heldIds = new Set([...held.values()].map(h => h.id));
      let t = sim.rivals.find(o => !driven.has(o.id) && !heldIds.has(o.id));
      if (!t) {
        let soonest = null;
        for (const [k, h] of held) if (!driven.has(h.id) && trainOf(h.id) && (!soonest || h.until < soonest[1].until)) soonest = [k, h];
        if (!soonest) return null;
        held.delete(soonest[0]); t = trainOf(soonest[1].id);
      }
      id = t.id; name = phone.wantName || newName(); token = hex(6);
    }
    const t = trainOf(id);
    t.human = { want: null, burst: false, rewind: 0 };
    phone.player = { id, name, token, ack: 0, seqIn: 0, queue: [], early: null, earlySeq: 0, late: 0, wish: 0, lastIn: now,
                     lagComp: !(phone.local && m.l === 0) };
    phone.me = phone.player;          // snapFor reads {id, ack} from here
    renameAll();
    return phone.player;
  }
  /* AN INPUT IS FOR A STEP. k is the simulation step it applies to, on the
     room's own count; d is how many steps behind k the phone was showing
     the other trains when it was made. Queued, and applied at step k (runStep below), or
     on the next step if k has already run. How early it came, in steps of
     the room's clock at the moment it arrived, goes back in the next
     snapshot so the phone can hold its inputs just ahead of need. The
     rewind lag compensation uses is d: where the others were on that
     screen, never more than REWIND_MAX back. */
  function input (phone, m) {
    const q = phone.player, t = q && trainOf(q.id);
    if (!t || !t.human || !Number.isInteger(m.seq) || m.seq <= q.seqIn) return;
    q.seqIn = m.seq; q.lastIn = Date.now();
    const next = steps + 1, clock = steps + (owed + (Date.now() - last) / 1000) / STEP;
    const k = Number.isInteger(m.k) ? m.k : next;
    const early = k - clock;
    if (k < next) q.late++;
    q.early = q.early === null ? early : Math.min(q.early, early); q.earlySeq = m.seq;
    const wish = Number.isFinite(m.d) ? m.d : 0;
    q.wish = wish;
    const e = { at: Math.min(Math.max(k, next), next + AHEAD_MAX), seq: m.seq,
      want: Number.isFinite(m.w) ? m.w : null, burst: !!m.b,
      rewind: q.lagComp ? Math.max(0, Math.min(REWIND_MAX, Math.round(wish))) : 0 };
    let i = q.queue.length;
    while (i > 0 && q.queue[i - 1].at > e.at) i--;
    q.queue.splice(i, 0, e);
    if (q.queue.length > QUEUE_MAX) q.queue.shift();
  }
  /* Before step K: every queued input due by then, in order; the last wins. */
  function applyInputs (K) {
    for (const phone of phones.values()) {
      const q = phone.player;
      if (!q || !q.queue.length) continue;
      const t = trainOf(q.id);
      if (!t || !t.human) { q.queue.length = 0; continue; }
      while (q.queue.length && q.queue[0].at <= K) {
        const e = q.queue.shift();
        t.human.want = e.want; t.human.burst = e.burst; t.human.rewind = e.rewind; q.ack = e.seq;
      }
    }
  }
  /* A TYPED NAME (3J): cleaned as the phone cleans it (roomcore.js
     cleanName), at most one change every 5 s, kept with the reconnect token
     (held keeps the player's name), and on every board and label with the
     next snapshot (renameAll). Empty keeps the generated name. */
  function nameIt (phone, raw) {
    const now = Date.now();
    if (phone.nameAt && now - phone.nameAt < 5000) return;
    const n = cleanName(raw);
    if (!n) return;
    phone.nameAt = now; phone.wantName = n;
    if (phone.player) { phone.player.name = n; renameAll(); }
  }
  function bench (ws, phone) {
    unseat(phone);
    try { ws.send(JSON.stringify({ t: 'benched' })); } catch (_) { /* gone */ }
  }
  /* Dropped: the brain holds the train and the token waits HOLD_MS. */
  function unseat (phone) {
    const q = phone.player;
    if (!q) return;
    phone.player = null; phone.me = null;
    const t = sim && trainOf(q.id);
    if (t) t.human = null;
    held.set(q.token, { id: q.id, name: q.name, until: Date.now() + HOLD_MS });
    renameAll();
  }

  function tick () {
    const now = Date.now();
    owed += (now - last) / 1000; last = now;
    let k = 0;
    while (owed >= STEP && k < 12) {
      applyInputs(steps + 1);
      if (staged && !mine && (steps + 1) % CYCLE === 0) putBack();
      if (race && (steps + 1) % CYCLE === 55) cluster();
      sim.step(); owed -= STEP; k++; steps++;
    }
    if (owed > STEP * 12) owed = 0;               // a stall is not caught up
    const events = sim.events.splice(0);
    n++;
    if (held.size) forgetHeld(now);
    /* AWAY (3G): a player whose inputs have stopped for AWAY_MS (the phone
       sends one at least every 200 ms) is benched whatever the phone is
       doing: a bot takes the manta, labelled as a bot, and holds it as for
       a drop. The phone is told, and rejoins with its token once shown. */
    for (const [ws, phone] of phones) if (phone.player && now - phone.player.lastIn > AWAY_MS) bench(ws, phone);
    for (const [ws, phone] of phones) {
      if (!phone.ready) continue;
      /* Binary (roomcore.js has the layout, a player's own fields
         included); who drives what, as JSON when it changed; the truth
         after it only for a debug phone, which only wrangler dev allows. */
      const nk = names.map(q => q.join(':')).join(';');
      if (nk !== phone.names) { phone.names = nk; try { ws.send(JSON.stringify({ t: 'names', names })); } catch (_) { /* gone */ } }
      const { data, truth } = snapFor(sim, phone, n, events, steps);
      try {
        ws.send(data);
        if (truth) {
          const q = phone.player, t = q && trainOf(q.id);
          if (q) truth.rw = [t && t.human ? t.human.rewind : 0, Math.round(q.wish * 10) / 10];
          ws.send(JSON.stringify({ t: 'truth', n, w: Date.now(), ...truth }));   // w: the room's wall clock (3I tests)
        }
      } catch (_) { /* gone */ }
    }
  }

  /* THE STAGED CUT (tests only, see the top). Bot 2 swims east across the
     player's path, never thinking; the rest are out of the water for good. */
  function stage () {
    for (const t of sim.rivals) if (t.id > 2) { t.dead = 1e9; t.followers.length = 0; }
    putBack();
    if (mine) layLong(trainOf(1), mine, sim.params);
  }
  function cluster () {
    let n = 0;
    for (const m of sim.wild) {
      if (!m || !m.alive || m.loose || n >= 16) continue;
      m.x = ((n % 4) - 1.5) * 12; m.z = (Math.floor(n / 4) - 1.5) * 12; n++;
    }
  }
  function putBack () {
    const lay = (t, x, z, head, count) => {
      if (!t) return;
      t.dead = 0; t.crashed = 0; t.cut = 0; t.bursting = false; t.burstOwed = 0; t.rebuild = 10;
      t.x = x; t.z = z; t.head = head; t.runs++;
      t.followers.length = 0;
      for (let i = 0; i < count; i++) t.followers.push({ x, z, head, born: sim.time, from: 0 });
      /* The path straight behind, laid here: sim.js seedTrail lays it
         mirrored left to right (a fix held back in 3E), and this train goes
         east. Behind is +sin, +cos. */
      t.trail.length = 0;
      const sp = sim.params.spacing;
      for (let d = 40 * sp; d >= 0; d -= sp / 4) t.trail.push({ x: x + Math.sin(head) * d, z: z + Math.cos(head) * d, h: head, s: t.s - d });
    };
    const seated = trainOf(1), cross = trainOf(2);
    if (race) {
      /* ?xb=2 (3I, tests only): the player and bot 2 swim head on, 50
         apart, through a cluster of 16 wild mantas laid at the middle as
         they close in (cluster(), 0.9 s after this); the bot starts 30
         nearer, so some the player's phone reaches for are the bot's. */
      lay(seated, -25, 260, 0, 12);
      lay(cross, 25, -230, Math.PI, 12);
      if (cross) cross.human = { want: Math.PI, burst: false, rewind: 0 };
      return;
    }
    if (botCuts) {
      /* ?xb=1 (3H): the other way round. The player's train crosses and
         bot 2 bursts into its body, so the cuts near the player are a bot's. */
      lay(seated, -60, 0, -Math.PI / 2, crossLen);
      lay(cross, 0, 260, 0, 12);
      if (cross) cross.human = { want: 0, burst: true, rewind: 0 };
      return;
    }
    lay(seated, 0, 260, 0, 12);                     // heading -z, towards the crossing
    lay(cross, -60, 0, -Math.PI / 2, crossLen);     // heading +x, across the seat's path
    if (cross) cross.human = { want: -Math.PI / 2, burst: false, rewind: 0 };
  }
  const start = () => { if (timer) return; last = Date.now(); owed = 0; timer = setInterval(tick, 1000 / SNAP_HZ); };
  const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
  function leave (ws) {
    const phone = phones.get(ws);
    if (phone) unseat(phone);
    phones.delete(ws);
    for (const p of phones.values()) if (p.ready) return;
    stop();
  }

  return {
    join (ws, local) { phones.set(ws, { view: viewOf(null), watch: -1, sent: new Map(), debug: false, local, ready: false }); },
    get crowded () { return phones.size >= MAX_SOCKETS; },
    leave,
    async message (ws, raw) {
      const phone = phones.get(ws);
      if (!phone) return;
      let m; try { m = JSON.parse(raw); } catch (_) { return; }
      if (!m || typeof m !== 'object' || Array.isArray(m)) return;
      if (m.t === 'in') { if (inOk(m, steps)) input(phone, m); return; }
      if (m.t === 'away') { if (phone.player) bench(ws, phone); return; }
      if (m.t === 'nm') { if (typeof m.n === 'string') nameIt(phone, m.n); return; }
      if (m.t === 'ping') { if (num(m.c, 0, 1e12)) ws.send(JSON.stringify({ t: 'pong', c: m.c })); return; }
      if (m.t === 'view') { if (viewOk(m)) { phone.view = viewOf(m); phone.watch = m.a === undefined ? -1 : m.a; } return; }
      if (m.t !== 'hi' || !hiOk(m)) return;
      await ready;
      /* A phone on another build is told to reload rather than play. */
      if (m.b !== String(build).replace(/\D/g, '').slice(2)) {   // the build's digits: 64 bytes (3G)
        ws.send(JSON.stringify({ t: 'reload', build }));
        try { ws.close(4000, 'new build'); } catch (_) { /* already closed */ }
        leave(ws);
        return;
      }
      phone.watch = m.a === undefined ? -1 : m.a;   // the view comes in its own message
      phone.debug = !!(m.g === 1 && phone.local);   // truth for tests, only under wrangler dev
      /* A second hello on the same socket gives its train back first. */
      if (phone.player) unseat(phone);
      let me = null;
      if (m.p !== 1) {
        let watching = 0;
        for (const p of phones.values()) if (p !== phone && p.ready && !p.player) watching++;
        if (watching >= MAX_WATCHERS) {
          ws.send(JSON.stringify({ t: 'full' }));
          try { ws.close(4002, 'room full'); } catch (_) { /* already closed */ }
          leave(ws);
          return;
        }
      }
      if (m.p === 1) {
        me = seat(phone, m);
        if (!me) {
          ws.send(JSON.stringify({ t: 'full' }));
          try { ws.close(4002, 'room full'); } catch (_) { /* already closed */ }
          leave(ws);
          return;
        }
        phone.watch = me.id;
      }
      phone.sent.clear(); phone.board = null; phone.names = null; phone.mePeak = null; phone.wild = null; phone.wildTick = 0; phone.ready = true;
      const init = { t: 'init', build, seed, params: sim.params, time: sim.time, steps,
        kinds: sim.rivals.map(t => [t.id, t.kind || 'bot']) };
      if (me) { init.me = { id: me.id, name: me.name, token: me.token }; init.names = names; }
      /* The radar's starting paths (3L): each train's trail at RADAR_RES units
         a point, newest first, back to its length. */
      init.rp = sim.rivals.map(t => {
        const pts = [], sp = sim.params.spacing || 19; let need = t.s;
        for (let i = t.trail.length - 1; i >= 0; i--) { const q = t.trail[i]; if (t.s - q.s > t.followers.length * sp + RADAR_RES) break; if (q.s <= need) { pts.push(Math.round(q.x), Math.round(q.z)); need -= RADAR_RES; } }
        return [t.id, t.runs, pts];
      });
      ws.send(JSON.stringify(init));
      start();
    },
    get stepping () { return timer !== null; },
    get build () { return build; },
    get players () { return players().length; },
    get staged () { return staged; },
    get steps () { return steps; },
  };
}

/* Under wrangler dev only: n steps of a fresh ocean at the defaults, so a
   test can time the simulation inside workerd from outside (its clocks do
   not move during a request). */
export async function bench (env, url, count) {
  const d = await loadDefaults(env, url);
  const s = createSim({ seed: 7, params: simParams(d.P) });
  for (let i = 0; i < count; i++) { s.input.want = Math.sin(i / 90) * 2; s.step(); s.events.length = 0; }
  return { steps: count, wild: s.wild.filter(w => w && w.alive).length, followers: s.rivals.reduce((a, t) => a + t.followers.length, 0) };
}
