/* 3K stage 3: the first visit plays in place. Through a 20 ms delay proxy
   (PORT is the proxy): tap Play, time to swimming; the lab phrase gone;
   landscape with the keyboard up, board and stats apart (screenshot). */
import { chromium } from '../lib/tools.mjs';
const O = 'http://127.0.0.1:' + process.env.PORT, SHOTS = (process.env.SHOTS || process.env.MANTA_OUT || '/tmp') || '/tmp';
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 88000);
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + '[inplace] ' + n + (x ? '  [' + x + ']' : '')); };
const b = await chromium.launch({ executablePath: process.env.CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const errs = [], times = [], seats = [], fps = [];
for (let run = 0; run < 3; run++) {
  const p = await (await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, hasTouch: true })).newPage();
  p.setDefaultTimeout(30000); p.setDefaultNavigationTimeout(30000); p.on('pageerror', e => errs.push(e.message.slice(0, 160)));
  await p.goto(O + '/lab/manta/play/?backend=webgl2&tier=low', { waitUntil: 'load' });
  await p.waitForFunction(() => window.__lab && window.__lab.startPlaying && window.__lab.room && window.__lab.room.connected, null, { timeout: 30000 }).catch(() => {});
  const lenText = await p.evaluate(() => (document.getElementById('len') || {}).textContent || '');
  if (run === 0) ok('watching under the name box, the page shows no lab wording', !/watching bot|tap for the next/.test(lenText), JSON.stringify(lenText));
  await p.fill('#nameBox', 'quick ' + run);
  /* Timed in the page from the tap to your manta first swimming: the room has seated you, and your drawn leader moves. */
  const r = await p.evaluate(() => new Promise(res0x => { let res = res0x; const btn = document.getElementById('playBtn'), url = location.href, R = window.__lab.room, S = window.__sim;
    let t0 = 0, x0 = null, nf = 0; const tick = () => { nf++; if (R.me && R.id >= 0 && S.you && !(S.you.dead > 0)) { if (x0 === null) x0 = [S.you.x, S.you.z]; else if (Math.hypot(S.you.x - x0[0], S.you.z - x0[1]) > 0.5) return res({ ms: performance.now() - t0, fps: Math.round(nf / ((performance.now() - t0) / 1000)), same: location.href === url, name: S.youName(), panel: !document.getElementById('namePanel').hidden }); }
      if (performance.now() - t0 > 8000) return res({ ms: null }); requestAnimationFrame(tick); };
    let seated = null; const iv = setInterval(() => { if (seated === null && R.me && R.id >= 0) { seated = performance.now() - t0; clearInterval(iv); } }, 1);
    const res0 = res; res = v => { clearInterval(iv); res0(Object.assign(v, { seated })); };
    t0 = performance.now(); btn.click(); requestAnimationFrame(tick); }));
  times.push(r.ms); seats.push(r.seated); fps.push(r.fps); if (run === 0) ok('one tap on Play swims in place: no reload, the box gone, the typed name', r.ms !== null && r.same && !r.panel && r.name === 'quick 0', JSON.stringify(r));
  if (run === 2) {
    const after = await p.evaluate(() => (document.getElementById('len') || {}).textContent || '');
    ok('playing, the length line is the length again', /^length \d+/.test(after), JSON.stringify(after));
  }
  await p.close();
}
times.sort((x, y) => x - y);
seats.sort((x, y) => x - y);
ok('tap on Play to seated in the room (what a phone then shows on its next frame), through a 20 ms link: under 300 ms', seats.every(t => t !== null) && seats[seats.length >> 1] < 300, 'seated ' + JSON.stringify(seats.map(t => t && Math.round(t))) + ' ms; to the drawn manta moving ' + JSON.stringify(times.map(t => t && Math.round(t))) + ' ms at ' + JSON.stringify(fps) + ' frames a second here (headless)');
/* Landscape with the keyboard up: the board and the stats line apart. */
const p = await (await b.newContext({ viewport: { width: 915, height: 190 }, deviceScaleFactor: 1, hasTouch: true })).newPage();
await p.goto(O + '/lab/manta/play/?backend=webgl2&tier=low', { waitUntil: 'load' });
await p.waitForFunction(() => window.__lab && window.__lab.room && window.__lab.room.connected, null, { timeout: 30000 }).catch(() => {});
await new Promise(r => setTimeout(r, 1200));
const ov = await p.evaluate(() => { const vis = e => e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0, b = document.getElementById('board'), s = document.getElementById('stats');
  const rb = b.getBoundingClientRect(), rs = s.getBoundingClientRect(); const overlap = vis(b) && vis(s) && !(rb.bottom <= rs.top || rs.bottom <= rb.top || rb.right <= rs.left || rs.right <= rb.left);
  return { boardShown: vis(b), overlap, box: document.getElementById('nameBox').getBoundingClientRect().bottom <= innerHeight, play: document.getElementById('playBtn').getBoundingClientRect().bottom <= innerHeight }; });
await p.screenshot({ path: SHOTS + '/namepanel-915x190-3k.png' });
ok('landscape with the keyboard up: the board and the stats line do not overlap; the box and Play on screen', !ov.overlap && ov.box && ov.play, JSON.stringify(ov));
ok('no page errors', errs.length === 0, JSON.stringify(errs.slice(0, 2)));
await b.close(); clearTimeout(die); process.exit(bad ? 1 : 0);
