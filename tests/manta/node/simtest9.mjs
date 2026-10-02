/* Brief 3B, stage 1: the layout follows the arena and the wild count.
   Nathan's values: wild 300, arena 2000, burst 470, turn 5.2, recruit 30. */
import { readFileSync } from 'node:fs';
import { createSim, STEP, zoomFor, viewFor } from '../../../docs/lab/manta/sim.js';
let n = 0, bad = 0;
const ok = (name, cond, extra = '') => { n++; if (!cond) bad++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (extra ? '  [' + extra + ']' : '')); };
const P = {};
for (const m of readFileSync(decodeURIComponent(new URL('../../../docs/lab/manta/params.js', import.meta.url).pathname), 'utf8')
    .matchAll(/\{ key: '(\w+)',[^}]*?def: ([-\d.e]+)/g)) P[m[1]] = parseFloat(m[2]);
/* Two settings (3C): the committed defaults, and arena 2000 with wild 300. */
const BIG = process.env.SET === 'big';
const base = BIG ? { wildCount: 300, arenaR: 2000 } : { wildCount: P.wildCount, arenaR: P.arenaR };
const nathan = extra => ({ cruise: P.cruise, burst: P.burstSpeed, turnCruise: P.turnCruise, turnBurst: P.turnBurst,
  recruitR: P.recruitR, spacing: P.spacing, wildCount: base.wildCount, regrow: P.regrow, wildSize: P.wildSize,
  bloomPull: P.bloomPull, trainScale: P.trainScale, arenaR: base.arenaR, arenaRWanted: base.arenaR, bots: 10,
  burstCost: P.burstCost, scatterGlow: P.scatterGlow, ...extra });
console.log('   setting: ' + (BIG ? 'arena 2000, wild 300' : 'committed defaults, arena ' + P.arenaR + ', wild ' + P.wildCount));
const ord = w => w && w.alive && !w.loose && !(w.sinking > 0);
const play = (s, secs, each) => { for (let i = 0; i < Math.round(secs / STEP); i++) {
  s.input.want = Math.sin(i / 90) * 2; s.input.burst = (i % 240) < 40; s.step(); s.events.length = 0; if (each) each(s, i); } };
/* Created at A, then (if B) restarted at B, the way the arena slider does. */
function world (seed, A, B) {
  const s = createSim({ seed, params: nathan({ arenaR: A, arenaRWanted: A }) });
  if (B) { play(s, 10); s.params.arenaRWanted = B; s.crash(s.you); play(s, s.params.deathBeat + 0.2); }
  return s;
}
const RING = 150;
const nearShare = s => { const R = s.params.arenaR; let k = 0, c = 0;
  for (const w of s.wild) if (ord(w)) { c++; if (R - Math.hypot(w.x, w.z) <= RING) k++; }
  return (k / Math.max(c, 1)) / ((R * R - (R - RING) * (R - RING)) / (R * R)); };

for (const [A, B] of [[2000, 0], [4000, 0], [4000, 2000], [2000, 4000]]) {
  const label = B ? 'created at ' + A + ', restarted at ' + B : 'at ' + A;
  let worst = 0, sum = 0, k = 0, spawnPast = 0, homePast = 0, foodPast = 0, foodPicks = 0, bloomPast = 0;
  for (const seed of [41, 42, 43]) {
    const s = world(seed, A, B), R = s.params.arenaR;
    const seen = new Set(s.wild.filter(ord));
    for (const g of s.groups) if (Math.hypot(g.hx, g.hz) > R - 320 + 1e-6) homePast++;
    for (const b of s.blooms) if (Math.hypot(b.x, b.z) > R) bloomPast++;
    play(s, 120, (s2, i) => {
      for (const w of s2.wild) if (ord(w) && !seen.has(w)) { seen.add(w); if (Math.hypot(w.x, w.z) > R - 260 + 1e-6) spawnPast++; }
      for (const t of s2.rivals) { if (t.goalKind !== 'food' || t.dead > 0 || t.goalAt === undefined || t.think < 0.5 - STEP * 1.5) continue;
        foodPicks++; if (Math.hypot(t.goalX, t.goalZ) > s2.brain.reefLine(t)) foodPast++; }
      if (i >= Math.round(60 / STEP) && i % 60 === 0) { const r = nearShare(s2); worst = Math.max(worst, r); sum += r; k++; }
    });
  }
  ok('the share of wild mantas near the reef is at most 1.5x the ring\'s share of the area, ' + label, worst <= 1.5,
     'worst ' + worst.toFixed(2) + 'x, mean ' + (sum / k).toFixed(2) + 'x over ' + k + ' samples, 3 seeds');
  ok('nothing spawns, homes or targets food past the reef line, ' + label, spawnPast === 0 && homePast === 0 && foodPast === 0 && bloomPast === 0 && foodPicks > 0,
     'spawns past ' + spawnPast + ', homes past ' + homePast + ', blooms past ' + bloomPast + ', food targets past ' + foodPast + ' of ' + foodPicks);
}

{ /* A count raised from 20 to 300 mid-game gets groups laid out for 300. */
  const s = createSim({ seed: 44, params: nathan({ wildCount: 20 }) });
  play(s, 5); const g20 = s.groups.length; s.params.wildCount = 300; play(s, 1);
  ok('a new wild count lays the groups out again', g20 < 10 && s.groups.length >= 60 && s.groups.length <= 100, g20 + ' groups at 20, ' + s.groups.length + ' at 300');
  s.params.wildCount = 20; play(s, 5);
  ok('and back down again', s.groups.length < 10 && s.wild.every(w => !w || !w.alive || w.group < s.groups.length), s.groups.length + ' groups at 20; every living manta in a group that exists');
}

{ /* New ocean at wild 300: the ordinary count starts at 300, on the new arena. */
  /* Created elsewhere, then the sliders moved to this setting and New ocean. */
  const s = createSim({ seed: 45, params: nathan({ wildCount: BIG ? 20 : 300, arenaR: BIG ? 4000 : 2000, arenaRWanted: BIG ? 4000 : 2000 }) });
  play(s, 20); s.params.wildCount = base.wildCount; s.params.arenaRWanted = base.arenaR; s.newOcean(12345);
  const c = s.wild.filter(ord).length, past = s.wild.filter(w => ord(w) && Math.hypot(w.x, w.z) > s.params.arenaR - 260 + 1e-6).length;
  ok('after New ocean the ordinary count starts at the wild count, on the new arena', c === base.wildCount && s.params.arenaR === base.arenaR && past === 0 && s.you.followers.length === 0 && s.rivals.length === 10,
     c + ' ordinary of ' + base.wildCount + ', arena ' + s.params.arenaR + ', ' + past + ' past the reef line, ' + s.rivals.length + ' bots');
  const ids = s.rivals.map(t => t.id).join(',');
  ok('after New ocean the bots are numbered 1 to 10 again', ids === '1,2,3,4,5,6,7,8,9,10' && s.you.id === 0, 'ids ' + ids);
  const a = createSim({ seed: 1, params: nathan() }), b = createSim({ seed: 2, params: nathan() }); a.newOcean(777); b.newOcean(777);
  play(a, 5); play(b, 5);
  ok('New ocean is a function of its seed', a.you.x === b.you.x && a.wild.filter(ord).length === b.wild.filter(ord).length, a.you.x.toFixed(3) + ' vs ' + b.you.x.toFixed(3));
}

console.log('\nlayout tests: ' + (n - bad) + '/' + n + ' passed, ' + bad + ' failed');
process.exit(bad ? 1 : 0);
