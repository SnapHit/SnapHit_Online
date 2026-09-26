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
    const [client, server] = Object.values(new WebSocketPair());
    /* An ocean room runs the simulation (ocean.js); any other room echoes.
       Hibernatable either way: an idle room costs nothing while it waits. */
    if (url.pathname.startsWith(ROOMS + 'ocean/')) {
      this.ctx.acceptWebSocket(server, ['ocean']);
      if (!this.ocean) this.ocean = createOcean(this.env, url);
      this.ocean.join(server, LOCAL.test(url.hostname));
    } else {
      this.ctx.acceptWebSocket(server);
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage (ws, message) {
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
    if (this.ocean && this.ctx.getTags(ws).includes('ocean')) this.ocean.leave(ws);
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, 'bye'); } catch (_) { /* already closed */ }
  }

  async webSocketError (ws) {
    if (this.ocean && this.ctx.getTags(ws).includes('ocean')) this.ocean.leave(ws);
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
    const room = /^\/lab\/manta\/rooms\/room\/([a-z0-9-]{1,32})$/.exec(path);
    const ocean = /^\/lab\/manta\/rooms\/ocean\/([a-z0-9-]{1,32})$/.exec(path);
    if (path !== ROOMS + 'echo' && !room && !ocean) return text('no such room', 404);
    if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
      return text('expected a websocket', 426);
    }
    if (!originAllowed(request, url)) return text('not from this site', 403);

    /* The room: one Durable Object per name, wherever Cloudflare puts it.
       An ocean of the same name is a different object. */
    if (room) return env.ROOMS.get(env.ROOMS.idFromName(room[1])).fetch(request);
    if (ocean) return env.ROOMS.get(env.ROOMS.idFromName('ocean:' + ocean[1])).fetch(request);

    /* The edge echo, as in step one: no room, just this Worker. */
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    server.addEventListener('message', e => {
      try { server.send(e.data); } catch (_) { /* the phone has gone */ }
    });
    server.addEventListener('close', e => {
      try { server.close(e.code === 1005 ? 1000 : e.code, 'bye'); } catch (_) { /* already closed */ }
    });
    return new Response(null, { status: 101, webSocket: client });
  },
};

function text (body, status) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}
