/* How many wild mantas are alive, and keeping the ocean even.
 *
 * TWO POPULATIONS, by ruling 2 of 2B part four (it overrides 6.3's "after
 * that they're ordinary wild mantas" and 10.2's "every wild manta counts
 * towards the target, scattered ones included"):
 *
 *   AMBIENT — the slots below the wild count. They regrow one at a time, on
 *   the even lattice, up to the wild count, whatever else is in the water.
 *
 *   DEBRIS — what a crash or a cut lets loose. It glows for the scatter glow
 *   and can be collected while it glows. If nobody collects it, it SINKS:
 *   uncollectable at once, drawn dimming and shrinking away, then gone. It
 *   never becomes ambient and never counts towards the target, so a crash
 *   can neither crowd the ocean nor empty it. Counting debris towards the
 *   target is what left the ocean at 4 of 20 under constant crashes.
 *
 * Ruling 3: a manta drawn as present is collectable. Sinking is the only
 * uncollectable state, and it is drawn as leaving.
 */
export function createPopulation (ctx) {
  const { p, wild, you } = ctx;
  let regrowOwed = 0;

  /* Everything alive in the water, sinking debris included: what is drawn. */
  function livingWild () {
    let n = 0;
    for (const w of wild) if (w && w.alive) n++;
    return n;
  }
  /* The ambient population the target works against: debris never counts. */
  function ambientWild () {
    let n = 0;
    for (let i = 0; i < p.wildCount && i < wild.length; i++) {
      const w = wild[i];
      if (w && w.alive && !w.loose && !(w.sinking > 0)) n++;
    }
    return n;
  }
  function debrisWild () {
    let n = 0;
    for (const w of wild) if (w && w.alive && w.loose) n++;
    return n;
  }

  /* Sinking runs its course and ends in nothing. Debris starts to sink the
     moment its glow runs out. If the wild count is turned down, the ambient
     surplus sinks too, furthest from the player first, one at a time. */
  function drainSurplus (dt) {
    let started = 0;
    for (const w of wild) {
      if (!w || !w.alive) continue;
      if (w.sinking > 0) {
        w.sinking -= dt;
        if (w.sinking <= 0) { w.sinking = 0; w.alive = false; if (ctx.release) ctx.release(w); }
        continue;
      }
      if (w.loose && !(w.glow > 0)) { w.sinking = p.drain; started++; }
    }
    /* The surplus is any ordinary manta in a slot at or past the count.
       This used to test ambientWild() > p.wildCount, which can never be
       true because ambientWild() only counts slots below the count, so a
       lowered wild count left its surplus swimming forever (3A). */
    {
      let far = null, fd = -1;
      for (let i = p.wildCount; i < wild.length; i++) {
        const w = wild[i];
        if (!w || !w.alive || w.loose || w.sinking > 0) continue;
        const d = Math.hypot(w.x - you.x, w.z - you.z);
        if (d > fd) { fd = d; far = w; }
      }
      if (far) { far.sinking = p.drain; started++; }
    }
    return started;
  }

  /* One every regrow seconds, up to the count, into a dead ambient slot. */
  function regrowWild (dt) {
    if (ambientWild() >= p.wildCount) { regrowOwed = 0; return 0; }
    regrowOwed += dt;
    if (regrowOwed < p.regrow) return 0;
    regrowOwed -= p.regrow;
    for (let i = 0; i < p.wildCount; i++) {
      const w = wild[i];
      if (!w || !w.alive) { ctx.spawnWild(i, ctx.trains); return 1; }
    }
    return 0;
  }

  return { livingWild, ambientWild, debrisWild, drainSurplus, regrowWild };
}
