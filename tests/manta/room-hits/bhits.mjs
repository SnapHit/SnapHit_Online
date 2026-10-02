/* 3K stage 2, in the page: the feedback page in the staged cut room
   (wrangler dev, PORT). The set piece (cut.trigger) is timed against the
   frame your drawn leader first touches the drawn train; and it fires once
   per hit, not again when the room confirms it. MODE=crash | cut. */
import { chromium } from '../lib/tools.mjs';
const O = 'http://127.0.0.1:' + process.env.PORT, MODE = process.env.MODE || 'crash';
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 85000);
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + '[page ' + MODE + '] ' + n + (x ? '  [' + x + ']' : '')); };
const b = await chromium.launch({ executablePath: process.env.CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, hasTouch: true });
await ctx.addInitScript(() => { try { localStorage.setItem('manta:name', 'hit tester'); } catch (_) {} });
const p = await ctx.newPage(); p.setDefaultTimeout(30000); p.setDefaultNavigationTimeout(30000);
const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0, 160)));
const name = Array.from({ length: 8 }, () => 'abcdefghjkmnpqrstuvwxyz23456789'[Math.floor(Math.random() * 31)]).join('');
await p.goto(O + '/lab/manta/play/?room=' + name + '&stage=cut&backend=webgl2&tier=low', { waitUntil: 'load' });
await p.waitForFunction(() => window.__lab && window.__lab.room && window.__lab.room.me && window.__lab.cut, null, { timeout: 30000 }).catch(() => {});
const r = await p.evaluate(async mode => {
  const L = window.__lab, S = window.__sim, R = L.room, P = S.params, k = P.trainScale || 1, trig = [], contacts = [];
  const orig = L.cut.trigger.bind(L.cut); L.cut.trigger = at => { trig.push(performance.now()); return orig(at); };
  let was = false;
  const watch = () => { const you = S.you; let touch = false;
    if (you && !(you.dead > 0)) for (const t of S.rivals) { if (!t || t.hole || t.dead > 0) continue;
      if (Math.hypot(t.x - you.x, t.z - you.z) <= 2 * P.leaderR * k) touch = true;
      for (const f of t.followers) if (Math.hypot(f.x - you.x, f.z - you.z) <= (P.leaderR + P.followerR) * k) touch = true; }
    if (touch && !was) contacts.push(performance.now()); was = touch; };
  /* After the page's own frame: the page's loop was registered first. */
  let on = true; const loop = () => { if (!on) return; watch(); requestAnimationFrame(loop); }; requestAnimationFrame(loop);
  if (mode === 'cut') { const cv = document.querySelector('canvas'), ev = (type, x, y) => cv.dispatchEvent(new PointerEvent(type, { pointerId: 11, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true, buttons: type === 'pointerup' ? 0 : 1 }));
    ev('pointerdown', 206, 300); ev('pointerup', 206, 300); await new Promise(r => setTimeout(r, 80)); ev('pointerdown', 206, 300); }
  await new Promise(r => setTimeout(r, 22000)); on = false;
  return { trig, contacts, stats: S.hitStats };
}, MODE).catch(e => ({ error: e.message }));
if (r.error) ok('ran', false, r.error); else {
  /* Each contact against the first set piece at or after it. */
  const lags = []; for (const c of r.contacts) { const t = r.trig.find(x => x >= c - 30); if (t !== undefined && t - c < 2000) lags.push(Math.max(0, t - c)); }
  const s = r.stats; lags.sort((a, b2) => a - b2);
  ok('the set piece fires on the frame of contact (the page samples after its own frame, so 0 is the same frame)', lags.length >= 2 && lags[Math.floor(0.95 * (lags.length - 1))] <= 17, lags.length + ' contacts, lags ' + JSON.stringify(lags.map(v => Math.round(v))));
  ok('one set piece per hit: triggers = predicted + those the room played unpredicted', r.trig.length === s.predicted + s.unpredicted, r.trig.length + ' triggers; ' + JSON.stringify(s));
  ok('no page errors', errs.length === 0, JSON.stringify(errs.slice(0, 2)));
}
await b.close(); clearTimeout(die); process.exit(bad ? 1 : 0);
