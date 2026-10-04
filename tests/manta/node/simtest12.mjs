/* 4A stage 4: the pink manta (pink.js), in plain Node against the real
   simulation. It appears where and when specified and only one exists at a
   time; it outruns a cruising leader and is caught by a burst; a touch
   without bursting does nothing; a catch adds exactly pinkReward followers,
   once; bots chase it as their greed says; off, nothing appears. Out of the
   fingerprint set (node/run.sh), like simtest11. */
import { createSim } from '../../../docs/lab/manta/sim.js';
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x ? '  [' + x + ']' : '')); };
const hyp = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const towards = (from, to) => Math.atan2(-(to.x - from.x), -(to.z - from.z));
const collect = S => { const got = []; const push = S.events.push; S.events.push = function () { for (const e of arguments) if (e && e.kind === 'pink') got.push({ ...e, len: S.you.followers.length }); return push.apply(this, arguments); }; return got; };

/* 1. Appearance: after the wait, clear of every leader, inside the reef, one at a time. */
{
  const S = createSim({ seed: 11, params: { pinkWait: 20, pinkStay: 25 } }), ev = collect(S);
  let firstAt = -1, dist = Infinity, inside = true, twice = 0, wasAlive = false, aliveSteps = 0;
  for (let k = 0; k < 60 * 150; k++) {
    S.step(); const pk = S.pink;
    if (pk.alive) { aliveSteps++; if (!wasAlive) { if (firstAt < 0) { firstAt = S.time; for (const t of S.trains) if (!(t.dead > 0)) dist = Math.min(dist, hyp(pk, t)); inside = Math.hypot(pk.x, pk.z) <= S.params.arenaR - 250; } } }
    wasAlive = pk.alive;
  }
  const appears = ev.filter(e => e.what === 'appear'), gones = ev.filter(e => e.what === 'leave' || e.what === 'catch');
  let gaps = []; for (let i = 1; i < appears.length; i++) { const prevGone = gones.filter(g => g.at < appears[i].at).pop(); if (prevGone) gaps.push(+(appears[i].at - prevGone.at).toFixed(2)); }
  ok('it first appears after the wait (pinkWait 20 s): at ' + firstAt.toFixed(2) + ' s', firstAt >= 20 && firstAt < 22);
  ok('at least pinkClear (800) from every leader: ' + dist.toFixed(0) + ' units', dist >= 800);
  ok('inside the reef', inside);
  ok('only one at a time, and the next appears pinkWait after the last left or was caught: gaps ' + gaps.join(', ') + ' s over ' + appears.length + ' appearances', appears.length >= 3 && gaps.every(g => g >= 20 - 1e-6 && g < 22) && ev.every((e, i) => e.what !== 'appear' || i === 0 || ev[i - 1].what !== 'appear'));
  ok('left uncaught it leaves after pinkStay (25 s): stays ' + gones.filter(g => g.what === 'leave').map(g => (g.at - appears.find(a => a.at < g.at && !appears.some(b => b.at > a.at && b.at < g.at)).at).toFixed(1)).join(', ') + ' s', gones.some(g => g.what === 'leave') && gones.filter(g => g.what === 'leave').every(g => { const a = appears.filter(a => a.at < g.at).pop(); return Math.abs(g.at - a.at - 25) < 0.05; }));
}

/* 2. A cruising leader never catches it: it flees at pinkFlee and stays inside. */
{
  const S = createSim({ seed: 11, params: { pinkWait: 1, bots: 0 } });
  while (!S.pink.alive) S.step();
  const pk = S.pink; S.you.x = pk.x + 250; S.you.z = pk.z; S.you.head = towards(S.you, pk); S.you.trail.length = 0; S.you.s = 0;
  let minD = Infinity, speeds = [], outside = 0, fleeSteps = 0;
  for (let k = 0; k < 60 * 12 && S.pink.alive; k++) {
    const x0 = pk.x, z0 = pk.z;
    S.input.want = towards(S.you, pk); S.input.burst = false; S.step();
    if (!pk.alive) break;
    minD = Math.min(minD, hyp(S.you, pk));
    if (pk.state === 'flee') { fleeSteps++; speeds.push(Math.hypot(pk.x - x0, pk.z - z0) * 60); }
    if (Math.hypot(pk.x, pk.z) > S.params.arenaR - 30) outside++;
  }
  const meanSpeed = speeds.reduce((a, b) => a + b, 0) / Math.max(1, speeds.length);
  ok('chased by a cruising leader for 12 s it flees (' + fleeSteps + ' steps fleeing) and is never within the recruit radius: nearest ' + minD.toFixed(1) + ' units (radius ' + S.params.recruitR + ')', fleeSteps > 300 && minD > S.params.recruitR);
  ok('it flees at pinkFlee: mean ' + meanSpeed.toFixed(1) + ' units a second against 260', Math.abs(meanSpeed - 260) < 2);
  ok('it stays inside the reef while fleeing', outside === 0 && pk.caught === 0);
}

/* 3. A burst catches it, adding exactly pinkReward followers, once. */
{
  const S = createSim({ seed: 11, params: { pinkWait: 1, bots: 0 } }), ev = collect(S);
  while (!S.pink.alive) S.step();
  /* Twenty followers to pay with: the suites run at simcore's burst cost of 0.35 s a follower. */
  const pk = S.pink; S.lay(20); S.you.x = pk.x + 250; S.you.z = pk.z; S.you.head = towards(S.you, pk);
  let caughtAt = -1, before = -1, after = -1, paid = 0, lenAtCatch = -1;
  for (let k = 0; k < 60 * 20; k++) {
    const n0 = S.you.followers.length;
    S.input.want = towards(S.you, pk); S.input.burst = true; S.step();
    const c = ev.find(e => e.what === 'catch');
    if (c && caughtAt < 0) { caughtAt = S.time; before = n0; after = S.you.followers.length; lenAtCatch = c.len; break; }
  }
  const catches = ev.filter(e => e.what === 'catch');
  ok('a bursting leader catches it: at ' + caughtAt.toFixed(2) + ' s, by you', caughtAt > 0 && catches.length === 1 && catches[0].by === S.you.id);
  ok('the catch adds exactly pinkReward (10) followers, once: ' + before + ' -> ' + after + ' on the step of the catch (the burst paid ' + (before + 10 - after) + ' that step)', after - before === 10 || after - before === 9);
  for (let k = 0; k < 60 * 2; k++) { S.input.burst = false; S.step(); }
  ok('and never again from the same appearance: still one catch event, one catch counted (the next appearance, at this test\'s 1 s wait, is a new one)', ev.filter(e => e.what === 'catch').length === 1 && pk.caught === 1 && ev.filter(e => e.what === 'appear').length >= 1);
}

/* 4. A touch without bursting does nothing. */
{
  const S = createSim({ seed: 11, params: { pinkWait: 1, bots: 0 } }), ev = collect(S);
  while (!S.pink.alive) S.step();
  const pk = S.pink; S.lay(2);
  S.you.x = pk.x; S.you.z = pk.z; S.input.want = null; S.input.burst = false; S.step();
  const n1 = S.you.followers.length, alive1 = pk.alive, c1 = ev.filter(e => e.what === 'catch').length;
  S.you.x = pk.x; S.you.z = pk.z; S.input.burst = true; S.step();
  ok('on top of it without bursting: not caught, followers unchanged (' + n1 + ')', alive1 && n1 === 2 && c1 === 0, 'alive ' + alive1 + ' len ' + n1 + ' catches ' + c1);
  ok('on top of it bursting: caught', !pk.alive && ev.filter(e => e.what === 'catch').length === 1 && S.you.followers.length >= 11, 'len ' + S.you.followers.length);
}

/* 5. Bots chase it as their greed says; measured over five minutes with the pink back every 10 s. */
{
  const S = createSim({ seed: 11, params: { pinkWait: 10, pinkStay: 40 } }), ev = collect(S);
  const chase = {}, alive = {}, catches = {};
  for (const t of S.rivals) { chase[t.kind] = 0; alive[t.kind] = 0; catches[t.kind] = 0; }
  for (let k = 0; k < 60 * 300; k++) {
    S.input.want = null; S.input.burst = false; S.step();
    if (S.pink.alive) for (const t of S.rivals) { if (t.dead > 0) continue; alive[t.kind]++; if (t.goalKind === 'pink') chase[t.kind]++; }
  }
  for (const e of ev) if (e.what === 'catch') { const t = S.rivals.find(r => r.id === e.by); if (t) catches[t.kind]++; }
  const share = Object.fromEntries(Object.keys(chase).map(k => [k, alive[k] ? +(chase[k] / alive[k]).toFixed(3) : 0]));
  ok('greedy bots chase it hardest and timid ones rarely: share of bot-steps chasing while it is in the water ' + JSON.stringify(share) + ', catches by kind ' + JSON.stringify(catches), (share.greedy || 0) > (share.timid || 0) && (share.greedy || 0) > 0.2 && (share.timid || 0) < 0.1);
  ok('bots catch it (' + Object.values(catches).reduce((a, b) => a + b, 0) + ' catches in five minutes, appearances ' + S.pink.appeared + ')', Object.values(catches).reduce((a, b) => a + b, 0) >= 1);
}

/* 6. Off: nothing appears and nothing is recorded. */
{
  const S = createSim({ seed: 11, params: { pinkOn: 0, pinkWait: 5 } }), ev = collect(S);
  for (let k = 0; k < 60 * 180; k++) S.step();
  ok('with pinkOn 0 it never appears in three minutes', !S.pink.alive && S.pink.appeared === 0 && ev.length === 0);
}
console.log(bad ? 'FAILED ' + bad : 'ALL PASS');
process.exit(bad ? 1 : 0);
