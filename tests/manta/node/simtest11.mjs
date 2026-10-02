/* 3E stage 3: a seeded trail lies BEHIND its leader, along its heading.
   Forward is (-sin h, -cos h), so behind is +sin, +cos. The seeded trail had
   x mirrored, so after a restart at any heading but straight up or down the
   first recruits sat off to one side of the path, not behind the leader. */
import { createSim, STEP } from '../../../docs/lab/manta/sim.js';
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x ? '  [' + x + ']' : '')); };
/* Worst lateral offset and the most-forward point of a trail, against the leader's heading. */
function judge (t) {
  const fx = -Math.sin(t.head), fz = -Math.cos(t.head), rx = Math.cos(t.head), rz = -Math.sin(t.head);
  let lat = 0, ahead = -Infinity;
  for (const q of t.trail) {
    const dx = q.x - t.x, dz = q.z - t.z;
    lat = Math.max(lat, Math.abs(dx * rx + dz * rz)); ahead = Math.max(ahead, dx * fx + dz * fz);
  }
  return { lat: +lat.toFixed(4), ahead: +ahead.toFixed(4), n: t.trail.length, head: +t.head.toFixed(3) };
}
/* 1. Every bot as dealt, at its random heading, before a single step. */
{
  const s = createSim({ seed: 31 });
  const js = s.rivals.map(judge), worst = js.reduce((a, j) => Math.max(a, j.lat), 0), fwd = js.reduce((a, j) => Math.max(a, j.ahead), -Infinity);
  ok('every bot\'s seeded trail lies behind its leader, along its heading', worst < 1e-6 && fwd <= 1e-6,
     'worst sideways ' + worst + ', most forward ' + fwd + ' over ' + js.length + ' bots, headings ' + js.map(j => j.head).join(' '));
}
/* 2. A RESTARTED leader: yours, crashed, and judged the step it comes back
      (steering off, so its heading is the one it restarted with). */
{
  const out = [];
  for (const seed of [41, 42, 43, 44, 45, 46]) {
    const s = createSim({ seed });
    s.input.want = null;
    const runs = s.you.runs;
    s.crash(s.you);
    let k = 0; while (s.you.runs === runs && k < 60 * 20) { s.step(); k++; }
    out.push({ seed, restarted: s.you.runs !== runs, ...judge(s.you) });
  }
  const worst = out.reduce((a, j) => Math.max(a, j.lat), 0), fwd = out.reduce((a, j) => Math.max(a, j.ahead), -Infinity);
  ok('a restarted leader\'s seeded trail lies behind it, along its heading', out.every(o => o.restarted) && worst < 0.01 && fwd <= 0.01,
     'worst sideways ' + worst + ', most forward ' + fwd + '; ' + out.map(o => 'h ' + o.head + ' (' + o.n + ' pts)').join(', '));
}
/* 3. And a restarted BOT, judged on the step it comes back. */
{
  const out = [];
  for (const seed of [51, 52, 53]) {
    const s = createSim({ seed }); s.you.dead = 1e9; s.you.followers.length = 0;
    const t = s.rivals[0], runs = t.runs;
    s.crash(t);
    let k = 0; while (t.runs === runs && k < 60 * 20) { s.step(); k++; }
    /* One step of the brain's steering has happened since the restart: a
       step turns at most turnRate/60, so allow that much sideways over the
       seeded length. */
    const tol = Math.sin(Math.max(s.params.turnCruise, s.params.turnBurst) * STEP) * 40 * s.params.spacing + 0.01;
    out.push({ seed, restarted: t.runs !== runs, tol, ...judge(t) });
  }
  ok('a restarted bot\'s seeded trail lies behind it too', out.every(o => o.restarted && o.lat <= o.tol && o.ahead <= 0.01),
     out.map(o => 'sideways ' + o.lat + ' (allowed ' + o.tol.toFixed(1) + '), most forward ' + o.ahead).join('; '));
}
console.log('simtest11 failures: ' + bad); process.exit(bad ? 1 : 0);
