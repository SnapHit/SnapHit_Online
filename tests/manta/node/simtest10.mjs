/* Brief 3D stage 1: a full ocean at the committed defaults, ten bots, you swimming. */
import { readFileSync } from 'node:fs';
import { createSim, STEP } from '../../../docs/lab/manta/sim.js';
let n = 0, bad = 0;
const ok = (name, cond, extra = '') => { n++; if (!cond) bad++; console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (extra ? '  [' + extra + ']' : '')); };
const P = {}; for (const m of readFileSync(decodeURIComponent(new URL('../../../docs/lab/manta/params.js', import.meta.url).pathname), 'utf8').matchAll(/\{ key: '(\w+)',[^}]*?def: ([-\d.e]+)/g)) P[m[1]] = parseFloat(m[2]);
const params = { cruise: P.cruise, burst: P.burstSpeed, turnCruise: P.turnCruise, turnBurst: P.turnBurst, recruitR: P.recruitR, spacing: P.spacing, wildCount: P.wildCount, regrow: P.regrow, wildSize: P.wildSize, bloomPull: P.bloomPull, trainScale: P.trainScale, arenaR: P.arenaR, arenaRWanted: P.arenaR, bots: P.bots, burstCost: P.burstCost, scatterGlow: P.scatterGlow };
const ord = w => w && w.alive && !w.loose && !(w.sinking > 0);
console.log('   defaults: wild ' + P.wildCount + ', arena ' + P.arenaR + ', refill ' + P.regrow + ' s, bots ' + P.bots + ', burst ' + P.burstSpeed + ', turn ' + P.turnCruise + ', recruit ' + P.recruitR);
const shares = [];
for (const seed of [51, 52, 53, 54, 55]) {
  const s = createSim({ seed, params }); let sum = 0, k = 0; const at = {};
  for (let i = 0; i < Math.round(300 / STEP); i++) {
    s.input.want = Math.sin(i / 90) * 2; s.input.burst = (i % 240) < 40; s.step(); s.events.length = 0;
    const o = s.wild.filter(ord).length;
    if (i >= Math.round(60 / STEP)) { sum += o; k++; }
    for (const T of [60, 120, 300]) if (Math.abs((i + 1) * STEP - T) < STEP / 2) at[T] = o;
  }
  shares.push({ seed, mean: sum / k / P.wildCount, at });
}
ok('the ordinary wild count averages at least 85% of the wild count from minute 1 to minute 5, ten bots',
   shares.every(r => r.mean >= 0.85), shares.map(r => r.seed + ': ' + (100 * r.mean).toFixed(1) + '% (1/2/5 min ' + r.at[60] + '/' + r.at[120] + '/' + r.at[300] + ')').join('; '));
console.log('\nfull ocean tests: ' + (n - bad) + '/' + n + ' passed, ' + bad + ' failed');
process.exit(bad ? 1 : 0);
