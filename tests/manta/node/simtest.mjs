/* The simulation's own tests. No browser: this steps the rules in Node at
   thousands of steps a second, so a rule that only breaks after a minute of
   play is caught in milliseconds. */
import { createSim, zoomFor, viewFor, STEP, DEF } from '../../../docs/lab/manta/sim.js';
let bad = 0, n = 0;
const ok = (name, cond, note = '') => { n++; if (!cond) bad++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (note ? '  [' + note + ']' : '')); };

/* ---- the leader never stops ---- */
{
  const s = createSim({ seed: 3 });
  let minMove = Infinity, maxMove = 0;
  let px = s.you.x, pz = s.you.z;
  for (let i = 0; i < 6000; i++) {                    // 100 seconds
    s.input.want = Math.sin(i / 37) * 3;              // swinging demands
    s.input.burst = (i % 600) < 60;
    const wasRun = s.you.runs, wasDead = s.you.dead > 0;
    s.step();
    const d = Math.hypot(s.you.x - px, s.you.z - pz);
    /* RULE 3 INTERRUPTS SWIMMING BY DESIGN. During the death beat there is
       no leader in the water, and the step that ends it puts you somewhere
       else entirely — 800 units or more away. Neither is a swim, so neither
       belongs in a measurement of how a leader swims. */
    const alive = !wasDead && s.you.dead === 0 && s.you.runs === wasRun;
    if (i > 2 && alive) { minMove = Math.min(minMove, d); maxMove = Math.max(maxMove, d); }
    px = s.you.x; pz = s.you.z;
  }
  /* Bursting needs a follower to pay with and there are none yet, so the
     speed here is cruise or the stun's slowed cruise. */
  const floor = DEF.cruise * 0.5 * STEP;
  ok('the leader never stops', minMove > floor,
     'slowest step ' + minMove.toFixed(3) + ' units, floor ' + floor.toFixed(3));
  ok('and never exceeds burst speed', maxMove <= DEF.burst * STEP + 1e-9,
     'fastest step ' + maxMove.toFixed(3));
}

/* ---- turning never exceeds the turn rate ---- */
{
  const s = createSim({ seed: 11 });
  let worst = 0;
  let prev = s.you.head;
  for (let i = 0; i < 6000; i++) {
    s.input.want = (i % 120 < 60) ? prev + Math.PI : prev - Math.PI;  // ask for a U-turn every step
    const wasRun = s.you.runs, wasDead = s.you.dead > 0;
    s.step();
    let d = s.you.head - prev;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    /* A restart picks a fresh heading; that is not a turn. */
    if (!wasDead && s.you.dead === 0 && s.you.runs === wasRun) worst = Math.max(worst, Math.abs(d) / STEP);
    prev = s.you.head;
  }
  ok('turning never exceeds the turn rate', worst <= DEF.turnCruise + 1e-6,
     'worst ' + worst.toFixed(4) + ' rad/s against ' + DEF.turnCruise);
}

/* ---- the nose points where the manta is going ----
   Nathan caught this on the phone: the mantas span as well as turned. The
   simulation moved with forward = (+sin, -cos) while the shader and every
   other mover in the lab use (-sin, -cos), so the body and the travel
   direction only agreed when the heading was straight up or down. This
   measures the angle between the two, which is the thing that was wrong. */
{
  const s = createSim({ seed: 77 });
  let worstDeg = 0, samples = 0;
  let px = s.you.x, pz = s.you.z;
  for (let i = 0; i < 4000; i++) {
    /* Swing all the way round, but in open water: a leader the reef is
       holding is not travelling along its heading, and that is the wall's
       doing rather than the heading's. */
    s.input.want = Math.hypot(s.you.x, s.you.z) > DEF.arenaR * 0.6
      ? Math.atan2(s.you.x, s.you.z)
      : Math.sin(i / 43) * 3;
    const wasRun = s.you.runs, wasDead = s.you.dead > 0;
    s.step();
    const dx = s.you.x - px, dz = s.you.z - pz;
    px = s.you.x; pz = s.you.z;
    const moved = Math.hypot(dx, dz);
    if (moved < 1e-6) continue;
    /* Neither the death beat nor the jump to the restart is a swim. */
    if (wasDead || s.you.dead > 0 || s.you.runs !== wasRun) continue;
    /* The direction the drawn body faces, by the lab's convention. */
    const nose = { x: -Math.sin(s.you.head), z: -Math.cos(s.you.head) };
    const cos = (nose.x * dx + nose.z * dz) / moved;
    const deg = Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
    worstDeg = Math.max(worstDeg, deg);
    samples++;
  }
  ok('the nose points where the manta is going', worstDeg < 1.0,
     'worst ' + worstDeg.toFixed(3) + ' degrees off, over ' + samples + ' steps');
}

/* ---- the camera's area rule, at every zoom ---- */
{
  const AREA = 329160;
  let worstErr = 0, worstAspect = 0;
  for (const aspect of [412 / 915, 915 / 412, 1, 1280 / 800, 0.42]) {
    for (let len = 0; len <= 600; len += 10) {
      const z = zoomFor(len);
      const v = viewFor(AREA, aspect, z);
      const want = AREA / (z * z);
      const err = Math.abs(v.w * v.h - want) / want;
      const ar = Math.abs((v.w / v.h) - aspect) / aspect;
      worstErr = Math.max(worstErr, err);
      worstAspect = Math.max(worstAspect, ar);
    }
  }
  ok('the area rule holds at every zoom', worstErr < 1e-12, 'worst relative error ' + worstErr.toExponential(2));
  ok('and the view keeps the screen’s shape', worstAspect < 1e-12, 'worst ' + worstAspect.toExponential(2));
  ok('zoom is 1.5 at length 0, 1.5/sqrt(7) at 300 and the 0.4 floor from about 653 (3L)',
     Math.abs(zoomFor(0) - 1.5) < 1e-9 && Math.abs(zoomFor(300) - 1.5 / Math.sqrt(7)) < 1e-9 && zoomFor(700) === 0.4 && zoomFor(600) > 0.4,
     zoomFor(0).toFixed(3) + ' .. ' + zoomFor(150).toFixed(3) + ' .. ' + zoomFor(300).toFixed(3));
}

/* ---- seeded and deterministic ---- */
{
  const run = () => { const s = createSim({ seed: 99 });
    for (let i = 0; i < 1200; i++) { s.input.want = Math.sin(i / 11) * 2; s.step(); }
    return [s.you.x, s.you.z, s.you.head, s.blooms[2].x]; };
  const a = run(), b = run();
  ok('a seed replays exactly', a.every((v, i) => v === b[i]), JSON.stringify(a.map(v => +v.toFixed(3))));
}

/* ---- the arena holds ---- */
{
  const s = createSim({ seed: 5 });
  let worst = 0;
  for (let i = 0; i < 12000; i++) { s.input.want = 0.6; s.step();
    worst = Math.max(worst, Math.hypot(s.you.x, s.you.z)); }
  ok('nothing leaves the arena', worst <= DEF.arenaR - DEF.leaderR + 1e-6,
     'furthest ' + worst.toFixed(1) + ' of ' + (DEF.arenaR - DEF.leaderR));
}

console.log('\nsim tests: ' + (n - bad) + '/' + n + ' passed, ' + bad + ' failed');
process.exit(bad ? 1 : 0);
