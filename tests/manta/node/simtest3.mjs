/* Stage 3: the rules of sections 6.1 and 6.3, each one a test. Seeded,
   deterministic, and run in Node in milliseconds. */
import { createSim, DEF, STEP } from '../../../docs/lab/manta/sim.js';
let n = 0, bad = 0;
const ok = (name, cond, extra = '') => { n++; if (!cond) bad++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (extra ? '  [' + extra + ']' : '')); };

/* Park every rival far away so only the two trains under test can touch. */
function stage (seed = 7) {
  /* THREE BOTS, not the ocean's ten. These tests are about what one touch
     between two trains means, and ten bots crashing in the background put
     their own wreckage in the water while the measurement is running. */
  const s = createSim({ seed, params: { bots: 3 } });
  /* Parked WELL APART and inside the reef. Stacking them on one point made
     them crash into each other, and a rival that is already stunned is
     skipped by the touch pass — which is what made a head-on look one-sided
     when the rules were right all along. */
  s.rivals.forEach((r, i) => {
    r.x = 900 + i * 300; r.z = 900; r.followers.length = 0;
    r.aim.t = 1e9; r.aim.x = r.x; r.aim.z = r.z - 400; r.pinBurst = true; r.bursting = false;
  });
  for (const w of s.wild) w.alive = false;         // nobody recruits by accident
  s.you.x = 0; s.you.z = 0; s.you.head = 0; s.seedTrail(s.you);
  return s;
}
/* Give a train a real tail without waiting for it to recruit one. */
function giveTail (s, t, k) {
  t.followers.length = 0;
  for (let i = 0; i < k; i++) t.followers.push({ x: t.x, z: t.z, head: t.head, born: 0, from: i });
  s.seedTrail(t);
  for (let i = 0; i < 3; i++) s.step();
  return t;
}
/* Put a rival across the player's nose, `ahead` units in front. */
function placeVictim (s, ahead, k, head = Math.PI / 2) {
  const r = s.rivals[0];
  r.x = s.you.x - Math.sin(s.you.head) * ahead;
  r.z = s.you.z - Math.cos(s.you.head) * ahead;
  r.head = head; r.aim.t = 1e9; r.aim.x = r.x; r.aim.z = r.z - 400;
  giveTail(s, r, k);
  return r;
}

/* ---- 1. a crash scatters EVERY member, the leader included ---- */
{
  const s = stage();
  giveTail(s, s.you, 6);
  const r = placeVictim(s, 500, 4);
  const target = r.followers[2];
  s.you.x = target.x; s.you.z = target.z + DEF.leaderR * 0.5;
  s.input.burst = false;
  const hadMine = s.you.followers.length, hadTheirs = r.followers.length;
  const looseBefore = s.wild.filter(w => w && w.alive && w.loose).length;
  s.step();
  const looseAfter = s.wild.filter(w => w && w.alive && w.loose).length;
  ok('a crash scatters your whole train', hadMine === 6 && s.you.followers.length === 0,
     hadMine + ' -> ' + s.you.followers.length);
  ok('and the leader goes into the water with it', looseAfter - looseBefore === hadMine + 1,
     (looseAfter - looseBefore) + ' loose for a train of ' + hadMine + ' plus its leader');
  ok('and the train you hit is unharmed', r.followers.length === hadTheirs,
     hadTheirs + ' -> ' + r.followers.length);
  ok('and every one of them is glowing',
     s.wild.filter(w => w && w.alive && w.loose && w.glow > 0).length >= hadMine + 1,
     s.wild.filter(w => w && w.alive && w.loose && w.glow > 0).length + ' glowing');
}

/* ---- 2. the run ends, with the right peak, after a death beat ---- */
{
  const s = stage(11);
  giveTail(s, s.you, 5);
  /* Grow to seven and shed two, so the peak is not the length at the crash. */
  s.you.followers.push({ x: s.you.x, z: s.you.z, head: s.you.head, born: 0, from: 1 });
  s.you.followers.push({ x: s.you.x, z: s.you.z, head: s.you.head, born: 0, from: 2 });
  s.step();
  const peakWant = s.you.peak;
  s.you.followers.length = 3;
  const r = placeVictim(s, 500, 3);
  s.you.x = r.x; s.you.z = r.z;
  const runsBefore = s.you.runs;
  s.step();
  ok('a crash ends the run and starts the death beat',
     s.you.dead > 0 && Math.abs(s.you.dead - DEF.deathBeat) < 0.02 + STEP,
     'death beat ' + s.you.dead.toFixed(3) + ' of ' + DEF.deathBeat);
  ok('and the run keeps its peak, not its length at the crash',
     peakWant === 7, 'peak ' + peakWant + ', length at the crash 3');
  /* Nothing of yours is in the water during the beat. */
  let swam = 0;
  const wasX = s.you.x, wasZ = s.you.z;
  for (let i = 0; i < Math.round(DEF.deathBeat / STEP) - 2; i++) {
    s.step();
    if (Math.hypot(s.you.x - wasX, s.you.z - wasZ) > 1) swam++;
  }
  ok('and you do not swim during it', swam === 0 && s.you.dead > 0, swam + ' steps moved');
  s.step(); s.step(); s.step();
  ok('and then you are swimming again as a lone manta',
     s.you.dead === 0 && s.you.followers.length === 0 && s.you.runs === runsBefore + 1,
     'runs ' + runsBefore + ' -> ' + s.you.runs + ', followers ' + s.you.followers.length);
  ok('and the finished run\u2019s peak is kept as its score', s.you.lastPeak === peakWant,
     'lastPeak ' + s.you.lastPeak + ' against ' + peakWant);
}

/* ---- 3. the restart is at least 800 units away and clear of every train ---- */
{
  for (const seed of [21, 22, 23]) {
    const s = stage(seed);
    giveTail(s, s.you, 4);
    const r = placeVictim(s, 500, 3);
    s.you.x = r.x; s.you.z = r.z;
    s.step();
    const cx = s.you.crashX, cz = s.you.crashZ;
    for (let i = 0; i < Math.round(DEF.deathBeat / STEP) + 4; i++) s.step();
    const away = Math.hypot(s.you.x - cx, s.you.z - cz);
    let nearest = Infinity;
    for (const t of s.trains) { if (t === s.you || t.dead > 0) continue;
      for (const q of [t, ...t.followers]) nearest = Math.min(nearest, Math.hypot(q.x - s.you.x, q.z - s.you.z)); }
    ok('restart ' + seed + ' is at least ' + DEF.restartMin + ' units from the crash',
       away >= DEF.restartMin - 1, away.toFixed(0) + ' units');
    ok('restart ' + seed + ' is clear of every train',
       nearest > DEF.leaderR * 3, 'nearest train member ' + (isFinite(nearest) ? nearest.toFixed(0) : 'none') + ' units');
    ok('restart ' + seed + ' is inside the reef', Math.hypot(s.you.x, s.you.z) < DEF.arenaR - 60,
       Math.hypot(s.you.x, s.you.z).toFixed(0) + ' of ' + DEF.arenaR);
  }
}

/* ---- 3b. a lone leader crashes the same way ---- */
{
  const s = stage(13);
  s.you.followers.length = 0;
  const r = placeVictim(s, 500, 3);
  s.you.x = r.x; s.you.z = r.z;
  s.step();
  ok('a lone leader crashes the same way, with no stun',
     s.you.dead > 0 && s.you.stunned === 0, 'death beat ' + s.you.dead.toFixed(2));
  for (let i = 0; i < Math.round(DEF.deathBeat / STEP) + 4; i++) s.step();
  ok('and it restarts too', s.you.dead === 0 && s.you.runs === 1,
     'runs ' + s.you.runs);
}

/* ---- 4. no burst at zero followers ---- */
{
  const s = stage(17);
  s.you.followers.length = 0;
  s.input.burst = true;
  let fast = 0;
  for (let i = 0; i < 120; i++) { const x = s.you.x, z = s.you.z; s.step();
    if (Math.hypot(s.you.x - x, s.you.z - z) > DEF.cruise * STEP * 1.05) fast++; }
  ok('no burst at zero followers', fast === 0 && s.you.bursting === false, fast + ' fast steps');
}

/* ---- 5. the burst drains one follower every 0.35s and stops at zero ---- */
{
  const s = stage(19);
  /* 3D: a full ocean refills around the train while it bursts, and a recruit
     mid-burst hides a drop. The drain's clock is the question: empty water. */
  s.params.regrow = 1e9; for (const w of s.wild) if (w) w.alive = false;
  giveTail(s, s.you, 8);
  s.input.burst = true;
  const drops = [];
  let last = s.you.followers.length, t = 0;
  /* Long enough to drain eight and see that it stops, short enough that a
     burst at 340 units a second does not reach the reef, which is a crash
     and would put a daze in the middle of the measurement. */
  for (let i = 0; i < Math.round(8 * DEF.burstCost / STEP) + 120; i++) {
    t += STEP; s.step();
    while (s.you.followers.length < last) { drops.push(+t.toFixed(3)); last--; }
  }
  const gaps = drops.slice(1).map((d, i) => d - drops[i]);
  const worst = gaps.length ? Math.max(...gaps.map(g => Math.abs(g - DEF.burstCost))) : 99;
  ok('the burst drains one follower every ' + DEF.burstCost + 's',
     drops.length === 8 && worst <= STEP * 1.5, drops.length + ' dropped, worst gap error ' + worst.toFixed(4));
  ok('and it stops at zero', s.you.followers.length === 0 && s.you.bursting === false,
     s.you.followers.length + ' left, bursting ' + s.you.bursting);
}

/* ---- 6. a cut frees everything behind the contact point ---- */
{
  const s = stage(23);
  giveTail(s, s.you, 4);
  const r = placeVictim(s, 500, 6);
  const target = r.followers[2];            // index 2 of six
  s.you.x = target.x; s.you.z = target.z;
  s.input.burst = true; s.you.bursting = true;
  s.step();
  ok('a cut leaves the rest of that train with its leader', r.followers.length === 2,
     'kept ' + r.followers.length + ' of 6, cut at index 2');
  ok('and frees everything behind the contact point',
     s.wild.filter(w => w && w.alive && w.loose && w.glow > 0).length >= 3,
     s.wild.filter(w => w && w.alive && w.loose).length + ' freed');
  ok('and the cutter keeps its own train', s.you.followers.length > 0,
     s.you.followers.length + ' still yours');
}

/* ---- 7. bursting into a leader frees its whole train ---- */
{
  const s = stage(29);
  giveTail(s, s.you, 4);
  const r = placeVictim(s, 500, 5);
  s.you.x = r.x; s.you.z = r.z;
  s.input.burst = true; s.you.bursting = true;
  s.step();
  ok('bursting into a leader frees its whole train', r.followers.length === 0,
     '5 -> ' + r.followers.length);
}

/* ---- 8. head on ---- */
function headOn (mine, theirs) {
  const s = stage(31);
  giveTail(s, s.you, 4);
  const r = placeVictim(s, 500, 4, Math.PI);       // facing back down at you
  s.you.head = 0;                                   // facing up at it
  s.you.x = r.x; s.you.z = r.z;
  s.input.burst = mine; s.you.bursting = mine && s.you.followers.length > 0;
  r.pinBurst = true; r.bursting = theirs && r.followers.length > 0;
  s.step();
  return { mine: s.you.followers.length, theirs: r.followers.length,
           myDead: +s.you.dead.toFixed(2), theirDead: +r.dead.toFixed(2) };
}
{
  const both = headOn(false, false);
  ok('head on, neither bursting: both runs end',
     both.mine === 0 && both.theirs === 0 && both.myDead > 0 && both.theirDead > 0,
     JSON.stringify(both));
  const meOnly = headOn(true, false);
  ok('head on, exactly one bursting: it cuts and its run carries on',
     meOnly.mine > 0 && meOnly.theirs === 0 && meOnly.myDead === 0,
     JSON.stringify(meOnly));
  const bothBurst = headOn(true, true);
  ok('head on, two bursting leaders: both runs end',
     bothBurst.mine === 0 && bothBurst.theirs === 0 && bothBurst.myDead > 0 && bothBurst.theirDead > 0,
     JSON.stringify(bothBurst));
}

/* ---- 9. scattered mantas: first leader to touch them, then they fade ---- */
{
  const s = stage(37);
  giveTail(s, s.you, 5);
  const r = placeVictim(s, 700, 0);
  s.scatter(s.you, 0);
  const loose = s.wild.filter(w => w && w.alive && w.loose);
  ok('a scatter leaves them glowing for ' + DEF.scatterGlow + 's',
     loose.length === 5 && loose.every(w => Math.abs(w.glow - DEF.scatterGlow) < 1e-6),
     loose.length + ' at glow ' + (loose[0] ? loose[0].glow : 'n/a'));
  /* The rival reaches one first. */
  const victim = loose[0];
  /* Clear of the player, or the rival's leader touches YOUR leader on the way
     in and is stunned before it can recruit anything. */
  s.you.x = 1200; s.you.z = -1200; s.you.head = 0; s.seedTrail(s.you);
  victim.x = -600; victim.z = 600;
  r.x = victim.x; r.z = victim.z; r.dazed = 0; r.stunned = 0; r.rebuild = -1;
  s.step();
  ok('and they join the first leader to touch them', r.followers.length >= 1,
     r.followers.length + ' joined the rival');
  /* The rest are left alone and stop glowing after the four seconds. */
  for (const w of s.wild) if (w.loose) { w.x = -1200; w.z = -1200; }
  for (const t of s.trains) { t.x = 900; t.z = 900; t.dazed = 99; }
  let stillGlowing = 1e9;
  for (let i = 0; i < Math.round(DEF.scatterGlow / STEP) + 30; i++) s.step();
  /* ALIVE loose mantas only: one that has been recruited keeps its loose
     flag and its last glow value in the array, because slots go dead rather
     than shifting — counting it measured the bookkeeping, not the fade. */
  stillGlowing = s.wild.filter(w => w && w.alive && w.loose && w.glow > 0).length;
  ok('and fade to ordinary wild mantas after that', stillGlowing === 0,
     stillGlowing + ' still glowing after ' + DEF.scatterGlow + 's');
}

/* ---- scripted rivals restart and rebuild ---- */
{
  const s = stage(101);
  const r = s.rivals[0];
  r.x = 0; r.z = 0; r.aim.x = 0; r.aim.z = -400;
  giveTail(s, r, 5);
  const crashAt = { x: r.x, z: r.z };
  r.x = 0; r.z = -(DEF.arenaR - DEF.leaderR);            // onto the reef
  s.step();
  ok('a rival crashes the same way and loses its train',
     r.dead > 0 && r.followers.length === 0, 'death beat ' + r.dead.toFixed(2));
  const cx = r.crashX, cz = r.crashZ;
  for (let i = 0; i < Math.round(DEF.deathBeat / STEP) + 4; i++) s.step();
  ok('and it starts again somewhere else',
     r.dead === 0 && Math.hypot(r.x - cx, r.z - cz) >= DEF.restartMin - 1,
     Math.hypot(r.x - cx, r.z - cz).toFixed(0) + ' units from its crash');
  /* And it gathers a train again: the appetite comes back after its rebuild
     timer, which is what keeps something to play against. */
  let grew = 0;
  for (let i = 0; i < Math.round(20 / STEP); i++) {
    /* Bait on its nose, so this measures the appetite and not the ocean. */
    const w = s.wild[0];
    w.alive = true; w.loose = false; w.immune = 0; w.fromTrain = null;
    w.colour = 0; w.x = r.x; w.z = r.z;
    const was = r.followers.length;
    s.step();
    if (r.followers.length > was) grew++;
  }
  ok('and rebuilds its train', grew > 0, grew + ' joined it in 20s');
}

console.log('\nstage 3 sim tests: ' + (n - bad) + '/' + n + ' passed, ' + bad + ' failed');
process.exit(bad ? 1 : 0);
