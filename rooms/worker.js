/* Manta trains' rooms Worker.
 *
 * The first of the two live steps in design doc 10.6: a plain Worker that
 * echoes, with no Durable Object and no migration, so a revert can still
 * remove everything it adds. It proves the site's routing in production and
 * measures round trips from real phones before any room exists.
 *
 * Only /lab/manta/rooms/* reaches it (run_worker_first in wrangler.jsonc).
 * Every other request, a miss included, is answered by the asset server and
 * never runs this code. See CLAUDE.md before changing anything here.
 */

/* THE OFF SWITCH. false refuses every room request with a 503 "rooms are
   off", and the lab falls back to solo. One line, never a revert. */
const ROOMS_OPEN = true;

const ROOMS = '/lab/manta/rooms/';

export default {
  async fetch (request, env) {
    const path = new URL(request.url).pathname;
    /* One line per invocation, so wrangler dev and wrangler tail show which
       requests ran the Worker, and prove the rest never reached it. */
    console.log('rooms worker ' + request.method + ' ' + path);
    /* The safety net: nothing outside the rooms path should ever arrive
       here, and if it does it gets the static site, unchanged. */
    if (!path.startsWith(ROOMS)) return env.ASSETS.fetch(request);
    if (!ROOMS_OPEN) return text('rooms are off', 503);
    if (path !== ROOMS + 'echo') return text('no such room', 404);
    if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
      return text('expected a websocket', 426);
    }
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    server.addEventListener('message', e => {
      try { server.send(e.data); } catch (_) { /* the phone has gone */ }
    });
    /* Answer a close, since this compatibility date does not do it for us. */
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
