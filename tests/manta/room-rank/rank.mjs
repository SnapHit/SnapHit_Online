/* 4C part 3: your rank under the board (design doc 7.1). Through wrangler
   dev, NAMES=1 DIRECT=1:

   the wire, in Node with the room's own roomcore.js: a player's snapshot
     carries its rank (flag 128, one byte) on the first snapshot and
     whenever it changes, and not otherwise; the rank is the board's own
     order (length, a crashed train at 0, then id); a watcher is sent none.
   solo, the lab page with 20 bots (21 trains) and your train at 0: a line
     under the board, set apart from the ten, with your rank, name and
     length, matching the order of every train; with a 60-long train you
     are on the board and there is no line. PART=wire|solo|room picks.
   in the public room on the feedback page: the room tells the phone its
     rank, the line shows it with your name and length, and it agrees with
     the order of every train the radar knows (sampled, since the radar
     comes five times a second).
   Screenshots rank-solo.png and rank-room.png in MANTA_OUT. Needs CHROME.
   About 70 s. */
import { chromium } from '../lib/tools.mjs';
import { snapFor, decodeSnap } from '../../../docs/lab/manta/roomcore.js';
const PORT = +process.env.PORT, O = 'http://127.0.0.1:' + PORT, OUT = process.env.MANTA_OUT || '/tmp';
const PART = process.env.PART || 'all', want = x => PART === 'all' || PART.split(',').includes(x);
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 200000 * (+process.env.WATCHDOG_X || 1));
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x ? '  [' + x + ']' : '')); };
const wait = ms => new Promise(r => setTimeout(r, ms));

/* 1. The wire. */
if (want('wire')) {
  const train = (id, len, dead = 0) => ({ id, x: 0, z: 0, head: 0, s: 0, trail: [], followers: Array.from({ length: len }, () => ({ x: 0, z: 0 })), dead, runs: 1, peak: len, kind: 'bot' });
  const rivals = []; for (let id = 0; id < 21; id++) rivals.push(train(id, id === 5 ? 3 : id < 16 ? 10 + id : 0));
  const sim = { rivals, wild: [], pink: null, shark: null };
  const phone = { view: { x: 0, z: 0, w: 400, h: 800 }, watch: -1, sent: new Map(), me: { id: 5, early: null, late: 0, ack: 0 }, debug: false };
  const s1 = decodeSnap(snapFor(sim, phone, 1, [], 0).data), s2 = decodeSnap(snapFor(sim, phone, 2, [], 1).data);
  const want = 1 + rivals.filter(t => t.id !== 5 && (t.followers.length > 3 || (t.followers.length === 3 && t.id < 5))).length;
  rivals[5].followers.length = 40;
  const s3 = decodeSnap(snapFor(sim, phone, 3, [], 2).data);
  rivals[5].dead = 1.2;
  const s4 = decodeSnap(snapFor(sim, phone, 4, [], 3).data);
  const want4 = 1 + rivals.filter(t => t.id !== 5 && (t.followers.length > 0 || t.id < 5)).length;
  ok('a player is sent its rank on its first snapshot (' + s1.rk + ', the board\'s order gives ' + want + '), not again while it holds, and again when it moves (40 long: ' + s3.rk + '; crashed, at 0: ' + s4.rk + ' of 21)',
     s1.rk === want && s2.rk === undefined && s3.rk === 1 && s4.rk === want4, JSON.stringify([s1.rk, s2.rk, s3.rk, s4.rk, want4]));
  const watcher = { view: phone.view, watch: -1, sent: new Map(), me: null, debug: false };
  ok('a watcher is sent no rank', decodeSnap(snapFor(sim, watcher, 1, [], 0).data).rk === undefined);
  const a = snapFor(sim, Object.assign({}, phone, { sent: new Map(), rank: 99 }), 1, [], 0).data.byteLength, c = snapFor(sim, Object.assign({}, phone, { sent: new Map(), rank: rivals[5].dead ? want4 : 1 }), 1, [], 0).data.byteLength;
  ok('the rank costs one byte, only when it changed (' + (a - c) + ' byte)', a - c === 1, a + ' against ' + c);
}

const b = await chromium.launch({ executablePath: process.env.CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const errs = [];
async function page (url, name) {
  const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, hasTouch: true });
  if (name) await ctx.addInitScript(n => { try { localStorage.setItem('manta:name', n); } catch (_) {} }, name);
  /* Every binary snapshot the room sends, kept for the check (the last 400). */
  await ctx.addInitScript(() => { const W = window.WebSocket; window.__bin = [];
    let sockets = 0; window.WebSocket = class extends W { constructor (...a) { super(...a); const id = ++sockets; this.addEventListener('message', e => { if (typeof e.data !== 'string') { window.__bin.push([id, e.data]); if (window.__bin.length > 400) window.__bin.shift(); } }); } }; });
  const p = await ctx.newPage(); p.setDefaultTimeout(30000); p.setDefaultNavigationTimeout(30000);
  p.on('pageerror', e => errs.push(e.message.slice(0, 160)));
  p.on('console', c => { if (c.type() === 'error' && !/WebSocket connection to|Failed to load resource|popErrorScope/.test(c.text())) errs.push(c.text().slice(0, 160)); });
  await p.goto(O + url, { waitUntil: 'load' }).catch(e => errs.push('goto ' + e.message));
  await p.waitForFunction(() => window.__labReady === true && window.__sim && window.__sim.you, null, { timeout: 30000, polling: 200 }).catch(() => {});
  p.ctx = ctx; return p;
}
const boardOf = p => p.evaluate(() => { const el = document.getElementById('board'), line = el.querySelector('.rankLine');
  const lines = [...el.children].filter(e => e.tagName !== 'BR');
  return { rows: lines.filter(e => !e.classList.contains('rankLine')).map(e => e.textContent), line: line ? line.textContent : null,
    gap: line && lines.length > 1 ? line.getBoundingClientRect().top - lines[lines.length - 2].getBoundingClientRect().bottom : null,
    border: line ? getComputedStyle(line).borderTopWidth : null }; });

/* 2. Solo, 21 trains. */
if (want('solo')) {
  const p = await page('/lab/manta/play/?solo=1&bots=20&backend=webgl2&tier=low&hint=0', 'rank tester');
  /* Fifteen bots given 3 to 9 followers each and your train emptied, so you
     are outside the top ten whatever the first second dealt. */
  await p.evaluate(() => { window.__lab.pause(); const S = window.__sim;
    S.rivals.slice(0, 15).forEach((r, i) => { for (let k = 0; k < 3 + (i % 7); k++) r.followers.push({ x: r.x, z: r.z, head: r.head, born: -100, from: -1 }); });
    S.you.followers.length = 0; for (let i = 0; i < 40; i++) window.__lab.step(1 / 60);
    window.__lab.step(0.6); });   // one step that runs the half second the board waits, so it is drawn from the state read below
  const st = await p.evaluate(() => { const S = window.__sim, you = S.you; const rows = S.trains.map(t => ({ id: t.id, mine: t === you, len: t.dead > 0 ? 0 : t.followers.length }));
    rows.sort((a, c) => c.len - a.len || (a.mine ? -1 : c.mine ? 1 : 0)); return { rank: rows.findIndex(r => r.mine) + 1, len: you.followers.length, trains: S.trains.length }; });
  const bd = await boardOf(p);
  await p.screenshot({ path: OUT + '/rank-solo.png' });
  ok('solo with 21 trains, outside the top ten: "' + bd.line + '" under ten rows, set apart (' + bd.gap + ' px gap, ' + bd.border + ' rule)',
     st.trains === 21 && st.rank > 10 && bd.rows.length === 10 && bd.line === st.rank + '. rank tester  ' + st.len && bd.gap >= 4 && bd.border === '1px', JSON.stringify({ st, bd }));
  await p.ctx.close();
  const q = await page('/lab/manta/play/?solo=1&bots=20&backend=webgl2&tier=low&hint=0&train=60', 'rank tester');
  await q.evaluate(() => { window.__lab.pause(); for (let i = 0; i < 40; i++) window.__lab.step(1 / 30); window.__lab.step(0.6); });
  const bq = await boardOf(q);
  ok('solo with a 60-long train: on the board, and no line under it', bq.line === null && bq.rows.some(r => /^\d+\. you  \d+$/.test(r)) && bq.rows.length === 10, JSON.stringify(bq));
  await q.ctx.close();
}

/* 3. In the public room. */
if (want('room')) {
  const p = await page('/lab/manta/play/?backend=webgl2&tier=low&hint=0', 'rank tester');
  await p.waitForFunction(() => { const R = window.__lab && window.__lab.room; return R && R.play && R.me && window.__sim.rank > 0; }, null, { timeout: 30000, polling: 200 }).catch(() => {});
  /* The line at every redraw of the board: a MutationObserver's callback
     runs in the same task as the redraw, before the next snapshot can be
     taken in, so the rank the room last told is the one the redraw read. */
  await p.evaluate(() => { window.__rk = []; new MutationObserver(() => { const S = window.__sim, line = document.querySelector('#board .rankLine');
    window.__rk.push({ rank: S.rank, line: line ? line.textContent : null, dead: S.you.dead > 0 }); }).observe(document.getElementById('board'), { childList: true }); });
  await wait(12000);
  /* Against the room's own snapshots: in every snapshot that carries the
     radar's lengths of every train (five a second), the rank the room last
     told this phone must be this train's place in the board's order. */
  const wire = await p.evaluate(async () => { const { decodeSnap } = await import('/lab/manta/roomcore.js'); const me = window.__lab.room.id; let told = null, n = 0, same = 0, told1 = 0; const bad = [];
    let benched = 0; for (const [sock, buf] of window.__bin) { const m = decodeSnap(buf); if (!m) continue; if (m.rk) { told = m.rk; told1++; } if (!m.rd || told === null) continue;
      /* A benched player (its inputs stopped, the room's bot holding it) is sent no record of its own, and so no rank: judged only while seated. */
      if (!m.me) { benched++; continue; }
      const mine = m.rd.find(r => r[0] === me); if (!mine) continue; const len = mine[5] ? mine[3] : 0; let rank = 1;
      for (const r of m.rd) { if (r[0] === me) continue; const l = r[5] ? r[3] : 0; if (l > len || (l === len && r[0] < me)) rank++; }
      n++; if (rank === told) same++; else if (bad.length < 3) bad.push({ told, rank, len, me, k: m.k, n: m.n, sock, rk: m.rk, rd: m.rd.map(r => r[0] + ':' + r[3] + (r[5] ? '' : 'x')).join(' '), tr: m.tr.map(t => t.id + ':' + t.len + (t.dead ? 'x' : '')).join(' ') }); }
    return { n, same, told1, bad, benched, sockets: new Set(window.__bin.map(x => x[0])).size }; });
  ok('in the room, the rank the room tells the phone is its place among all 21 trains in every snapshot that carries their lengths (' + wire.same + ' of ' + wire.n + ', told ' + wire.told1 + ' times; ' + wire.benched + ' benched snapshots not judged)', wire.n >= 20 && wire.same === wire.n, JSON.stringify(wire.bad));
  await p.screenshot({ path: OUT + '/rank-room.png' });
  /* The line: at every redraw with the room's rank past ten it reads that rank, your name and a length; at ten or better there is none. */
  const draws = await p.evaluate(() => window.__rk);
  const outside = draws.filter(d => d.rank > 10), inside = draws.filter(d => d.rank > 0 && d.rank <= 10);
  const right = outside.filter(d => d.line && new RegExp('^' + d.rank + '\\. rank tester  \\d+$').test(d.line));
  ok('outside the top ten, at every redraw the line under the board says the rank the room told, your name and your length ("' + (outside[0] ? outside[0].line : 'never outside') + '"; ' + right.length + ' of ' + outside.length + ' redraws; ' + inside.length + ' inside the ten, none with a line)',
     outside.length >= 5 && right.length === outside.length && inside.every(d => d.line === null), JSON.stringify(outside.filter(d => !right.includes(d)).concat(inside.filter(d => d.line !== null)).slice(0, 3)));
  await p.ctx.close();
}
ok('no page errors', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
await b.close(); clearTimeout(die); console.log('rank failures: ' + bad); process.exit(bad ? 1 : 0);
