/* 4A stage 5: the whale shark (shark.js), in plain Node against the real
   simulation, with sharkOn 1. It appears on schedule and leaves after
   crossing; it never turns for a train (its heading changes at one constant
   rate); a train it crosses is cut at the crossing, and everything behind
   becomes glowing debris; a leader touching its body crashes; bots avoid
   it, measured as crashes into it per bot per five minutes; off, nothing
   changes. Out of the fingerprint set. */
import { createSim } from '../../../docs/lab/manta/sim.js';
import { layLong } from '../../../docs/lab/manta/simcore.js';
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x ? '  [' + x + ']' : '')); };
const collect = S => { const got = []; const push = S.events.push; S.events.push = function () { for (const e of arguments) if (e) got.push({ ...e }); return push.apply(this, arguments); }; return got; };
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

/* 1. Schedule and path: on with sharkEvery 20, bots away (0), five minutes. */
{
  const S = createSim({ seed: 5, params: { sharkOn: 1, sharkEvery: 20, bots: 0 } }), ev = collect(S);
  let heads = [], turns = [], stays = [], since = -1, inside = 0, speeds = [];
  for (let k = 0; k < 60 * 300; k++) {
    const sh = S.shark, h0 = sh.alive ? sh.head : null, x0 = sh.x, z0 = sh.z;
    S.step();
    if (sh.alive) {
      if (since < 0) since = S.time;
      if (h0 !== null) { turns.push(wrap(sh.head - h0) * 60); speeds.push(Math.hypot(sh.x - x0, sh.z - z0) * 60); }
      if (Math.hypot(sh.x, sh.z) < S.params.arenaR) inside++;
    } else if (since >= 0) { stays.push(+(S.time - since).toFixed(1)); since = -1; turns.push(NaN); }
  }
  const appears = ev.filter(e => e.kind === 'shark' && e.what === 'appear'), leaves = ev.filter(e => e.kind === 'shark' && e.what === 'leave');
  const gaps = []; for (let i = 1; i < appears.length; i++) gaps.push(+(appears[i].at - leaves[i - 1].at).toFixed(1));
  /* The turn rate within one appearance is constant: the spread of per-step turn rates, ignoring the breaks between appearances. */
  const runs = []; let cur = []; for (const t of turns) { if (Number.isNaN(t)) { if (cur.length) runs.push(cur); cur = []; } else cur.push(t); } if (cur.length) runs.push(cur);
  const spread = runs.map(r => Math.max(...r) - Math.min(...r)), maxSpread = Math.max(...spread), maxRate = Math.max(...runs.map(r => Math.max(...r.map(Math.abs))));
  const meanSpeed = speeds.reduce((a, b) => a + b, 0) / Math.max(1, speeds.length);
  ok('it appears every sharkEvery after the last left (20 s): gaps ' + gaps.join(', ') + ' s over ' + appears.length + ' appearances', appears.length >= 4 && gaps.every(g => Math.abs(g - 20) < 0.1));
  ok('it stays about 40 s each time: ' + stays.join(', ') + ' s', stays.length >= 3 && stays.every(s => s > 30 && s < 50));
  ok('it crosses at sharkSpeed (120): mean ' + meanSpeed.toFixed(1) + ' a second, inside the arena ' + inside + ' of ' + speeds.length + ' steps', Math.abs(meanSpeed - 120) < 1 && inside > speeds.length * 0.7);
  ok('it never changes course: its heading turns at one constant rate per appearance (largest spread ' + maxSpread.toExponential(2) + ' rad/s, rates at most ' + maxRate.toFixed(3) + ' rad/s)', maxSpread < 1e-6 && maxRate <= 0.031);
}

/* A straight train, for staging: the trail along one line ending at the
   leader, which heads on along it (layLong's coil would meet the body with
   its tail first). */
function layStraight (t, count, p, x1, z1, h) {
  const sp = p.spacing, total = (count + 40) * sp, step = sp / 4, dx = -Math.sin(h), dz = -Math.cos(h);
  t.trail.length = 0;
  for (let l = 0; l <= total; l += step) t.trail.push({ x: x1 - dx * (total - l), z: z1 - dz * (total - l), h, s: t.s - (total - l) });
  t.x = x1; t.z = z1; t.head = h;
  t.followers.length = 0;
  for (let k = 0; k < count; k++) t.followers.push({ x: x1, z: z1, head: h, born: -100, from: -1 });
}
/* Lets it swim in until its head is a thousand units inside the reef, so a
   train can lie across its path inside the arena (it appears outside). */
function swimIn (S) { let g = 0; while (Math.hypot(S.shark.x, S.shark.z) > S.params.arenaR - 1000 && g++ < 3000) S.step(); }

/* 2. A train it crosses is cut at the crossing, everything behind freed as debris; a leader on its body crashes. */
{
  const S = createSim({ seed: 5, params: { sharkOn: 1, sharkEvery: 1, bots: 0 } }), ev = collect(S);
  while (!S.shark.alive) S.step();
  const sh = S.shark; swimIn(S);
  /* A straight 40-long train across its path 400 units ahead of its head: the crossing point at follower 10, the leader 310 units to one side and swimming on away from the body. */
  const fx = -Math.sin(sh.head), fz = -Math.cos(sh.head), cx = sh.x + fx * 400, cz = sh.z + fz * 400;
  const side = sh.head + Math.PI / 2, sx = -Math.sin(side), sz = -Math.cos(side);
  layStraight(S.you, 40, S.params, cx + sx * 10 * S.params.spacing, cz + sz * 10 * S.params.spacing, side);
  const n0 = S.you.followers.length;
  /* Measured over the cut's own step: on its way the train may recruit a wild manta or two. */
  let cutAt = -1, lenBefore = -1, lenAfter = -1, debris0 = -1, debrisAfter = -1, crashed = false;
  for (let k = 0; k < 60 * 8; k++) {
    S.input.want = S.you.head; S.input.burst = false;   // the leader holds its course, away from the body
    const lb = S.you.followers.length, db = S.debrisWild();
    S.step();
    const c = ev.find(e => e.kind === 'cut' && e.id === S.you.id);
    if (c && cutAt < 0) { cutAt = S.time; lenBefore = lb; debris0 = db; lenAfter = S.you.followers.length; debrisAfter = S.debrisWild(); }
    if (S.you.dead > 0) { crashed = true; break; }
    if (cutAt >= 0 && S.time - cutAt > 0.5) break;
  }
  ok('a train lying across its path is cut when its body reaches it: ' + lenBefore + ' -> ' + lenAfter + ' followers (laid ' + n0 + '), ' + (cutAt > 0 ? (cutAt - sh.since).toFixed(1) : '-') + ' s after it swam in', cutAt > 0 && lenAfter < lenBefore && lenAfter >= 0);
  ok('everything behind the crossing becomes glowing debris in that step: debris ' + debris0 + ' -> ' + debrisAfter + ' (freed ' + (lenBefore - lenAfter) + ')', debrisAfter - debris0 === lenBefore - lenAfter && lenBefore - lenAfter >= 10);
  ok('the leader, clear of the body, swims on', !crashed);
  /* A leader on its body crashes: set down on the middle of its body once it is inside the reef. */
  const S2 = createSim({ seed: 5, params: { sharkOn: 1, sharkEvery: 1, bots: 0 } }), ev2 = collect(S2);
  while (!S2.shark.alive) S2.step();
  swimIn(S2);
  const t = S2.sharkTail(); S2.you.x = (S2.shark.x + t.x) / 2; S2.you.z = (S2.shark.z + t.z) / 2; S2.step();
  const cr = ev2.find(e => e.kind === 'crash' && e.id === S2.you.id);
  ok('a leader touching its body crashes (how: ' + (cr && cr.how) + ')', !!cr && cr.how === 'shark' && S2.you.dead > 0);
}

/* 3. Bots avoid it: crashes into it per bot per five minutes, with it in the water most of the time. */
{
  const S = createSim({ seed: 5, params: { sharkOn: 1, sharkEvery: 5, sharkStay: 60 } }), ev = collect(S);
  for (let k = 0; k < 60 * 300; k++) { S.input.want = null; S.input.burst = false; S.step(); }
  const into = ev.filter(e => e.kind === 'crash' && e.how === 'shark' && e.id !== S.you.id).length, all = ev.filter(e => e.kind === 'crash' && e.id !== S.you.id).length;
  const perBot = into / S.rivals.length, cuts = ev.filter(e => e.kind === 'cut' && e.by === -1).length;
  ok('bots steer clear of it: ' + into + ' crashes into it in five minutes over ' + S.rivals.length + ' bots (' + perBot.toFixed(2) + ' per bot; all crashes ' + all + '), ' + cuts + ' trains cut by it', perBot <= 1.5);
  ok('it was in the water for most of the five minutes (' + S.shark.appeared + ' appearances)', S.shark.appeared >= 3);
}

/* 4. Off (the default): nothing appears, nothing is recorded, the world is the same as without it. */
{
  const A = createSim({ seed: 5, params: {} }), evA = collect(A);
  for (let k = 0; k < 60 * 120; k++) A.step();
  ok('off by default: never in the water, no shark events in two minutes', A.params.sharkOn === 0 && !A.shark.alive && A.shark.appeared === 0 && evA.filter(e => e.kind === 'shark').length === 0);
}
console.log(bad ? 'FAILED ' + bad : 'ALL PASS');
process.exit(bad ? 1 : 0);
