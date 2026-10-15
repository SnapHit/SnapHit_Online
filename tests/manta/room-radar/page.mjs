/* 3L stage 2: the radar on the feedback page under wrangler dev (PORT). */
import { chromium } from '../lib/tools.mjs';
const O = 'http://127.0.0.1:' + process.env.PORT, SP = (process.env.MANTA_OUT || '/tmp') || '/tmp';
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 88000);
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + '[page] ' + n + (x ? '  [' + x + ']' : '')); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await chromium.launch({ executablePath: process.env.CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const off = [], errs = [];
for (const [first, tag] of [[false, 'play'], [true, 'first']]) {
  const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, hasTouch: true });
  if (!first) await ctx.addInitScript(() => { try { localStorage.setItem('manta:name', 'radar tester'); } catch (_) {} });
  const p = await ctx.newPage(); p.setDefaultTimeout(30000); p.setDefaultNavigationTimeout(30000);
  p.on('pageerror', e => errs.push(e.message.slice(0, 160)));
  p.on('request', r => { const u = r.url(); if (!u.startsWith(O) && !u.startsWith(O.replace('http', 'ws')) && !/^(data|about|blob):/.test(u)) off.push(u); });
  await p.goto(O + '/lab/manta/play/?backend=webgl2&tier=low', { waitUntil: 'load' });
  await p.waitForFunction(() => window.__lab && window.__lab.room && window.__lab.room.connected && window.__radar && window.__radar.last, null, { timeout: 30000 }).catch(() => {});
  await wait(2500);
  /* 4B: the radar maps the room's whole arena onto its disc. A room's
     arena is 2760 (solo 2000): the disc's radius in px is the arena's
     radius times the drawing scale, and no train is drawn outside it. */
  const fit = await p.evaluate(() => { const L = window.__radar && window.__radar.last, M = window.__radar && window.__radar.model, A = window.__sim && window.__sim.params && window.__sim.params.arenaR;
    if (!L || !M || !A) return null; let worst = 0, n = 0;
    for (const t of M.trains.values()) if (t.alive) { n++; worst = Math.max(worst, Math.hypot(t.x, t.z) * L.scale); }
    return { arenaR: A, disc: +(L.centre - 1.5).toFixed(2), mapped: +(L.scale * A).toFixed(2), furthest: +worst.toFixed(2), trains: n }; });
  ok(tag + ': the radar maps the room\'s whole arena (radius 2760) onto its disc, and every train is inside it', !!fit && fit.arenaR === 2760 && Math.abs(fit.mapped - fit.disc) < 0.05 && fit.trains >= 10 && fit.furthest <= fit.disc + 0.5, JSON.stringify(fit));
  for (const [w, h, name] of [[412, 915, 'portrait'], [915, 412, 'landscape'], [915, 190, 'landscape-keyboard']]) {
    await p.setViewportSize({ width: w, height: h }); await wait(1500);
    const r = await p.evaluate(() => { const vis = e => e && getComputedStyle(e).display !== 'none' && !e.hidden && e.getBoundingClientRect().width > 0;
      const radar = document.getElementById('radar').getBoundingClientRect(), hits = [], hit = q => q.width && !(q.right <= radar.left || radar.right <= q.left || q.bottom <= radar.top || radar.bottom <= q.top);
      for (const id of ['stats', 'len', 'board', 'signal', 'namePanel']) { const e = document.getElementById(id); if (vis(e) && hit(e.getBoundingClientRect())) hits.push(id); }
      for (const e of document.querySelectorAll('#fb > *')) if (vis(e) && hit(e.getBoundingClientRect())) hits.push('fb:' + (e.id || e.className));
      return { size: Math.round(radar.width), inside: radar.left >= 0 && radar.right <= innerWidth && radar.top >= 0 && radar.bottom <= innerHeight, hits, overflow: document.documentElement.scrollWidth - innerWidth, short: Math.min(innerWidth, innerHeight) }; });
    ok(tag + ' ' + name + ': the radar is on screen (' + r.size + ' px on a ' + r.short + ' px short side), overlaps nothing, no horizontal overflow', r.inside && r.hits.length === 0 && r.overflow === 0 && r.size >= 96 && r.size <= 160, JSON.stringify(r));
    if (tag === 'play' || name === 'landscape-keyboard') await p.screenshot({ path: SP + '/radar-' + tag + '-' + w + 'x' + h + '.png' });
  }
  await p.close();
}
ok('zero off-origin requests, no page errors', off.length === 0 && errs.length === 0, JSON.stringify([off.slice(0, 2), errs.slice(0, 3)]));
await b.close(); clearTimeout(die); process.exit(bad ? 1 : 0);
