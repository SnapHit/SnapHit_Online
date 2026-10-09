/* 3E stage 4: play mode through the delay proxy, with the phone's own
   prediction code. PORT is the proxy's port; LABEL names the delay. All
   parts run at once, each in its own room. PARTS=corr,cut,bytes,drop. */
import { player, perSecond, q } from './playclient.mjs';
const PORT = +process.env.PORT, LABEL = process.env.LABEL || '', PARTS = (process.env.PARTS || 'corr,cut,bytes,drop,restart').split(',');
const CUT_S = +(process.env.CUT_S || 150);
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 560000);
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + '[' + LABEL + '] ' + n + (x ? '  [' + x + ']' : '')); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const room = p => p + '-' + Math.random().toString(36).slice(2, 7);
const jobs = [];

if (PARTS.includes('corr')) jobs.push((async () => {
  const c = player(PORT, room('corr'), { script: c => { const t = performance.now() / 1000;
    c.input.want = c.play.live ? c.you.head + 0.6 * Math.sin(t * 0.7) : null; c.input.burst = false; } });
  await c.opened; await wait(25000); c.close();
  const s = c.play.corrections.slice().sort((a, b) => a - b), snaps = s.filter(v => v > 60).length;
  ok('while swimming, the 95th percentile correction to your own leader is under 2 units, with no snaps', c.init && s.length > 100 && q(s, 0.95) < 2 && snaps === 0,
     s.length + ' corrections: median ' + q(s, 0.5).toFixed(3) + ', p95 ' + q(s, 0.95).toFixed(3) + ', worst ' + (s[s.length - 1] || 0).toFixed(2) +
     ' units; ' + snaps + ' snaps; inputs sent ' + c.play.seq + ', late for their step ' + c.play.late + '; lead ' + c.play.lead + ' steps after ' + c.play.leadMoves + ' moves');
})());

if (PARTS.includes('cut')) {
  const cutRun = async (lagComp, len = 0) => {
    const tally = new Map();
    const c = player(PORT, room('cut'), { stage: true, debug: true, lagComp, len, script: c => {
      const P = c.play, you = c.you;
      if (!P.live || !P.me) { c.input.want = null; c.input.burst = false; return; }
      let st = tally.get(P.me.runs); if (!st) { st = { tried: false, at: performance.now() }; tally.set(P.me.runs, st); }
      const d = c.shown(2);
      if (!d || d.dead || !d.followers.length) { c.input.want = null; c.input.burst = false; return; }
      const f = d.followers[Math.min(10, d.followers.length >> 1)];
      const dist = Math.hypot(f.x - you.x, f.z - you.z);
      c.input.want = Math.atan2(-(f.x - you.x), -(f.z - you.z));
      c.input.burst = dist < 160 && you.followers.length > 0;
      /* An attempt is a touch ON THIS SCREEN: your leader, as drawn, on a
         follower of the crossing train as drawn, while bursting. */
      if (!st.tried && P.sentBurst) {
        const R = (c.params.leaderR + c.params.followerR) * (c.params.trainScale || 1);
        for (let gi = 0; gi < d.followers.length; gi++) { const g = d.followers[gi];
          if (Math.hypot(g.x - you.x, g.z - you.z) <= R) { st.tried = true; st.d = { i: gi, lead: Math.round(Math.hypot(d.x - you.x, d.z - you.z)), len: d.followers.length, mine: you.followers.length }; break; } }
      }
    } });
    await c.opened; await wait(CUT_S * 1000); await wait(1200); c.close();
    const runs = [...tally.keys()].sort((a, b) => a - b); runs.pop();        // the last cycle may be unfinished
    const tried = runs.filter(r => tally.get(r).tried), landed = tried.filter(r => (c.cuts.get(r) || 0) > 0);
    const rw = c.rw.map(x => x[0]), wish = c.rw.map(x => x[1]);
    const missed = tried.filter(r => !((c.cuts.get(r) || 0) > 0)).map(r => ({ run: r, crashes: c.crashes.get(r) || 0, d: tally.get(r).d }));
    if (missed.length) console.log('   [' + LABEL + '] lagComp ' + lagComp + ' missed: ' + JSON.stringify(missed.slice(0, 8)));
    return { lagComp, len: len || 20, cycles: runs.length, tries: tried.length, landed: landed.length, pct: tried.length ? 100 * landed.length / tried.length : NaN,
             maxRewind: rw.length ? Math.max(...rw) : null, maxWish: wish.length ? Math.max(...wish) : null,
             medWish: wish.length ? wish.slice().sort((a, b) => a - b)[wish.length >> 1] : null, late: c.play.late, lead: c.play.lead };
  };
  jobs.push((async () => {
    const [on, off, on4, off4] = await Promise.all([cutRun(true), cutRun(false), cutRun(true, 4), cutRun(false, 4)]);
    for (const r of [on, off, on4, off4]) console.log('   [' + LABEL + '] ' + r.len + '-follower crossing, lag compensation ' + (r.lagComp ? 'ON ' : 'OFF') + ': ' + r.landed + ' of ' + r.tries +
      ' staged cuts landed (' + r.pct.toFixed(0) + '%) over ' + r.cycles + ' crossings; rewind used max ' + r.maxRewind + ' steps, wanted median ' + r.medWish + ' max ' + r.maxWish + '; late inputs ' + r.late + ', lead ' + r.lead);
    const bar = /^rtt 300/.test(LABEL) ? 80 : 90;
    ok('at least 50 staged cut attempts with lag compensation on and off', on.tries >= 50 && off.tries >= 50, 'on ' + on.tries + ', off ' + off.tries);
    ok('staged cuts landed with lag compensation on: at least ' + bar + '%', on.pct >= bar, on.landed + ' of ' + on.tries + ' (' + on.pct.toFixed(1) + '%); off: ' + off.landed + ' of ' + off.tries + ' (' + off.pct.toFixed(1) + '%)');
    ok('no train is judged where it was more than 250 ms earlier (15 steps)', on.maxRewind !== null && on.maxRewind <= 15 && off.maxRewind === 0,
       'on: rewind max ' + on.maxRewind + ' steps while the screen was up to ' + on.maxWish + ' behind; off: ' + off.maxRewind);
  })());
}

if (PARTS.includes('bytes')) jobs.push((async () => {
  const r = room('bytes'), ps = [0, 1, 2].map(k => player(PORT, r, { script: c => { const t = performance.now() / 1000 + k;
    c.input.want = c.play.live ? c.you.head + 0.8 * Math.sin(t * 0.9) : null; c.input.burst = Math.sin(t * 0.3) > 0.8; } }));
  await Promise.all(ps.map(p => p.opened)); await wait(2500); const t0 = Date.now(); await wait(25000);
  const names = ps.map(p => p.init && p.init.me && p.init.me.name), ids = ps.map(p => p.init && p.init.me && p.init.me.id);
  const rows = ps.map(p => { const i = perSecond(p.bytesIn, t0, 25), o = perSecond(p.bytesOut, t0, 25); const both = i.map((_, k) => 0);
    const pairs = []; for (let k = 0; k < 25; k++) { const a = t0 + k * 1000; pairs.push(p.bytesIn.concat(p.bytesOut).filter(([t]) => t >= a && t < a + 1000).reduce((s, [, b]) => s + b, 0)); }
    pairs.sort((a, b) => a - b); return { in50: q(i, 0.5), out50: q(o, 0.5), both50: q(pairs, 0.5), both95: q(pairs, 0.95) }; });
  const trains = ps[0].board ? ps[0].board.length : null;
  ps.forEach(p => p.close());
  ok('three players share a room with the seventeen bots left, each with a generated name', ids.every(v => typeof v === 'number') && new Set(ids).size === 3 && names.every(n => /^[a-z]+ [a-z]+$/.test(n || '')),
     JSON.stringify(names) + ' ids ' + ids + ', ' + trains + ' trains on the board');
  ok('bytes per phone, both directions: median at most 10 KB/s, 95th percentile at most 16 KB/s', rows.every(r => r.both50 <= 10240 && r.both95 <= 16384),
     rows.map(r => 'in ' + (r.in50 / 1024).toFixed(2) + ' + out ' + (r.out50 / 1024).toFixed(2) + ' = ' + (r.both50 / 1024).toFixed(2) + ' KB/s (p95 ' + (r.both95 / 1024).toFixed(2) + ')').join('; '));
})());

if (PARTS.includes('drop')) jobs.push((async () => {
  const r = room('drop');
  const a = player(PORT, r); await a.opened; await wait(2500);
  const me = a.init && a.init.me; a.drop(); await wait(3000);
  const b = player(PORT, r, { token: me && me.token }); await b.opened; await wait(2500);
  ok('a dropped manta is held by a bot and taken back within 15 s with its token', me && b.init && b.init.me && b.init.me.id === me.id && b.init.me.name === me.name,
     'before ' + JSON.stringify(me && { id: me.id, name: me.name }) + ', after ' + JSON.stringify(b.init && b.init.me && { id: b.init.me.id, name: b.init.me.name }));
  const tokenB = b.init && b.init.me && b.init.me.token; b.drop();
  await wait(16500);
  const c2 = player(PORT, r, { token: tokenB }); await c2.opened; await wait(2500);
  ok('after 15 s, reconnecting with the old token makes a new manta', c2.init && c2.init.me && c2.init.me.token !== tokenB,
     'old token ' + (tokenB || '').slice(0, 6) + '…, new ' + ((c2.init && c2.init.me && c2.init.me.token) || '').slice(0, 6) + '…, id ' + (c2.init && c2.init.me && c2.init.me.id) + ' name ' + (c2.init && c2.init.me && c2.init.me.name));
  c2.close();
})());

/* 3F: THE RESTART GAP. The staged room with no steering: the seat swims
   into the crossing train, dies and is put back every 2.5 s, a restart
   after a death. For 3 s after each restart, every frame the phone draws
   keeps its leader within 5 units of one follower spacing from its first
   follower. */
if (PARTS.includes('restart')) jobs.push((async () => {
  const c = player(PORT, room('rs'), { stage: true, script: c => { c.input.want = null; c.input.burst = false; } });
  await c.opened; await wait(+(process.env.RESTART_S || 62) * 1000); c.close();
  const sp = c.params.spacing, off = c.gaps.map(([, g]) => Math.abs(g - sp)), badN = off.filter(v => v > 5).length;
  ok('for 3 s after each of at least 20 restarts, every drawn frame keeps leader to first follower within 5 of the spacing', c.restarts >= 20 && c.gaps.length > 500 && badN === 0,
     c.restarts + ' restarts, ' + c.gaps.length + ' frames; ' + badN + ' off by more than 5; worst off by ' + (off.length ? Math.max(...off).toFixed(2) : '-') + ' (spacing ' + sp + ')');
})());

await Promise.all(jobs);
console.log('[' + LABEL + '] playtest failures: ' + bad); clearTimeout(die); setTimeout(() => process.exit(bad ? 1 : 0), 300);
