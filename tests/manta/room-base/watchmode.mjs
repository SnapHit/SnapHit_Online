/* 3C stage 4: watch mode in the page, against wrangler dev. WebGL2, headless. */
import { chromium } from '../lib/tools.mjs';
const O = 'http://127.0.0.1:' + process.env.PORT;
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 88000);
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x ? '  [' + x + ']' : '')); };
const b = await chromium.launch({ executablePath: process.env.CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1 })).newPage();
p.setDefaultTimeout(30000); p.setDefaultNavigationTimeout(30000);
const errs = [], off = [], non200 = [];
p.on('console', c => { if (c.type() === 'error') errs.push(c.text().slice(0, 200)); });
p.on('pageerror', e => errs.push('pageerror: ' + e.message.slice(0, 200)));
p.on('request', r => { const u = r.url(); if (!u.startsWith(O) && !/^(data|about|blob):/.test(u)) off.push(u); });
p.on('response', r => { if (r.status() !== 200 && r.status() !== 101) non200.push(r.status() + ' ' + r.url().replace(O, '')); });
/* 3E setup: the room runs for 12 s before the page opens, so its bots have
   trains. A fresh room at the committed small ocean (20 wild in a 4000
   arena) can have nothing but the first bot's own leader in view. The page's
   build is read from the served panel.js. */
{ const build = (await (await fetch(O + '/lab/manta/panel.js')).text()).match(/export const BUILD = '([^']+)'/)[1];
  const ws = new WebSocket(O.replace('http', 'ws') + '/lab/manta/rooms/ocean/w1', { headers: { Origin: O } });
  await new Promise(res => { ws.onopen = res; ws.onerror = res; });
  try { ws.send(JSON.stringify({ t: 'hi', b: String(build).replace(/\D/g, '').slice(2) })); ws.send(JSON.stringify({ t: 'view', x: 0, z: 0, w: 400, h: 900 })); } catch (_) {}
  await new Promise(res => setTimeout(res, 12000)); try { ws.close(); } catch (_) {} }
await p.goto(O + '/lab/manta/?room=w1&backend=webgl2&tier=low', { waitUntil: 'load' }).catch(e => console.log('goto ' + e.message));
await p.waitForFunction(() => window.__labReady === true, null, { timeout: 25000 }).catch(() => console.log('(no ready)'));
await p.waitForFunction(() => { const r = window.__lab && window.__lab.room; return r && r.connected && r.snaps > 60; }, null, { timeout: 25000 }).catch(() => console.log('(no room snapshots)'));
await p.waitForTimeout(2500);
const r = await p.evaluate(async () => { const L = window.__lab, M = L.mantas, R = L.room;
  const count = () => { let d = 0; for (let j = 0; j < M.drawn; j++) if (M.aPos.getX(j) !== M.PARKED) d++; return d; };
  const signal = [...document.querySelectorAll('div')].map(d => d.textContent).find(t => /^● /.test(t || '')) || '';
  const out = { connected: R.connected, snaps: R.snaps, rtt: R.rtt, delay: R.delay, build: R.build, watched: R.watched, drawn: count(),
    board: (document.getElementById('board') || {}).textContent || '', signal, you: window.__sim && window.__sim.you && [Math.round(window.__sim.you.x), Math.round(window.__sim.you.z)],
    cam: [Math.round(L.camera.position.x), Math.round(L.camera.position.z)], localSteps: window.__sim && window.__sim.watching };
  /* 3D: each visible bot sits at index id-1, and its leader's tint is the
     same before and after switching which bot is watched. */
  const S = window.__sim, tintOf = id => { const i = M.RIVAL_BASE + (id - 1) * M.RIVAL_LEN; return [M.aTint.getX(i), M.aTint.getY(i), M.aTint.getZ(i)].map(v => +v.toFixed(4)).join(','); };
  const idx = () => S.rivals.filter(r => !r.hole).map(r => [r.id, S.rivals.indexOf(r)]);
  const before = idx(), tintsBefore = Object.fromEntries(Array.from({ length: 10 }, (_, k) => [k + 1, tintOf(k + 1)]));
  document.querySelector('canvas').dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 200, clientY: 500 }));
  await new Promise(res => setTimeout(res, 1500));
  out.watchedAfterTap = R.watched;
  const after = idx(), tintsAfter = Object.fromEntries(Array.from({ length: 10 }, (_, k) => [k + 1, tintOf(k + 1)]));
  out.indexOk = before.concat(after).every(([id, i]) => i === id - 1);
  out.tintSame = Object.keys(tintsBefore).filter(k => tintsBefore[k] !== tintsAfter[k]);
  out.boardKinds = (document.getElementById('board') || {}).textContent.match(/bot \d+ · \w+/g) || [];
  /* Pause holds what is drawn while the room carries on; Step moves it on. */
  const pos = () => { const a = []; for (let j = 0; j < Math.min(M.drawn, 1200); j++) a.push(M.aPos.getX(j), M.aPos.getZ(j)); return a.join(','); };
  const click = id => document.getElementById(id).click();
  click('dbgPause'); await new Promise(res => setTimeout(res, 300));
  const p0 = pos(), s0 = R.snaps; await new Promise(res => setTimeout(res, 1200)); const p1 = pos(), s1 = R.snaps;
  click('dbgStep'); await new Promise(res => setTimeout(res, 300)); const p2 = pos();
  click('dbgPause'); await new Promise(res => setTimeout(res, 600)); const p3 = pos();
  out.pause = { frozen: p0 === p1, roomCarriedOn: s1 - s0, stepped: p2 !== p1, liveAgain: p3 !== p2 };
  out.overflow = document.documentElement.scrollWidth - innerWidth;
  return out; }).catch(e => ({ error: e.message }));
await p.screenshot({ path: (process.env.MANTA_OUT || '/tmp') + '/watch-412x915.png' }).catch(() => {});
console.log(JSON.stringify(r));
if (r.error) ok('ran', false, r.error); else {
  ok('watch mode connects to the room and draws it from snapshots', r.connected && r.snaps > 60 && r.drawn > 1 && r.localSteps === true, 'snaps ' + r.snaps + ', drawn ' + r.drawn + ' mantas, watching bot ' + r.watched + ', delay ' + (r.delay && r.delay.toFixed ? r.delay.toFixed(0) : r.delay) + ' ms');
  ok('the camera follows the watched bot', r.you && Math.abs(r.cam[0] - r.you[0]) < 60 && Math.abs(r.cam[1] - r.you[1]) < 60, 'camera ' + r.cam + ', watched leader ' + r.you);
  ok('the signal mark shows the round trip', /ms/.test(r.signal), r.signal);
  ok('the board lists bots and no "you"', /bot \d+/.test(r.board) && !/\byou\b/.test(r.board), r.board.replace(/\s+/g, ' ').slice(0, 120));
  ok('a tap moves to another bot', r.watchedAfterTap !== r.watched, r.watched + ' -> ' + r.watchedAfterTap);
  ok('switching bots never changes a train\'s colour: every bot at index id-1, tints unchanged', r.indexOk && r.tintSame.length === 0, 'index ok ' + r.indexOk + ', changed tints ' + JSON.stringify(r.tintSame));
  ok('the board shows every bot\'s kind', r.boardKinds.length >= 9 && r.boardKinds.every(k => /· (timid|greedy|bully)$/.test(k)), r.boardKinds.join(' | '));
  ok('Pause freezes what is drawn while the room carries on; Step moves it; unpausing goes live', r.pause.frozen && r.pause.roomCarriedOn > 10 && r.pause.stepped && r.pause.liveAgain, JSON.stringify(r.pause));
  ok('the page is on the room\'s build', !!r.build, r.build);
  ok('no horizontal overflow', r.overflow <= 0, String(r.overflow));
}
ok('no console errors', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
ok('no non-200 (the 101 upgrade aside)', non200.length === 0, JSON.stringify(non200.slice(0, 5)));
ok('off-origin zero', off.length === 0, JSON.stringify(off));
console.log('watchmode failures: ' + bad); clearTimeout(die); await b.close(); process.exit(bad ? 1 : 0);
