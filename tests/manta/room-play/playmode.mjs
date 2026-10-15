/* 3E stage 4: play mode in the page, through a delay proxy (PORT). Scheme A
   steers and bursts, your train has no gap, and the PAGE'S OWN prediction
   meets the correction bar while steering for 20 s. WebGL2, phone size. */
import { chromium } from '../lib/tools.mjs';
const O = 'http://127.0.0.1:' + process.env.PORT, LABEL = process.env.LABEL || 'proxy ' + process.env.PORT;
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 89000);
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + '[' + LABEL + '] ' + n + (x ? '  [' + x + ']' : '')); };
const b = await chromium.launch({ executablePath: process.env.CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, hasTouch: true })).newPage();
p.setDefaultTimeout(30000); p.setDefaultNavigationTimeout(30000);
const errs = [], off = [], non200 = [];
p.on('console', c => { if (c.type() === 'error') errs.push(c.text().slice(0, 200)); });
p.on('pageerror', e => errs.push('pageerror: ' + e.message.slice(0, 200)));
p.on('request', r => { const u = r.url(); if (!u.startsWith(O) && !u.startsWith(O.replace('http', 'ws')) && !/^(data|about|blob):/.test(u)) off.push(u); });
p.on('response', r => { if (r.status() !== 200 && r.status() !== 101) non200.push(r.status() + ' ' + r.url().replace(O, '')); });
/* 3G: USECODE=1 plays in a private room the registry made, not a test name. */
const roomName = process.env.USECODE ? (await (await fetch(O + '/lab/manta/rooms/new', { method: 'POST', headers: { Origin: O, 'X-Test-Address': 'pm' + Math.random() } })).json()).code : 'pm-' + Math.random().toString(36).slice(2, 7);
console.log('room ' + roomName);
const open = async extra => {
  await p.goto(O + '/lab/manta/?room=' + roomName + extra + '&play=1&backend=webgl2&tier=low', { waitUntil: 'load' }).catch(e => console.log('goto ' + e.message));
  await p.waitForFunction(() => window.__labReady === true, null, { timeout: 25000 }).catch(() => console.log('(no ready)'));
  await p.waitForFunction(() => { const r = window.__lab && window.__lab.room; return r && r.connected && r.me && r.snaps > 30 && window.__sim.you.followers; }, null, { timeout: 25000 }).catch(() => console.log('(no room)'));
};
await open('');
const r = await p.evaluate(async () => {
  const L = window.__lab, R = L.room, S = window.__sim, cv = document.querySelector('canvas');
  const ev = (type, id, x, y) => cv.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 11, clientX: x, clientY: y, bubbles: true, cancelable: true, buttons: type === 'pointerup' ? 0 : 1 }));
  const wait = ms => new Promise(res => setTimeout(res, ms));
  const out = { play: R.play, name: R.name, id: R.id, backend: (document.getElementById('backend') || {}).textContent };
  /* Steer with scheme A: hold a finger beside the leader, on the side the
     arena's centre is (3F: in a 2000 arena a seat near the reef, steered
     into it, is held by the wall and cannot show a turn). Tried again (up
     to three times) if your manta was in a death beat. */
  for (let tries = 0; tries < 3; tries++) {
    for (let k = 0; k < 60 && S.you.dead > 0; k++) await wait(50);
    const side = S.you.x > 0 ? -1 : 1, fx = side > 0 ? 400 : 12;
    const x0 = S.you.x, runs0 = R.me && R.me.runs; let died = false;
    ev('pointerdown', 11, fx, 457);
    for (let k = 0; k < 30; k++) { await wait(50); if (S.you.dead > 0 || (R.me && R.me.runs !== runs0)) died = true; }
    out.want = S.input.want; out.side = side; out.dx = (S.you.x - x0) * side; out.steerTries = tries + 1; ev('pointerup', 11, fx, 457); await wait(300);
    if (!died) break;
  }
  /* 20 s of steering: a finger circling the screen, as a player would. */
  const c0 = R.corrections.length, late0 = R.late;
  ev('pointerdown', 11, 206, 200);
  for (let k = 0; k < 200; k++) { const a = k / 16; ev('pointermove', 11, 206 + 150 * Math.cos(a), 457 + 300 * Math.sin(a)); await wait(100); }
  ev('pointerup', 11, 206, 200);
  out.corr = R.corrections.slice(c0).sort((a, c) => a - c); out.late = R.late - late0; out.lead = R.lead; out.seq = R.seq; out.rtt = R.rtt;
  out.board = (document.getElementById('board') || {}).textContent || '';
  /* 4B: the board is the top ten of a room's 20 trains, so a new train is
     usually not on it; your own row is marked whenever it is. */
  out.onBoard = !!(window.__sim && window.__sim.trains && window.__sim.trains.includes(window.__sim.you));
  out.players = (window.__lab.room && window.__lab.room.players) || [];
  out.mark = ([...document.querySelectorAll('div')].find(d => /^● /.test(d.textContent || '')) || {}).textContent || '';
  out.overflow = document.documentElement.scrollWidth - innerWidth;
  return out;
}).catch(e => ({ error: e.message }));
/* Then the staged cut room (wrangler dev only), where your train is put
   back with twelve followers every 2.5 s: burst, and look for a gap. */
const non200First = non200.splice(0);
await open('-s&stage=cut');
const revalidated = non200.filter(x => x.startsWith('304 ')).length; non200.splice(0, non200.length, ...non200First, ...non200.filter(x => !x.startsWith('304 ')));
const r2 = await p.evaluate(async () => {
  const L = window.__lab, R = L.room, S = window.__sim, M = L.mantas, cv = document.querySelector('canvas');
  const ev = (type, id, x, y) => cv.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 11, clientX: x, clientY: y, bubbles: true, cancelable: true, buttons: type === 'pointerup' ? 0 : 1 }));
  const wait = ms => new Promise(res => setTimeout(res, ms));
  const wake = async () => { for (let k = 0; k < 60 && !(S.you.followers && S.you.followers.length > 3 && !(S.you.dead > 0)); k++) await wait(50); };
  /* No gap, INCLUDING RIGHT AFTER A RESTART (3F): the drawn leader (slot 0)
     to the drawn first follower (slot 1) on every frame your train is alive
     over 8 s, which spans three put-backs of the staged room. */
  await wake();
  const gaps = []; let lens = [], lastRuns = null, restarts = 0, afterRestart = 0;
  const t0 = performance.now();
  while (performance.now() - t0 < 8000) { await new Promise(res => requestAnimationFrame(res));
    const runs = R.me && R.me.runs;
    if (runs !== lastRuns) { if (lastRuns !== null) restarts++; lastRuns = runs; afterRestart = 3; }
    if (S.you.dead > 0 || !(S.you.followers && S.you.followers.length)) continue;
    if (afterRestart > 0) afterRestart--;
    lens.push(S.you.followers.length);
    gaps.push(Math.hypot(M.aPos.getX(0) - M.aPos.getX(1), M.aPos.getZ(0) - M.aPos.getZ(1))); }
  const out = { gaps: gaps.length ? [Math.min(...gaps), Math.max(...gaps)] : null, len: lens.length ? Math.max(...lens) : 0, frames: gaps.length, restarts, spacing: S.params.spacing };
  /* Burst: double-tap and hold, and watch the room's own word for it,
     starting just after a put-back so there is a whole crossing to do it in. */
  { const r0 = R.me && R.me.runs; for (let k = 0; k < 60 && (R.me && R.me.runs) === r0; k++) await wait(50); }
  await wake();
  ev('pointerdown', 11, 206, 300); ev('pointerup', 11, 206, 300); await wait(80); ev('pointerdown', 11, 206, 300);
  let seen = false; for (let k = 0; k < 40 && !seen; k++) { await wait(50); seen = !!(R.me && R.me.b); }
  out.burstInput = !!S.input.burst; out.burstRoom = seen; ev('pointerup', 11, 206, 300);
  return out;
}).catch(e => ({ error: e.message }));
Object.assign(r, r2.error ? { error: 'staged: ' + r2.error } : r2);
await p.screenshot({ path: (process.env.MANTA_OUT || '/tmp') + '/play3e-412x915.png' }).catch(() => {});
await p.goto('about:blank').catch(() => {});
const c = r.corr || [], p95 = c.length ? c[Math.ceil(0.95 * c.length) - 1] : NaN, snaps = c.filter(v => v > 60).length;
console.log(JSON.stringify({ ...r, corr: c.length + ' corrections' }).slice(0, 500));
if (r.error) ok('ran', false, r.error); else {
  ok('play mode joins the room as a manta with a generated name', r.play && typeof r.id === 'number' && /^[a-z]+ [a-z]+$/.test(r.name || ''), r.name + ' #' + r.id + ', ' + r.backend);
  ok('scheme A steers: a finger beside you turns you that way and you move that way', r.want !== null && Math.abs(Math.sin(r.want) + r.side) < 0.3 && r.dx > 20, 'finger to the ' + (r.side > 0 ? 'right' : 'left') + ', want ' + (r.want && r.want.toFixed(2)) + ', moved ' + (r.dx || 0).toFixed(0) + ' units that way, try ' + r.steerTries);
  ok('scheme A bursts: double-tap and hold, and the room says you are bursting', r.burstInput && r.burstRoom, 'input ' + r.burstInput + ', room ' + r.burstRoom);
  ok('your train is drawn with no gap, including after a restart: leader to first follower within spacing ± 5', !!r.gaps && r.restarts >= 1 && r.gaps[0] >= r.spacing - 5 && r.gaps[1] <= r.spacing + 5, r.gaps ? r.gaps.map(v => v.toFixed(1)).join('..') + ' (spacing ' + r.spacing + ', length up to ' + r.len + ', ' + r.frames + ' frames across ' + r.restarts + ' restarts)' : 'no followers to measure');
  ok("the page's own prediction: p95 correction under 2 units while steering, no snaps", c.length > 80 && p95 < 2 && snaps === 0,
     c.length + ' corrections over 20 s: median ' + (c[c.length >> 1] || 0).toFixed(3) + ', p95 ' + (p95 || 0).toFixed(3) + ', worst ' + (c[c.length - 1] || 0).toFixed(2) + '; ' + snaps + ' snaps; late inputs ' + r.late + ' of ' + r.seq + '; lead ' + r.lead + '; rtt ' + (r.rtt && r.rtt.toFixed(0)));
  ok('the signal mark shows your name, the room names you as a player, and the board marks your row as you when you are in its top ten', r.mark.includes(r.name) && r.players.includes(r.name) && (!r.onBoard || /\byou\b/.test(r.board)),
     'mark "' + r.mark + '"; players ' + JSON.stringify(r.players) + '; on the board ' + r.onBoard + ': ' + r.board.replace(/\s+/g, ' ').slice(0, 160));
  ok('no horizontal overflow', r.overflow <= 0, String(r.overflow));
}
ok('no console errors', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
ok('no non-200 (the 101 upgrade aside; the second load\'s ' + revalidated + ' cache revalidations are 304 by design)', non200.length === 0, JSON.stringify(non200.slice(0, 5)));
ok('off-origin zero', off.length === 0, JSON.stringify(off));
console.log('playmode failures: ' + bad); clearTimeout(die); await b.close(); process.exit(bad ? 1 : 0);
