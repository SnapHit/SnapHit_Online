/* 4D part 5: two fixes found reviewing 4C.
   1. The controls hint on a narrow screen without touch (the mouse-and-keys
      line) was cut off at the right edge at 412 px. Now it wraps in
      balanced lines: at 320, 360, 412, 600, 800 and 1366 px wide with a
      mouse, and 360 and 412 as a phone, the whole hint is on screen, its
      text unclipped, and on one line wherever one line fits.
   2. In solo fallback the note "The room could not be reached within 5
      seconds, so this is solo." overlapped the top of the board on a
      412x915 phone. Now the board starts under the play bar's last row:
      at 412x915, 360x800, 320x640, 915x412 and 1366x768 with the note up
      (and with the full and resting notes), nothing on screen overlaps:
      the bar's buttons and note, the board, the radar, the score and
      stats lines and the sound pill. Screenshots fixes-*.png.
   Run with lib/serve.sh. */
import { chromium } from '../lib/tools.mjs';
const O = 'http://127.0.0.1:' + process.env.PORT, X = +process.env.WATCHDOG_X || 1, OUT = process.env.MANTA_OUT || '/tmp';
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 170000 * X);
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
  return p;
}
/* 1. The hint. */
for (const [w, h, touch] of [[320, 640, false], [360, 800, false], [412, 915, false], [600, 900, false], [800, 450, false], [1366, 768, false], [360, 800, true], [412, 915, true]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch });
  const p = await open(ctx, '/lab/manta/play/?solo=1&tier=low&backend=webgl2&fx=off&paused=1');
  const r = await p.evaluate(() => { const e = document.getElementById('hint'); if (!e) return null; const q = e.getBoundingClientRect(), cs = getComputedStyle(e);
    const lines = Math.round(q.height / parseFloat(cs.lineHeight || 19.5) - 0.6);
    /* Would one line fit? The text's own width, measured on one line. */
    const m = document.createElement('span'); m.style.cssText = 'position:fixed;visibility:hidden;white-space:nowrap;font:' + cs.font + ';letter-spacing:' + cs.letterSpacing; m.textContent = e.textContent; document.body.appendChild(m);
    const one = m.getBoundingClientRect().width + 32 + 2; m.remove();
    return { x: q.x, right: q.right, w: q.width, h: q.height, text: e.textContent, clipX: e.scrollWidth - e.clientWidth, shown: cs.display !== 'none', one: Math.round(one), lines: Math.max(1, Math.round((q.height - 18) / 19.5)) }; });
  const tag = w + 'x' + h + (touch ? ' phone' : ' mouse');
  if (w === 412 && !touch) await p.screenshot({ path: OUT + '/fixes-hint-412x915-mouse.png' });
  const fits = r && r.one <= w - 32;
  ok(tag + ': the hint whole on screen and unclipped (' + (r ? r.lines + ' line' + (r.lines > 1 ? 's' : '') : 'none') + '), on one line where one fits', !!r && r.shown && r.x >= 0 && r.right <= w + 0.5 && r.clipX <= 0 && (!fits || r.lines === 1) && (touch ? /^Hold/.test(r.text) : /^Mouse/.test(r.text)), JSON.stringify(r));
  await ctx.close();
}
/* 2. The solo notes and the board. */
const IDS = ['friends', 'online', 'privacyLink', 'fbOpen', 'noteRow', 'board', 'radar', 'len', 'stats', 'sound'];
for (const [w, h, touch, note] of [[412, 915, true, 'slow'], [360, 800, true, 'slow'], [320, 640, true, 'slow'], [915, 412, true, 'slow'], [1366, 768, false, 'slow'], [412, 915, true, 'full'], [360, 800, true, 'rest']]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch });
  const p = await open(ctx, '/lab/manta/play/?solo=1&tier=low&backend=webgl2&fx=off&hint=0&bots=20&note=' + note + (note === 'rest' ? '&until=' + (Date.now() + 3600000) : ''));
  /* Past the first swim's reveal (the board waits 1.2 s), with a full board. */
  await p.evaluate(() => { const L = window.__lab; L.pause(); for (let i = 0; i < 12; i++) L.step(0.2); });
  await p.waitForTimeout(300);
  const r = await p.evaluate(ids => { const out = {};
    for (const id of ids) { const e = document.getElementById(id); if (!e) continue; const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || e.hidden) continue;
      let q = e.getBoundingClientRect();
      if (id === 'noteRow') { const n = document.getElementById('note'); q = n.getBoundingClientRect(); }
      if (q.width && q.height) out[id] = { x: q.x, y: q.y, right: q.right, bottom: q.bottom }; }
    return { out, note: document.getElementById('note').textContent, W: innerWidth, H: innerHeight }; }, IDS);
  const over = [], keys = Object.keys(r.out);
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) { const a = r.out[keys[i]], c = r.out[keys[j]]; if (!(a.right <= c.x + 0.5 || c.right <= a.x + 0.5 || a.bottom <= c.y + 0.5 || c.bottom <= a.y + 0.5)) over.push(keys[i] + '/' + keys[j]); }
  const off = keys.filter(k => { const q = r.out[k]; return q.x < -0.5 || q.y < -0.5 || q.right > r.W + 0.5 || q.bottom > r.H + 0.5; });
  const tag = w + 'x' + h + ' ' + note;
  await p.screenshot({ path: OUT + '/fixes-note-' + w + 'x' + h + '-' + note + '.png' });
  ok(tag + ': the note is up ("' + r.note.slice(0, 40) + '...") and nothing overlaps or leaves the screen (' + keys.join(', ') + ')', !!r.out.noteRow && !!r.out.board && over.length === 0 && off.length === 0, (over.join(' ') || 'no overlap') + (off.length ? ', off screen ' + off.join(' ') : ''));
  await ctx.close();
}
const real = errs.filter(e => !/status of 501/.test(e));
ok('no console errors', real.length === 0, JSON.stringify(real.slice(0, 3)));
clearTimeout(die); await b.close();
console.log(bad ? 'FAILED ' + bad : 'ALL PASS');
process.exit(bad ? 1 : 0);
