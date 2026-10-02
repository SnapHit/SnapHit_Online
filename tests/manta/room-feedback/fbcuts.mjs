/* 3H stage 2: the feedback page's "cuts landed" in the staged room (wrangler
   dev only). Bot 2 cutting your train (?xb=1) counts nothing; your own
   bursts across bot 2 count, one for each cut that names you. */
import { chromium } from '../lib/tools.mjs';
const O = 'http://127.0.0.1:' + process.env.PORT;
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 88000);
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x ? '  [' + x + ']' : '')); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await chromium.launch({ executablePath: process.env.CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
async function run (extra, burst) {
  const p = await (await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, hasTouch: true })).newPage();
  p.setDefaultTimeout(30000); p.setDefaultNavigationTimeout(30000);
  const name = Array.from({ length: 8 }, () => 'abcdefghjkmnpqrstuvwxyz23456789'[Math.floor(Math.random() * 31)]).join('');
  await p.goto(O + '/lab/manta/play/?room=' + name + '&stage=cut' + extra + '&backend=webgl2&tier=low', { waitUntil: 'load' });
  const r = await p.evaluate(async burst => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    for (let k = 0; k < 150 && !(window.__lab && window.__lab.room && window.__lab.room.me && window.__sim.events); k++) await wait(100);
    const S = window.__sim, R = window.__lab.room, seen = []; const push = S.events.push;
    /* Watch what reaches the page, after the page's own hook. */
    const hooked = S.events.push; S.events.push = function () { for (const e of arguments) if (e && e.kind === 'cut') seen.push(e.by); return hooked.apply(this, arguments); };
    const cv = document.querySelector('canvas');
    const ev = (type, x, y) => cv.dispatchEvent(new PointerEvent(type, { pointerId: 11, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true, buttons: type === 'pointerup' ? 0 : 1 }));
    if (burst) { ev('pointerdown', 206, 300); ev('pointerup', 206, 300); await wait(80); ev('pointerdown', 206, 300); }
    await wait(14000);
    if (burst) ev('pointerup', 206, 300);
    await wait(500);
    return { you: S.you.id, room: R.id, seen, stats: document.getElementById('stats').textContent };
  }, burst).catch(e => ({ error: e.message }));
  await p.close();
  return r;
}
const neg = await run('&xb=1', false);
const nCount = neg.stats ? +(neg.stats.match(/cuts landed (\d+)/) || [])[1] : NaN;
ok('bot 2 cutting your train: the page saw its cuts and counted none', !neg.error && neg.seen.filter(v => v === 2).length >= 2 && nCount === 0, JSON.stringify(neg));
const pos = await run('', true);
const pCount = pos.stats ? +(pos.stats.match(/cuts landed (\d+)/) || [])[1] : NaN, mine = pos.seen ? pos.seen.filter(v => v === pos.you).length : -1;
ok('your own bursts across bot 2: the page counts exactly the cuts that name you', !pos.error && pos.you === pos.room && mine >= 1 && pCount === mine, JSON.stringify(pos));
await b.close(); console.log('fbcuts failures: ' + bad); clearTimeout(die); process.exit(bad ? 1 : 0);
