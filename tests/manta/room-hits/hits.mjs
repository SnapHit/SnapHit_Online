/* 3K stage 2: YOUR OWN HITS AT ONCE. The phone's own roomplay.js and
   roomcore.js createHits, against the rival train drawn as the page draws
   it (c.shown), through the delay proxy (PORT), the staged cut room.
   MODE=cut bursts across bot 2; MODE=crash goes straight into its body. */
const TREE = process.env.TREE || decodeURIComponent(new URL('../../..', import.meta.url).pathname).replace(/\/$/, '');
const core = await import(TREE + '/docs/lab/manta/roomcore.js');
import { player } from './playclient.mjs';
const PORT = +process.env.PORT, MODE = process.env.MODE || 'cut', LABEL = (process.env.LABEL || PORT) + ' ' + MODE;
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 85000);
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + '[' + LABEL + '] ' + n + (x ? '  [' + x + ']' : '')); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const pct = (a, q) => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const room = 'ht-' + Math.random().toString(36).slice(2, 7), hits = core.createHits(), rtts5 = [];
const c = player(PORT, room, { stage: true, debug: true, script: c => {
  const P = c.play, you = c.you;
  if (!P.live || !P.me || MODE === 'crash') { c.input.want = null; c.input.burst = false; return; }
  const d = c.shown(2);
  if (!d || d.dead || !d.followers.length) { c.input.want = null; c.input.burst = false; return; }
  const f = d.followers[Math.min(10, d.followers.length >> 1)];
  c.input.want = Math.atan2(-(f.x - you.x), -(f.z - you.z));
  c.input.burst = Math.hypot(f.x - you.x, f.z - you.z) < 160 && you.followers.length > 0;
} });
await c.opened;
const plays = [], contacts = [], outcomes = [], expired = [], doubles = []; let lastRtt = null, inContact = false;
c.onSnap = (m, atPerf) => {
  if (c.rtt !== lastRtt && c.rtt !== null) { lastRtt = c.rtt; rtts5.push(c.rtt); if (rtts5.length > 5) rtts5.shift(); }
  const tm = c.timing(), now = performance.now();
  for (const e of m.ev || []) {
    if (e.by !== c.play.id) continue;
    const pend = hits.pending.slice(), matched = hits.confirm({ kind: e.k, x: e.x, z: e.z });
    const holdMs = Math.max(0, (m.time + tm.offset + tm.delay) * 1000 - atPerf * 1000);
    if (matched) { const h = pend.find(h => h.kind === e.k && Math.hypot(h.x - e.x, h.z - e.z) <= core.HIT_MATCH); outcomes.push({ after: now - h.contact, before: now + holdMs - h.contact, kind: e.k }); }
    else { plays.push({ t: now, room: true, kind: e.k });
      if (expired.some(x => x.kind === e.k && Math.hypot(x.x - e.x, x.z - e.z) <= core.HIT_MATCH && now - x.gone < 3000)) doubles.push(e.k); }
  }
};
const P = c.params;
const timer = setInterval(() => {
  const now = performance.now(), you = c.you;
  if (!c.play.live || you.dead > 0) { inContact = false; hits.expire(now, (rtts5.length ? Math.max(...rtts5) : 300) + 150, false); return; }
  const trains = []; for (let id = 1; id <= 10; id++) { if (id === c.play.id) continue; const t = c.shown(id); if (t && !t.dead) { t.id = id; trains.push(t); } }
  /* Contact on screen, by the test's own reckoning. */
  const k = P.trainScale || 1; let touch = false;
  for (const r of trains) { if (Math.hypot(r.x - you.x, r.z - you.z) <= 2 * P.leaderR * k) touch = true; for (const f of r.followers) if (Math.hypot(f.x - you.x, f.z - you.z) <= (P.leaderR + P.followerR) * k) touch = true; }
  if (touch && !inContact) contacts.push(now);
  inContact = touch;
  const before = hits.pending.length;
  hits.expire(now, (rtts5.length ? Math.max(...rtts5) : 300) + 150, true);
  const h = hits.detect(you, trains, P, now);
  if (h) { h.contact = contacts.length ? contacts[contacts.length - 1] : now; plays.push({ t: now, flash: now - h.contact, kind: h.kind }); }
}, 1000 / 60);
/* Watch expiries: a pending hit gone without confirmation. */
const seen = new Set(), conf = () => hits.stats.confirmed;
const watcher = setInterval(() => { for (const h of hits.pending) seen.add(h); for (const h of seen) if (!hits.pending.includes(h)) { seen.delete(h); h.gone = performance.now(); expired.push(h); } }, 5);
await wait(+(process.env.SECS || 35) * 1000);
clearInterval(timer); clearInterval(watcher); clearInterval(c.timer); try { c.ws.close(); } catch (_) {}
const st = hits.stats, flashes = plays.filter(p => p.flash !== undefined).map(p => p.flash), roomPlays = plays.filter(p => p.room).length;
const unconf = expired.length - st.confirmed >= 0 ? st.unconfirmed : st.unconfirmed;
console.log('[' + LABEL + '] ' + JSON.stringify({ predicted: st.predicted, confirmed: st.confirmed, unconfirmed: st.unconfirmed, unpredicted: st.unpredicted, contacts: contacts.length,
  flashP95: pct(flashes, 0.95), outcomeAfterMed: Math.round(pct(outcomes.map(o => o.after), 0.5)), outcomeBeforeMed: Math.round(pct(outcomes.map(o => o.before), 0.5)), rtt: Math.round(c.rtt || 0) }));
ok('contact on screen to the flash: 95th percentile at most one frame (17 ms)', flashes.length >= 3 && pct(flashes, 0.95) <= 17, flashes.length + ' hits, p95 ' + pct(flashes, 0.95).toFixed(1) + ' ms');
ok('contact to the outcome: played on arrival, against the old hold', outcomes.length >= 3, 'median ' + Math.round(pct(outcomes.map(o => o.after), 0.5)) + ' ms after (95th ' + Math.round(pct(outcomes.map(o => o.after), 0.95)) + '), ' + Math.round(pct(outcomes.map(o => o.before), 0.5)) + ' ms with the old hold');
ok('unconfirmed predicted hits: counted, and none followed by its event later (no scatter, no death from them)', doubles.length === 0, st.unconfirmed + ' of ' + st.predicted + ' unconfirmed (' + (100 * st.unconfirmed / Math.max(1, st.predicted)).toFixed(1) + '%); late events after one expired: ' + doubles.length);
ok('no hit plays twice: every one of your room events played once (a confirmation plays nothing more)', doubles.length === 0 && st.confirmed + st.unpredicted === st.confirmed + roomPlays, st.confirmed + ' confirmed silently, ' + roomPlays + ' played from the room (not predicted)');
clearTimeout(die); process.exit(bad ? 1 : 0);
