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
import { snapFor, SNAP_HZ } from '../docs/lab/manta/roomcore.js';

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
});

const MAX_PLAYERS = 10;
const HOLD_MS = 15000;            // a dropped player's train waits this long for its token
const REWIND_MAX = 15;            // steps (250 ms); the simulation keeps no more
const AHEAD_MAX = 120;            // an input stamped further ahead than this is applied at that
const QUEUE_MAX = 64;             // inputs a player may have waiting
const CYCLE = 150;                // the staged cut: steps between put-backs (2.5 s)
/* Names, never typed: a word from each list, unique in the room. */
const FIRST = ['coral', 'amber', 'silver', 'misty', 'swift', 'quiet', 'bright', 'lucky', 'salty', 'sunny', 'deep', 'blue'];
const SECOND = ['fox', 'otter', 'heron', 'comet', 'pebble', 'kelp', 'wave', 'finch', 'drift', 'lantern', 'tide', 'moth'];
const hex = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, '0')).join('');

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(+v) ? +v : lo));
const viewOf = m => ({ x: clamp(m && m.x, -1e5, 1e5), z: clamp(m && m.z, -1e5, 1e5),
                       w: clamp(m && m.w, 100, 6000), h: clamp(m && m.h, 100, 6000) });

export function createOcean (env, url, opts = {}) {
  const phones = new Map();           // socket -> what this phone has been sent
  const staged = opts.stage === 'cut';
  /* The crossing train's length, 20 unless a test asks (?len=, 2 to 40). */
  const crossLen = Math.round(clamp(url.searchParams.get('len') || 20, 2, 40));
  let sim = null, build = null, seed = 0;
  let timer = null, last = 0, owed = 0, n = 0, steps = 0;
  const ready = loadDefaults(env, url).then(d => {
    build = d.build;
    seed = crypto.getRandomValues(new Uint32Array(1))[0];
    sim = createSim({ seed, params: simParams(d.P) });
    sim.params.history = true;          // the ring lag compensation reads (sim.js)
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
    const tok = typeof m.token === 'string' && m.token.length <= 64 ? m.token : '';
    let id = -1, name = '', token = '';
    if (tok) {
      /* The same token on a socket still open (a reconnect before the old
         close arrived): the new socket takes the train over. */
      for (const [ws, p] of phones) if (p !== phone && p.player && p.player.token === tok) {
        const q = p.player; p.player = null; p.me = null;
        driven.delete(q.id); held.set(tok, { id: q.id, name: q.name, until: now + HOLD_MS });
        try { ws.close(4001, 'replaced'); } catch (_) { /* gone */ }
      }
      const h = held.get(tok);
      if (h && trainOf(h.id) && !driven.has(h.id)) { id = h.id; name = h.name; token = tok; held.delete(tok); }
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
      id = t.id; name = newName(); token = hex(16);
    }
    const t = trainOf(id);
    t.human = { want: null, burst: false, rewind: 0 };
    phone.player = { id, name, token, ack: 0, seqIn: 0, queue: [], early: null, earlySeq: 0, late: 0, wish: 0,
                     lagComp: !(phone.local && m.lagComp === false) };
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
    q.seqIn = m.seq;
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
      if (staged && (steps + 1) % CYCLE === 0) putBack();
      sim.step(); owed -= STEP; k++; steps++;
    }
    if (owed > STEP * 12) owed = 0;               // a stall is not caught up
    const events = sim.events.splice(0);
    n++;
    if (held.size) forgetHeld(now);
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
          ws.send(JSON.stringify({ t: 'truth', n, ...truth }));
        }
      } catch (_) { /* gone */ }
    }
  }

  /* THE STAGED CUT (tests only, see the top). Bot 2 swims east across the
     player's path, never thinking; the rest are out of the water for good. */
  function stage () {
    for (const t of sim.rivals) if (t.id > 2) { t.dead = 1e9; t.followers.length = 0; }
    putBack();
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
    leave,
    async message (ws, raw) {
      const phone = phones.get(ws);
      if (!phone) return;
      let m; try { m = JSON.parse(raw); } catch (_) { return; }
      if (m.t === 'in') { input(phone, m); return; }
      if (m.t === 'ping') { ws.send(JSON.stringify({ t: 'pong', c: m.c })); return; }
      if (m.t === 'view') { phone.view = viewOf(m); phone.watch = Number.isInteger(m.watch) ? m.watch : -1; return; }
      if (m.t !== 'hello') return;
      await ready;
      /* A phone on another build is told to reload rather than play. */
      if (m.build !== build) {
        ws.send(JSON.stringify({ t: 'reload', build }));
        try { ws.close(4000, 'new build'); } catch (_) { /* already closed */ }
        leave(ws);
        return;
      }
      phone.view = viewOf(m.view); phone.watch = Number.isInteger(m.watch) ? m.watch : -1;
      phone.debug = !!(m.debug && phone.local);   // truth for tests, only under wrangler dev
      /* A second hello on the same socket gives its train back first. */
      if (phone.player) unseat(phone);
      let me = null;
      if (m.play === true) {
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
      ws.send(JSON.stringify(init));
      start();
    },
    get stepping () { return timer !== null; },
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
