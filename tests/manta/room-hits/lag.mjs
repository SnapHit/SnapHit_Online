/* 3K stage 1: THE HIT LAG, broken into its parts. The phone's own
   roomplay.js through the delay proxy (PORT), the staged cut room. MODE=cut
   bursts across bot 2; MODE=crash goes straight into its body. Each of
   your own events (it names you) is timed on the machine's clock (the room
   stamps its truth with Date.now()):
     contact  the phone's predicted step first reaching the event's step
     sent     the first input stamped for that step or later
     step     the room running that step (truth clock less the steps since)
     snap     the room sending the snapshot that carries it
     arrive   that snapshot reaching the phone
     play     when the page would play it: roomview holds an event until
              its render time (now - offset - delay) passes the snapshot. */
import { player } from './playclient.mjs';
const PORT = +process.env.PORT, MODE = process.env.MODE || 'cut', LABEL = (process.env.LABEL || PORT) + ' ' + MODE;
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 85000);
const wait = ms => new Promise(r => setTimeout(r, ms));
const med = a => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
const room = 'lg-' + Math.random().toString(36).slice(2, 7);
const frames = [], inputs = [], hits = [];
const c = player(PORT, room, { stage: true, debug: true, script: c => {
  const P = c.play, you = c.you;
  frames.push([Date.now(), P.step]);
  if (!P.live || !P.me) { c.input.want = null; c.input.burst = false; return; }
  if (MODE === 'crash') { c.input.want = null; c.input.burst = false; return; }
  const d = c.shown(2);
  if (!d || d.dead || !d.followers.length) { c.input.want = null; c.input.burst = false; return; }
  const f = d.followers[Math.min(10, d.followers.length >> 1)];
  c.input.want = Math.atan2(-(f.x - you.x), -(f.z - you.z));
  c.input.burst = Math.hypot(f.x - you.x, f.z - you.z) < 160 && you.followers.length > 0;
} });
await c.opened;
const raw = c.ws.send.bind(c.ws);
c.ws.send = s => { try { const m = JSON.parse(s); if (m.t === 'in') inputs.push([Date.now(), m.k]); } catch (_) {} return raw(s); };
let pend = null;
c.onSnap = (m, atPerf) => {
  const mine = (m.ev || []).filter(e => e.by === c.play.id && (MODE === 'cut' ? e.k === 'cut' : e.k === 'crash'));
  if (!mine.length) return;
  const tm = c.timing();
  /* The page plays it when now - offset - delay reaches m.time. */
  const playWall = Date.now() + Math.max(0, (m.time + tm.offset + tm.delay - atPerf)) * 1000;
  pend = { k: m.k, arrive: Date.now(), playWall, rtt: c.rtt };
};
c.onTruth = m => { if (!pend) return; pend.snap = m.w; hits.push(pend); pend = null; };
await wait(+(process.env.SECS || 40) * 1000);
clearInterval(c.timer); try { c.ws.close(); } catch (_) {}
const parts = { wait_send: [], to_room: [], wait_step: [], wait_snap: [], back: [], hold: [], total: [] };
for (const h of hits) {
  const se = h.k - 1;                                          // the event's step: within the 3 since the last snapshot
  const fr = frames.find(([, s]) => s >= se), inp = inputs.find(([, k]) => k >= se);
  if (!fr || !inp) continue;
  const tStep = h.snap - (h.k - se) * 1000 / 60, oneway = (h.rtt || 0) / 2;
  parts.wait_send.push(inp[0] - fr[0]);                         // negative: sent ahead of the contact (the lead)
  parts.to_room.push(oneway);
  parts.wait_step.push(tStep - (inp[0] + oneway));
  parts.wait_snap.push(h.snap - tStep);
  parts.back.push(h.arrive - h.snap);
  parts.hold.push(h.playWall - h.arrive);
  parts.total.push(h.playWall - fr[0]);
}
const r = { hits: parts.total.length }; for (const k in parts) r[k] = Math.round(med(parts[k]));
console.log('[' + LABEL + '] ' + JSON.stringify(r) + ' rtt ' + Math.round(c.rtt || 0));
clearTimeout(die); process.exit(0);
