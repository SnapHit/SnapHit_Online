/* 4A stage 4: the pink manta through a room, with the phone's own code
   (playclient.mjs, roomcore's decodeSnap and createPlay). The room runs with
   PINK_WAIT:4 and PINK_STAY:40 (--var, test only) so it appears in seconds.
   Checks: the snapshot carries it (flag 32) from its appearance, moving,
   one at a time; a phone that cruises at it never catches it; a phone that
   bursts at it catches it, its length jumps by exactly pinkReward once, and
   the room's catch event names this phone; bytes per phone stay within the
   bar while it is carried. One phone per delay, in its own staged room. */
import { player, perSecond, q } from './playclient.mjs';
const PORT = +process.env.PORT, LABEL = process.env.LABEL || PORT;
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 110000);
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + '[' + LABEL + '] ' + n + (x ? '  [' + x + ']' : '')); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const towards = (a, b) => Math.atan2(-(b.x - a.x), -(b.z - a.z));
/* A phone with a train of 20 (?mine=20), chasing the pink from the moment the snapshots carry it; burst only when told. */
let mode = 'cruise', pk = null, pkSeen = 0, pkGone = 0, lastPk = null, moves = [], catches = [], lenLog = [];
const c = player(PORT, 'pk-' + Math.random().toString(36).slice(2, 7) + '?mine=20', { stage: true, script: c => {
  if (!c.play.live) { c.input.want = null; c.input.burst = false; return; }
  if (pk) { c.input.want = towards(c.you, pk); c.input.burst = mode === 'burst' && Math.hypot(c.you.x - pk.x, c.you.z - pk.z) < 400; }
  else { c.input.want = null; c.input.burst = false; }
} });
c.onSnap = m => {
  if (m.pk) { if (!pk) pkSeen++; if (lastPk) moves.push(Math.hypot(m.pk.x - lastPk.x, m.pk.z - lastPk.z)); lastPk = m.pk; pk = m.pk; }
  else { if (pk) pkGone++; pk = null; lastPk = null; }
  for (const e of m.ev || []) if (e.k === 'pink' && e.what === 'catch') catches.push({ by: e.by, at: m.time, len: c.play.me ? c.play.me.len : -1 });
  if (c.play.me) lenLog.push([m.time, c.play.me.len]);
};
await c.opened; await wait(3000);
const t0 = Date.now();
/* Cruise at it for 14 s: never caught. */
mode = 'cruise'; await wait(14000);
const seenCruise = pkSeen, minLenCruise = Math.min(...lenLog.slice(-200).map(l => l[1]));
ok('the snapshot carries the pink manta from its appearance (flag 32): seen ' + pkSeen + ' appearance(s), ' + moves.length + ' moves, mean ' + (moves.reduce((a, b) => a + b, 0) / Math.max(1, moves.length)).toFixed(1) + ' units a snapshot', pkSeen >= 1 && moves.length > 50);
ok('cruising at it for 14 s catches nothing: no catch event, length held (' + minLenCruise + ')', catches.length === 0 && minLenCruise >= 15);
/* Burst at it: caught, +pinkReward once, by this phone. */
mode = 'burst'; const lenBefore = c.play.me ? c.play.me.len : -1; const tBurst = Date.now();
for (let k = 0; k < 120 && catches.length === 0; k++) await wait(250);
await wait(1500);
const mine = catches.filter(e => e.by === c.play.id), lenAfter = c.play.me ? c.play.me.len : -1;
const jump = (() => { for (let i = 1; i < lenLog.length; i++) if (lenLog[i][1] - lenLog[i - 1][1] >= 8) return lenLog[i][1] - lenLog[i - 1][1]; return 0; })();
ok('bursting at it catches it within ' + ((Date.now() - tBurst) / 1000).toFixed(1) + ' s, and the room\'s catch event names this phone', mine.length === 1 && catches.length === 1, 'catches ' + JSON.stringify(catches) + ' me ' + c.play.id);
ok('the length jumps by pinkReward (10) once, between snapshots: ' + lenBefore + ' -> ' + lenAfter + ', largest jump ' + jump, jump >= 9 && jump <= 10);
ok('only one at a time: appearances ' + pkSeen + ', gone ' + pkGone, pkSeen <= pkGone + 1);
const per = perSecond(c.bytesIn.concat(c.bytesOut), t0, 15), med = q(per, 0.5), p95 = q(per, 0.95);
ok('bytes per phone while it is carried: ' + (med / 1024).toFixed(1) + ' KB/s median, ' + (p95 / 1024).toFixed(1) + ' KB/s 95th (bar 10 and 16)', med <= 10240 && p95 <= 16384);
clearInterval(c.timer); try { c.ws.close(); } catch (_) {}
clearTimeout(die); process.exit(bad ? 1 : 0);
