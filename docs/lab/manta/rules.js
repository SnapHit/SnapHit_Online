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
  /* Read at call time: the groups are laid out again when the arena or the
     wild count changes (3B). */
  const groupCount = ctx.groupCount;
  const wild = ctx.wild;
  const scratch = ctx.scratch;
  const hash = ctx.hash;

  /* EVERY MANTA IN A TRAIN, leader first. A crash asks "did my leader touch
     any part of another train", and a cut asks "which part". */
  function partsOf (t) { return [t, ...t.followers]; }

  /* COLLECTABLE FROM THE MOMENT IT IS IN THE WATER (ruling 3): the hash is
     built before touches resolve, so a manta scattered this step went in
     only on the next one, drawn for a frame before anyone could take it. */
  function intoHash (m) { m.isWild = true; m.train = null; hash.add(m.x, m.z, m); }

  /* 6.3: a scattered manta glows in its old train's colour for a few seconds
     and joins the first leader to touch it; after that it is an ordinary wild
     manta again. It keeps the colour it owned before it ever joined. */
  /* One way into the water, so the leader glows exactly like its train. */
  function scatterOne (t, f, owner, immune = 0) {
    const m = { x: f.x, z: f.z, head: f.head, group: Math.floor(next() * groupCount()),
                speed: 40 + next() * 30, glow: p.scatterGlow, wasColour: t.id,
                colour: f.from >= 0 ? f.from : 0, alive: true, isWild: true, loose: true,
                fromTrain: immune > 0 ? owner : null, immune };
    let at = -1;
    for (let i = p.wildCount; i < wild.length; i++) if (!wild[i] || !wild[i].alive) { at = i; break; }
    if (at >= 0) wild[at] = m; else wild.push(m);
    intoHash(m);
    return m;
  }

  function scatter (t, from, immune = 0) {
    const dropped = t.followers.splice(from);
    for (const f of dropped) {
      /* Into a loose slot that has gone dead if there is one, so a long run
         of crashes does not grow this array without bound. Ambient slots —
         everything below wildCount — belong to the regrowth timer. */
      const m = { x: f.x, z: f.z, head: f.head, group: Math.floor(next() * groupCount()),
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
      intoHash(m);
    }
    return dropped.length;
  }

  /* 6.1 rule 3 and 6.3. The train you hit is unharmed; you scatter and are
     dazed, or stunned if you had nobody to lose. */
  /* v1.10 rule 3: "your WHOLE train, you included, scatters into glowing
     wild mantas for anyone to recruit, and you start again as a lone manta
     somewhere else in the ocean." So the leader is scattered too, the run
     ends here and its peak is its score, and the death beat runs before
     sim.js puts the train back somewhere clear. A lone leader crashes the
     same way: there is no stun any more, because there is no you to stun. */
  /* SET PIECES FIRE ON EVENTS, ONE EACH (ruling 4 of 2B part four). The
     renderer read t.cut and t.crashed every frame, and those stay frozen on a
     train in its death beat, so one cut fired again and again. Now each crash
     and each cut is recorded once, with where it happened. A burst that
     crosses a body touches follower after follower on successive steps: the
     same cutter against the same train within CROSSING seconds is one cut. */
  const CROSSING = 0.35;
  function record (e) {
    if (!ctx.events) return;
    ctx.events.push(e);
    if (ctx.events.length > 256) ctx.events.shift();   // nobody draining: a test
  }

  /* `into` is what it hit — the other train, or null for the reef — and
     `how` whether that was a leader head on or somebody's body. */
  function crash (t, into = null, how = 'reef') {
    if (t.dead > 0) return 0;                     // nothing happens to a wreck
    const had = t.followers.length;
    record({ kind: 'crash', id: t.id, into: into ? into.id : -1, how,
             intoLen: into ? into.followers.length : -1, len: had, x: t.x, z: t.z, at: ctx.now ? ctx.now() : 0 });
    t.crashX = t.x; t.crashZ = t.z;
    scatter(t, 0);
    /* The leader itself, at the point of the crash, glowing like the rest. */
    scatterOne(t, { x: t.x, z: t.z, head: t.head, from: 0 }, t);
    t.dead = p.deathBeat;
    t.crashed = 0.25;
    t.bursting = false;
    t.burstOwed = 0;
    return had + 1;
  }

  /* 6.3: a cut happens where a BURSTING leader touches another train. Every
     follower behind the contact point goes wild; the rest of that train,
     including its leader, carries on. Touching its leader cuts at the front,
     so the whole train goes. */
  function cutAt (t, index, by = null) {
    const at = t.followers[index] || t;           // where it was touched
    const x = at.x, z = at.z;
    /* The cut train may not take its own loose followers back in the same
       step: they go into the hash at once now, and its leader sits one
       spacing from the first of them. One step, as before. */
    const freed = scatter(t, index, 1 / 60);
    if (freed) {
      t.cut = 0.25;
      const now = ctx.now ? ctx.now() : 0;
      const same = by && t.lastCutBy === by && now - t.lastCutAt < CROSSING;
      t.lastCutBy = by; t.lastCutAt = now;
      if (!same) record({ kind: 'cut', id: t.id, by: by ? by.id : -1, x, z, at: now });
    }
    return freed;
  }

  /* Who is touching whom. Only a leader can start any of this: it is the
     front of its own train (6.3), and a follower touching anything does
     nothing at all. */
  function contacts (t) {
    hash.near(t.x, t.z, scratch);
    let hitTrain = null, hitIndex = 0, hitLeader = false, best = Infinity;
    for (const o of scratch) {
      if (o.isWild || o.train === t) continue;
      if (!o.train) continue;
      const d = Math.hypot(o.x - t.x, o.z - t.z);
      /* Train size scales what a manta IS, not just how it looks, so a
         bigger train is a bigger target and a wider wall. */
      const k = p.trainScale || 1;
      if (d > (p.leaderR + (o.isLeader ? p.leaderR : p.followerR)) * k) continue;
      if (d < best) { best = d; hitTrain = o.train; hitIndex = o.index; hitLeader = !!o.isLeader; }
    }
    return hitTrain ? { train: hitTrain, index: hitIndex, leader: hitLeader } : null;
  }

  function resolveTouches () {
    /* Gathered first and applied afterwards, so a head-on is judged on what
       both leaders were doing rather than on which one was stepped first.
       MUTUAL PAIRS GO FIRST, for the same reason: handling them in train
       order let the first leader crash on its own and the second then read
       the pair as mutual, so one head-on was scored twice and the other side
       not at all. */
    const hits = ctx.trains.map(t => t.dead > 0 ? null : contacts(t));
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
      if (a && !b) cutAt(other, h.index, t);
      else if (b && !a) cutAt(t, hits[back].index, other);
      else { crash(t, other, 'head-on'); crash(other, t, 'head-on'); }
      done.add(t); done.add(other);
    }
    for (let i = 0; i < ctx.trains.length; i++) {
      const t = ctx.trains[i], h = hits[i];
      if (!h || done.has(t) || done.has(h.train)) continue;
      if (t.bursting) cutAt(h.train, h.index, t);
      else crash(t, h.train, h.leader ? 'leader' : 'body');
      done.add(t);
    }
    /* The reef is a wall and hitting it is a crash like any other. */
    for (const t of ctx.trains) {
      if (t.dead > 0) continue;
      if (Math.hypot(t.x, t.z) >= p.arenaR - p.leaderR * (p.trainScale || 1) - 0.5) crash(t, null, 'reef');
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

  return { partsOf, scatter, scatterOne, crash, cutAt, contacts, resolveTouches, payForBurst, steerRival };
}
