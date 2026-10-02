/* 2B part four, stage 1: two populations, and drawn means collectable.
   Seeded and deterministic, at the committed defaults read from params.js. */
import { readFileSync } from 'node:fs';
import { createSim, STEP } from '../../../docs/lab/manta/sim.js';
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
const inHash = (s, m) => { const out = []; s.hash.near(m.x, m.z, out); return out.includes(m); };

/* The index of dispersion of the AMBIENT population over screen-sized cells
   inside the reef, empty cells included, JUDGED BY GROUP (3C ruling 2): each
   group's centre (the centroid of its living ordinary members) is one point.
   Counting every manta measured the designed groups of 3 to 5 sharing a
   cell, not an uneven ocean. */
function dispersionOf (s) {
  const CW = 385, CH = 855, lim = s.params.arenaR - 150, cells = new Map(), sum = new Map();
  for (const w of s.wild) {
    if (!w || !w.alive || w.loose || w.sinking > 0) continue;
    const g = sum.get(w.group) || { x: 0, z: 0, n: 0 }; g.x += w.x; g.z += w.z; g.n++; sum.set(w.group, g);
  }
  for (const g of sum.values()) {
    const x = g.x / g.n, z = g.z / g.n;
    if (Math.hypot(x, z) > lim) continue;
    const k = Math.floor(x / CW) + ',' + Math.floor(z / CH); cells.set(k, (cells.get(k) || 0) + 1); }
  const all = [];
  for (let cx = -Math.ceil(lim / CW); cx <= Math.ceil(lim / CW); cx++)
    for (let cz = -Math.ceil(lim / CH); cz <= Math.ceil(lim / CH); cz++) {
      if (Math.hypot((cx + 0.5) * CW, (cz + 0.5) * CH) > lim) continue;
      all.push(cells.get(cx + ',' + cz) || 0); }
  const mean = all.reduce((a, b) => a + b, 0) / all.length;
  const v = all.reduce((a, b) => a + (b - mean) * (b - mean), 0) / all.length;
  return v / Math.max(mean, 1e-9);
}

/* ---- the ambient population holds, evenly, through constant crashes ---- */
{
  const s = createSim({ seed: 71, params: nathan() });
  s.you.dead = 1e9; s.you.followers.length = 0;        // bots only
  for (let i = 0; i < Math.round(60 / STEP); i++) s.step();   // let the bots grow
  const amb = [], disp = [];
  let crashes = 0, debrisPeak = 0, over = 0;
  for (let i = 0; i < Math.round(60 / STEP); i++) {
    /* Constant crashes: every half second the longest living bot crashes. */
    if (i % 30 === 0) {
      let t = null;
      for (const r of s.rivals) if (!(r.dead > 0) && (!t || r.followers.length > t.followers.length)) t = r;
      if (t) { s.crash(t); crashes++; }
    }
    s.step();
    if (s.ambientWild() > s.params.wildCount) over++;
    if (i % 60 === 59) { amb.push(s.ambientWild()); disp.push(dispersionOf(s)); debrisPeak = Math.max(debrisPeak, s.debrisWild()); }
  }
  const mean = amb.reduce((a, b) => a + b, 0) / amb.length, worstD = Math.max(...disp);
  const meanD = disp.reduce((a, b) => a + b, 0) / disp.length;
  /* 3D: the refill time sets the level: the gap settles at the eating rate
     times the refill time, so the bar is the brief's 85%, not 95%. */
  ok('the ambient population holds (at least 85% of the wild count) through a minute of constant crashes',
     over === 0 && mean >= 0.85 * s.params.wildCount,
     'ambient each second min ' + Math.min(...amb) + ' mean ' + mean.toFixed(2) + ' max ' + Math.max(...amb) +
     ' of ' + s.params.wildCount + '; steps over target ' + over + '; ' + crashes + ' crashes; debris up to ' + debrisPeak);
  /* Ruling of brief 3A: even means a mean index of dispersion at most 1.5
     AND no single sample above 2.0. The old single-sample bar of 1.5 was a
     guess; the collapse this test exists to catch read far higher. */
  ok('and it stays even, judged by group: mean index of dispersion at or below 1.5, no sample above 2.0', meanD <= 1.5 && worstD <= 2.0,
     'burst cost ' + s.params.burstCost + '; mean ' + meanD.toFixed(4) + ', worst ' + worstD.toFixed(4) + ' over ' + disp.length + ' samples');
}

/* ---- uncollected debris sinks away when its glow ends ---- */
{
  const s = createSim({ seed: 72, params: nathan({ bots: 1 }) });
  s.you.dead = 1e9; s.you.followers.length = 0;
  const b = s.bots[0];
  b.x = 1500; b.z = 0; s.seedTrail(b); b.followers.length = 0;
  for (let i = 0; i < 12; i++) b.followers.push({ x: 1500, z: 0, head: 0, born: 0, from: i });
  const before = new Set(s.wild);
  s.crash(b);
  const debris = s.wild.filter(m => m && m.alive && !before.has(m));
  const glowT = s.params.scatterGlow, sinkT = s.params.drain;
  let collectableWhileGlowing = true, sinkingNotCollectable = true, sawSinking = false;
  let ambientBefore = s.ambientWild(), countedAsAmbient = false;
  for (let i = 0; i < Math.round((glowT + sinkT + 0.5) / STEP); i++) {
    s.step();
    if (s.ambientWild() > s.params.wildCount) countedAsAmbient = true;
    for (const m of debris) {
      if (!m.alive) continue;
      if (m.glow > 0 && !inHash(s, m)) collectableWhileGlowing = false;
      if (m.sinking > 0) { sawSinking = true; if (inHash(s, m)) sinkingNotCollectable = false; }
    }
  }
  const left = debris.filter(m => m.alive).length;
  ok('crash debris can be collected while it glows', collectableWhileGlowing, debris.length + ' let loose, glow ' + glowT + ' s');
  ok('when its glow ends it sinks, and sinking cannot be collected', sawSinking && sinkingNotCollectable, 'sink ' + sinkT + ' s');
  ok('and it is gone once sunk, never becoming ambient', left === 0 && !countedAsAmbient,
     left + ' still alive after ' + (glowT + sinkT + 0.5).toFixed(1) + ' s; ambient ' + ambientBefore + ' -> ' + s.ambientWild());
}

/* ---- every manta drawn as present is collectable ---- */
{
  const s = createSim({ seed: 73, params: nathan() });
  let checked = 0, badPresent = 0, staleFlags = 0, leaving = 0;
  for (let i = 0; i < Math.round(120 / STEP); i++) {
    s.input.want = Math.sin(i / 90) * 2; s.input.burst = (i % 240) < 60;
    s.step();
    if (i % 30) continue;
    for (const m of s.wild) {
      if (!m || !m.alive) continue;
      if (m.sinking > 0) { leaving++; continue; }         // drawn as leaving
      checked++;
      if (!inHash(s, m)) badPresent++;
      if (m.fromTrain && !(m.immune > 0)) staleFlags++;   // an ignore flag outliving its time
    }
  }
  ok('every wild manta drawn as present is collectable', checked > 0 && badPresent === 0,
     checked + ' checks, ' + badPresent + ' present but not collectable, ' + leaving + ' leaving');
  ok('and no shed flag outlives its time', staleFlags === 0, staleFlags + ' stale');
}

/* ---- an arena radius change waits for YOUR restart (ruling 5) ---- */
{
  const s = createSim({ seed: 74, params: nathan() });
  const R0 = s.params.arenaR;
  s.params.arenaRWanted = R0 - 1000;
  /* Bots crash and restart; the wall must not move. */
  let botRestarts = 0;
  for (let k = 0; k < 4; k++) { const b = s.rivals[k]; s.crash(b); }
  for (let i = 0; i < Math.round(3 / STEP); i++) { s.input.want = null; s.step(); }
  for (const b of s.rivals.slice(0, 4)) if (b.runs > 0) botRestarts++;
  const afterBots = s.params.arenaR;
  s.crash(s.you);
  for (let i = 0; i < Math.round((s.params.deathBeat + 0.5) / STEP); i++) s.step();
  ok('an arena radius change waits for your own restart', botRestarts > 0 && afterBots === R0 && s.params.arenaR === R0 - 1000,
     botRestarts + ' bots restarted and the wall stayed at ' + afterBots + '; after yours it is ' + s.params.arenaR);
}

/* ---- no bot targets food beyond its own reef turn-back line (ruling 6) ---- */
{
  const s = createSim({ seed: 75, params: nathan() });
  s.you.dead = 1e9; s.you.followers.length = 0;
  let picks = 0, beyond = 0, worst = -Infinity;
  for (let i = 0; i < Math.round(120 / STEP); i++) {
    s.step();
    for (const t of s.rivals) {
      if (t.goalKind !== 'food' || t.dead > 0 || t.goalAt === undefined) continue;
      if (t.think < 0.5 - STEP * 1.5) continue;          // judged on the step it chose
      picks++;
      const over = Math.hypot(t.goalX, t.goalZ) - s.brain.reefLine(t);
      worst = Math.max(worst, over);
      if (over > 0) beyond++;
    }
  }
  ok('no bot targets food beyond its reef turn-back line', picks > 0 && beyond === 0,
     picks + ' food choices, ' + beyond + ' beyond; closest ' + (-worst).toFixed(0) + ' units inside the line');
}

console.log('\npopulation tests: ' + (n - bad) + '/' + n + ' passed, ' + bad + ' failed');
process.exit(bad ? 1 : 0);
