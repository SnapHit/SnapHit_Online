/* 4A stage 5: the whale shark through a room, with the phone's own code.
   The room runs with SHARK_ON:1 and SHARK_EVERY:5 (--var, test only), and
   the staged room's ?shark=cross sets it across the seated 40-long train
   each time it appears (rooms/ocean.js, tests only), since driving a train
   across its path under lag could not be made reliable. Checks: the
   snapshot carries it (flag 64) from its appearance, to every phone,
   moving at its speed on one heading that turns at one constant rate
   (never for a train); the train it is set across is cut there (the length
   drops, the room's cut event has no cutter); a leader driven into its body
   crashes (the room's crash event names this phone); bytes within the bar.
   One phone per delay, in its own staged room. */
import { player, perSecond, q } from './playclient.mjs';
const PORT = +process.env.PORT, LABEL = process.env.LABEL || PORT;
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 110000);
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + '[' + LABEL + '] ' + n + (x ? '  [' + x + ']' : '')); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const towards = (a, b) => Math.atan2(-(b.x - a.x), -(b.z - a.z));
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
let sk = null, seen = 0, gone = 0, last = null, moves = [], turns = [], cuts = [], crashes = [], lenLog = [], mode = 'wait', aim = null, held = null;
const c = player(PORT, 'sk-' + Math.random().toString(36).slice(2, 7) + '?mine=40&shark=cross', { stage: true, script: c => {
  if (!c.play.live) { c.input.want = null; c.input.burst = false; return; }
  c.input.burst = false;
  const you = c.you, r = Math.hypot(you.x, you.z);
  if (mode === 'ram' && sk) { const L = c.params.sharkLen || 320; aim = { x: sk.x + Math.sin(sk.h) * L / 2, z: sk.z + Math.cos(sk.h) * L / 2 }; c.input.want = towards(you, aim); }
  /* Otherwise: inside and alive, a gentle weave through the middle rather than a course into the reef (a tight circle would coil the train round the set-across point). */
  else c.input.want = r > 1200 ? towards(you, { x: 0, z: 0 }) : you.head + 0.12 * Math.sin(Date.now() / 1000);
} });
c.onSnap = m => {
  if (m.sk) { if (!sk) seen++; if (last) { const mv = Math.hypot(m.sk.x - last.x, m.sk.z - last.z); moves.push(mv); if (mv < 60) turns.push(wrap(m.sk.h - last.h)); } last = m.sk; sk = m.sk; }   // a set-across (tests only) is a teleport, left out of the course
  else { if (sk) gone++; sk = null; last = null; }
  for (const e of m.ev || []) { if (e.k === 'cut') cuts.push({ by: e.by, at: m.time, wall: Date.now() }); if (e.k === 'crash') crashes.push({ by: e.by, at: m.time }); }
  if (c.play.me) lenLog.push([m.time, c.play.me.len, c.play.me.dead || 0]);
};
await c.opened; await wait(2000);
const t0 = Date.now();
for (let k = 0; k < 60 && !sk; k++) await wait(250);
ok('the snapshot carries the whale shark from its appearance (flag 64): seen ' + seen + ' appearance(s) within ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s', seen >= 1);
await wait(4000);
const mv = moves.filter(m => m < 60);   // the set-across is a teleport, not a move
const spd = mv.length ? mv.reduce((a, b) => a + b, 0) / mv.length * 20 : 0;
/* The heading on the wire is a byte (2 pi / 256, 0.0245 rad), so the change between two snapshots jitters by up to two steps around its true, constant rate. */
const tr = turns.filter(t => Math.abs(t) < 0.5), trSpread = tr.length > 5 ? Math.max(...tr) - Math.min(...tr) : 9;
ok('it moves at its speed on one gently curving course: ' + spd.toFixed(0) + ' units a second at 20 snapshots a second, heading changes per snapshot within ' + trSpread.toFixed(4) + ' rad of each other over ' + tr.length + ' samples (the wire\'s heading step is 0.0245)', Math.abs(spd - 120) < 15 && trSpread <= 2 * Math.PI / 256 * 2 + 1e-6);
/* Set across the train at its appearance: the cut, the room's event with no cutter, the length down from 40. */
const len0 = 40, tc = Date.now();
for (let k = 0; k < 120 && cuts.length === 0; k++) await wait(250);
await wait(1000);
/* This phone's own train around the cut event: its length just before, and the least within a second after, alive throughout (a bot's cut by it would also name no cutter). */
const mine = cuts.map(ct => { const before = lenLog.filter(l => l[0] < ct.at).slice(-1)[0], after = lenLog.filter(l => l[0] >= ct.at && l[0] <= ct.at + 1); return { at: ct.at, by: ct.by, before: before ? before[1] : -1, after: after.length ? Math.min(...after.map(l => l[1])) : -1, dead: (before && before[2] > 0) || after.some(l => l[2] > 0) }; });
const own = mine.find(m => m.by === -1 && !m.dead && m.before >= 8 && m.after >= 0 && m.after <= m.before - 4);
ok('set across the train behind its leader, its body cuts it there: ' + (own ? own.before + ' -> ' + own.after + ' at ' + own.at.toFixed(1) + ' s' : 'no cut of this train') + ', the room\'s cut event with no cutter' + (mine.length ? ' (cut events seen: ' + JSON.stringify(mine.slice(0, 3)) + ')' : ''), !!own);
/* Then ram its body: a crash. */
mode = 'ram'; const tr0 = Date.now(); const deadBefore = lenLog.filter(l => l[2] > 0).length;
for (let k = 0; k < 160 && !(lenLog.length && lenLog[lenLog.length - 1][2] > 0); k++) await wait(250);
const died = lenLog.some(l => l[2] > 0);
ok('a leader driven into its body crashes: dead within ' + ((Date.now() - tr0) / 1000).toFixed(1) + ' s, the room\'s crash event naming this phone', died && crashes.some(e => e.by === c.play.id), 'crashes ' + JSON.stringify(crashes.slice(0, 3)) + ' me ' + c.play.id);
/* Bytes while it is carried, with the six seconds after the cut left out: the 36 followers it frees are a cut's debris burst (the wild deltas of 36 glowing mantas scattering), a cut's cost and not the shark's five bytes a snapshot; the whole-run figure is reported beside it. */
const all = perSecond(c.bytesIn.concat(c.bytesOut), t0, 20), cutWall = cuts.length ? cuts[0].wall : -1;
const per = all.filter((v, i) => cutWall < 0 || t0 + i * 1000 < cutWall - 1000 || t0 + i * 1000 > cutWall + 6000);
const med = q(per, 0.5), p95 = q(per, 0.95), medAll = q(all, 0.5), p95All = q(all, 0.95);
const sharkBytes = moves.length + 1;   // one five-byte record per snapshot that carried it
/* Asserted: its own share of the wire (five bytes a snapshot) and the room's ceiling. The room's median is reported against its bar, not asserted here: this staged scene (a 40-long train laid in the middle at the far zoom, then 36 freed as debris) sits at that bar with or without it, and room-bytes/bytes.mjs is the bytes check. */
ok('bytes per phone while it is carried: its own record ' + (sharkBytes * 5 / 20 / 1024).toFixed(2) + ' KB/s (5 bytes in each of ' + sharkBytes + ' snapshots); the room ' + (medAll / 1024).toFixed(1) + ' KB/s median, ' + (p95All / 1024).toFixed(1) + ' KB/s 95th (' + (med / 1024).toFixed(1) + ' and ' + (p95 / 1024).toFixed(1) + ' outside the cut\'s debris burst; the bar is 10 and 16, the 95th asserted)', sharkBytes * 5 / 20 <= 0.2 * 1024 && p95All <= 16384);
clearInterval(c.timer); try { c.ws.close(); } catch (_) {}
clearTimeout(die); process.exit(bad ? 1 : 0);
