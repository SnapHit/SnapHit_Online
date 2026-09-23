/* The bots: one brain, three dials, from section 10.2.
 *
 *   every half second, pick a goal — the nearest reachable group of wild
 *   mantas, or a plankton bloom if none are close;
 *   steer towards it while avoiding the reef and any train segment ahead;
 *   burst to cut when a train crosses close ahead and there are followers
 *   to pay with.
 *
 * The dials are greed (how far it will chase food), caution (how early it
 * gives a train room) and aggression (how readily it spends a follower to
 * cut one). The three personalities are presets of those dials and nothing
 * else: there is one brain.
 *
 * It decides only what a bot WANTS — a heading and whether to hold burst —
 * and writes that into the same two fields the player's input writes. Every
 * rule then applies to a bot exactly as it applies to you: it recruits, it
 * crashes, its run ends, it restarts, it cuts and is cut.
 */
export const PRESETS = {
  greedy: { greed: 1.00, caution: 0.35, aggression: 0.45 },
  timid:  { greed: 0.40, caution: 1.00, aggression: 0.10 },
  bully:  { greed: 0.65, caution: 0.45, aggression: 1.00 },
};
export const PRESET_KEYS = Object.keys(PRESETS);

export function createBrain (ctx) {
  const { p } = ctx;

  /* How far this bot will go out of its way for food, and how early it
     starts giving a train room. Both are distances, so the dials read as
     something you can watch on the phone. */
  const reachOf = t => 500 + t.greed * 2800;
  const lookOf = t => 140 + t.caution * 300;

  function pickGoal (t) {
    const reach = reachOf(t);
    let best = null, bd = reach;
    for (const w of ctx.wild) {
      if (!w || !w.alive) continue;
      /* Glowing scattered mantas are food like any other, the ones it has
         just cut loose included. The only ones it skips are those it may not
         take back yet: what it shed to pay for its own burst. */
      if (w.fromTrain === t && w.immune > 0) continue;
      const d = Math.hypot(w.x - t.x, w.z - t.z);
      if (d < bd) { bd = d; best = w; }
    }
    if (best) { t.goalX = best.x; t.goalZ = best.z; t.goalKind = 'food'; t.goalAt = bd; return; }
    /* Nothing within reach, so the plankton: 6.3 makes a bloom an attractor
       and the doc's brain falls back to one. */
    let bb = null, bbd = Infinity;
    for (const b of ctx.blooms) {
      const d = Math.hypot(b.x - t.x, b.z - t.z);
      if (d < bbd) { bbd = d; bb = b; }
    }
    if (bb) { t.goalX = bb.x; t.goalZ = bb.z; t.goalKind = 'bloom'; t.goalAt = bbd; }
  }

  /* The nearest part of somebody else's train that is AHEAD of this bot. */
  function crossingAhead (t) {
    const look = lookOf(t);
    const fx = -Math.sin(t.head), fz = -Math.cos(t.head);
    let hit = null, hd = look;
    for (const o of ctx.trains) {
      if (o === t || o.dead > 0) continue;
      const parts = [o, ...o.followers];
      for (let i = 0; i < parts.length; i++) {
        const q = parts[i];
        const dx = q.x - t.x, dz = q.z - t.z;
        const d = Math.hypot(dx, dz) || 1e-6;
        if (d > look) continue;
        if ((dx * fx + dz * fz) / d < 0.3) continue;      // behind or beside
        if (d < hd) { hd = d; hit = { q, o, d, dx, dz, index: i }; }
      }
    }
    return hit;
  }

  function think (t, dt) {
    t.think = (t.think || 0) - dt;
    if (t.think <= 0) { t.think = 0.5; pickGoal(t); }

    let gx = (t.goalX === undefined ? t.x : t.goalX) - t.x;
    let gz = (t.goalZ === undefined ? t.z : t.goalZ) - t.z;
    const gn = Math.hypot(gx, gz) || 1;
    gx /= gn; gz /= gn;

    /* THE REEF FIRST, because the reef ends the run. A cautious bot turns
       inward earlier; every bot turns eventually, and hard. */
    const r = Math.hypot(t.x, t.z) || 1e-6;
    const edge = p.arenaR - 300 - t.caution * 400;
    if (r > edge) {
      const k = Math.min(1.8, (r - edge) / 220 + 0.35);
      gx += (-t.x / r) * k * 2.4;
      gz += (-t.z / r) * k * 2.4;
    }

    /* Then whatever is in the way. */
    const hit = crossingAhead(t);
    const look = lookOf(t);
    let burst = false;
    if (hit) {
      /* Cut it, if this bot is the sort that would and has a follower to
         pay with. 6.3: bursting into a train cuts it where it touches. */
      burst = t.aggression > 0.5 && t.followers.length > 0 && hit.d < look * 0.75;
      if (!burst) {
        /* Otherwise go round: push sideways, harder the closer it is and the
           more cautious the bot. */
        const px = -hit.dz, pz = hit.dx, pn = Math.hypot(px, pz) || 1;
        const side = (px * gx + pz * gz) >= 0 ? 1 : -1;
        const k = (0.4 + t.caution * 2.6) * (1 - hit.d / look);
        gx += (px / pn) * side * k;
        gz += (pz / pn) * side * k;
      }
    }

    t.bursting = burst && t.followers.length > 0;
    t.want = Math.atan2(-gx, -gz);
  }

  /* The deal: which personality each bot wears, from the seed, so a seed
     replays the whole ocean and the panel can say what it rolled. */
  function dealDials (t, roll) {
    const key = PRESET_KEYS[Math.floor(roll * PRESET_KEYS.length) % PRESET_KEYS.length];
    const d = PRESETS[key];
    t.kind = key; t.greed = d.greed; t.caution = d.caution; t.aggression = d.aggression;
    return key;
  }

  return { think, dealDials, reachOf, lookOf, crossingAhead };
}
