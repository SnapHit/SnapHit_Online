/* The rules of sections 6.1 and 6.3, lifted out of sim.js whole.
 *
 * Nothing here draws and nothing here steps a train: it decides what a touch
 * MEANS — a crash, a cut, a head-on — and what a burst costs. sim.js owns the
 * world and hands it over as one context object, which is filled in before
 * the first step and read at call time, because the trains array cannot exist
 * until the trains do.
 *
 * Split out of sim.js with no change of behaviour: the three suites report
 * the same 37 passes, line for line, before and after.
 */
export function createRules (ctx) {
  const { p } = ctx;
  const next = ctx.next;
  const GROUPS = ctx.GROUPS;
  const wild = ctx.wild;
  const scratch = ctx.scratch;
  const hash = ctx.hash;

  /* EVERY MANTA IN A TRAIN, leader first. A crash asks "did my leader touch
     any part of another train", and a cut asks "which part". */
  function partsOf (t) { return [t, ...t.followers]; }

  /* 6.3: a scattered manta glows in its old train's colour for a few seconds
     and joins the first leader to touch it; after that it is an ordinary wild
     manta again. It keeps the colour it owned before it ever joined. */
  function scatter (t, from, immune = 0) {
    const dropped = t.followers.splice(from);
    for (const f of dropped) {
      /* Into a loose slot that has gone dead if there is one, so a long run
         of crashes does not grow this array without bound. Ambient slots —
         everything below wildCount — belong to the regrowth timer. */
      const m = { x: f.x, z: f.z, head: f.head, group: Math.floor(next() * GROUPS),
                  speed: 40 + next() * 30, glow: p.scatterGlow, wasColour: t.id,
                  colour: f.from >= 0 ? f.from : 0, alive: true, isWild: true, loose: true,
                  /* WHO JUST DROPPED IT, and for how long they may not have it
                     back. A burst sheds from the tail, which sits one spacing
                     — 31 units — behind the leader, and the recruit radius is
                     40: without this the manta you paid with rejoins on the
                     next step and the burst is free. Measured: a train of
                     eight drained to one and then stuck there. A crash needs
                     no such thing, because 6.3 dazes the crasher for exactly
                     this reason. Everybody ELSE may still take it at once,
                     which is what 6.3 asks for. */
                  fromTrain: immune > 0 ? t : null, immune };
      let at = -1;
      for (let i = p.wildCount; i < wild.length; i++) if (!wild[i] || !wild[i].alive) { at = i; break; }
      if (at >= 0) wild[at] = m; else wild.push(m);
    }
    return dropped.length;
  }

  /* 6.1 rule 3 and 6.3. The train you hit is unharmed; you scatter and are
     dazed, or stunned if you had nobody to lose. */
  function crash (t) {
    const had = t.followers.length;
    scatter(t, 0);
    if (had > 0) t.dazed = p.daze; else t.stunned = p.stun;
    t.crashed = 0.25;
    t.bursting = false;
    return had;
  }

  /* 6.3: a cut happens where a BURSTING leader touches another train. Every
     follower behind the contact point goes wild; the rest of that train,
     including its leader, carries on. Touching its leader cuts at the front,
     so the whole train goes. */
  function cutAt (t, index) {
    const freed = scatter(t, index);
    if (freed) t.cut = 0.25;
    return freed;
  }

  /* Who is touching whom. Only a leader can start any of this: it is the
     front of its own train (6.3), and a follower touching anything does
     nothing at all. */
  function contacts (t) {
    hash.near(t.x, t.z, scratch);
    let hitTrain = null, hitIndex = 0, best = Infinity;
    for (const o of scratch) {
      if (o.isWild || o.train === t) continue;
      if (!o.train) continue;
      const d = Math.hypot(o.x - t.x, o.z - t.z);
      if (d > p.leaderR + (o.isLeader ? p.leaderR : p.followerR)) continue;
      if (d < best) { best = d; hitTrain = o.train; hitIndex = o.index; }
    }
    return hitTrain ? { train: hitTrain, index: hitIndex } : null;
  }

  function resolveTouches () {
    /* Gathered first and applied afterwards, so a head-on is judged on what
       both leaders were doing rather than on which one was stepped first.
       MUTUAL PAIRS GO FIRST, for the same reason: handling them in train
       order let the first leader crash on its own and the second then read
       the pair as mutual, so one head-on was scored twice and the other side
       not at all. */
    const hits = ctx.trains.map(t => (t.dazed > 0 || t.stunned > 0) ? null : contacts(t));
    const done = new Set();
    for (let i = 0; i < ctx.trains.length; i++) {
      const t = ctx.trains[i], h = hits[i];
      if (!h) continue;
      const back = ctx.trains.indexOf(h.train);
      if (back < 0 || back <= i) continue;
      if (!hits[back] || hits[back].train !== t) continue;
      /* HEAD ON. Both crash unless exactly one is bursting; the one that is
         cuts the other instead, and two bursting leaders both crash. */
      const other = h.train, a = t.bursting, b = other.bursting;
      if (a && !b) cutAt(other, h.index);
      else if (b && !a) cutAt(t, hits[back].index);
      else { crash(t); crash(other); }
      done.add(t); done.add(other);
    }
    for (let i = 0; i < ctx.trains.length; i++) {
      const t = ctx.trains[i], h = hits[i];
      if (!h || done.has(t) || done.has(h.train)) continue;
      if (t.bursting) cutAt(h.train, h.index);
      else crash(t);
      done.add(t);
    }
    /* The reef is a wall and hitting it is a crash like any other. */
    for (const t of ctx.trains) {
      if (t.dazed > 0 || t.stunned > 0) continue;
      if (Math.hypot(t.x, t.z) >= p.arenaR - p.leaderR - 0.5) crash(t);
    }
  }

  /* 6.3: bursting needs at least one follower to pay with, and holding it
     drains them from the tail at a steady rate. */
  function payForBurst (t, dt) {
    if (!t.bursting) { t.burstOwed = 0; return 0; }
    t.burstOwed += dt;
    let paid = 0;
    while (t.burstOwed >= p.burstCost && t.followers.length > 0) {
      t.burstOwed -= p.burstCost;
      scatter(t, t.followers.length - 1, p.burstCost * 3);
      paid++;
    }
    if (t.followers.length === 0) { t.bursting = false; t.burstOwed = 0; }
    return paid;
  }

  /* A rival that has been cut down to its leader is no use as a target, so
     it gathers a new train. It does that by recruiting like everyone else,
     which is why this only has to turn its appetite back on. */
  function steerRival (t, dt) {
    const a = t.aim;
    a.t -= dt;
    if (a.t <= 0) {
      a.t = 4 + next() * 6;
      /* Towards the player often enough to meet: 6.2 wants something to
         crash into and something to cut. */
      if (next() < 0.5) { a.x = ctx.you.x + (next() - 0.5) * 300; a.z = ctx.you.z + (next() - 0.5) * 300; }
      else { const b = ctx.blooms[Math.floor(next() * ctx.blooms.length)];
             a.x = b.x + (next() - 0.5) * 400; a.z = b.z + (next() - 0.5) * 400; }
    }
    t.want = Math.atan2(-(a.x - t.x), -(a.z - t.z));
    if (t.followers.length === 0) { t.rebuild -= dt; } else t.rebuild = 10;
  }

  return { partsOf, scatter, crash, cutAt, contacts, resolveTouches, payForBurst, steerRival };
}
