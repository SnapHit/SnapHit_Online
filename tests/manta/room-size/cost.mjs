/* Brief 4B part 1c and 1d: what a room costs to run, in plain Node, at 11,
   21, 31 and 51 mantas, and what it sends each phone.

   The room's own code: rooms/ocean.js is loaded from the tree, with only
   these changes made IN MEMORY to a copy in MANTA_OUT (the repo is never
   touched): its imports point back at docs/lab/manta/, its seat count is
   raised to n-1 when that is more than it has, and three hooks are added
   that time each simulation step and each 20 Hz tick and hand the harness
   the simulation to read. The room's timer and wall clock are replaced by
   a clock this harness moves 50 ms a tick, and crypto by a seeded
   generator, so a run is the same run every time.

   THE OCEAN FOR n MANTAS (SIZE=scaled, the default): the room's committed
   defaults from docs/lab/manta/params.js, as the room loads them, with
   n-1 bots (the room's own solo manta is kept out of the water, so n-1
   trains swim, all of them seats), arena radius 2000 x sqrt(n/11) and
   300 x n/11 wild mantas, rounded to the nearest 10 (and, once the room
   sizes its own ocean in 4B, blooms 4 x (radius/2000)^2, set in the copy's
   ROOM_ constants). SIZE=room takes the room exactly as it is in the tree.

   THE PHONES: n-1, each seated on a train, as a player's phone is. Each
   says hello, then every 50 ms of the room's clock: a view of its leader at
   its zoom every 200 ms when it moved, a ping a second, and inputs at the
   rate phones sent them before 4B part 3 (each change, at most 20 and at
   least 5 a second: more incoming messages than phones now send, so the
   room's cost is not understated), steering towards a point that moves every few seconds, with a
   burst now and then (PLAYERS=scripted), or steering and bursting as the
   room's bot brain would for that train (PLAYERS=bot), so they eat, give
   way and grow as bots do and the trains are longer, or sending no
   inputs at all (PLAYERS=brain), so the room benches each after 2 s and
   the brain drives all n-1 trains inside the timed steps while every phone
   is still sent its snapshots: the dearest room there is. Their zoom follows their own train's length
   (ZOOM=natural), or is held at one zoom for all (near 1.5, mid 1.06, far
   0.4, burst 0.357: the far view widened 12%), on a 412 x 915 screen.

   WHAT IS TIMED: each sim.step() on its own, and each tick whole; the tick
   less its steps is the snapshots and everything else the room does at
   20 Hz, shared equally among that tick's steps. A step's cost is its own
   time plus that share. Mean and 99th percentile over every step measured,
   after a warm-up.

   WHAT IS COUNTED (BYTES=1): every message the room sends each phone,
   with WebSocket framing (2 bytes under 126, 4 under 65536), and every
   message each phone sends, with framing and mask (6 bytes), per second of
   the room's clock; median and 95th percentile over phones x seconds.

   node tests/manta/room-size/cost.mjs                 the step cost, 11 21 31 51
   N=21 ZOOM=far BYTES=1 node tests/manta/room-size/cost.mjs
   Env: N (list), SIZE (scaled|room), WARM_S (60), MEASURE_S (120), SEED (1),
   PLAYERS (scripted|bot|brain),
   ZOOM (natural|near|mid|far|burst), BYTES, BREAKDOWN (bytes by section of
   the snapshot, over every second and over the dearest 5%), MANTA_OUT. */
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const TREE = decodeURIComponent(new URL('../../..', import.meta.url).pathname).replace(/\/$/, '');
const OUT = process.env.MANTA_OUT || mkdtempSync(join(tmpdir(), 'manta-'));
mkdirSync(OUT, { recursive: true });
const NS = (process.env.N || '11,21,31,51').split(',').map(Number);
const SIZE = process.env.SIZE || 'scaled';
const WARM_S = +(process.env.WARM_S || 60), MEASURE_S = +(process.env.MEASURE_S || 120);
const ZOOM = process.env.ZOOM || 'natural', BYTES = process.env.BYTES === '1' || process.env.BREAKDOWN === '1', BREAKDOWN = process.env.BREAKDOWN === '1';
const SEED = +(process.env.SEED || 1), PLAYERS = process.env.PLAYERS || 'scripted';
const ZOOMS = { near: 1.5, mid: 1.5 / Math.SQRT2, far: 0.4, burst: 0.4 / 1.12 };
const VIEW_AREA = +readFileSync(TREE + '/docs/lab/manta/scene.js', 'utf8').match(/export const VIEW_AREA = (\d+)/)[1];
const ASPECT = 412 / 915;
const { zoomFor, viewFor } = await import(TREE + '/docs/lab/manta/simcore.js');
const build = readFileSync(TREE + '/docs/lab/manta/panel.js', 'utf8').match(/export const BUILD = '([^']+)'/)[1];

/* A seeded crypto.getRandomValues, so the room's seed, names and tokens
   repeat: mulberry32. */
let rs = SEED >>> 0;
const rnd32 = () => { rs = (rs + 0x6D2B79F5) >>> 0; let t = rs; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return (t ^ (t >>> 14)) >>> 0; };
Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { getRandomValues (a) { for (let i = 0; i < a.length; i++) a[i] = rnd32() & (a.BYTES_PER_ELEMENT === 1 ? 255 : a.BYTES_PER_ELEMENT === 2 ? 65535 : 0xffffffff); return a; } } });
const rnd = () => rnd32() / 4294967296;

/* The room's clock and timer, moved by hand. */
let clock = 1.7e12; const realNow = Date.now; Date.now = () => clock;
let roomTick = null;
const realSetInterval = globalThis.setInterval, realClearInterval = globalThis.clearInterval;
globalThis.setInterval = (fn) => { roomTick = fn; return 1; };
globalThis.clearInterval = () => { roomTick = null; };

/* Timing hooks the patched copy calls. */
const cost = { steps: [], ticks: [], cur: [] };
globalThis.__cost = {
  step (ms) { cost.cur.push(ms); },
  tickEnd (ms) { cost.ticks.push({ ms, steps: cost.cur }); cost.cur = []; },
};

let copies = 0, roomSized = false;
async function loadOcean (seats, sizes) {
  let src = readFileSync(TREE + '/rooms/ocean.js', 'utf8');
  const one = (a, b) => { const k = src.split(a).length - 1; if (k !== 1) throw new Error('patch matched ' + k + ' times: ' + a); src = src.replace(a, b); };
  const base = pathToFileURL(TREE + '/docs/lab/manta/').href;
  if (!src.includes("from '../docs/lab/manta/")) throw new Error('patch: imports not found');
  src = src.replaceAll("from '../docs/lab/manta/", "from '" + base);
  /* Seats: a number before 4B; from 4B, ROOM_TRAINS (set below). */
  const mp = src.match(/const MAX_PLAYERS = (\d+|ROOM_TRAINS);/);
  if (!mp) throw new Error('patch: MAX_PLAYERS not found');
  if (mp[1] !== 'ROOM_TRAINS' && +mp[1] < seats) one(mp[0], 'const MAX_PLAYERS = ' + seats + ';');
  one('sim.step(); owed -= STEP;', '{ const __a = performance.now(); sim.step(); globalThis.__cost.step(performance.now() - __a); } owed -= STEP;');
  one('function tick () {', 'function tick () { const __t = performance.now(); tick0(); globalThis.__cost.tickEnd(performance.now() - __t); }\n  function tick0 () {');
  one('get stepping () {', 'get sim () { return sim; }, get stepping () {');
  /* From 4B the room sizes its own ocean (ROOM_TRAINS and the rest in
     ocean.js), so a scaled ocean is set there; before it, through the
     params.js defaults the room loads (envFor). */
  const rc = src.match(/export const ROOM_TRAINS = \d+, ROOM_ARENA = \d+, ROOM_WILD = \d+, ROOM_BLOOMS = \d+;/);
  if (rc && sizes) one(rc[0], 'export const ROOM_TRAINS = ' + sizes.bots + ', ROOM_ARENA = ' + sizes.arenaR + ', ROOM_WILD = ' + sizes.wildCount + ', ROOM_BLOOMS = ' + Math.round(4 * (sizes.arenaR / 2000) ** 2) + ';');
  roomSized = !!rc;
  const file = join(OUT, 'ocean-copy-' + (copies++) + '.mjs');
  writeFileSync(file, src);
  return (await import(pathToFileURL(file).href)).createOcean;
}

/* The room's assets: docs/ from the tree, params.js with this ocean's size. */
function envFor (sizes) {
  return { ASSETS: { async fetch (req) {
    const path = new URL(req.url).pathname;
    let text = readFileSync(TREE + '/docs' + path, 'utf8');
    if (path.endsWith('/params.js') && sizes) {
      for (const [key, v] of Object.entries(sizes)) {
        const re = new RegExp("(\\{ key: '" + key + "',[^}]*?def: )([-\\d.e]+)");
        if (!re.test(text)) throw new Error('params: no ' + key);
        text = text.replace(re, '$1' + v);
      }
    }
    return new Response(text);
  } } };
}

const frame = n => (n < 126 ? 2 : n < 65536 ? 4 : 10);
/* A snapshot's bytes by section (roomcore.js has the layout): header and
   framing, trains (leaders, and path points fresh or new), events, board,
   wild (full lists and changes), radar, the pink manta and shark, a
   player's own block. */
const { decodeSnap } = await import(TREE + '/docs/lab/manta/roomcore.js');
function partsOf (buf, framing) {
  const m = decodeSnap(buf), o = { head: 20 + framing, leaders: 0, paths: 0, freshPaths: 0, events: 0, board: 0, wild: 0, radar: 0, pinkShark: 0, me: 0 };
  for (const q of m.tr) { o.leaders += 15 + (q.fresh ? 3 : 0); const pb = q.pts.length ? 9 + 7 * (q.pts.length - 1) : 0; if (q.fresh) o.freshPaths += pb; else o.paths += pb; }
  o.events = 7 * m.ev.length;
  if (m.bd) o.board = 1 + 3 * m.bd.length;
  if (m.wd) o.wild += 2 + 9 * m.wd.length;
  if (m.wa) o.wild += 4 + 9 * m.wa.length + 2 * m.wg.length;
  if (m.rd) o.radar = 1 + 10 * m.rd.length;
  if (m.pk) o.pinkShark += 7; if (m.sk) o.pinkShark += 5;
  o.me = buf.byteLength - (Object.values(o).reduce((a, v) => a + v, 0) - framing);
  return o;
}
const pct = (a, p) => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]; };
const mean = a => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);

async function run (n) {
  const sizes = SIZE === 'scaled' ? { bots: n - 1, arenaR: Math.round(2000 * Math.sqrt(n / 11) / 10) * 10, wildCount: Math.round(300 * n / 11 / 10) * 10 } : null;
  const createOcean = await loadOcean(n - 1, sizes);
  const ocean = createOcean(envFor(roomSized ? null : sizes), new URL('http://127.0.0.1/lab/manta/rooms/ocean/cost'), {});
  const digits = String(build).replace(/\D/g, '').slice(2);
  const phones = [];
  for (let i = 0; i < n - 1; i++) {
    const p = { i, ws: null, id: -1, seq: 0, sentW: null, sentB: false, sentAt: -1e9, viewAt: -1e9, pingAt: -1e9 + i * 37, sentView: null,
                aim: null, aimUntil: 0, burstUntil: 0, nextBurst: 0, down: [], up: [], parts: [], bin: 0 };
    p.ws = { send (d) { const b = typeof d === 'string' ? Buffer.byteLength(d) : d.byteLength; p.down.push([clock, b + frame(b)]);
                         if (BREAKDOWN) p.parts.push([clock, typeof d === 'string' ? { json: b + frame(b) } : partsOf(d, frame(b))]);
                         if (typeof d === 'string') { const m = JSON.parse(d); if (m.t === 'init' && m.me) p.id = m.me.id; if (m.t === 'full') p.full = true; } },
             close () { p.closed = true; } };
    phones.push(p);
  }
  const up = (p, m) => { const s = JSON.stringify(m); p.up.push([clock, Buffer.byteLength(s) + 6]); return ocean.message(p.ws, s); };
  for (const p of phones) { ocean.join(p.ws, false); await up(p, { t: 'hi', b: digits, p: 1 }); }
  const seated = phones.filter(p => p.id >= 0).length;
  if (seated !== n - 1) throw new Error('seated ' + seated + ' of ' + (n - 1));
  const sim = ocean.sim, P = sim.params;
  const trainOf = id => sim.rivals.find(t => t.id === id);
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

  /* One phone, once a tick (50 ms of the room's clock). */
  function phoneTick (p, t) {
    const tr = trainOf(p.id); if (!tr) return;
    const now = clock;
    if (!p.aim || now >= p.aimUntil || Math.hypot(p.aim.x - tr.x, p.aim.z - tr.z) < 80) {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * (P.arenaR - 400);
      p.aim = { x: Math.cos(a) * r, z: Math.sin(a) * r }; p.aimUntil = now + 2000 + rnd() * 4000;
    }
    if (now >= p.nextBurst) { p.burstUntil = now + 400 + rnd() * 800; p.nextBurst = now + 3000 + rnd() * 5000; }
    let w = Math.round(wrap(Math.atan2(-(p.aim.x - tr.x), -(p.aim.z - tr.z)) + 0.08 * Math.sin(now / 300 + p.i)) * 1e4) / 1e4;
    let b = now < p.burstUntil;
    if (PLAYERS === 'bot' && !(tr.dead > 0)) {
      /* The bot brain's choice for this train, as its input: players who
         eat, give way and grow as bots do. */
      const h = tr.human; tr.human = null; sim.brain.think(tr, 0.05);
      w = tr.want === null || tr.want === undefined ? null : Math.round(wrap(tr.want) * 1e4) / 1e4; b = !!tr.bursting; tr.human = h;
    }
    const since = now - p.sentAt;
    if (PLAYERS === 'brain') return viewAndPing(p, tr, now);
    const changed = b !== p.sentB || (w === null) !== (p.sentW === null) || (w !== null && Math.abs(wrap(w - p.sentW)) > 0.02);
    if (since >= 50 && (changed || since >= 200)) {
      p.seq++; p.sentW = w; p.sentB = b; p.sentAt = now;
      const m = { t: 'in', seq: p.seq, k: ocean.steps + 3, w, d: 12 }; if (b) m.b = 1;
      up(p, m);
    }
    viewAndPing(p, tr, now);
  }
  function viewAndPing (p, tr, now) {
    const len = tr.followers.length, z = ZOOM === 'natural' ? zoomFor(len, P) : ZOOMS[ZOOM];
    const v = viewFor(VIEW_AREA, ASPECT, z), vx = tr.dead > 0 ? tr.crashX : tr.x, vz = tr.dead > 0 ? tr.crashZ : tr.z;
    const moved = !p.sentView || Math.abs(vx - p.sentView.x) + Math.abs(vz - p.sentView.z) > 10 || Math.abs(v.w - p.sentView.w) > 1;
    if (moved && now - p.viewAt >= 200) { up(p, { t: 'view', x: Math.round(vx), z: Math.round(vz), w: Math.round(v.w), h: Math.round(v.h) }); p.sentView = { x: vx, z: vz, w: v.w }; p.viewAt = now; }
    if (now - p.pingAt >= 1000) { up(p, { t: 'ping', c: now % 1e9 }); p.pingAt = now; }
  }

  const ticks = Math.round((WARM_S + MEASURE_S) * 20), warm = Math.round(WARM_S * 20);
  let t0 = null;
  for (let k = 0; k < ticks; k++) {
    if (k === warm) { cost.ticks = []; t0 = clock; for (const p of phones) { p.down = []; p.up = []; p.parts = []; } }
    for (const p of phones) phoneTick(p, k);
    clock += 50;
    if (!roomTick) throw new Error('the room is not ticking');
    roomTick();
  }
  /* Per step: its own time plus an equal share of its tick's remainder. */
  const per = [], simOnly = [], share = [];
  for (const t of cost.ticks) {
    const st = t.steps.reduce((s, v) => s + v, 0), rest = Math.max(0, t.ms - st), k = t.steps.length || 1;
    for (const s of t.steps) { per.push(s + rest / k); simOnly.push(s); }
    share.push(rest / k);
  }
  const lens = sim.rivals.map(t => t.dead > 0 ? 0 : t.followers.length).sort((a, b) => b - a);
  const row = { n, players: PLAYERS, trains: sim.rivals.length, phones: n - 1, arenaR: P.arenaR, wild: P.wildCount, steps: per.length,
    mean: mean(per), p99: pct(per, 0.99), max: Math.max(...per), simMean: mean(simOnly), simP99: pct(simOnly, 0.99), snapShare: mean(share),
    tickMean: mean(cost.ticks.map(t => t.ms)), tickP99: pct(cost.ticks.map(t => t.ms), 0.99), lengths: lens.slice(0, 5).join('/') + ' longest, median ' + lens[lens.length >> 1] };
  if (BYTES) {
    const secs = Math.floor(MEASURE_S), down = [], both = [], upr = [], msgs = [];
    for (const p of phones) for (let s = 0; s < secs; s++) {
      const a = t0 + s * 1000, b = a + 1000, sum = arr => arr.filter(([t]) => t >= a && t < b).reduce((x, [, v]) => x + v, 0);
      const d = sum(p.down), u = sum(p.up); down.push(d); upr.push(u); both.push(d + u); msgs.push(p.up.filter(([t]) => t >= a && t < b).length);
    }
    if (BREAKDOWN) {
      /* Each section's share: over every phone-second, and over the
         dearest 5% of them (what makes the 95th percentile). */
      const sec = []; for (const p of phones) for (let s2 = 0; s2 < secs; s2++) { const a = t0 + s2 * 1000, b = a + 1000, acc = { total: 0 };
        for (const [t, parts] of p.parts) if (t >= a && t < b) for (const [k2, v] of Object.entries(parts)) { acc[k2] = (acc[k2] || 0) + v; acc.total += v; }
        sec.push(acc); }
      sec.sort((x, y) => x.total - y.total);
      const avg = list => { const o = {}; for (const r of list) for (const [k2, v] of Object.entries(r)) o[k2] = (o[k2] || 0) + v / list.length; return Object.fromEntries(Object.entries(o).map(([k2, v]) => [k2, +(v / 1024).toFixed(2)])); };
      row.parts = { all: avg(sec), top5: avg(sec.slice(Math.floor(sec.length * 0.95))) };
    }
    Object.assign(row, { zoom: ZOOM, view: ZOOM === 'natural' ? 'natural' : (() => { const v = viewFor(VIEW_AREA, ASPECT, ZOOMS[ZOOM]); return Math.round(v.w) + 'x' + Math.round(v.h); })(),
      down50: pct(down, 0.5), down95: pct(down, 0.95), both50: pct(both, 0.5), both95: pct(both, 0.95), up50: pct(upr, 0.5), msgsUp: mean(msgs) });
  }
  return row;
}

const rows = [];
for (const n of NS) {
  const r = await run(n);
  rows.push(r);
  const f = v => v.toFixed(3);
  console.log('n ' + r.n + ' ' + r.players + ' (' + r.trains + ' trains, ' + r.phones + ' phones, arena ' + r.arenaR + ', wild ' + r.wild + '): per step mean ' + f(r.mean) + ' ms, p99 ' + f(r.p99) + ' ms, max ' + f(r.max) +
    ' | sim alone mean ' + f(r.simMean) + ' p99 ' + f(r.simP99) + ' | snapshots share mean ' + f(r.snapShare) + ' | tick mean ' + f(r.tickMean) + ' p99 ' + f(r.tickP99) + ' | ' + r.steps + ' steps | trains ' + r.lengths);
  if (r.parts) console.log('   KB/s by part, every second: ' + JSON.stringify(r.parts.all) + '\n   KB/s by part, the dearest 5% of seconds: ' + JSON.stringify(r.parts.top5));
  if (BYTES) console.log('   bytes per phone at ' + r.zoom + ' (' + r.view + '): down median ' + (r.down50 / 1024).toFixed(2) + ' KB/s, 95th ' + (r.down95 / 1024).toFixed(2) +
    '; both ways median ' + (r.both50 / 1024).toFixed(2) + ', 95th ' + (r.both95 / 1024).toFixed(2) + '; up median ' + (r.up50 / 1024).toFixed(2) + ' KB/s in ' + r.msgsUp.toFixed(1) + ' messages a second');
  writeFileSync(join(OUT, 'room-cost.json'), JSON.stringify(rows, null, 1));   // each row as it lands: a timeout keeps what finished
}
Date.now = realNow; globalThis.setInterval = realSetInterval; globalThis.clearInterval = realClearInterval;
console.log('rows in ' + join(OUT, 'room-cost.json'));
