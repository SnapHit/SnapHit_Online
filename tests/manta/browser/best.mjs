/* 4D part 1: your best, kept on the device (design doc 10.8, manta:best).
   On the feedback page in solo (the portal package runs the same page; the
   portal test checks it there): a fresh device shows a best of 0; a run to
   a peak of 37 that crashes writes 37 under manta:best and shows it on the
   death card (from part 2, as "your first best"; "best 37" after a lower
   run); a new visit starts with "best peak 37" on the stats line and
   "best 37" on the score line; a lower run does not lower it; the lab page,
   whose tests lay long trains, never writes it; and with storage blocked
   the page plays and crashes as normal. Run with lib/serve.sh. */
import { chromium } from '../lib/tools.mjs';
const O = 'http://127.0.0.1:' + process.env.PORT, X = +process.env.WATCHDOG_X || 1;
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 85000 * X);
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x ? '  [' + x + ']' : '')); };
const b = await chromium.launch({ executablePath: process.env.CHROME,
  args: ['--enable-unsafe-webgpu', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const errs = [];
async function open (ctx, url) {
  const p = await ctx.newPage(); p.setDefaultTimeout(30000 * X); p.setDefaultNavigationTimeout(30000 * X);
  p.on('console', c => { if (c.type() === 'error') errs.push(c.text().slice(0, 140)); });
  p.on('pageerror', e => errs.push('pageerror: ' + e.message.slice(0, 140)));
  await p.goto(O + url, { waitUntil: 'load' }).catch(e => console.log('goto ' + e.message));
  await p.waitForFunction(() => window.__labReady === true, null, { timeout: 25000 * X }).catch(() => console.log('(no ready)'));
  await p.waitForTimeout(500);
  return p;
}
/* Lay n, step so the page sees it, crash, step into the beat; read back. */
const runTo = (p, n) => p.evaluate(n => {
  const L = window.__lab, S = window.__sim; L.pause();
  S.lay(n); for (let i = 0; i < 4; i++) L.step(1 / 60);
  S.crash(S.you); for (let i = 0; i < 6; i++) L.step(1 / 60);
  let stored = null; try { stored = localStorage.getItem('manta:best'); } catch (_) { stored = 'blocked'; }
  const card = document.getElementById('beat');
  return { stored, card: card.className, best: (card.querySelector('.best') || {}).textContent || null, peak: S.you.peak };
}, n);
let P1 = 37;
const PLAY = '/lab/manta/play/?solo=1&tier=low&backend=webgl2&fx=off&hint=0&paused=1';   // held at its first frame: nothing recruited before the first read
const phone = await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
{
  const p = await open(phone, PLAY);
  const a = await p.evaluate(() => { let s = null; try { s = localStorage.getItem('manta:best'); } catch (_) { s = 'blocked'; } return { s, stats: document.getElementById('stats').textContent }; });
  await p.waitForTimeout(300);
  ok('a fresh device: nothing under manta:best, and the stats line says best peak 0', a.s === null && /best peak 0/.test(a.stats), JSON.stringify(a));
  const r = await runTo(p, 37);
  /* 4D part 2: the card calls a first best "your first best" (card.js), and says "best N" when the run is not a new best. */
  P1 = r.peak;   // 37, or one more if a wild manta joined while it was laid
  ok('a run to 37 that crashes keeps its peak under manta:best, and the death card calls it your first best', P1 >= 37 && P1 <= 40 && r.stored === String(P1) && /\bon\b/.test(r.card) && r.best === 'your first best', JSON.stringify(r));
  await p.close();
}
{
  const p = await open(phone, PLAY);
  await p.waitForTimeout(400);
  const a = await p.evaluate(() => { window.__lab.step(1 / 60); return { stats: document.getElementById('stats').textContent, len: document.getElementById('len').textContent }; });
  ok('a new visit starts with it: "best peak ' + P1 + '" on the stats line, "best ' + P1 + '" on the score line', a.stats.includes('best peak ' + P1 + ' ') && new RegExp('best ' + P1 + '$').test(a.len), JSON.stringify(a));
  const r = await runTo(p, 12);
  ok('a lower run does not lower it (12 crashes, ' + P1 + ' kept, the card says best ' + P1 + ')', r.stored === String(P1) && r.best === 'best ' + P1, JSON.stringify(r));
  await p.close();
}
{
  const p = await open(phone, '/lab/manta/?tier=low&backend=webgl2&fx=off&hint=0');
  const r = await runTo(p, 200);
  ok('the lab page never writes it (a 200 laid there, ' + P1 + ' kept)', r.stored === String(P1), JSON.stringify(r));
  await p.close();
}
{
  const blocked = await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  await blocked.addInitScript(() => { Object.defineProperty(window, 'localStorage', { configurable: true, get () { throw new DOMException('blocked', 'SecurityError'); } }); });
  const before = errs.length;
  const p = await open(blocked, PLAY);
  const r = await runTo(p, 21);
  const drew = await p.evaluate(() => window.__labDrew === true);
  ok('storage blocked: the page draws, plays and crashes as normal, the card shows it as a best for this visit, no page errors', drew && r.stored === 'blocked' && /\bon\b/.test(r.card) && r.best === 'your first best' && errs.length === before, JSON.stringify({ r, errs: errs.slice(before, before + 3) }));
  await blocked.close();
}
ok('no console errors', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
clearTimeout(die); await b.close();
console.log(bad ? 'FAILED ' + bad : 'ALL PASS');
process.exit(bad ? 1 : 0);
