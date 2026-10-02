/* A TCP delay proxy for the room tests (3D stage 4): every chunk in either
   direction waits RTT/2 ± JITTER/2 ms, never overtaking the one before it,
   so HTTP and WebSockets both see a slow, jittery link. Usage:
   LISTEN=9001 UPSTREAM=8851 RTT=150 JITTER=50 node delayproxy.mjs */
import net from 'node:net';
const LISTEN = +process.env.LISTEN, UP = +process.env.UPSTREAM, RTT = +(process.env.RTT || 0), JIT = +(process.env.JITTER || 0);
const oneWay = () => Math.max(0, RTT / 2 + (Math.random() * 2 - 1) * JIT / 2);
/* One queue per direction, drained in order by a single timer, so chunks
   can never overtake each other (separate timers of different lengths that
   fall due together are not ordered by Node). */
function pipe (from, to) {
  const queue = []; let timer = null, last = 0, ended = false;
  const drain = () => { timer = null; const now = Date.now();
    while (queue.length && queue[0].at <= now) { const c = queue.shift(); if (!to.destroyed) to.write(c.chunk); }
    if (queue.length) timer = setTimeout(drain, Math.max(0, queue[0].at - Date.now()));
    else if (ended) to.end(); };
  from.on('data', chunk => { const at = Math.max(last, Date.now() + oneWay()); last = at; queue.push({ at, chunk }); if (!timer) timer = setTimeout(drain, Math.max(0, at - Date.now())); });
  from.on('end', () => { ended = true; if (!timer) drain(); });
  from.on('error', () => to.destroy());
}
net.createServer(c => { const u = net.connect(UP, '127.0.0.1'); c.on('error', () => u.destroy()); u.on('error', () => c.destroy()); pipe(c, u); pipe(u, c); })
  .listen(LISTEN, '127.0.0.1', () => console.log('delay proxy ' + LISTEN + ' -> ' + UP + ', rtt ' + RTT + ' ± ' + JIT + ' ms'));
