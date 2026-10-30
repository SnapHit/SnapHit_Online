/* Manta trains' rooms Worker.
 *
 * Step two of design doc 10.6: the first room. A Durable Object per room
 * name, on the hibernation API, that echoes and answers "who". The plain
 * edge echo from step one stays beside it for comparison.
 *
 * Only /lab/manta/rooms/* reaches this code (run_worker_first in
 * wrangler.jsonc). Every other request, a miss included, is answered by the
 * asset server and never runs it. See CLAUDE.md before changing anything:
 * once the Room class is deployed, a revert cannot remove it.
 */
import { DurableObject } from 'cloudflare:workers';
import { createOcean, bench, MAX_PLAYERS, REST_AT } from './ocean.js';

/* THE OFF SWITCH, in two places. Here in the code: false refuses every
   rooms request, the room paths and the echo alike, with a 503 "rooms are
   off", and players go solo with a note. One line, never a revert. And, from
   4B, as a Worker variable Nathan sets in Cloudflare's dashboard, from his
   phone and without a push: ROOMS_OPEN set to false (or off, no, 0) turns
   rooms off; unset or anything else leaves them on. wrangler.jsonc has
   keep_vars, so no deploy overwrites what he set. */
const ROOMS_OPEN = true;
const OFF = /^\s*(false|off|no|0)\s*$/i;
const roomsOpen = env => ROOMS_OPEN && !OFF.test(String((env && env.ROOMS_OPEN) ?? ''));

const ROOMS = '/lab/manta/rooms/';

/* ROOM LIMITS (3G). Rooms exist only by name from the server: the public
   room "lobby", and private codes the registry has made. The registry is
   this same Room class under a name no path can reach ('#' is in no room
   pattern), so nothing new is deployed: no class, no migration. */
const LOBBY = 'lobby';
/* OVERFLOW ROOMS (3O): the public game is "lobby", then "lobby-2" up to
   "lobby-20" as each fills. Every one of those names is the server's own. */
const PUBLIC = /^lobby(-([2-9]|1[0-9]|20))?$/;
const SEATS = MAX_PLAYERS;        // players in one room (20 from 4B), from ocean.js so the two cannot differ
const SENT_FOR_MS = 10000;        // a player sent to a public room counts this long until it reports
const REGISTRY = '#registry';
const REG = 'https://registry.internal/';
const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';   // no 0/o, 1/l/i
const CODE = /^[2-9a-hjkmnp-z]{8}$/;
/* THE LIVE ROOM CAP: live rooms, lobby included (lobby is never refused).
   3 unless the Worker variable LIVE_CAP, set in Cloudflare's dashboard and
   kept through deploys (keep_vars), names another from 1 to 20 (lobby-20 is
   the last public room's name). Until 4B: 20, in code. */
const LIVE_CAP = 3;
const capOf = env => { const n = Math.floor(Number(env && env.LIVE_CAP)); return n >= 1 ? Math.min(20, n) : LIVE_CAP; };
const NEW_EVERY_MS = 10000;       // one new room per connection address per 10 s
const CODE_TTL_MS = 24 * 3600e3;  // a code with no players for this long is gone
const LIVE_FOR_MS = 150000;       // a live room reports every minute; silence ends it
const MSG_MAX = 64;               // bytes in one incoming message
const MSG_RATE = 30;              // incoming messages a second; over it, closed
const NAME_MSG_MAX = 256;         // bytes, for a typed name's own message only (3J)
/* THE DAILY BUDGET GUARD (4B, design doc 10.6 Cost). Cloudflare's free
   plan allows 100,000 Durable Object requests a day (every 20 incoming
   messages count as one) and 13,000 GB-s of run time (a ticking room is
   billed 128 MB whatever its players: 0.128 GB-s a second, by Cloudflare's
   own worked example), and past either every room fails until 00:00 UTC.
   The registry counts what all rooms use each UTC day from what each room
   adds to the reports it already sends (every join, leave and seat, and
   once a minute while anyone is there), so the guard makes no request of
   its own: one storage row written per registry request. Counted: every
   incoming message (a twentieth), every request into a room (each
   connection), every registry request (and 10 ms of run time each), every
   second a room ticks. Not counted: what the Worker refuses before any
   object (bad names, other sites, rooms off) and the unlinked probe page's
   echo rooms, a few at most. Rooms act on it (ocean.js REST_AT, LEAVE_AT);
   the public game refuses new players here at REST_AT. */
const DAY_REQUESTS = 100000, DAY_GBS = 13000, GBS_A_SECOND = 0.128, REGISTRY_SECONDS = 0.01;
const dayOf = t => new Date(t).toISOString().slice(0, 10);
const midnightAfter = t => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1); };
const count = (v, max) => { const n = Math.floor(Number(v)); return n > 0 ? Math.min(n, max) : 0; };
const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), b => ALPHABET[b % ALPHABET.length]).join('');
/* THE PLAY COUNTER AND THE FEEDBACK BOX (4C, design doc 10.6), in place of
   Cloudflare's Web Analytics. Both live in the registry, so nothing new is
   deployed (no class, no migration), and both count towards the daily
   budget guard: each is a Worker request and a registry request.
   The counter: per UTC day, visits that started a run (v), returning
   visitors (n: the phone kept a flag from an earlier UTC day, and says
   only yes or no), runs (r), room joins (j) and runs past one minute (m),
   at most this many of each in one request, from the feedback page's
   sendBeacon. No identifier of any kind is read, sent or stored: no
   address, no browser, no name. Kept for COUNT_DAYS days and a day more.
   The feedback box: at most FB_CHARS characters (code points), stored
   under the time it arrived and nothing else, at most FB_PER_DAY a day
   from one connection address. The address itself never leaves the
   Worker's handling of the request: the registry is given only a one-way
   tag of it (addrTag: an HMAC of the UTC day and the address under
   FEEDBACK_KEY), in a header and not the URL, since whatever records
   requests (wrangler dev's traces, Cloudflare's logs) keeps URLs; it holds
   the tag in memory for that day only, to count to three. The
   latest FB_KEEP are kept. Read on the lab panel with FEEDBACK_KEY, a
   secret Nathan sets in Cloudflare's dashboard (never in the repo or in
   wrangler.jsonc); a wrong key is allowed KEY_TRIES a day an address. */
const COUNT_KEYS = { v: 1, n: 1, r: 100, j: 20, m: 100 };
const COUNT_BYTES = 64, COUNT_DAYS = 7;
const FB_CHARS = 500, FB_BYTES = 2048, FB_PER_DAY = 3, FB_KEEP = 200, FB_SHOWN = 50, KEY_TRIES = 10;
const ZERO = () => ({ v: 0, n: 0, r: 0, j: 0, m: 0 });
const SITE = 'https://snap-hit.online';
const LOCAL = /^(localhost|127\.0\.0\.1)$/;
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/* A room's page must be this site. Under wrangler dev the request itself is
   addressed to localhost, which production never is, so only then may a
   localhost page connect. Anything else is refused before it costs a room. */
function originAllowed (request, url) {
  const origin = request.headers.get('Origin') || '';
  if (origin === SITE) return true;
  return LOCAL.test(url.hostname) && LOCAL_ORIGIN.test(origin);
}

export class Room extends DurableObject {
  async fetch (request) {
    const url = new URL(request.url);
    if (url.hostname === 'registry.internal') {
      if (!this.ctx.id.equals(this.env.ROOMS.idFromName(REGISTRY))) return text('no such room', 404);
      return this.registry(url, request);
    }
    /* Every request into a room is a billed request (4B): counted here and
       carried to the registry by the next report. */
    this.unsent = this.unsent || { m: 0, q: 0 };
    this.unsent.q++;
    const [client, server] = Object.values(new WebSocketPair());
    /* An ocean room runs the simulation (ocean.js); any other room echoes.
       Hibernatable either way: an idle room costs nothing while it waits.
       A staged room is an ocean set up for the cut test, and only ever
       under wrangler dev: checked here as well as in the Worker. */
    const staged = LOCAL.test(url.hostname) && url.pathname.startsWith(ROOMS + 'stage/');
    if (url.pathname.startsWith(ROOMS + 'ocean/') || staged) {
      if (!this.ocean) this.ocean = createOcean(this.env, url, { stage: staged ? 'cut' : null, onChange: gone => this.report(gone) });
      /* At most 20 players and 4 watchers (ocean.js); a socket beyond
         everything a room could seat is refused before it is accepted. */
      if (this.ocean.crowded) return text('room full', 503);
      if (!staged) this.name = url.pathname.slice((ROOMS + 'ocean/').length);
      this.ctx.acceptWebSocket(server, ['ocean']);
      this.ocean.join(server, LOCAL.test(url.hostname), url.searchParams.get('fake'));
      this.report();
    } else {
      this.ctx.acceptWebSocket(server);
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage (ws, message) {
    /* Every socket, echo and ocean alike: at most 64 bytes a message and
       30 messages a second. Too big or too many and the socket is closed. */
    /* Every incoming message is a twentieth of a billed request (4B). */
    this.unsent = this.unsent || { m: 0, q: 0 };
    this.unsent.m++;
    const now = Date.now(), ocean = this.ocean && this.ctx.getTags(ws).includes('ocean');
    const limit = ocean && typeof message === 'string' && message.startsWith('{"t":"nm"') ? NAME_MSG_MAX : MSG_MAX;
    const bytes = typeof message === 'string' ? (message.length > limit ? limit + 1 : new TextEncoder().encode(message).length) : message.byteLength;
    if (bytes > limit) {
      /* A phone on an older build says a longer hello: tell it to reload. */
      if (ocean && this.ocean.build && typeof message === 'string' && message.length < 1024 && message.includes('"hello"')) {
        try { ws.send(JSON.stringify({ t: 'reload', build: this.ocean.build })); } catch (_) { /* gone */ }
      }
      return this.drop(ws, 1009, 'message too big');
    }
    this.rates = this.rates || new WeakMap();
    let r = this.rates.get(ws);
    if (!r || now - r.start >= 1000) { r = { start: now, n: 0 }; this.rates.set(ws, r); }
    if (++r.n > MSG_RATE) return this.drop(ws, 1008, 'too many messages');
    if (ocean && now - (this.reportedAt || 0) > 60000) this.report();
    if (this.ctx.getTags(ws).includes('ocean')) {
      /* Woken with no ocean in memory: the phone reconnects and resyncs. */
      if (!this.ocean) { try { ws.close(1012, 'room restarted'); } catch (_) { /* gone */ } return; }
      await this.ocean.message(ws, message);
      /* A player seated or benched: the registry hears at once (3O). */
      if (this.ocean && this.ocean.players !== this.seated) this.report();
      return;
    }
    if (message === 'who') {
      ws.send(JSON.stringify({ who: this.ctx.getWebSockets().length }));
      return;
    }
    ws.send(message);
  }

  /* Answer a close, since this compatibility date does not do it for us. */
  async webSocketClose (ws, code) {
    if (this.ocean && this.ctx.getTags(ws).includes('ocean')) { this.ocean.leave(ws); this.report(ws); }
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, 'bye'); } catch (_) { /* already closed */ }
  }

  async webSocketError (ws) {
    if (this.ocean && this.ctx.getTags(ws).includes('ocean')) { this.ocean.leave(ws); this.report(ws); }
  }

  drop (ws, code, why) {
    if (this.ocean && this.ctx.getTags(ws).includes('ocean')) { this.ocean.leave(ws); this.report(ws); }
    shut(ws, code, why);
  }

  /* An ocean tells the registry whether anyone is in it: on every join and
     leave, and once a minute while it is live. Staged rooms never count.
     From 4B each report also carries what this room has used since the
     last (messages, requests, milliseconds ticked), and the registry answers
     with the day's use, which the room acts on and shows the lab panel. A
     report that fails keeps its counts for the next. */
  report (gone) {
    if (!this.name) return;
    const n = this.ctx.getWebSockets('ocean').filter(s => s !== gone).length;
    this.reportedAt = Date.now();
    this.seated = this.ocean ? this.ocean.players : 0;
    const u = this.unsent || { m: 0, q: 0 }, ms = this.ocean ? this.ocean.takeRunMs() : 0;
    this.unsent = { m: 0, q: 0 };
    const reg = this.env.ROOMS.get(this.env.ROOMS.idFromName(REGISTRY));
    reg.fetch(REG + 'live?name=' + this.name + '&n=' + n + '&p=' + this.seated + '&um=' + u.m + '&uq=' + u.q + '&us=' + Math.round(ms))
      .then(r => r.ok ? r.json() : Promise.reject(new Error('registry ' + r.status)))
      .then(j => { if (this.ocean && j && j.left !== undefined) this.ocean.setBudget(j); })
      .catch(() => { this.unsent.m += u.m; this.unsent.q += u.q; if (this.ocean) { this.ocean.giveRunMs(ms); this.ocean.noBudget(); } });
  }

  /* The day's use (4B): kept in memory, stored under its UTC day on every
     change, read back after a restart. Yesterday's is kept for comparison;
     older days go. Null if anything about it fails: the guard then steps
     aside and the rooms carry on. */
  async useToday (now) {
    try {
      if (this.test && this.test.fail) throw new Error('test: the guard fails');
      const day = dayOf(now), s = this.ctx.storage;
      if (!this.use || this.use.day !== day) {
        this.use = (await s.get('use:' + day)) || { day, m: 0, q: 0, w: 0, reg: 0, ms: 0 };
        const keep = 'use:' + dayOf(now - 864e5);
        for (const [k] of await s.list({ prefix: 'use:' })) if (k < keep) await s.delete(k);
      }
      return this.use;
    } catch (_) { return null; }
  }
  /* The day's use as fractions of the allowances, and the milliseconds left
     until 00:00 UTC. Requests: messages / 20, room requests and registry
     requests (the Durable Object allowance), or Worker requests if ever
     more (the Workers allowance: room requests and the public game, new
     room and status asks). */
  levelOf (use, now) {
    const extra = this.test && this.test.day === use.day ? this.test.extra : 0;
    const requests = Math.max(use.m / 20 + use.q + use.reg, use.q + use.w);
    const seconds = use.ms / 1000 + REGISTRY_SECONDS * use.reg;
    return { r: requests / DAY_REQUESTS + extra, d: seconds * GBS_A_SECOND / DAY_GBS + extra, left: midnightAfter(now) - now, day: use.day };
  }

  /* THE REGISTRY: only ever the object named REGISTRY, reached only from
     this file. Codes as 'code:<code>' -> last time it had players (or was
     made); live rooms as 'live:<name>' -> until when it counts as live. */
  async registry (url, request) {
    const s = this.ctx.storage, op = url.pathname.slice(1);
    /* TESTS ONLY (wrangler dev with TEST_NAMES, through /rooms/budget, which
       only a local request reaches): use added for today (extra, a fraction
       of both allowances, gone at 00:00 UTC), the guard's clock moved (clock,
       ms) so a test can cross midnight, and the guard made to fail (fail). */
    if (op === 'budget' && this.env.TEST_NAMES === '1') {
      const q = url.searchParams, t = this.test = this.test || { extra: 0, clock: 0, fail: false, day: '' };
      if (q.has('clock')) t.clock = +q.get('clock') || 0;
      if (q.has('fail')) t.fail = q.get('fail') === '1';
      if (q.has('extra')) { t.extra = Math.max(0, +q.get('extra') || 0); t.day = dayOf(Date.now() + t.clock); }
    }
    const now = Date.now() + (this.test ? this.test.clock : 0);
    const name = url.searchParams.get('name') || '';
    const ttl = +this.env.CODE_TTL_MS || CODE_TTL_MS, cap = capOf(this.env);
    const live = [];
    for (const [k, until] of await s.list({ prefix: 'live:' })) if (until > now) live.push(k.slice(5)); else await s.delete(k);
    /* Players sent to a public room and not yet seated there (3O):
       name -> times sent, each dropped when the room reports one more
       player, or after SENT_FOR_MS. */
    const sent = this.sent = this.sent || new Map();
    for (const [k, a] of sent) { const b = a.filter(t => now - t < SENT_FOR_MS); if (b.length) sent.set(k, b); else sent.delete(k); }
    /* THE DAY'S USE (4B): this request, and what a report carries. */
    const use = await this.useToday(now);
    if (use) {
      use.reg++;
      if (op === 'public' || op === 'new' || op === 'count' || op === 'feedback' || op === 'plays') use.w++;
      if (op !== 'live') try { await s.put('use:' + use.day, use); } catch (_) { /* counted in memory; stored with the next */ }
    }
    let level = use ? this.levelOf(use, now) : null;
    if (op === 'budget') return Response.json({ use, level }, { headers: { 'cache-control': 'no-store' } });
    /* Rooms resting (4B): the counter and the feedback box rest with them,
       so neither spends what is left of the day. */
    const resting = !!level && Math.max(level.r, level.d) >= REST_AT;
    const restingText = () => text('rooms are resting: ' + (Date.now() + (level ? level.left : midnightAfter(Date.now()) - Date.now())), 503);
    /* THE PLAY COUNTER (4C): the canonical count the Worker checked, added
       to today's row. Old rows go when the day turns. */
    if (op === 'count') {
      if (resting) return restingText();
      const day = dayOf(now), key = 'count:' + day, c = (await s.get(key)) || ZERO();
      for (const k of Object.keys(COUNT_KEYS)) c[k] = (c[k] || 0) + count(url.searchParams.get(k), COUNT_KEYS[k]);
      await s.put(key, c);
      if (this.countDay !== day) {
        this.countDay = day;
        const keep = 'count:' + dayOf(now - COUNT_DAYS * 864e5);
        for (const [k] of await s.list({ prefix: 'count:' })) if (k < keep) await s.delete(k);
      }
      return text('counted', 200);
    }
    /* THE FEEDBACK BOX (4C): three a day from one address, the address in
       memory only; the message stored with the time it came and nothing else. */
    if (op === 'feedback') {
      if (resting) return restingText();
      const msg = cleanFeedback(request ? await request.text() : '');
      if (msg === null) return text('at most ' + FB_CHARS + ' characters', 413);
      if (!msg) return text('nothing to send', 400);
      const day = dayOf(now), ip = (request && request.headers.get('x-who')) || '';
      const sentBy = this.fbSent = this.fbSent || new Map();
      for (const [k, v] of sentBy) if (v.day !== day) sentBy.delete(k);
      const had = sentBy.get(ip) || { day, n: 0 };
      if (had.n >= FB_PER_DAY) return text('three messages a day from one connection', 429);
      had.n++; sentBy.set(ip, had);
      const rand = Array.from(crypto.getRandomValues(new Uint8Array(3)), b => b.toString(16).padStart(2, '0')).join('');
      await s.put('fb:' + String(now).padStart(15, '0') + ':' + rand, { t: now, text: msg });
      this.fbRows = (this.fbRows ?? (await s.list({ prefix: 'fb:' })).size - 1) + 1;
      if (this.fbRows > FB_KEEP + 20) {
        const keys = [...(await s.list({ prefix: 'fb:' })).keys()];
        for (const k of keys.slice(0, Math.max(0, keys.length - FB_KEEP))) await s.delete(k);
        this.fbRows = Math.min(keys.length, FB_KEEP);
      }
      return text('thank you', 200);
    }
    /* THE LAB PANEL'S PLAYS (4C): the last COUNT_DAYS days of counts for
       anyone on the lab panel; the latest FB_SHOWN messages only with the
       key (k: the Worker's verdict on it: ok, wrong, none, or unset when no
       key is set in the dashboard). */
    if (op === 'plays') {
      const days = [];
      for (let i = 0; i < COUNT_DAYS; i++) days.push(dayOf(now - i * 864e5));
      const got = await s.get(days.map(d => 'count:' + d));
      const out = { days: days.map(d => Object.assign({ day: d }, ZERO(), got.get('count:' + d) || {})), key: '', messages: null };
      const k = url.searchParams.get('k') || 'none', day = dayOf(now), ip = (request && request.headers.get('x-who')) || '';
      const tries = this.keyTries = this.keyTries || new Map();
      for (const [a, v] of tries) if (v.day !== day) tries.delete(a);
      const t = tries.get(ip) || { day, n: 0 };
      if ((k === 'ok' || k === 'wrong') && t.n >= KEY_TRIES) return text('too many wrong keys today', 429);
      if (k === 'wrong') { t.n++; tries.set(ip, t); }
      out.key = k;
      if (k === 'ok') out.messages = [...(await s.list({ prefix: 'fb:', reverse: true, limit: FB_SHOWN })).values()].map(m => ({ t: m.t, text: m.text }));
      return Response.json(out, { headers: { 'cache-control': 'no-store' } });
    }
    if (op === 'live') {
      const n = +url.searchParams.get('n') || 0, p = +url.searchParams.get('p') || 0;
      if (n > 0) await s.put('live:' + name, now + LIVE_FOR_MS); else await s.delete('live:' + name);
      if (await s.get('code:' + name)) await s.put('code:' + name, now);
      if (PUBLIC.test(name)) {
        const was = (await s.get('seats:' + name)) || 0;
        if (p > was && sent.has(name)) sent.get(name).splice(0, p - was);
        if (n > 0) await s.put('seats:' + name, p); else await s.delete('seats:' + name);
      }
      /* What the report carries, counted only now that everything above
         has been written: a report that fails is resent with its counts,
         and must not have counted them already. */
      if (use) {
        use.m += count(url.searchParams.get('um'), 1e7); use.q += count(url.searchParams.get('uq'), 1e5); use.ms += count(url.searchParams.get('us'), 864e5);
        try { await s.put('use:' + use.day, use); } catch (_) { /* counted in memory; stored with the next */ }
        level = this.levelOf(use, now);
      }
      return level ? Response.json(level, { headers: { 'cache-control': 'no-store' } }) : text('ok', 200);
    }
    /* THE PUBLIC GAME (3O): the public room with the most players that still
       has a free seat, lobby first on a tie. A new one opens only when every
       open one is full, and only while fewer than the cap are live, private
       rooms included. A room a phone found full is taken as full here. */
    if (op === 'public') {
      /* 80 PERCENT (4B): the public game takes no new players, and says when
         rooms return (the room's own clock: Date.now(), not the test's). A
         ?fake=80 (lab only) does the same for that one ask; ?fake=95 lets
         the player in, and the room sends it solo after its next crash. */
      const fake = url.searchParams.get('fake') === '80' ? 0.8 : 0;
      if (Math.max(level ? Math.max(level.r, level.d) : 0, fake) >= REST_AT) return text('rooms are resting: ' + (Date.now() + (level ? level.left : midnightAfter(Date.now()) - Date.now())), 503);
      const full = url.searchParams.get('full') || '';
      if (PUBLIC.test(full)) await s.put('seats:' + full, SEATS);
      const open = [LOBBY];
      for (let i = 2; i <= cap; i++) { const r = LOBBY + '-' + i; if (live.includes(r) || sent.has(r)) open.push(r); }
      let best = null, most = -1;
      for (const r of open) {
        const n = ((live.includes(r) && await s.get('seats:' + r)) || 0) + (sent.has(r) ? sent.get(r).length : 0);
        if (n < SEATS && n > most) { best = r; most = n; }
      }
      if (!best) {
        const busy = new Set([...live, ...sent.keys()]);
        if (busy.size >= cap) return text('every room is full: try again soon', 503);
        for (let i = 2; i <= cap && !best; i++) if (!busy.has(LOBBY + '-' + i)) best = LOBBY + '-' + i;
        if (!best) return text('every room is full: try again soon', 503);
      }
      if (!sent.has(best)) sent.set(best, []);
      sent.get(best).push(now);
      return Response.json({ room: best }, { headers: { 'cache-control': 'no-store' } });
    }
    if (op === 'enter') {
      /* A public overflow room: the server's own name, within the cap. */
      if (name !== LOBBY && PUBLIC.test(name)) {
        if (!live.includes(name) && !sent.has(name) && live.length >= cap) return text('every room is busy: try again soon', 503);
        return text('ok', 200);
      }
      if (name !== LOBBY) {
        const seen = await s.get('code:' + name);
        if (!seen) return text('no such room', 404);
        if (now - seen > ttl && !live.includes(name)) { await s.delete('code:' + name); return text('no such room', 404); }
        if (!live.includes(name) && live.length >= cap) return text('every room is busy: try again soon', 503);
      }
      return text('ok', 200);
    }
    if (op === 'new') {
      const ip = url.searchParams.get('ip') || '';
      this.asked = this.asked || new Map();
      for (const [k, t] of this.asked) if (now - t >= NEW_EVERY_MS) this.asked.delete(k);
      if (this.asked.has(ip)) return text('one new room every 10 seconds', 429);
      this.asked.set(ip, now);
      if (live.length >= cap) return text('every room is busy: try again soon', 503);
      /* Codes with no players for the whole time to live go, hourly. */
      if (now - (this.pruned || 0) > 3600e3) {
        this.pruned = now;
        for (const [k, t] of await s.list({ prefix: 'code:' })) if (now - t > ttl && !live.includes(k.slice(5))) await s.delete(k);
      }
      let code; do code = newCode(); while (code === LOBBY || await s.get('code:' + code));
      await s.put('code:' + code, now);
      return Response.json({ code }, { headers: { 'cache-control': 'no-store' } });
    }
    return text('no such room', 404);
  }
}

export default {
  async fetch (request, env) {
    const url = new URL(request.url), path = url.pathname;
    /* One line per invocation, so wrangler dev and wrangler tail show which
       requests ran the Worker, and prove the rest never reached it. */
    console.log('rooms worker ' + request.method + ' ' + path);
    /* The safety net: nothing outside the rooms path should ever arrive
       here, and if it does it gets the static site, unchanged. */
    if (!path.startsWith(ROOMS)) return env.ASSETS.fetch(request);
    /* ?fake= (4B, lab only): this one request answered as if rooms were off,
       or every room full, so the plain notes can be seen without switching
       anything off or filling anything. It touches no one else. */
    const fake = url.searchParams.get('fake') || '';
    if (!roomsOpen(env) || fake === 'off') return text('rooms are off', 503);

    /* Under wrangler dev only: the day's use as the registry has it (4B tests). */
    if (path === ROOMS + 'budget' && LOCAL.test(url.hostname)) return registry(env).fetch(REG + 'budget' + url.search);
    /* Under wrangler dev only: time the simulation inside workerd. */
    if (path === ROOMS + 'bench' && LOCAL.test(url.hostname)) {
      const count = Math.min(40000, Math.max(1, +url.searchParams.get('n') || 0));
      return Response.json(await bench(env, url, count));
    }
    /* A new private room: a POST from this site, answered with its code. */
    if (path === ROOMS + 'new') {
      if (request.method !== 'POST') return text('expected a POST', 405);
      if (!originAllowed(request, url)) return text('not from this site', 403);
      const ip = (LOCAL.test(url.hostname) && request.headers.get('X-Test-Address')) || request.headers.get('CF-Connecting-IP') || '';
      return registry(env).fetch(REG + 'new?ip=' + encodeURIComponent(ip));
    }
    /* Why a room cannot be reached (4B): asked once by a page whose socket
       would not open. Rooms off is answered above. For a private room or an
       overflow room (?room=), whether the registry would refuse it for the
       live-room cap ("every room is busy", 503); anything else is "rooms
       are open", so a page never sees an error from asking. */
    if (path === ROOMS + 'status') {
      if (request.method !== 'POST') return text('expected a POST', 405);
      if (!originAllowed(request, url)) return text('not from this site', 403);
      const name = url.searchParams.get('room') || '';
      if (name !== LOBBY && (PUBLIC.test(name) || CODE.test(name))) {
        const r = await registry(env).fetch(REG + 'enter?name=' + name);
        if (r.status === 503) return text(await r.text(), 503);
      }
      return text('rooms are open', 200);
    }
    /* THE PLAY COUNTER (4C): a visit's counts, batched by the feedback
       page and sent with sendBeacon. Five small numbers and nothing else:
       no address, browser or name is read here or passed on. */
    if (path === ROOMS + 'count') {
      if (request.method !== 'POST') return text('expected a POST', 405);
      if (!originAllowed(request, url)) return text('not from this site', 403);
      const c = parseCount(await bodyOf(request, COUNT_BYTES));
      if (!c) return text('not a count', 400);
      return registry(env).fetch(REG + 'count?' + c);
    }
    /* THE FEEDBACK BOX (4C): the message, and the connection's address only
       so the registry can hold it to three a day, in memory. */
    if (path === ROOMS + 'feedback') {
      if (request.method !== 'POST') return text('expected a POST', 405);
      if (!originAllowed(request, url)) return text('not from this site', 403);
      const body = await bodyOf(request, FB_BYTES), msg = cleanFeedback(body);
      if (msg === null) return text('at most ' + FB_CHARS + ' characters', 413);
      if (!msg) return text('nothing to send', 400);
      const ip = (LOCAL.test(url.hostname) && request.headers.get('X-Test-Address')) || request.headers.get('CF-Connecting-IP') || '';
      return registry(env).fetch(REG + 'feedback', { method: 'POST', body: msg, headers: { 'x-who': await addrTag(env, ip) } });
    }
    /* THE LAB PANEL'S PLAYS (4C): the counts, and with FEEDBACK_KEY the
       messages. The key is checked here, where the secret is, in constant
       time; the registry is told only the verdict. */
    if (path === ROOMS + 'plays') {
      if (request.method !== 'POST') return text('expected a POST', 405);
      if (!originAllowed(request, url)) return text('not from this site', 403);
      const given = (request.headers.get('X-Feedback-Key') || '').slice(0, 256), set = typeof env.FEEDBACK_KEY === 'string' && env.FEEDBACK_KEY.length > 0;
      const k = !given ? 'none' : !set ? 'unset' : (await sameKey(given, env.FEEDBACK_KEY)) ? 'ok' : 'wrong';
      const ip = (LOCAL.test(url.hostname) && request.headers.get('X-Test-Address')) || request.headers.get('CF-Connecting-IP') || '';
      return registry(env).fetch(REG + 'plays?k=' + k, { headers: { 'x-who': await addrTag(env, ip) } });
    }
    /* The public game (3O): which public room a joining player swims in. */
    if (path === ROOMS + 'public') {
      if (request.method !== 'POST') return text('expected a POST', 405);
      if (!originAllowed(request, url)) return text('not from this site', 403);
      if (fake === 'full') return text('every room is full: try again soon', 503);
      return registry(env).fetch(REG + 'public?full=' + encodeURIComponent(url.searchParams.get('full') || '') + (/^(80|95)$/.test(fake) ? '&fake=' + fake : ''));
    }
    /* The probe page's room echo is the room "probe" and no other. */
    const room = /^\/lab\/manta\/rooms\/room\/(probe)$/.exec(path);
    const ocean = /^\/lab\/manta\/rooms\/ocean\/([a-z0-9-]{1,32})$/.exec(path);
    /* Under wrangler dev with --var TEST_NAMES:1 only, the older room tests
       may name their own rooms, outside the registry and the cap. */
    const testName = ocean && LOCAL.test(url.hostname) && env.TEST_NAMES === '1' && !PUBLIC.test(ocean[1]) && !CODE.test(ocean[1]);
    if (ocean && !PUBLIC.test(ocean[1]) && !CODE.test(ocean[1]) && !testName) return text('no such room', 404);
    /* The staged cut test's room (3E): under wrangler dev only. Anywhere
       else this path is not a room at all, and gets the 404 below. */
    const stage = LOCAL.test(url.hostname) ? /^\/lab\/manta\/rooms\/stage\/([a-z0-9-]{1,32})$/.exec(path) : null;
    if (path !== ROOMS + 'echo' && !room && !ocean && !stage) return text('no such room', 404);
    if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
      return text('expected a websocket', 426);
    }
    if (!originAllowed(request, url)) return text('not from this site', 403);

    /* The room: one Durable Object per name, wherever Cloudflare puts it.
       An ocean of the same name is a different object. */
    if (room) return env.ROOMS.get(env.ROOMS.idFromName(room[1])).fetch(request);
    if (ocean) {
      /* Lobby always; a code only while the registry knows it, and only
         while fewer than the cap are live (or it is one of them). */
      if (ocean[1] !== LOBBY && !testName) {
        const r = await registry(env).fetch(REG + 'enter?name=' + ocean[1]);
        if (r.status !== 200) return text(await r.text(), r.status);
      }
      return env.ROOMS.get(env.ROOMS.idFromName('ocean:' + ocean[1])).fetch(request);
    }
    if (stage) return env.ROOMS.get(env.ROOMS.idFromName('stage:' + stage[1])).fetch(request);

    /* The edge echo, as in step one: no room, just this Worker. */
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    let start = 0, n = 0;
    server.addEventListener('message', e => {
      const now = Date.now(), d = e.data;
      if (now - start >= 1000) { start = now; n = 0; }
      const bytes = typeof d === 'string' ? new TextEncoder().encode(d).length : d.byteLength;
      if (bytes > MSG_MAX) { shut(server, 1009, 'message too big'); return; }
      if (++n > MSG_RATE) { shut(server, 1008, 'too many messages'); return; }
      try { server.send(d); } catch (_) { /* the phone has gone */ }
    });
    server.addEventListener('close', e => {
      try { server.close(e.code === 1005 ? 1000 : e.code, 'bye'); } catch (_) { /* already closed */ }
    });
    return new Response(null, { status: 101, webSocket: client });
  },
};

const registry = env => env.ROOMS.get(env.ROOMS.idFromName(REGISTRY));

/* A request's body as text, or null when it is longer than max bytes. */
async function bodyOf (request, max) {
  if (+(request.headers.get('content-length') || 0) > max) return null;
  const buf = await request.arrayBuffer();
  if (buf.byteLength > max) return null;
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (_) { return null; }
}
/* A count as the page sends it (v=1&n=0&r=2&j=1&m=0): only the five keys,
   whole numbers within their caps, at least one above zero, and returning
   (n) only with a visit (v). The canonical form, or null. */
function parseCount (body) {
  if (typeof body !== 'string' || !body) return null;
  const q = new URLSearchParams(body), c = ZERO();
  for (const [k, v] of q) {
    if (!(k in COUNT_KEYS) || !/^\d{1,3}$/.test(v) || +v > COUNT_KEYS[k]) return null;
    c[k] = +v;
  }
  if (!c.v) c.n = 0;
  if (!(c.v + c.r + c.j + c.m)) return null;
  return Object.keys(COUNT_KEYS).map(k => k + '=' + c[k]).join('&');
}
/* A feedback message: control characters (but line breaks and tabs) and
   text-direction overrides removed, trimmed; '' when nothing is left; null
   when it is over FB_CHARS characters or was not text. Shown only ever as
   plain text (textContent), never as markup. */
function cleanFeedback (s) {
  if (typeof s !== 'string') return null;
  const t = s.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g, '').trim();
  return [...t].length > FB_CHARS ? null : t;
}
/* A connection address as the registry is given it (4C): a one-way tag, the
   first 16 bytes of an HMAC-SHA-256 of the UTC day and the address under
   FEEDBACK_KEY (a plain SHA-256 when no key is set), so it differs every
   day and cannot be turned back into the address without the secret. */
async function addrTag (env, ip) {
  const data = new TextEncoder().encode(dayOf(Date.now()) + '|' + ip);
  const key = typeof env.FEEDBACK_KEY === 'string' ? env.FEEDBACK_KEY : '';
  let buf;
  if (key) { const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); buf = await crypto.subtle.sign('HMAC', k, data); }
  else buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf).slice(0, 16), b => b.toString(16).padStart(2, '0')).join('');
}
/* Two keys compared in constant time, through their SHA-256 digests. */
async function sameKey (a, b) {
  const h = async s => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  const [x, y] = await Promise.all([h(a), h(b)]);
  let d = 0; for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}
function shut (ws, code, why) { try { ws.close(code, why); } catch (_) { /* already closed */ } }

function text (body, status) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}
