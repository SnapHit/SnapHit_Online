/* The game, with nothing in it that knows how to draw.
 *
 * No imports from three, no uniforms, no DOM. That is the point: the rules
 * are steppable in Node thousands of times a second, so every one of them
 * has a test that runs in milliseconds instead of a browser that draws at
 * one frame a second. main.js reads this and paints it; this never looks
 * back.
 *
 * FIXED STEP, SEEDED. Every step is exactly 1/60, and every random choice
 * comes from the seeded generator, so a seed plus a list of inputs is a
 * reproducible run — which is what makes a failing acceptance test something
 * you can re-run rather than something you saw once.
 */
import { rng } from './palette.js';
import { createRules } from './rules.js';
import { createBrain } from './bots.js';
import { createMotion } from './motion.js';
import { createPopulation } from './population.js';

import { STEP, DEF, FADE, zoomFor, viewFor, joinMix, looseMix, sizeFor, leaderSize,
         createHash, TAU, wrapAngle } from './simcore.js';
/* Re-exported, so everything that imported these from sim.js still does. */
export { STEP, DEF, FADE, zoomFor, viewFor, joinMix, looseMix, sizeFor, leaderSize, createHash };

export function createSim ({ seed = 1, params = {} } = {}) {
  const p = { ...DEF, ...params };
  const next = rng(seed >>> 0);
  let time = 0;

  /* Four static blooms, placed by the seed inside the reef. */
  const blooms = [];
  for (let i = 0; i < p.blooms; i++) {
    const a = next() * TAU, r = (0.35 + next() * 0.45) * p.arenaR;
    blooms.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, r: 260 + next() * 140 });
  }

  /* 300 wild mantas in small groups. A group shares a wander target that
     drifts towards the nearest bloom, which is what makes them gather where
     the plankton is without any of them being told to path anywhere. */
  /* GROUPS OF 3 TO 5 (10.2), so the count decides how many groups there are
     rather than the other way round. */
  const groupCap = [];
  let planned = 0;
  while (planned < p.wildCount) { const k = 3 + Math.floor(next() * 3); groupCap.push(k); planned += k; }
  const GROUPS = groupCap.length;
  /* EVERY GROUP HAS A HOME, and the homes are laid out rather than rolled.
     Thirty random targets over an arena thirty-two screens across cluster by
     construction — that is what a Poisson scatter does — and no amount of
     keeping-apart fixes it once two homes share a screen. The sunflower
     lattice (the golden angle, radius as the square root of the index) is
     the standard even cover of a disc, so the ocean is evenly occupied by
     construction and the wandering happens around that. */
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  /* The gap between neighbouring homes on the lattice, from the area each
     one has to itself. */
  const spreadOf = () => {
    const rr = Math.max(200, p.arenaR - 320);
    const gap = Math.sqrt(Math.PI * rr * rr / Math.max(1, GROUPS));
    return Math.min(520, Math.max(190, gap * p.groupSpread));
  };
  const groups = [];
  for (let g = 0; g < GROUPS; g++) {
    const a = g * GOLDEN, r = Math.sqrt((g + 0.5) / GROUPS) * (p.arenaR - 320);
    const hx = Math.cos(a) * r, hz = Math.sin(a) * r;
    groups.push({ x: hx, z: hz, hx, hz, t: next() * 6 });
  }
  const wild = [];
  const groupUsed = new Array(GROUPS).fill(0);
  function spawnWild (i, awayFrom) {
    /* Away from every leader, so nothing pops into existence on top of the
       player and is recruited in the same step. */
    let x = 0, z = 0;
    for (let tries = 0; tries < 12; tries++) {
      /* Clear of the reef as well as of every leader: a manta that regrows
         against the wall is one nobody can reach without crashing. */
      const a = next() * TAU, r = Math.sqrt(next()) * (p.arenaR - 260);
      x = Math.cos(a) * r; z = Math.sin(a) * r;
      let ok = true;
      for (const L of awayFrom) if (Math.hypot(x - L.x, z - L.z) < 400) { ok = false; break; }
      if (ok) break;
    }
    /* Into a group with room in it, so a group stays 3 to 5 strong. */
    let g = Math.floor(next() * GROUPS);
    for (let k = 0; k < GROUPS; k++) {
      const q = (g + k) % GROUPS;
      if (groupUsed[q] < groupCap[q]) { g = q; break; }
    }
    groupUsed[g]++;
    /* A FRESH OBJECT, never the recruited one reused. The one that joined
       your train is a follower now; this is a different animal that happens
       to keep the count at 300. Reusing it made "was it recruited from
       inside the radius" unanswerable, because the recruit was alive again
       by the time anything looked. */
    const m = {};
    m.x = x; m.z = z; m.head = next() * TAU; m.group = g;
    const oa = next() * TAU, orr = Math.sqrt(next()) * spreadOf();
    m.ox = Math.cos(oa) * orr; m.oz = Math.sin(oa) * orr;   // its place in the group
    m.speed = 40 + next() * 30;
    m.glow = 0;                 // seconds left glowing in an old train's colour
    m.wasColour = -1;           // which train it was in, while it glows
    m.colour = i;               // its slot in the deal; the renderer picks the hue
    m.alive = true;
    wild[i] = m;
    return m;
  }
  for (let i = 0; i < p.wildCount; i++) spawnWild(i, []);

  /* Rebuilt every step: every leader and follower circle in the world. */
  const hash = createHash(Math.max(p.recruitR, p.spacing) * 2);
  const scratch = [];

  /* A TRAIN. Yours and every rival's are the same object, because 6.1's
     rules are written about trains and not about the player: a rival crashes
     into you exactly the way you crash into it, and is cut the same way. */
  let nextId = 0;
  function makeTrain (x, z, head) {
    return {
      id: nextId++, x, z, head, turn: 0,
      bursting: false, dazed: 0, stunned: 0,   // kept at 0: nothing sets them now
      dead: 0,                // seconds of death beat left, 0 when swimming
      peak: 0,                // the longest this run has been
      lastPeak: 0,            // the score of the run that just ended
      runs: 0,
      crashX: 0, crashZ: 0,
      followers: [],
      trail: [],              // recent path, for the arc-length rule
      s: 0,                   // arc length travelled
      burstOwed: 0,           // seconds of burst not yet paid for
      rebuild: 0,             // a rival alone counts down to a new train
      want: null,             // a rival steers itself; yours comes from input
      crashed: 0,             // counts up for the renderer: a crash just happened
      cut: 0,
    };
  }
  const you = makeTrain(0, 0, 0);
  /* Seeded straight behind the leader, so the first recruits have a path to
     sit on instead of piling up on the spot until it has swum a train's
     length. Same trick the spike's rival trains needed after a wrap. */
  function seedTrail (t) {
    t.trail.length = 0;
    const back = 40 * p.spacing;
    for (let d = back; d >= 0; d -= p.spacing * 0.25)
      t.trail.push({ x: t.x + Math.sin(t.head) * -d, z: t.z + Math.cos(t.head) * d,
                     h: t.head, s: t.s - d });
  }
  seedTrail(you);

  /* What the player is asking for this step: a heading to steer towards, or
     null to hold course, plus whether burst is held. Set by the input layer
     and consumed here, so the simulation never reads a device. */
  const input = { want: null, burst: false };

  /* How a manta moves lives in motion.js. */
  const { speedOf, turnRateOf, advance, hold, recordTrail, placeFollowers } = createMotion(p);

  /* ONLY YOUR LEADER RECRUITS (rule 1, and 6.3 makes it explicit): a long
     train must not hoover up the ocean, and a dazed one must not collect the
     train it just lost. */
  /* Every distance a recruit was at when it joined, for the test that the
     radius is actually the radius. */
  const joinedAt = [];
  function recruit (t, cap) {
    if (t.dead > 0) return 0;
    if (t.followers.length >= cap) return 0;
    let joined = 0;
    hash.near(t.x, t.z, scratch);
    for (const m of scratch) {
      if (!m.isWild || !m.alive) continue;
      if (t.followers.length >= cap) break;
      if (m.fromTrain === t && m.immune > 0) continue;
      if (Math.hypot(m.x - t.x, m.z - t.z) > p.recruitR) continue;
      m.alive = false;
      if (t === you) joinedAt.push(+Math.hypot(m.x - t.x, m.z - t.z).toFixed(3));
      /* At the TAIL. The colour runs from the head out, which the renderer
         does by tinting every follower with the train's colour. */
      t.followers.push({ x: m.x, z: m.z, head: m.head, born: time, from: m.colour });
      joined++;
      /* A SCATTERED manta is not part of the ambient 300 and is not replaced;
         an ambient one is, so the ocean keeps its population. */
      /* NO INSTANT RESPAWN. v1.10: the ocean refills one manta every two
         seconds and no faster, so a busy patch runs dry and a train can only
         grow as fast as the water allows.

         THE ARRAY NEVER SHIFTS. A manta's slot is its colour — the deal gives
         each index a hue — so splicing a recruited manta out would recolour
         every manta behind it. Slots go dead and are reused instead. */
      m.alive = false;
      if (!m.loose && m.group !== undefined) groupUsed[m.group] = Math.max(0, groupUsed[m.group] - 1);
    }
    return joined;
  }

  function stepWild (dt) {
    for (let g = 0; g < GROUPS; g++) {
      const gr = groups[g];
      gr.t -= dt;
      if (gr.t <= 0) {
        gr.t = 4 + next() * 6;
        /* AROUND ITS OWN HOME, not anywhere. The old line closed most of the
           distance to the nearest bloom every time, which is a sink: thirty
           groups, four blooms, and nothing in between. */
        const wander = p.groupApart * 0.7;
        const wa = next() * TAU, wr = Math.sqrt(next()) * wander;
        let nx = gr.hx + Math.cos(wa) * wr, nz = gr.hz + Math.sin(wa) * wr;
        /* Then a lean towards the nearest bloom, and only while that bloom
           has room: plankton is an attractor, not something anyone collects,
           and a handful of groups at a time is what "gather" means. */
        let best = null, bd = Infinity;
        for (const bl of blooms) {
          const d = Math.hypot(bl.x - nx, bl.z - nz);
          if (d >= bd) continue;
          let held = 0;
          for (const o of groups) if (o !== gr && Math.hypot(o.x - bl.x, o.z - bl.z) < bl.r) held++;
          if (held >= p.bloomHold) continue;
          bd = d; best = bl;
        }
        if (best) {
          const pull = p.bloomPull * (0.35 + next() * 0.3);
          nx += (best.x - nx) * pull; nz += (best.z - nz) * pull;
        }
        gr.x = nx; gr.z = nz;
      }
    }
    for (const m of wild) {
      if (!m.alive) continue;
      if (m.glow > 0) m.glow = Math.max(0, m.glow - dt);
      if (m.immune > 0) { m.immune -= dt; if (m.immune <= 0) m.fromTrain = null; }
      const gr = groups[m.group];
      /* Forward is (-sin, -cos), the one convention in this lab. Written
         mirrored, these 300 would spin as they turned exactly the way the
         player's train did before 88a0679. */
      /* Towards its own place in the group, not the group's centre. */
      const tx = gr.x + (m.ox || 0), tz = gr.z + (m.oz || 0);
      const want = Math.atan2(-(tx - m.x), -(tz - m.z));
      const d = wrapAngle(want - m.head);
      m.head = wrapAngle(m.head + Math.max(-1.2 * dt, Math.min(1.2 * dt, d)));
      m.x -= Math.sin(m.head) * m.speed * dt;
      m.z -= Math.cos(m.head) * m.speed * dt;
      const r = Math.hypot(m.x, m.z), lim = p.arenaR - 30;
      if (r > lim) { const k = lim / r; m.x *= k; m.z *= k; m.head += Math.PI; }
    }
  }

  /* TEN BOT LEADERS, on the one brain of 10.2, replacing the three scripted
     trains. They are trains like yours in every respect — the rules do not
     know which of them is a person. */
  const brainCtx = { p, blooms, wild: null, trains: null, next };
  const brain = createBrain(brainCtx);
  const rivals = [];
  for (let r = 0; r < p.bots; r++) {
    const a = next() * TAU, d = 500 + next() * (p.arenaR - 900);
    const t = makeTrain(Math.cos(a) * d, Math.sin(a) * d, next() * TAU);
    /* Kept for the harnesses that park a bot by its aim; the brain ignores it. */
    t.aim = { x: t.x, z: t.z, t: 1e9 };
    t.think = next() * 0.5;
    brain.dealDials(t, next());
    seedTrail(t);
    rivals.push(t);
  }
  const bots = rivals;
  const trains = [you, ...rivals];
  brainCtx.trains = trains;
  brainCtx.wild = wild;
  /* The slider, applied as it moves: a new bot is dealt its personality from
     the same generator, so the ocean stays a function of the seed. */
  function setBotCount (n) {
    n = Math.max(0, Math.round(n));
    while (rivals.length > n) { const gone = rivals.pop(); trains.splice(trains.indexOf(gone), 1); }
    while (rivals.length < n) {
      const a = next() * TAU, d = 500 + next() * (p.arenaR - 900);
      const t = makeTrain(Math.cos(a) * d, Math.sin(a) * d, next() * TAU);
      t.aim = { x: t.x, z: t.z, t: 1e9 };
      t.think = next() * 0.5;
      brain.dealDials(t, next());
      seedTrail(t);
      rivals.push(t); trains.push(t);
    }
    p.bots = n;
  }

  /* What the seed rolled, for the panel. */
  const botMix = () => {
    const m = {};
    for (const t of rivals) m[t.kind] = (m[t.kind] || 0) + 1;
    return m;
  };

  /* The rules live in rules.js. They read this context at call time, so the
     trains array can be finished after they are created. */
  const ruleCtx = { p, next, GROUPS, wild, scratch, hash, trains, you, blooms };
  const { scatter, crash, cutAt, resolveTouches, payForBurst, steerRival } = createRules(ruleCtx);

  function stepTrain (t, want, dt) {
    if (t.crashed > 0) t.crashed = Math.max(0, t.crashed - dt);
    if (t.cut > 0) t.cut = Math.max(0, t.cut - dt);
    const fromX = t.x, fromZ = t.z, sBefore = t.s;
    const moved = advance(t, want, dt);
    hold(t, fromX, fromZ, sBefore);
    recordTrail(t, moved);
  }

  /* WHERE YOU COME BACK. v1.10: at least 800 units from the crash and clear
     of every train, so you are not dropped back into the wreck you just made
     or on top of the rival that made it. Tries a ring of candidates and takes
     the first that is clear; the last resort is the furthest one tried, which
     cannot happen in an arena this size but must not be an infinite loop. */
  function restart (t) {
    let best = null, bestClear = -1;
    for (let k = 0; k < 40; k++) {
      const a = next() * TAU;
      const r = p.restartMin + next() * (p.arenaR - p.restartMin - 120);
      const x = t.crashX + Math.cos(a) * r, z = t.crashZ + Math.sin(a) * r;
      if (Math.hypot(x, z) > p.arenaR - 120) continue;
      let clear = Infinity;
      for (const o of trains) {
        if (o === t || o.dead > 0) continue;
        for (const q of [o, ...o.followers]) clear = Math.min(clear, Math.hypot(q.x - x, q.z - z));
      }
      if (clear > bestClear) { bestClear = clear; best = { x, z }; }
      if (clear > 300) break;
    }
    if (!best) best = { x: 0, z: 0 };
    /* A new arena, if one was asked for while the last run was going. */
    if (p.arenaRWanted && p.arenaRWanted !== p.arenaR) p.arenaR = p.arenaRWanted;
    t.x = best.x; t.z = best.z; t.head = next() * TAU;
    t.s = 0; t.followers.length = 0; t.bursting = false; t.burstOwed = 0;
    t.lastPeak = t.peak; t.peak = 0; t.runs++;
    t.dead = 0; t.crashed = 0; t.cut = 0; t.rebuild = 10;
    seedTrail(t);
  }

  /* The living count, the drain and regrowth live in population.js. */
  const { livingWild, drainSurplus, regrowWild } = createPopulation({ p, wild, you, trains, spawnWild });

  function step () {
    const dt = STEP;
    time += dt;
    /* 6.3: bursting needs a follower to pay with. Stage 1 lifted this gate
       because there was nothing to spend; the spending is here now, so the
       gate comes back with it. */
    /* THE DEATH BEAT. A crashed train is gone from the water while it runs:
       it does not swim, recruit, touch anything or appear in the hash. When
       it ends, it is a lone manta somewhere else. */
    for (const t of trains) {
      if (t.dead <= 0) continue;
      t.dead -= dt;
      if (t.dead <= 0) restart(t);
    }
    you.bursting = !you.dead && input.burst && you.followers.length > 0;
    payForBurst(you, dt);
    if (!you.dead) stepTrain(you, input.want, dt);
    if (you.followers.length > you.peak) you.peak = you.followers.length;
    for (const t of rivals) {
      if (t.dead > 0) continue;
      const pinned = t.pinBurst ? t.bursting : null;
      brain.think(t, dt);
      /* A test about the head-on rules pins the burst instead of letting the
         brain choose it. */
      if (pinned !== null) t.bursting = pinned;
      payForBurst(t, dt);
      stepTrain(t, t.want, dt);
      if (t.followers.length > t.peak) t.peak = t.followers.length;
    }
    stepWild(dt);
    drainSurplus(dt);
    regrowWild(dt);

    /* The hash carries every leader and follower circle, which is what both
       recruiting and crashing ask about. Wild mantas go in too, because
       recruiting asks the other way round. */
    hash.clear();
    for (const t of trains) {
      if (t.dead > 0) continue;
      t.isLeader = true; t.train = t; t.index = 0; t.isWild = false;
      hash.add(t.x, t.z, t);
      for (let k = 0; k < t.followers.length; k++) {
        const f = t.followers[k];
        f.isLeader = false; f.train = t; f.index = k; f.isWild = false;
        hash.add(f.x, f.z, f);
      }
    }
    for (const m of wild) if (m.alive) { m.isWild = true; m.train = null; hash.add(m.x, m.z, m); }

    resolveTouches();
    /* A rival that has been cut down to its leader gets its appetite back
       after about ten seconds, so there is always something to play against. */
    for (const t of rivals) if (!t.dead) recruit(t, t.rebuild <= 0 ? 8 : t.followers.length);
    if (!you.dead) recruit(you, 1e9);
    /* AFTER recruiting, so a manta that joined this step is already on the
       path rather than sitting wherever it was caught for a frame. */
    for (const t of trains) if (!t.dead) placeFollowers(t);
    return time;
  }

  return {
    get time () { return time; },
    params: p, blooms, you, rivals, bots, botMix, brain, setBotCount, trains, input, step, wild, groups, hash, joinedAt,
    liveWild: livingWild,
    scatter, crash, cutAt, makeTrain, seedTrail, restart,
    get length () { return you.followers.length; },
    zoom: () => zoomFor(you.followers.length, p),
    /* For tests and for the panel: the speed actually used this step. */
    speedOf, turnRateOf,
  };
}
