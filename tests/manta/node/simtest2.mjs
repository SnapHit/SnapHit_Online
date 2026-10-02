/* Stage 2 of 2A part three: scarcity and size, against v1.10's table.
   Seeded and deterministic, and run in Node in milliseconds. */
import { createSim, DEF, STEP, FADE, joinMix, looseMix, sizeFor } from '../../../docs/lab/manta/sim.js';
import { dispersion } from './disperse.mjs';
let n = 0, bad = 0;
const ok = (name, cond, extra = '') => { n++; if (!cond) bad++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (extra ? '  [' + extra + ']' : '')); };

/* ---- the count never exceeds 120, and groups stay 3 to 5 ---- */
{
  const s = createSim({ seed: 66 });
  let most = 0;
  for (let i = 0; i < 9000; i++) {
    s.input.want = Math.sin(i / 70) * 3;
    s.step();
    if (i % 25 === 0) most = Math.max(most, s.liveWild());
  }
  /* A CRASH PUTS A WHOLE TRAIN IN THE WATER AT ONCE, so the population can
     sit over its target for the few seconds the surplus takes to fade. What
     must not happen is the ocean staying inflated. */
  /* Let the last crash's scatter finish glowing and draining before asking:
     the surplus is meant to take a few seconds a manta, not to be instant. */
  /* 2B part three: bots grow now, so they crash long trains all through any
     settling window and there is no "last crash" to wait for. The question
     the comment above asks is whether the ocean STAYS inflated, so that is
     what is measured: the longest unbroken spell over target in the next
     minute, which must be no longer than one scatter's glow and drain. */
  const peak = s.liveWild();
  s.you.x = 0; s.you.z = 0;
  const allowed = DEF.scatterGlow + DEF.drain + 4;
  let run = 0, longest = 0, overSteps = 0, total = 0;
  for (let i = 0; i < Math.round(60 / STEP); i++) {
    s.step(); total++;
    /* 3D: the ORDINARY count (debris is counted apart and never stops the
       refill, v1.16), so a full ocean plus a wreck's debris is not "over". */
    if (s.ambientWild() > DEF.wildCount) { run++; overSteps++; } else run = 0;
    longest = Math.max(longest, run);
  }
  ok('the ordinary wild count never stays over ' + DEF.wildCount + ' longer than a glow and a drain',
     longest * STEP <= allowed,
     'longest spell over ' + (longest * STEP).toFixed(1) + ' s of ' + allowed + ' allowed, over ' +
     (100 * overSteps / total).toFixed(0) + '% of a minute, now ' + s.liveWild() + ', from ' + peak + ', worst seen ' + most);
  const sizes = new Map();
  for (let i = 0; i < DEF.wildCount; i++) { const w = s.wild[i];
    if (w && w.alive) sizes.set(w.group, (sizes.get(w.group) || 0) + 1); }
  const over = [...sizes.values()].filter(v => v > 5).length;
  ok('and its groups are 3 to 5 strong', over === 0, 'groups over five: ' + over +
     ', across ' + sizes.size + ' groups');
}

/* ---- regrowth runs at one every 2 seconds, and no faster ---- */
{
  /* No bots: this measures the ocean's own clock, and a bot crashing puts
     mantas in the water, which correctly pauses regrowth. */
  /* 3D: an EMPTY ocean is made by starting at a wild count of 0 and raising
     it, which lays the groups out fresh. Switching mantas off by hand
     bypassed the groups' bookkeeping, so every group still looked full. */
  const s = createSim({ seed: 71, params: { bots: 0, wildCount: 0 } });
  s.params.wildCount = DEF.wildCount;
  s.you.x = 1900; s.you.z = 0;                       // out of everyone's way
  /* 3D, ruling 1: the refill law. With the ocean emptied and nobody eating,
     each missing manta returns within the refill time T on average, so the
     count regrown by t is close to G (1 - e^(-t/T)) and never ahead of what
     is owed. */
  const G = DEF.wildCount, T = DEF.regrow, at = {};
  let most = 0, ahead = 0;
  for (let i = 0; i < Math.round(12 / STEP); i++) {
    for (const w of s.wild) if (w && w.loose) { w.alive = false; w.fading = 0; }
    s.step();
    const t = (i + 1) * STEP, n = s.ambientWild();
    /* The discrete refill: owed grows by (G - n) dt / T each step. */
    const law = G * (1 - Math.pow(1 - STEP / T, i + 1));
    if (n > law + 1.0001) ahead++;
    most = Math.max(most, n);
    for (const k of [5, 12]) if (Math.abs(t - k) < STEP / 2) at[k] = n;
  }
  const want5 = G * (1 - Math.exp(-5 / T)), want12 = G * (1 - Math.exp(-12 / T));
  ok('regrowth refills the gap: G(1 - e^(-t/T)) at 5 s and 12 s, within 5%',
     Math.abs(at[5] - want5) <= 0.05 * want5 && Math.abs(at[12] - want12) <= 0.05 * want12,
     'at 5 s ' + at[5] + ' (law ' + want5.toFixed(1) + '), at 12 s ' + at[12] + ' (law ' + want12.toFixed(1) + '), refill ' + T + ' s, ' + G + ' missing');
  ok('and never ahead of what is owed', ahead === 0, ahead + ' steps ahead of the law by more than one');
}

/* ---- nothing spawns close to a leader ---- */
{
  /* 3D: empty by starting at 0 and raising the count (see above). */
  const s = createSim({ seed: 73, params: { wildCount: 0 } });
  s.params.wildCount = DEF.wildCount;
  let tooClose = 0, grown = 0;
  for (let i = 0; i < Math.round(60 / STEP); i++) {
    const aliveBefore = new Set();
    for (let k = 0; k < DEF.wildCount; k++) if (s.wild[k] && s.wild[k].alive) aliveBefore.add(k);
    s.step();
    for (let k = 0; k < DEF.wildCount; k++) {
      const w = s.wild[k];
      /* 3D: a wreck's debris lands where the wreck is, by design; with the
         ocean refilling from empty it can take a free slot below the count. */
      if (!w || !w.alive || aliveBefore.has(k) || w.loose) continue;
      /* THE ONE THAT JUST ARRIVED, and only that one. Counting every manta
         near a leader measured the trains swimming towards them afterwards,
         which is the game working, not a bad spawn. */
      grown++;
      for (const t of s.trains) if (t.dead <= 0 && Math.hypot(w.x - t.x, w.z - t.z) < 100) { tooClose++; break; }
    }
  }
  ok('nothing spawns close to a leader', tooClose === 0,
     grown + ' regrew, ' + tooClose + ' within 100 units of a leader');
}

/* ---- recruiting happens only within radius 30 ---- */
{
  const s = createSim({ seed: 12 });
  let missedInside = 0;
  for (let i = 0; i < 12000; i++) {
    s.input.want = Math.sin(i / 90) * 2.5;
    const runsWas = s.you.runs, deadWas = s.you.dead > 0;
    s.step();
    if (deadWas) continue;
    /* Judged AFTER the step, which is when recruiting ran: both the leader
       and the manta move first, so anything measured beforehand may not be
       inside the radius by the time the rule looks. A manta the leader just
       paid a burst with is excluded — it is briefly not its to take. */
    /* A dead leader is not in the water and recruits nothing, and the step
       that restarts it can legitimately land near a manta. */
    if (s.you.dead === 0 && s.you.runs === runsWas) {
      for (const w of s.wild) {
        if (!w || !w.alive) continue;
        if (w.fromTrain === s.you && w.immune > 0) continue;
        /* 3D: sinking is leaving and uncollectable by design (2B part four,
           ruling 3); a full ocean puts more debris near you to sink. */
        if (w.sinking > 0) continue;
        if (Math.hypot(w.x - s.you.x, w.z - s.you.z) <= DEF.recruitR) { missedInside++; break; }
      }
    }
  }
  const worstJoin = s.joinedAt.length ? Math.max(...s.joinedAt) : 0;
  ok('recruiting happens only within radius ' + DEF.recruitR,
     s.joinedAt.length > 0 && worstJoin <= DEF.recruitR + 1e-6,
     s.joinedAt.length + ' joined, furthest ' + worstJoin.toFixed(2) + ' of ' + DEF.recruitR);
  ok('and nothing inside it is left behind', missedInside === 0, missedInside + ' missed');
}

/* ---- a recruit's size and colour change together ---- */
{
  const s = createSim({ seed: 81 });
  const f = { born: 10 };
  const rows = [];
  for (const t of [10, 10.125, 10.25, 10.375, 10.5, 10.75]) {
    const mix = joinMix(f, t);
    rows.push([+mix.toFixed(3), +sizeFor(mix, DEF).toFixed(2)]);
  }
  ok('a recruit takes its colour and its size on one number',
     rows[0][0] === 0 && rows[0][1] === DEF.wildSize &&
     rows[4][0] === 1 && rows[4][1] === DEF.followerSize &&
     rows[2][0] === 0.5 && Math.abs(rows[2][1] - 24) < 1e-9,
     rows.map(r => r[0] + '->' + r[1]).join('  '));
  ok('and it is finished after ' + FADE + 's and never overshoots',
     rows[5][0] === 1 && rows[5][1] === DEF.followerSize, 'at 0.75s ' + rows[5][1]);
}

/* ---- a scattered manta shrinks as its glow ends ---- */
{
  const s = createSim({ seed: 91 });
  for (let i = 0; i < 6; i++) s.you.followers.push({ x: 0, z: 0, head: 0, born: 0, from: i });
  s.scatter(s.you, 0);
  const loose = s.wild.filter(w => w && w.alive && w.loose);
  const at = g => { const m = { glow: g, loose: true }; return +sizeFor(looseMix(m), DEF).toFixed(2); };
  ok('a scattered manta keeps its train size while it glows',
     loose.length === 6 && at(DEF.scatterGlow) === DEF.followerSize && at(1.0) === DEF.followerSize,
     loose.length + ' loose, at 4s ' + at(4) + ', at 1s ' + at(1));
  ok('and shrinks to wild size exactly as its colour returns',
     at(0.25) === 24 && at(0) === DEF.wildSize,
     'at 0.25s ' + at(0.25) + ', at 0s ' + at(0));
}

/* ---- and the rules that must keep holding ---- */
{
  const s = createSim({ seed: 33 });
  let tailOk = true, checked = 0;
  for (let i = 0; i < 12000; i++) {
    const before = s.you.followers.slice();
    s.input.want = Math.cos(i / 150) * 2;
    s.step();
    const after = s.you.followers;
    if (after.length > before.length)
      { checked++; for (let k = 0; k < before.length; k++) if (after[k] !== before[k]) tailOk = false; }
  }
  ok('recruits still join at the tail', tailOk && checked > 0, checked + ' joins, order never disturbed');
}
{
  const s = createSim({ seed: 44 });
  for (let i = 0; i < 12; i++) s.you.followers.push({ x: 0, z: 0, head: 0, born: 0, from: i });
  for (let i = 0; i < 400; i++) { s.input.want = s.you.head + 0.4; s.step(); }
  let worst = 0, samples = 0;
  for (let i = 0; i < 6000; i++) {
    const home = Math.hypot(s.you.x, s.you.z);
    s.input.want = home > DEF.arenaR * 0.6 ? Math.atan2(s.you.x, s.you.z)
                                           : s.you.head + ((i % 600 < 300) ? 3 : -3);
    s.step();
    const f = s.you.followers;
    if (f.length < 3) continue;
    let prev = s.you;
    for (let k = 0; k < Math.min(f.length, 12); k++) {
      worst = Math.max(worst, Math.abs(Math.hypot(f[k].x - prev.x, f[k].z - prev.z) - DEF.spacing));
      samples++; prev = f[k];
    }
  }
  ok('spacing still holds at ' + DEF.spacing + ' within 1 through turns', worst <= 1.0,
     'worst deviation ' + worst.toFixed(3) + ' over ' + samples + ' samples');
}

/* ---- an even ocean: the index of dispersion ---- */
{
  for (const n of [20, 120]) {
    const d = dispersion(n);
    console.log('   ' + n + ' mantas: mean ' + d.mean + ' a cell, variance ' + d.variance +
                ', ' + d.empty + ' of ' + d.cells + ' cells empty, worst cell ' + d.worst);
    ok('the ocean is even at ' + n + ' wild mantas, judged by group', d.index <= 1.5,
       'index of dispersion ' + d.index + ', bar 1.5');
  }
}

/* ---- groups keep apart, and a bloom holds only a handful ---- */
{
  const s = createSim({ seed: 9 });
  let worstApart = Infinity, worstHeld = 0;
  for (let i = 0; i < Math.round(90 / STEP); i++) {
    s.step();
    if (i % 600) continue;
    for (let a = 0; a < s.groups.length; a++)
      for (let b = a + 1; b < s.groups.length; b++)
        worstApart = Math.min(worstApart, Math.hypot(s.groups[a].hx - s.groups[b].hx,
                                                     s.groups[a].hz - s.groups[b].hz));
    for (const bl of s.blooms) {
      let held = 0;
      for (const g of s.groups) if (Math.hypot(g.x - bl.x, g.z - bl.z) < bl.r) held++;
      worstHeld = Math.max(worstHeld, held);
    }
  }
  ok('group homes keep apart', worstApart >= DEF.groupApart * 0.7,
     'closest pair ' + worstApart.toFixed(0) + ' units');
  ok('and a bloom never holds more than a handful', worstHeld <= DEF.bloomHold + 1,
     'worst ' + worstHeld + ' groups in one bloom, allowance ' + DEF.bloomHold);
}

/* ---- nothing spawns near a leader or the reef ---- */
{
  const s = createSim({ seed: 15 });
  /* EVERY wild manta, not just the ambient slots: the living count now
     includes scattered ones, so leaving those alive leaves the ocean full. */
  for (const w of s.wild) if (w) { w.alive = false; w.fading = 0; }
  let nearLeader = 0, nearReef = 0, grew = 0;
  for (let i = 0; i < Math.round(120 / STEP); i++) {
    const was = new Set();
    for (let k = 0; k < DEF.wildCount; k++) if (s.wild[k] && s.wild[k].alive) was.add(k);
    s.step();
    for (let k = 0; k < DEF.wildCount; k++) {
      const w = s.wild[k];
      if (!w || !w.alive || was.has(k)) continue;
      grew++;
      for (const t of s.trains) if (t.dead <= 0 && Math.hypot(w.x - t.x, w.z - t.z) < 100) nearLeader++;
      if (Math.hypot(w.x, w.z) > DEF.arenaR - 200) nearReef++;
    }
  }
  ok('nothing regrows near a leader', nearLeader === 0, grew + ' regrew, ' + nearLeader + ' near a leader');
  ok('and nothing regrows against the reef', nearReef === 0, nearReef + ' within 200 units of it');
}

/* ---- the arena radius applies at the next restart ---- */
{
  const s = createSim({ seed: 25 });
  s.params.arenaRWanted = 1200;
  const before = s.params.arenaR;
  for (let i = 0; i < 300; i++) s.step();
  ok('an arena radius change waits for the restart', s.params.arenaR === before,
     'still ' + s.params.arenaR + ' while the run is going');
  /* Crash it into the reef and let the death beat run out. */
  s.you.x = 0; s.you.z = -(s.params.arenaR - DEF.leaderR);
  s.step();
  for (let i = 0; i < Math.round(DEF.deathBeat / STEP) + 6; i++) s.step();
  ok('and takes effect on the next one', s.params.arenaR === 1200,
     before + ' -> ' + s.params.arenaR);
}

/* ---- train size scales collision as well as the picture ---- */
{
  const reach = scale => {
    const s = createSim({ seed: 31, params: { trainScale: scale } });
    for (const r of s.rivals) { r.x = 900; r.z = 900; r.followers.length = 0; r.aim.t = 1e9; r.aim.x = 900; r.aim.z = 600; }
    for (const w of s.wild) w.alive = false;
    const r = s.rivals[0];
    r.x = 0; r.z = -400; r.head = 0; r.aim.x = 0; r.aim.z = -800; s.seedTrail(r);
    /* Walk the player in from the side until the touch registers. */
    let hit = -1;
    for (let d = 60; d > 2 && hit < 0; d -= 0.5) {
      const t = createSim({ seed: 31, params: { trainScale: scale } });
      for (const q of t.rivals) { q.x = 1400; q.z = 1400; q.followers.length = 0; q.aim.t = 1e9; q.aim.x = 1400; q.aim.z = 1400; }
      for (const w of t.wild) w.alive = false;
      const v = t.rivals[0];
      v.x = 0; v.z = 0; v.head = 0; v.aim.t = 1e9; v.aim.x = 0; v.aim.z = -900; t.seedTrail(v);
      t.you.x = d; t.you.z = 0; t.you.head = Math.PI / 2; t.seedTrail(t.you);
      t.step();
      if (t.you.dead > 0) hit = d;
    }
    return hit;
  };
  const small = reach(1), big = reach(1.8);
  ok('train size widens the collision radius with the picture',
     big > small + 4, 'touched at ' + small + ' units at scale 1, ' + big + ' at scale 1.8');
  ok('and the drawn size moves with it',
     sizeFor(1, { ...DEF, trainScale: 1.8 }) > sizeFor(1, DEF) + 8,
     sizeFor(1, DEF).toFixed(0) + ' -> ' + sizeFor(1, { ...DEF, trainScale: 1.8 }).toFixed(0) + ' units across');
}

console.log('\nstage 2 sim tests: ' + (n - bad) + '/' + n + ' passed, ' + bad + ' failed');
process.exit(bad ? 1 : 0);
