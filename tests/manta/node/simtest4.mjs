/* The bots: one brain, three dials. Seeded and deterministic. */
import { createSim, DEF, STEP } from '../../../docs/lab/manta/sim.js';
import { PRESETS } from '../../../docs/lab/manta/bots.js';
let n = 0, bad = 0;
const ok = (name, cond, extra = '') => { n++; if (!cond) bad++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (extra ? '  [' + extra + ']' : '')); };

/* ---- the deal ---- */
{
  const s = createSim({ seed: 3 });
  ok('there are ' + DEF.bots + ' bots', s.bots.length === DEF.bots, s.bots.length + ' bots');
  const mix = s.botMix();
  ok('and the seed deals them personalities',
     Object.keys(mix).length >= 2 && s.bots.every(b => PRESETS[b.kind]),
     JSON.stringify(mix));
}

/* ---- a bot recruits ---- */
{
  const s = createSim({ seed: 11, params: { bots: 1 } });
  const b = s.bots[0];
  b.followers.length = 0;
  let joined = 0;
  for (let i = 0; i < Math.round(60 / STEP); i++) {
    /* Bait in front of it, inside the recruit radius, every step. */
    const w = s.wild[0];
    if (w) { w.alive = true; w.loose = false; w.immune = 0; w.fromTrain = null;
             w.x = b.x - Math.sin(b.head) * 8; w.z = b.z - Math.cos(b.head) * 8; }
    const was = b.followers.length;
    s.step();
    if (b.followers.length > was) joined++;
  }
  ok('a bot recruits wild mantas', joined > 0, joined + ' joined it in 60s');
}

/* ---- caution: a train across its path ---- */
function closing (caution) {
  const s = createSim({ seed: 21, params: { bots: 1 } });
  const b = s.bots[0];
  Object.assign(b, { greed: 0.5, caution, aggression: 0 });
  b.x = 0; b.z = 0; b.head = 0; s.seedTrail(b);
  b.goalX = 0; b.goalZ = -900; b.think = 1e9;            // straight up the screen
  /* Your train parked squarely across its path, 220 units ahead. */
  s.you.x = 0; s.you.z = -220; s.you.head = Math.PI / 2; s.seedTrail(s.you);
  s.you.followers.length = 0;
  for (let i = 0; i < 4; i++) s.you.followers.push({ x: 0, z: -220, head: Math.PI / 2, born: 0, from: i });
  let nearest = Infinity;
  for (let i = 0; i < 90; i++) {
    s.input.want = null;
    s.you.x = 0; s.you.z = -220;                          // held there
    s.step();
    for (const q of [s.you, ...s.you.followers])
      nearest = Math.min(nearest, Math.hypot(q.x - b.x, q.z - b.z));
    if (b.dead > 0) break;
  }
  return { nearest, dead: b.dead > 0 };
}
{
  const timid = closing(PRESETS.timid.caution);
  const rash = closing(0.02);
  console.log('   closest approach: cautious ' + timid.nearest.toFixed(0) +
              ', rash ' + rash.nearest.toFixed(0));
  ok('a cautious bot gives a crossing train room',
     timid.nearest > rash.nearest + 5,
     'cautious ' + timid.nearest.toFixed(0) + ' units, rash ' + rash.nearest.toFixed(0));
}

/* ---- aggression: bursting to cut ---- */
function facing (aggression, followers) {
  const s = createSim({ seed: 31, params: { bots: 1 } });
  const b = s.bots[0];
  Object.assign(b, { greed: 0.5, caution: 0.3, aggression });
  /* No food on the way: a lattice group can sit on this path, and a bot that
     recruits one has something to pay with (2B part four). */
  for (const m of s.wild) if (m) m.alive = false;
  b.x = 0; b.z = 0; b.head = 0; s.seedTrail(b);
  b.goalX = 0; b.goalZ = -900; b.think = 1e9;
  b.followers.length = 0;
  for (let i = 0; i < followers; i++) b.followers.push({ x: 0, z: 0, head: 0, born: 0, from: i });
  s.you.x = 0; s.you.z = -150; s.you.head = Math.PI / 2; s.seedTrail(s.you);
  s.you.followers.length = 0;
  for (let i = 0; i < 4; i++) s.you.followers.push({ x: 0, z: -150, head: Math.PI / 2, born: 0, from: i });
  let burst = 0;
  for (let i = 0; i < 20; i++) {
    s.you.x = 0; s.you.z = -150;
    s.step();
    if (b.bursting) burst++;
  }
  return burst;
}
{
  const bully = facing(PRESETS.bully.aggression, 4);
  const timid = facing(PRESETS.timid.aggression, 4);
  const broke = facing(PRESETS.bully.aggression, 0);
  ok('an aggressive bot bursts to cut a train across its path', bully > 0, bully + ' steps bursting');
  ok('and a timid one does not', timid === 0, timid + ' steps bursting');
  ok('and none of them bursts at zero followers', broke === 0, broke + ' steps bursting with nothing to pay');
}

/* ---- greed: how far it travels for food ---- */
function travelled (greed) {
  /* No regrowth: the ocean refilling next to the bot gives both of them
     something close to chase, which is not what greed means. */
  const s = createSim({ seed: 41, params: { bots: 1, wildCount: 6, regrow: 1e9, arenaR: 4000 } });
  const b = s.bots[0];
  /* The bot alone: where the player starts depends on how many numbers the
     deal drew before it, and it can land on the bot's nose (2B part four). */
  s.you.dead = 1e9; s.you.followers.length = 0;
  /* No blooms either (2B part five): with the new spawn's different draws a
     bloom near the patch drew the timid bot within its own reach of the food,
     and it ate it too. The test is about how far each goes FOR FOOD. */
  s.blooms.length = 0;
  Object.assign(b, { greed, caution: 0.5, aggression: 0 });
  b.x = 0; b.z = 0; b.head = 0; s.seedTrail(b);
  /* FOOD BETWEEN THE TWO REACHES. Greed is a distance — 500 units plus 2800
     times the dial — so greedy reaches 3300 and timid 1620. Put the patch at
     1500 and both go for it, which is what the first version measured. */
  for (const w of s.wild) if (w) w.alive = false;
  for (let i = 0; i < 4; i++) {
    const w = s.wild[i];
    w.alive = true; w.loose = false; w.x = 2200 + i * 12; w.z = 0; w.speed = 0;
    w.ox = 0; w.oz = 0; w.group = 0;
  }
  s.groups[0].hx = 2200; s.groups[0].hz = 0; s.groups[0].x = 2200; s.groups[0].z = 0; s.groups[0].t = 1e9;
  const d0 = Math.hypot(2200 - b.x, 0 - b.z);
  for (let i = 0; i < Math.round(25 / STEP); i++) s.step();
  return d0 - Math.hypot(2200 - b.x, 0 - b.z);
}
{
  const greedy = travelled(PRESETS.greedy.greed);
  const timid = travelled(PRESETS.timid.greed);
  console.log('   closed on distant food: greedy ' + greedy.toFixed(0) + ', timid ' + timid.toFixed(0));
  ok('a greedy bot travels further for food than a timid one', greedy > timid + 100,
     'greedy closed ' + greedy.toFixed(0) + ' units, timid ' + timid.toFixed(0));
}

/* ---- bots never stall ---- */
{
  const s = createSim({ seed: 51 });
  const slow = [];
  for (let i = 0; i < Math.round(90 / STEP); i++) {
    const was = s.bots.map(b => ({ x: b.x, z: b.z, dead: b.dead }));
    s.step();
    s.bots.forEach((b, k) => {
      if (b.dead > 0 || was[k].dead > 0) return;
      const d = Math.hypot(b.x - was[k].x, b.z - was[k].z);
      if (d < DEF.cruise * STEP * 0.5) slow.push(+d.toFixed(3));
    });
  }
  ok('bots never stall', slow.length === 0, slow.length + ' slow steps, worst ' + (slow.length ? Math.min(...slow) : 'n/a'));
}

/* ---- a seed replays the whole ocean ---- */
{
  const run = () => {
    const s = createSim({ seed: 4242 });
    for (let i = 0; i < 3000; i++) { s.input.want = Math.sin(i / 90) * 2; s.step(); }
    return JSON.stringify({
      you: [+s.you.x.toFixed(4), +s.you.z.toFixed(4), s.you.followers.length, s.you.runs],
      bots: s.bots.map(b => [+b.x.toFixed(4), +b.z.toFixed(4), b.followers.length, b.kind]),
      wild: s.liveWild(),
    });
  };
  const a = run(), b = run();
  ok('a seed replays the whole ocean exactly', a === b, a === b ? a.slice(0, 90) + '…' : 'diverged');
}

console.log('\nbot tests: ' + (n - bad) + '/' + n + ' passed, ' + bad + ' failed');
process.exit(bad ? 1 : 0);
