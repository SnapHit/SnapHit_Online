/* 2B part three: bots that grow. Seeded and deterministic. */
import { readFileSync } from 'node:fs';
import { createSim, STEP } from '../../../docs/lab/manta/sim.js';
import { PRESETS } from '../../../docs/lab/manta/bots.js';
let n = 0, bad = 0;
const ok = (name, cond, extra = '') => { n++; if (!cond) bad++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (extra ? '  [' + extra + ']' : '')); };

/* Nathan's values, read from params.js the way accept.mjs reads them. */
const P = {};
for (const m of readFileSync(decodeURIComponent(new URL('../../../docs/lab/manta/params.js', import.meta.url).pathname), 'utf8')
    .matchAll(/\{ key: '(\w+)',[^}]*?def: ([-\d.e]+)/g)) P[m[1]] = parseFloat(m[2]);
const nathan = extra => ({ cruise: P.cruise, burst: P.burstSpeed, turnCruise: P.turnCruise, turnBurst: P.turnBurst,
  recruitR: P.recruitR, spacing: P.spacing, wildCount: P.wildCount, regrow: P.regrow, wildSize: P.wildSize,
  bloomPull: P.bloomPull, trainScale: P.trainScale, arenaR: P.arenaR, arenaRWanted: P.arenaR, bots: P.bots,
  burstCost: P.burstCost, scatterGlow: P.scatterGlow, ...extra });

/* ---- a bot in open water grows past five ---- */
{
  const s = createSim({ seed: 51, params: nathan({ bots: 1 }) });
  s.you.dead = 1e9; s.you.followers.length = 0;          // parked: the bot has the ocean to itself
  const b = s.bots[0];
  let peak = 0, at = -1;
  for (let i = 0; i < Math.round(180 / STEP); i++) {
    s.step();
    if (b.followers.length > peak) { peak = b.followers.length; if (peak === 6 && at < 0) at = s.time; }
  }
  ok('a bot alone in open water grows past five followers', peak > 5,
     'peak ' + peak + (at >= 0 ? ', sixth at ' + at.toFixed(1) + ' s' : '') + ', ' + b.kind + ', ' + P.wildCount + ' wild');
}

/* ---- a bot that cuts a train collects some of what it cut ---- */
{
  /* No ambient food (the twenty taken out, no regrowth), so anything the bot collects afterwards is what the cut
     let loose. The victim is your train, crossing its nose and swimming on. */
  const s = createSim({ seed: 61, params: nathan({ bots: 1, regrow: 1e9 }) });
  for (const m of s.wild) if (m) m.alive = false;         // the ambient twenty, out of the water
  const b = s.bots[0];
  Object.assign(b, PRESETS.bully, { kind: 'bully' });
  b.x = 0; b.z = 0; b.head = 0; s.seedTrail(b);
  b.followers.length = 0;
  for (let i = 0; i < 4; i++) b.followers.push({ x: 0, z: 0, head: 0, born: 0, from: i });
  b.goalX = 0; b.goalZ = -900; b.think = 1.2;            // swim at the crossing first
  const you = s.you;
  /* 3E: the seeded trail was mirrored, so a leader at x 120 heading -x had
     its train laid AHEAD of it, across x -108..120 and the bot's nose. With
     the trail behind the leader as it should be, the leader goes at the far
     end of that same span (120 - 12 x 19) so the train still lies across it. */
  you.x = 120 - 12 * s.params.spacing; you.z = -170; you.head = Math.PI / 2; s.seedTrail(you);
  you.followers.length = 0;
  for (let i = 0; i < 12; i++) you.followers.push({ x: 120, z: -170, head: Math.PI / 2, born: 0, from: i });
  /* Every manta the cuts let loose, by object: a length difference would
     miss the ones the victim takes straight back in the same step. */
  const freed = new Set();
  let cutAt = -1, cuts = 0, collected = 0, afterCut = 0, victimCrashed = 0;
  for (let i = 0; i < Math.round(25 / STEP); i++) {
    s.input.want = Math.PI / 2; s.input.burst = false;
    const loose = [...freed].filter(m => m.alive);
    const bWas = b.followers.length, yWas = you.followers.length, wasDead = you.dead > 0;
    const pre = new Set(s.wild.filter(m => m && m.alive && m.wasColour === you.id));
    s.step();
    const crashedNow = !wasDead && you.dead > 0;
    if (crashedNow) victimCrashed++;
    /* Only what a CUT lets loose: a crash's debris is not the bot's doing. */
    if (you.cut === 0.25 && !crashedNow) {
      if (cutAt < 0) cutAt = s.time;
      cuts++;
      for (const m of s.wild) if (m && m.alive && m.wasColour === you.id && !pre.has(m)) freed.add(m);
    }
    if (cutAt < 0) continue;
    afterCut++;
    const eaten = loose.filter(m => !m.alive).length;
    const bGot = b.followers.length - bWas, yGot = Math.max(0, you.followers.length - yWas);
    if (eaten > 0 && bGot > 0) collected += Math.min(bGot, Math.max(0, eaten - yGot));
  }
  const cutFreed = freed.size;
  ok('a bully bursts into a train crossing its nose and cuts it', cutAt >= 0,
     cutAt >= 0 ? 'first cut at ' + cutAt.toFixed(2) + ' s; ' + cuts + ' cut(s), ' + victimCrashed + ' victim crash(es), ' + cutFreed + ' let loose' : 'no cut');
  ok('and goes on to collect some of what it cut', collected > 0,
     collected + ' of ' + cutFreed + ' collected in ' + (afterCut * STEP).toFixed(1) + ' s; bot now ' + b.followers.length);
}

console.log('\ngrowth tests: ' + (n - bad) + '/' + n + ' passed, ' + bad + ' failed');
process.exit(bad ? 1 : 0);
