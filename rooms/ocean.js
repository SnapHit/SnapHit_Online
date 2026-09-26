/* A room's ocean (3C stage 4): the lab's own simulation, run by the Room
 * Durable Object as the referee, and sent to each phone as snapshots of
 * what is near its view (roomcore.js has the wire format).
 *
 * The simulation starts with the committed defaults, read from the same
 * params.js the phones load (through the assets binding, so the numbers
 * cannot drift), and a seed of its own, when the first phone says hello. It
 * steps at 60 Hz from a timer while at least one phone is here and the
 * timer stops when the last one leaves, so an empty room goes idle. Bots
 * only for now: the human manta is kept out of the water.
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

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(+v) ? +v : lo));
const viewOf = m => ({ x: clamp(m && m.x, -1e5, 1e5), z: clamp(m && m.z, -1e5, 1e5),
                       w: clamp(m && m.w, 100, 6000), h: clamp(m && m.h, 100, 6000) });

export function createOcean (env, url) {
  const phones = new Map();           // socket -> what this phone has been sent
  let sim = null, build = null, seed = 0;
  let timer = null, last = 0, owed = 0, n = 0, steps = 0;
  const ready = loadDefaults(env, url).then(d => {
    build = d.build;
    seed = crypto.getRandomValues(new Uint32Array(1))[0];
    sim = createSim({ seed, params: simParams(d.P) });
    sim.you.dead = 1e9; sim.you.followers.length = 0;   // no human manta yet
  });

  function tick () {
    const now = Date.now();
    owed += (now - last) / 1000; last = now;
    let k = 0;
    while (owed >= STEP && k < 12) { sim.step(); owed -= STEP; k++; steps++; }
    if (owed > STEP * 12) owed = 0;               // a stall is not caught up
    const events = sim.events.splice(0);
    n++;
    for (const [ws, phone] of phones) {
      if (!phone.ready) continue;
      try { ws.send(JSON.stringify(snapFor(sim, phone, n, events))); } catch (_) { /* gone */ }
    }
  }
  const start = () => { if (timer) return; last = Date.now(); owed = 0; timer = setInterval(tick, 1000 / SNAP_HZ); };
  const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
  function leave (ws) {
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
      phone.sent.clear(); phone.board = null; phone.ready = true;
      ws.send(JSON.stringify({ t: 'init', build, seed, params: sim.params, time: sim.time, steps,
        kinds: sim.rivals.map(t => [t.id, t.kind || 'bot']) }));
      start();
    },
    get stepping () { return timer !== null; },
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
