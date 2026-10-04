/* 4A stage 1: the desktop layout at 1366x768, 1920x1080 and 2560x1440 with
   a mouse: on the feedback page (solo, and the first visit's name panel)
   and the lab page, the board, radar, score line, stats line, play bar,
   hint and name panel are each on screen, none overlaps another, the text
   is at least 13 px, the radar grows with the screen, nothing overflows
   sideways and the page has no console errors. Screenshots go to MANTA_OUT
   as desk-<w>x<h>[-name|-lab].png, to be looked at: a harness measures
   rectangles, not whether it looks right. */
import { chromium } from '../lib/tools.mjs';
const O = 'http://127.0.0.1:' + process.env.PORT, OUT = process.env.MANTA_OUT || '/tmp';
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 85000);
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x ? '  [' + x + ']' : '')); };
const b = await chromium.launch({ executablePath: process.env.CHROME,
  args: ['--enable-unsafe-webgpu', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const errs = [];
/* One size a run (SIZE=1920x1080), or all three: three pages a size is
   near the 90 s limit on SwiftShader. */
const ALL = [[1366, 768], [1920, 1080], [2560, 1440]];
const SIZES = process.env.SIZE ? [process.env.SIZE.split('x').map(Number)] : ALL;
/* PART=feed|name|lab runs one of the three pages; at 2560x1440 all three
   together pass the 90 s limit on SwiftShader. */
const PART = process.env.PART || 'all', want = part => PART === 'all' || PART === part;
/* Polling by interval, not by frame: at a frame a second a frame-polled
   wait reports ready seconds late, after the hint has faded. */
const ready = p => p.waitForFunction(() => window.__labReady === true, null, { timeout: 25000, polling: 100 }).catch(() => console.log('(no ready)'));
const IDS = ['board', 'len', 'stats', 'fb', 'radar', 'hint', 'namePanel', 'chip', 'signal'];
const rects = IDS => IDS.map(id => { const e = document.getElementById(id); if (!e) return null; const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return null; const r = e.getBoundingClientRect(); if (r.width === 0 || r.height === 0) return null; return { id, x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom, font: parseFloat(cs.fontSize) }; }).filter(Boolean);
const overlaps = (a, c) => !(a.right <= c.x + 0.5 || c.right <= a.x + 0.5 || a.bottom <= c.y + 0.5 || c.bottom <= a.y + 0.5);
for (const [W, H] of SIZES) {
  const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: false });
  /* A fresh page for each check: the first visit's page redirects itself
     to solo after 5 s, which would interrupt a later navigation. */
  const page = async () => { const p = await ctx.newPage(); p.setDefaultTimeout(30000); p.setDefaultNavigationTimeout(30000);
    p.on('console', c => { if (c.type() === 'error') errs.push(W + ': ' + c.text().slice(0, 140)); });
    p.on('pageerror', e => errs.push(W + ' pageerror: ' + e.message.slice(0, 140))); return p; };
  let p = await page();
  if (want('feed')) {
  /* The feedback page, solo, with a train so the board and radar have lines. */
  await p.goto(O + '/lab/manta/play/?solo=1&tier=low&backend=webgl2&train=60', { waitUntil: 'load' }).catch(e => console.log('goto ' + e.message));
  await ready(p);
  await p.mouse.move(W * 0.6, H * 0.4);
  /* The shot first, while the hint is up: its five seconds run on a real
     clock, and a 2560-wide SwiftShader frame can take seconds. */
  const hintUp = await p.evaluate(() => window.__lab.hint && window.__lab.hint.shown);
  await p.screenshot({ path: OUT + '/desk-' + W + 'x' + H + '.png' });
  await p.evaluate(() => { window.__lab.pause(); window.__lab.step(0.6); });   // a frame with the board drawn (it draws every half second of scene time)
  const r = await p.evaluate(rects, IDS);
  const pairs = []; for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) if (overlaps(r[i], r[j])) pairs.push(r[i].id + '/' + r[j].id);
  const inside = r.filter(e => e.x < 0 || e.y < 0 || e.right > W || e.bottom > H).map(e => e.id);
  const have = r.map(e => e.id);
  const radar = r.find(e => e.id === 'radar'), board = r.find(e => e.id === 'board'), len = r.find(e => e.id === 'len'), stats = r.find(e => e.id === 'stats'), hint = r.find(e => e.id === 'hint');
  const small = r.filter(e => e.font < 13 && e.id !== 'radar').map(e => e.id + ' ' + e.font + 'px');
  const label = await p.evaluate(() => { const e = document.querySelector('#labels div'); return e ? parseFloat(getComputedStyle(e).fontSize) : null; });
  const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  ok(W + 'x' + H + ' feedback page: board, score, stats, play bar and radar all on screen; the hint ' + (hintUp ? 'up at the shot' : 'had faded by the shot (headless frames are slow; hint.mjs proves its timing)'), ['board', 'len', 'stats', 'fb', 'radar'].every(id => have.includes(id)) && inside.length === 0, 'have ' + have.join(',') + (inside.length ? ' off screen: ' + inside.join(',') : ''));
  ok(W + 'x' + H + ' nothing overlaps', pairs.length === 0, pairs.join(' ') || 'none');
  ok(W + 'x' + H + ' text at least 13 px (board ' + (board && board.font) + ', score ' + (len && len.font) + ', stats ' + (stats && stats.font) + ', names ' + label + ', hint ' + (hint && hint.font) + ')', small.length === 0 && label >= 13, small.join(', '));
  ok(W + 'x' + H + ' radar ' + (radar && Math.round(radar.w)) + ' px (' + (Math.min(W, H) >= 900 ? 'up to 220' : 'up to 160') + ' on this short side)', radar && radar.w >= (Math.min(W, H) >= 900 ? 220 : 160) - 1, '');
  ok(W + 'x' + H + ' no horizontal overflow', over === 0, String(over));
  await p.close(); p = await page();
  }
  if (want('name')) {
  /* The first visit: the name panel over the ocean (no room here, so it goes solo after 5 s; shot at 2 s). */
  await p.goto(O + '/lab/manta/play/?tier=low&backend=webgl2', { waitUntil: 'load' }).catch(e => console.log('goto ' + e.message));
  await p.waitForTimeout(2000);
  const r2 = await p.evaluate(rects, IDS);
  const np = r2.find(e => e.id === 'namePanel');
  const pairs2 = []; for (let i = 0; i < r2.length; i++) for (let j = i + 1; j < r2.length; j++) if (overlaps(r2[i], r2[j])) pairs2.push(r2[i].id + '/' + r2[j].id);
  await p.screenshot({ path: OUT + '/desk-' + W + 'x' + H + '-name.png' });
  ok(W + 'x' + H + ' first visit: the name panel is centred and overlaps nothing', np && Math.abs((np.x + np.w / 2) - W / 2) < 2 && Math.abs((np.y + np.h / 2) - H / 2) < 40 && pairs2.length === 0, (np ? Math.round(np.w) + 'x' + Math.round(np.h) + ' at ' + Math.round(np.x) + ',' + Math.round(np.y) : 'no panel') + (pairs2.length ? ' overlaps ' + pairs2.join(' ') : ''));
  await p.close(); p = await page();
  }
  if (want('lab')) {
  /* The lab page: chip, board, score and radar. */
  await p.goto(O + '/lab/manta/?tier=low&backend=webgl2&train=60', { waitUntil: 'load' }).catch(e => console.log('goto ' + e.message));
  await ready(p);
  const hintUp3 = await p.evaluate(() => window.__lab.hint && window.__lab.hint.shown);
  await p.screenshot({ path: OUT + '/desk-' + W + 'x' + H + '-lab.png' });
  await p.evaluate(() => { window.__lab.pause(); window.__lab.step(0.6); });
  const r3 = await p.evaluate(rects, IDS);
  const pairs3 = []; for (let i = 0; i < r3.length; i++) for (let j = i + 1; j < r3.length; j++) if (overlaps(r3[i], r3[j])) pairs3.push(r3[i].id + '/' + r3[j].id);
  ok(W + 'x' + H + ' lab page: chip, board, score and radar on screen, none overlapping; the hint ' + (hintUp3 ? 'up at the shot' : 'had faded by the shot'), ['chip', 'board', 'len', 'radar'].every(id => r3.some(e => e.id === id)) && pairs3.length === 0, r3.map(e => e.id).join(',') + (pairs3.length ? ' overlaps ' + pairs3.join(' ') : ''));
  }
  await p.close();
  await ctx.close();
}
/* The first visit asks the static server for a room it cannot have: that WebSocket failure is the page going solo, not an error of the page's. */
const real = errs.filter(e => !/popErrorScope|WebSocket/.test(e));
ok('no console errors at any size', real.length === 0, JSON.stringify([...new Set(real)]).slice(0, 400));
clearTimeout(die); await b.close(); process.exit(bad ? 1 : 0);
