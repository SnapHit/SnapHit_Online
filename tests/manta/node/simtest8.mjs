/* Brief 3A: ordinary wild mantas never exceed the wild count, and a lowered
   wild count drains its surplus. Seeded, at the committed defaults. */
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
const split = s => { let o = 0, d = 0; for (const w of s.wild) { if (!w || !w.alive) continue; if (w.loose) d++; else o++; } return { o, d }; };

{ /* Two minutes of play with a crash every half second: never over. */
  const s = createSim({ seed: 81, params: nathan() });
  let worst = 0, debrisPeak = 0, crashes = 0;
  for (let i = 0; i < Math.round(120 / STEP); i++) {
    if (i > 1800 && i % 30 === 0) { let t = null;
      for (const r of s.rivals) if (!(r.dead > 0) && (!t || r.followers.length > t.followers.length)) t = r;
      if (t) { s.crash(t); crashes++; } }
    s.input.want = Math.sin(i / 90) * 2; s.step(); s.events.length = 0;
    const c = split(s); worst = Math.max(worst, c.o); debrisPeak = Math.max(debrisPeak, c.d);
  }
  ok('ordinary wild mantas never exceed the wild count, through a burst of crashes', worst <= s.params.wildCount,
     'most ordinary ' + worst + ' of ' + s.params.wildCount + '; debris up to ' + debrisPeak + '; ' + crashes + ' crashes');
}
{ /* The page's old start: spawned at 120, then told 20. The surplus drains. */
  const s = createSim({ seed: 82, params: nathan({ wildCount: 120 }) });
  s.params.wildCount = 20;
  let t = 0; const was = split(s).o;
  for (let i = 0; i < Math.round(10 / STEP); i++) { s.step(); s.events.length = 0; if (split(s).o > 20) t = i + 1; }
  const now = split(s).o;
  ok('a lowered wild count drains its surplus', was === 120 && now <= 20,
     'ordinary ' + was + ' -> ' + now + ' of 20; last over the count at ' + (t * STEP).toFixed(2) + ' s (drain ' + s.params.drain + ' s)');
}
console.log('\nwild count tests: ' + (n - bad) + '/' + n + ' passed, ' + bad + ' failed');
process.exit(bad ? 1 : 0);
