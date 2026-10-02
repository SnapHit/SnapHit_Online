/* 3L stage 1: bytes per phone at the far zoom with a 500-long train. The
   staged room with ?mine=500; the phone reports the far view (zoom 0.4 on
   412x915: 962 x 2138 units). 25 s; in + out per second. */
import { player } from './playclient.mjs';
const PORT = +process.env.PORT, LABEL = process.env.LABEL || PORT;
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 85000);
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + '[' + LABEL + '] ' + n + (x ? '  [' + x + ']' : '')); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const c = player(PORT, 'bt-' + Math.random().toString(36).slice(2, 7) + '?mine=500', { stage: true, script: c => { const t = performance.now() / 1000; c.input.want = c.play.live ? c.you.head + 0.5 * Math.sin(t * 0.5) : null; c.input.burst = false; } });
await c.opened; await wait(4000);
const t0 = Date.now(); await wait(25000);
const per = []; for (let k = 0; k < 25; k++) { const a = t0 + k * 1000; per.push(c.bytesIn.concat(c.bytesOut).filter(([t]) => t >= a && t < a + 1000).reduce((s, [, b]) => s + b, 0)); }
per.sort((x, y) => x - y); const med = per[12], p95 = per[23];
const len = c.play.me ? c.play.me.len : -1;
ok('bytes per phone at the far zoom with a ' + len + '-long train: median at most 10 KB/s, 95th percentile at most 16 KB/s', len >= 450 && med <= 10240 && p95 <= 16384, (med / 1024).toFixed(1) + ' KB/s median, ' + (p95 / 1024).toFixed(1) + ' KB/s 95th; view ' + process.env.VIEW_W + 'x' + process.env.VIEW_H);
clearInterval(c.timer); try { c.ws.close(); } catch (_) {}
clearTimeout(die); process.exit(bad ? 1 : 0);
