/* A scripted phone for Brief 4B's message counts (part 1b, and part 3's
   before and after). The inputs are the PHONE'S OWN CODE (roomplay.js,
   the steering and burst messages); the view and the ping follow the
   page's own rule as roomview.js has it (tick: a view at most every 200 ms
   and only when it moved more than 10 units or changed size; a ping a
   second), with the view's size from the close-up camera's curve for the
   train's length on a 412 x 915 screen. If roomplay.js grows a sender of
   its own for these (createPlay's `tick`), that is used instead, so the
   count is always what the phone in the tree would send.

   Every message sent is logged as [time, type, bytes]; every burst press
   (input.burst going true) as [time, the step this phone was on], so a test
   can say how long a press took to leave the phone and which step it was
   stamped for. Drawing is replaced by the interpolation watch mode uses, as
   in room-play/playclient.mjs. */
import { readFileSync } from 'node:fs';
const TREE = process.env.TREE || decodeURIComponent(new URL('../../..', import.meta.url).pathname).replace(/\/$/, '');
const { createMirror, decodeSnap } = await import(TREE + '/docs/lab/manta/roomcore.js');
const { createPlay } = await import(process.env.PLAYJS || TREE + '/docs/lab/manta/roomplay.js');
const { zoomFor, viewFor } = await import(TREE + '/docs/lab/manta/simcore.js');
export const BUILD = readFileSync(TREE + '/docs/lab/manta/panel.js', 'utf8').match(/export const BUILD = '([^']+)'/)[1];
const VIEW_AREA = +readFileSync(TREE + '/docs/lab/manta/scene.js', 'utf8').match(/export const VIEW_AREA = (\d+)/)[1];
const lerp = (a, b, f) => a + (b - a) * f, wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
export function player (port, room, opts = {}) {
  const B = 'http://127.0.0.1:' + port, kind = opts.stage ? 'stage' : 'ocean';
  const c = { init: null, snapsCount: 0, msgs: [], presses: [], ins: [], acks: [], rtt: null, closed: null, full: false,
              events: [], cuts: new Map(), crashes: new Map(), connected: false };
  const params = {}, core = createMirror(params), input = { want: null, burst: false };
  const you = { id: -1, watched: -1, x: 0, z: 0, head: 0, s: 0, followers: [], dead: 0, peak: 0, lastPeak: 0, len: 0 };
  Object.assign(c, { params, core, input, you });
  const snaps = [], offsets = []; let offset = null; const delay = 0.1;
  const nowS = () => performance.now() / 1000;
  const viewStep = () => offset === null || !snaps.length ? null : (nowS() - offset - delay) * 60;
  const ws = new WebSocket('ws://127.0.0.1:' + port + '/lab/manta/rooms/' + kind + '/' + room, { headers: { Origin: B } });
  c.ws = ws; ws.binaryType = 'arraybuffer';
  const send = m => {
    if (ws.readyState !== 1) return; const s = JSON.stringify(m), t = performance.now();
    c.msgs.push([t, m.t, Buffer.byteLength(s)]);
    if (m.t === 'in') c.ins.push({ t, seq: m.seq, k: m.k, b: m.b === 1 || (Array.isArray(m.i) && m.i.some(e => e && e.b)), m });
    try { ws.send(s); } catch (_) {}
  };
  const viewNow = () => { const v = viewFor(VIEW_AREA, 412 / 915, zoomFor(you.len || 0, params)); return { x: you.x, z: you.z, w: v.w, h: v.h }; };
  const play = createPlay({ room, params, core, you, input, send, rtt: () => c.rtt, view: viewStep, viewNow });
  c.play = play;
  c.opened = new Promise(res => { ws.onopen = () => { const h = { t: 'hi', b: String(opts.build || BUILD).replace(/\D/g, '').slice(2), ...play.hello() };
      if (opts.debug) h.g = 1; send(h); const v = viewNow(); send({ t: 'view', x: Math.round(v.x), z: Math.round(v.z), w: Math.round(v.w), h: Math.round(v.h) });
      send({ t: 'nm', n: 'rate ' + (opts.tag || 'phone') }); res(true); };
    ws.onerror = () => res(false); });
  ws.onclose = e => { c.closed = { code: e.code, reason: e.reason }; c.connected = false; };
  ws.onmessage = e => {
    const bin = typeof e.data !== 'string';
    const m = bin ? decodeSnap(e.data) : JSON.parse(String(e.data));
    if (!m) return;
    if (m.t === 'full') { c.full = true; return; }
    if (m.t === 'pong') { c.rtt = ((performance.now() - m.c) % 1e6 + 1e6) % 1e6; return; }
    if (m.t === 'init') { Object.assign(params, m.params || {}); core.trains.clear(); snaps.length = 0; offsets.length = 0; offset = null;
      c.init = m; play.onInit(m); c.connected = true; return; }
    if (m.t !== 'snap') return;
    const at = nowS();
    core.apply(m); c.snapsCount++;
    play.onSnap(m);
    if (m.me && m.me.ack !== undefined) c.acks.push([performance.now(), m.me.ack, m.k]);
    offsets.push(at - m.time); if (offsets.length > 40) offsets.shift(); offset = Math.min(...offsets);
    for (const q of m.tr) { const t = core.trains.get(q.id); q.run = t ? t.runs : -1; }
    snaps.push({ time: m.time, tr: new Map(m.tr.map(q => [q.id, q])) }); while (snaps.length > 2 && m.time - snaps[1].time > 1) snaps.shift();
    const runs = m.me ? m.me.runs : -1;
    for (const ev of m.ev || []) { c.events.push({ at: performance.now(), ...ev }); if (ev.k === 'cut') c.cuts.set(runs, (c.cuts.get(runs) || 0) + 1); if (ev.k === 'crash') c.crashes.set(runs, (c.crashes.get(runs) || 0) + 1); }
  };
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
  let lastT = performance.now(), wasBurst = false, pingAt = -1e9, viewAt = -1e9, sentView = null;
  const FRAME = opts.frameMs || 1000 / 60;
  c.timer = setInterval(() => {
    const t = performance.now(), dt = Math.min(0.4, (t - lastT) / 1000); lastT = t;
    if (!c.init) return;
    if (opts.script) opts.script(c);
    if (input.burst && !wasBurst) c.presses.push([t, play.step]);
    wasBurst = !!input.burst;
    const on = c.connected && ws.readyState === 1;
    play.frame(dt, false, 0, on);
    if (!on) return;
    if (typeof play.tick === 'function') { play.tick(t / 1000); return; }
    /* roomview.js tick(), as it is in the tree before Brief 4B part 3. */
    const v = viewNow();
    const moved = !sentView || Math.abs(v.x - sentView.x) + Math.abs(v.z - sentView.z) > 10 || Math.abs(v.w - sentView.w) > 1 || Math.abs(v.h - sentView.h) > 1;
    if (moved && t - viewAt >= 200) { send({ t: 'view', x: Math.round(v.x), z: Math.round(v.z), w: Math.round(v.w), h: Math.round(v.h) }); sentView = v; viewAt = t; }
    if (t - pingAt >= 1000) { send({ t: 'ping', c: Math.round(t) }); pingAt = t; }
  }, FRAME);
  c.close = () => { clearInterval(c.timer); try { ws.close(1000, 'bye'); } catch (_) {} };
  return c;
}
