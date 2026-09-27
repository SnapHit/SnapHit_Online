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
import { createOcean, bench } from './ocean.js';

/* THE OFF SWITCH. false refuses every rooms request, the room paths and the
   echo alike, with a 503 "rooms are off", and the lab falls back to solo.
   One line, never a revert. */
const ROOMS_OPEN = true;

const ROOMS = '/lab/manta/rooms/';

/* ROOM LIMITS (3G). Rooms exist only by name from the server: the public
   room "lobby", and private codes the registry has made. The registry is
   this same Room class under a name no path can reach ('#' is in no room
   pattern), so nothing new is deployed: no class, no migration. */
const LOBBY = 'lobby';
const REGISTRY = '#registry';
const REG = 'https://registry.internal/';
const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';   // no 0/o, 1/l/i
const CODE = /^[2-9a-hjkmnp-z]{8}$/;
const LIVE_CAP = 20;              // live rooms, lobby included; lobby is never refused
const NEW_EVERY_MS = 10000;       // one new room per connection address per 10 s
const CODE_TTL_MS = 24 * 3600e3;  // a code with no players for this long is gone
const LIVE_FOR_MS = 150000;       // a live room reports every minute; silence ends it
const MSG_MAX = 64;               // bytes in one incoming message
const MSG_RATE = 30;              // incoming messages a second; over it, closed
const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), b => ALPHABET[b % ALPHABET.length]).join('');
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
      return this.registry(url);
    }
    const [client, server] = Object.values(new WebSocketPair());
    /* An ocean room runs the simulation (ocean.js); any other room echoes.
       Hibernatable either way: an idle room costs nothing while it waits.
       A staged room is an ocean set up for the cut test, and only ever
       under wrangler dev: checked here as well as in the Worker. */
    const staged = LOCAL.test(url.hostname) && url.pathname.startsWith(ROOMS + 'stage/');
    if (url.pathname.startsWith(ROOMS + 'ocean/') || staged) {
      if (!this.ocean) this.ocean = createOcean(this.env, url, { stage: staged ? 'cut' : null });
      /* At most 10 players and 4 watchers (ocean.js); a socket beyond
         everything a room could seat is refused before it is accepted. */
      if (this.ocean.crowded) return text('room full', 503);
      if (!staged) this.name = url.pathname.slice((ROOMS + 'ocean/').length);
      this.ctx.acceptWebSocket(server, ['ocean']);
      this.ocean.join(server, LOCAL.test(url.hostname));
      this.report();
    } else {
      this.ctx.acceptWebSocket(server);
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage (ws, message) {
    /* Every socket, echo and ocean alike: at most 64 bytes a message and
       30 messages a second. Too big or too many and the socket is closed. */
    const now = Date.now(), ocean = this.ocean && this.ctx.getTags(ws).includes('ocean');
    const bytes = typeof message === 'string' ? (message.length > MSG_MAX ? MSG_MAX + 1 : new TextEncoder().encode(message).length) : message.byteLength;
    if (bytes > MSG_MAX) {
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
     leave, and once a minute while it is live. Staged rooms never count. */
  report (gone) {
    if (!this.name) return;
    const n = this.ctx.getWebSockets('ocean').filter(s => s !== gone).length;
    this.reportedAt = Date.now();
    const reg = this.env.ROOMS.get(this.env.ROOMS.idFromName(REGISTRY));
    reg.fetch(REG + 'live?name=' + this.name + '&n=' + n).then(r => r.text()).catch(() => { /* next report */ });
  }

  /* THE REGISTRY: only ever the object named REGISTRY, reached only from
     this file. Codes as 'code:<code>' -> last time it had players (or was
     made); live rooms as 'live:<name>' -> until when it counts as live. */
  async registry (url) {
    const s = this.ctx.storage, now = Date.now(), op = url.pathname.slice(1);
    const name = url.searchParams.get('name') || '';
    const ttl = +this.env.CODE_TTL_MS || CODE_TTL_MS, cap = +this.env.LIVE_CAP || LIVE_CAP;
    const live = [];
    for (const [k, until] of await s.list({ prefix: 'live:' })) if (until > now) live.push(k.slice(5)); else await s.delete(k);
    if (op === 'live') {
      const n = +url.searchParams.get('n') || 0;
      if (n > 0) await s.put('live:' + name, now + LIVE_FOR_MS); else await s.delete('live:' + name);
      if (await s.get('code:' + name)) await s.put('code:' + name, now);
      return text('ok', 200);
    }
    if (op === 'enter') {
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
    if (!ROOMS_OPEN) return text('rooms are off', 503);

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
    /* The probe page's room echo is the room "probe" and no other. */
    const room = /^\/lab\/manta\/rooms\/room\/(probe)$/.exec(path);
    const ocean = /^\/lab\/manta\/rooms\/ocean\/([a-z0-9-]{1,32})$/.exec(path);
    /* Under wrangler dev with --var TEST_NAMES:1 only, the older room tests
       may name their own rooms, outside the registry and the cap. */
    const testName = ocean && LOCAL.test(url.hostname) && env.TEST_NAMES === '1' && ocean[1] !== LOBBY && !CODE.test(ocean[1]);
    if (ocean && ocean[1] !== LOBBY && !CODE.test(ocean[1]) && !testName) return text('no such room', 404);
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
         while fewer than 20 rooms are live (or it is one of them). */
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
function shut (ws, code, why) { try { ws.close(code, why); } catch (_) { /* already closed */ } }

function text (body, status) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}
