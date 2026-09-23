/* How many wild mantas are alive, and keeping it at the target: the surplus
 * a crash puts in the water drains away, and regrowth tops the ocean up one
 * manta at a time and never faster.
 *
 * It reads the world through one context at call time, and is called from
 * the same point in the step as before, so the generator is drawn in the
 * same order: the suites' PASS and FAIL lines hash identically before and
 * after the move.
 */
export function createPopulation (ctx) {
  const { p, wild, you } = ctx;
  /* One every regrow seconds, up to the count, into a slot that has gone
     dead and away from every leader. Never two in one step. */
  let regrowOwed = 0;
  /* THE LIVING POPULATION, SCATTERED ONES INCLUDED. This counted only the
     ambient slots, so a crash that put forty mantas in the water left the
     ocean forty over its target and regrowth carried on regardless: the
     count is what the target works against, however a manta got there. */
  function livingWild () {
    let n = 0;
    for (const w of wild) if (w && w.alive) n++;
    return n;
  }

  /* Over the target, nothing regrows and the surplus drains away: the
     scattered ones furthest from the player fade out first, over a few
     seconds each, so the ocean settles back without anything vanishing
     under your nose. */
  function drainSurplus (dt) {
    let live = 0, going = 0;
    for (const w of wild) {
      if (!w || !w.alive) continue;
      live++;
      if (w.fading > 0) going++;
    }
    for (const w of wild) {
      if (!w || !w.alive || !(w.fading > 0)) continue;
      w.fading -= dt;
      if (w.fading <= 0) w.alive = false;
    }
    let over = live - going - p.wildCount;
    if (over <= 0) return 0;
    /* Enough of them at once to cover the whole surplus, furthest from the
       player first, so a train of forty crashing does not leave the ocean
       over its target for two minutes. They still take their few seconds
       each to fade. */
    const spare = [];
    for (const w of wild) {
      if (!w || !w.alive || !w.loose || w.glow > 0 || w.fading > 0) continue;
      spare.push(w);
    }
    spare.sort((a, b) => Math.hypot(b.x - you.x, b.z - you.z) - Math.hypot(a.x - you.x, a.z - you.z));
    let started = 0;
    for (const w of spare) {
      if (over <= 0) break;
      w.fading = p.drain; over--; started++;
    }
    return started;
  }

  function regrowWild (dt) {
    const live = livingWild();
    if (live >= p.wildCount) { regrowOwed = 0; return 0; }
    regrowOwed += dt;
    if (regrowOwed < p.regrow) return 0;
    regrowOwed -= p.regrow;
    for (let i = 0; i < p.wildCount; i++) if (!wild[i] || !wild[i].alive) { ctx.spawnWild(i, ctx.trains); return 1; }
    return 0;
  }

  return { livingWild, drainSurplus, regrowWild };
}
