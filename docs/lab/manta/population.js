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

  /* REGROWTH REFILLS THE GAP (3C, ruling 1). Each missing manta returns on
     average within the refill time, p.regrow seconds (5 by default), so
     the ocean refills faster the emptier it is. A fixed one every half
     second could not keep up with eleven trains at 300 and the ocean fell
     to about 35. Whole owed mantas spawn on the lattice, into dead slots
     below the count, away from leaders, as before. */
  function regrowWild (dt) {
    const gap = p.wildCount - ambientWild();
    if (gap <= 0) { regrowOwed = 0; return 0; }
    /* Owed never runs ahead of the gap, so a wait cannot bank a flood. */
    regrowOwed = Math.min(gap, regrowOwed + gap * dt / p.regrow);
    let n = 0;
    while (regrowOwed >= 1) {
      let slot = -1;
      for (let i = 0; i < p.wildCount; i++) { const w = wild[i]; if (!w || !w.alive) { slot = i; break; } }
      if (slot < 0) { regrowOwed = 0; break; }
      /* No group with room clear of every leader: wait for the next step. */
      if (!ctx.spawnWild(slot, ctx.trains, true)) break;
      regrowOwed -= 1; n++;
    }
    return n;
  }

  return { livingWild, ambientWild, debrisWild, drainSurplus, regrowWild };
}
