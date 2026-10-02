/* A scripted phone for the 3E play-mode tests. The prediction, the step
   clock and the inputs are the PHONE'S OWN CODE (roomplay.js), with the same
   mirror (roomcore.js); only the drawing is replaced by the interpolation
   watch mode uses (roomview.js: the fastest recent arrival as the offset,
   a delay of 0.1 s plus twice the arrival jitter, at most 0.4 s). */
import { readFileSync } from 'node:fs';
const TREE = process.env.TREE || decodeURIComponent(new URL('../../..', import.meta.url).pathname).replace(/\/$/, '');
const { createMirror, decodeSnap } = await import(TREE + '/docs/lab/manta/roomcore.js');
const { createPlay } = await import(process.env.PLAYJS || TREE + '/docs/lab/manta/roomplay.js');
export const BUILD = readFileSync(TREE + '/docs/lab/manta/panel.js', 'utf8').match(/export const BUILD = '([^']+)'/)[1];
const lerp = (a, b, f) => a + (b - a) * f, wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
export function player (port, room, opts = {}) {
  const B = 'http://127.0.0.1:' + port, kind = opts.stage ? 'stage' : 'ocean';
  const c = { init: null, snapsCount: 0, bytesIn: [], bytesOut: [], rtt: null, board: null, names: null, closed: null, full: false,
              events: [], cuts: new Map(), crashes: new Map(), rw: [], connected: false, snapLog: [] };
  const params = {}, core = createMirror(params), input = { want: null, burst: false };
  const you = { id: -1, watched: -1, x: 0, z: 0, head: 0, s: 0, followers: [], dead: 0, peak: 0, lastPeak: 0, len: 0 };
  Object.assign(c, { params, core, input, you });
  const snaps = [], offsets = [], gaps = []; let offset = null, delay = 0.1, lastArrive = null;
  const nowS = () => performance.now() / 1000;
  const viewStep = () => offset === null || !snaps.length ? null : (nowS() - offset - delay) * 60;
  const ws = new WebSocket('ws://127.0.0.1:' + port + '/lab/manta/rooms/' + kind + '/' + room + (opts.len ? '?len=' + opts.len : ''), { headers: { Origin: B } });
  c.ws = ws; ws.binaryType = 'arraybuffer';
  const send = m => { if (ws.readyState !== 1) return; const s = JSON.stringify(m); c.bytesOut.push([Date.now(), Buffer.byteLength(s)]); try { ws.send(s); } catch (_) {} };
  const play = createPlay({ room, params, core, you, input, send, rtt: () => c.rtt, view: viewStep });
  c.play = play;
  c.opened = new Promise(res => { ws.onopen = () => { const h = { t: 'hi', b: String(opts.build || BUILD).replace(/\D/g, '').slice(2), ...play.hello() };
      if (opts.token) h.k = opts.token; if (opts.debug) h.g = 1; if (opts.lagComp === false) h.l = 0; send(h); send({ t: 'view', x: 0, z: 0, w: 385, h: 855 }); res(true); };
    ws.onerror = () => res(false); });
  ws.onclose = e => { c.closed = { code: e.code, reason: e.reason }; c.connected = false; };
  let pingAt = -1e9, viewAt = 0;
  ws.onmessage = e => {
    const bin = typeof e.data !== 'string';
    c.bytesIn.push([Date.now(), bin ? e.data.byteLength : Buffer.byteLength(String(e.data))]);
    const m = bin ? decodeSnap(e.data) : JSON.parse(String(e.data));
    if (!m) return;
    if (m.t === 'truth') { if (m.rw) c.rw.push(m.rw); return; }
    if (m.t === 'names') { c.names = m.names; return; }
    if (m.t === 'full') { c.full = true; return; }
    if (m.t === 'pong') { c.rtt = performance.now() - m.c; return; }
    if (m.t === 'init') { Object.assign(params, m.params || {}); core.trains.clear(); snaps.length = 0; offsets.length = 0; gaps.length = 0;
      offset = null; lastArrive = null; delay = 0.1; c.init = m; c.names = m.names || c.names; play.onInit(m); c.connected = true; return; }
    if (m.t !== 'snap') return;
    const at = nowS();
    core.apply(m); c.snapsCount++; if (m.bd) c.board = m.bd; if (m.names) c.names = m.names;
    play.onSnap(m);
    offsets.push(at - m.time); if (offsets.length > 40) offsets.shift(); offset = Math.min(...offsets);
    if (lastArrive !== null) { gaps.push(at - lastArrive); if (gaps.length > 40) gaps.shift(); } lastArrive = at;
    if (gaps.length > 4) { const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      const sd = Math.sqrt(gaps.reduce((a, g) => a + (g - mean) * (g - mean), 0) / gaps.length); delay = Math.min(0.4, Math.max(0.1, 0.1 + 2 * sd)); }
    for (const q of m.tr) { const t = core.trains.get(q.id); q.run = t ? t.runs : -1; }
    snaps.push({ time: m.time, tr: new Map(m.tr.map(q => [q.id, q])) }); while (snaps.length > 2 && m.time - snaps[1].time > 1) snaps.shift();
    const runs = m.me ? m.me.runs : -1;
    for (const ev of m.ev || []) { c.events.push({ at: performance.now(), ...ev }); if (ev.k === 'cut') c.cuts.set(runs, (c.cuts.get(runs) || 0) + 1); if (ev.k === 'crash') c.crashes.set(runs, (c.crashes.get(runs) || 0) + 1); }
    c.snapLog.push({ k: m.k, e: m.e, l: m.l });
  };
  /* A train as this phone would draw it: between the two snapshots around
     the render time, followers laid on its path by placeFollowers. */
  c.shown = id => {
    if (offset === null || !snaps.length) return null;
    const T = nowS() - offset - delay;
    let A = snaps[0], Bs = snaps[0];
    if (T >= snaps[snaps.length - 1].time) A = Bs = snaps[snaps.length - 1];
    else for (let i = 0; i + 1 < snaps.length; i++) if (snaps[i + 1].time > T) { A = snaps[i]; Bs = snaps[i + 1]; break; }
    const qb = Bs.tr.get(id), tr = core.trains.get(id); if (!qb || !tr) return null;
    const qa = A.tr.get(id) || qb, f = Bs === A || T <= A.time ? 0 : Math.min(1, (T - A.time) / (Bs.time - A.time));
    const jump = qa.run !== qb.run, a = jump ? qb : qa;
    const t = { trail: tr.trail, x: lerp(a.x, qb.x, f), z: lerp(a.z, qb.z, f), s: lerp(a.s, qb.s, f), head: a.h + wrap(qb.h - a.h) * f,
                dead: qb.dead || qb.run !== tr.runs, followers: [] };
    const len = t.dead ? 0 : qb.len; for (let i = 0; i < len; i++) t.followers.push({ x: t.x, z: t.z, head: t.head });
    if (len) core.placeFollowers(t);
    return t;
  };
  let lastT = performance.now(), lastRuns = null, since = -1e9;
  c.gaps = [];                               // [ms since restart, gap] for 3 s after each restart
  c.restarts = 0;
  const FRAME = opts.frameMs || 1000 / 60;
  c.timer = setInterval(() => {
    const t = performance.now(), dt = Math.min(0.4, (t - lastT) / 1000); lastT = t;
    if (!c.init) return;
    if (c.connected && t - pingAt >= 1000) { send({ t: 'ping', c: t }); pingAt = t; }
    if (opts.script) opts.script(c);
    play.frame(dt, false, 0, c.connected && ws.readyState === 1);
    /* THE DRAWN GAP after a restart: what this frame would draw, the eased
       leader against its eased first follower, for 3 s after the phone first
       sees the train's runs change. */
    const runs = play.me && play.me.runs;
    if (runs !== undefined && runs !== lastRuns) { if (lastRuns !== null) { c.restarts++; since = t; } lastRuns = runs; }
    if (t - since <= 3000 && play.live && !(you.dead > 0) && you.followers.length) c.gaps.push([Math.round(t - since), Math.hypot(you.x - you.followers[0].x, you.z - you.followers[0].z)]);
    if (t - viewAt >= 200 && play.live) { send({ t: 'view', x: Math.round(you.x), z: Math.round(you.z), w: 385, h: 855, a: play.id }); viewAt = t; }
  }, FRAME);
  c.close = () => { clearInterval(c.timer); try { ws.close(1000, 'bye'); } catch (_) {} };
  c.drop = () => { clearInterval(c.timer); try { ws.close(4001, 'drop'); } catch (_) {} };
  return c;
}
export const perSecond = (arr, t0, secs) => { const per = []; for (let k = 0; k < secs; k++) { const a = t0 + k * 1000; per.push(arr.filter(([t]) => t >= a && t < a + 1000).reduce((s, [, b]) => s + b, 0)); } return per.sort((a, b) => a - b); };
export const q = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] : NaN;
