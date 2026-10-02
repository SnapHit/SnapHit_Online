/* 2B part four, stage 2: each crash and each cut crossing recorded once, and
   nothing for a train in its death beat. Seeded and deterministic. */
import { readFileSync } from 'node:fs';
import { createSim, STEP } from '../../../docs/lab/manta/sim.js';
import { PRESETS } from '../../../docs/lab/manta/bots.js';
let n = 0, bad = 0;
const ok = (name, cond, extra = '') => { n++; if (!cond) bad++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (extra ? '  [' + extra + ']' : '')); };
const P = {};
for (const m of readFileSync(decodeURIComponent(new URL('../../../docs/lab/manta/params.js', import.meta.url).pathname), 'utf8')
    .matchAll(/\{ key: '(\w+)',[^}]*?def: ([-\d.e]+)/g)) P[m[1]] = parseFloat(m[2]);
const nathan = extra => ({ cruise: P.cruise, burst: P.burstSpeed, turnCruise: P.turnCruise, turnBurst: P.turnBurst,
  recruitR: P.recruitR, spacing: P.spacing, wildCount: P.wildCount, regrow: P.regrow, wildSize: P.wildSize,
  bloomPull: P.bloomPull, trainScale: P.trainScale, arenaR: P.arenaR, arenaRWanted: P.arenaR, bots: P.bots,
  burstCost: P.burstCost, scatterGlow: P.scatterGlow, ...extra });

/* ---- a bot match: one crash event per crash, none for a wreck ---- */
{
  const s = createSim({ seed: 81, params: nathan() });
  s.you.dead = 1e9; s.you.followers.length = 0;
  let crashes = 0, crashEvents = 0, cutEvents = 0, cutSteps = 0, wreckEvents = 0, tooSoon = 0;
  const lastCut = new Map();
  for (let i = 0; i < Math.round(300 / STEP); i++) {
    const deadBefore = new Map(s.rivals.map(t => [t.id, t.dead > 0]));
    const cutBefore = new Map(s.rivals.map(t => [t.id, t.cut]));
    s.step();
    for (const t of s.rivals) {
      if (!deadBefore.get(t.id) && t.dead > 0) crashes++;
      if (t.cut === 0.25 && !(t.dead > 0)) cutSteps++;
    }
    for (const e of s.events.splice(0)) {
      if (deadBefore.get(e.id)) wreckEvents++;
      if (e.kind === 'crash') crashEvents++;
      else {
        cutEvents++;
        const k = e.id + ':' + e.by, prev = lastCut.get(k);
        if (prev !== undefined && e.at - prev < 0.35) tooSoon++;
        lastCut.set(k, e.at);
      }
    }
  }
  ok('one crash event per crash', crashes > 0 && crashEvents === crashes, crashes + ' crashes, ' + crashEvents + ' events, 5 min, 10 bots');
  ok('a crossing counts as one cut', cutEvents > 0 && tooSoon === 0 && cutEvents <= cutSteps,
     cutEvents + ' cut events from ' + cutSteps + ' cutting steps; ' + tooSoon + ' repeats inside 0.35 s');
  ok('nothing fires for a train already in its death beat', wreckEvents === 0, wreckEvents + ' events on wrecks');
}

/* ---- one bully, one crossing, one cut ---- */
{
  const s = createSim({ seed: 61, params: nathan({ bots: 1, regrow: 1e9 }) });
  for (const m of s.wild) if (m) m.alive = false;
  const b = s.bots[0];
  Object.assign(b, PRESETS.bully, { kind: 'bully' });
  b.x = 0; b.z = 0; b.head = 0; s.seedTrail(b);
  b.followers.length = 0;
  for (let i = 0; i < 4; i++) b.followers.push({ x: 0, z: 0, head: 0, born: 0, from: i });
  b.goalX = 0; b.goalZ = -900; b.think = 1.2;
  const you = s.you;
  /* 3F: as in simtest5, the seeded trail used to lie ahead of a leader at
     x 120 heading -x, across x -108..120 and the bully's nose. With the
     trail behind the leader, the leader goes at the far end of that same
     span so the body still lies across it. */
  you.x = 120 - 12 * s.params.spacing; you.z = -170; you.head = Math.PI / 2; s.seedTrail(you);
  you.followers.length = 0;
  for (let i = 0; i < 12; i++) you.followers.push({ x: you.x, z: -170, head: Math.PI / 2, born: 0, from: i });
  let cutSteps = 0, cutEvents = 0, first = -1;
  for (let i = 0; i < Math.round(1.2 / STEP); i++) {
    s.input.want = Math.PI / 2; s.input.burst = false;
    s.step();
    if (you.cut === 0.25) { cutSteps++; if (first < 0) first = s.time; }
    for (const e of s.events.splice(0)) if (e.kind === 'cut' && e.id === you.id) cutEvents++;
  }
  ok('a bully crossing a body is one cut, however many followers it touches', cutEvents === 1,
     cutEvents + ' cut events from ' + cutSteps + ' cutting steps, first at ' + (first >= 0 ? first.toFixed(2) : '-') + ' s');
}

console.log('\nevent tests: ' + (n - bad) + '/' + n + ' passed, ' + bad + ' failed');
process.exit(bad ? 1 : 0);
