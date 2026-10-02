/* How evenly are the wild mantas spread after a minute of play? The arena,
   away from the reef, is cut into screen-sized cells and each is counted.
   Variance over mean — the index of dispersion — is 1 for a uniform random
   scatter and grows with clumping. */
import { createSim, DEF } from '../../../docs/lab/manta/sim.js';
export function dispersion (count, seed = 5, secs = 60) {
  const s = createSim({ seed, params: { wildCount: count } });
  for (let i = 0; i < Math.round(secs / (1 / 60)); i++) {
    s.input.want = Math.sin(i / 120) * 2;
    s.step();
  }
  /* Screen-sized cells, 385 by 855, over the disc inside the reef. */
  const CW = 385, CH = 855, lim = DEF.arenaR - 150;
  const cells = new Map();
  let placed = 0;
  /* 3C ruling 2: judged by group. Each group's centre (the centroid of its
     living ordinary members) is one point, so the designed groups of 3 to 5
     sharing a cell do not read as clumping. */
  const sum = new Map();
  for (const w of s.wild) {
    if (!w || !w.alive || w.loose || w.sinking > 0) continue;
    const g = sum.get(w.group) || { x: 0, z: 0, n: 0 }; g.x += w.x; g.z += w.z; g.n++; sum.set(w.group, g);
  }
  for (const g of sum.values()) {
    const x = g.x / g.n, z = g.z / g.n;
    if (Math.hypot(x, z) > lim) continue;
    const k = Math.floor(x / CW) + ',' + Math.floor(z / CH);
    cells.set(k, (cells.get(k) || 0) + 1);
    placed++;
  }
  /* Every cell whose centre is inside the disc counts, empty ones included:
     the empty stretches are exactly what Nathan is complaining about. */
  const all = [];
  for (let cx = -Math.ceil(lim / CW); cx <= Math.ceil(lim / CW); cx++)
    for (let cz = -Math.ceil(lim / CH); cz <= Math.ceil(lim / CH); cz++) {
      const mx = (cx + 0.5) * CW, mz = (cz + 0.5) * CH;
      if (Math.hypot(mx, mz) > lim) continue;
      all.push(cells.get(cx + ',' + cz) || 0);
    }
  const mean = all.reduce((a, b) => a + b, 0) / all.length;
  const varr = all.reduce((a, b) => a + (b - mean) * (b - mean), 0) / all.length;
  return { count, placed, cells: all.length, mean: +mean.toFixed(2),
           variance: +varr.toFixed(2), index: +(varr / Math.max(mean, 1e-9)).toFixed(2),
           worst: Math.max(...all), empty: all.filter(v => v === 0).length };
}
if (process.argv[1].endsWith('disperse.mjs')) {
  for (const n of [20, 120]) console.log(JSON.stringify(dispersion(n)));
}
