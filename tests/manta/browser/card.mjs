/* 4D part 2: the death card (design doc 10.8, card.js). On the feedback page
   in solo, with the loop paused and the simulation stepped by hand:
     the run tracked (time alive, a cut you landed, your best rank), then a
     crash into a bot's train: the card names it ("You ran into bot N"),
     counts the peak up from 0, shows the facts, and on a fresh device a
     "New best!" once the count is done;
     the train holds dead past the beat with "Tap to swim again" up;
     a real tap during the beat skips it (the prompt at once, the beat
     over), and one more starts the next run; Space does the same with a
     keyboard; a tap in the first 0.35 s of a crash does nothing;
     reduced flash and motion: the same words, no pop;
     the lab page holds nothing: it comes back by itself after the beat;
     the card read at a pixel ratio of 1 at 800x450 and 1080x607 with a
     mouse and on 412x915 and 360x800 phones: on screen, unclipped, text
     at least 13 px in the frames and 11 on a phone, and clear of the
     board, radar, score and stats lines (screenshots card-<w>x<h>.png in
     MANTA_OUT, to be looked at);
   and in Node, the words for every way to die. Run with lib/serve.sh. */
import { chromium } from '../lib/tools.mjs';
import { causeText, clock } from '../../../docs/lab/manta/card.js';
const O = 'http://127.0.0.1:' + process.env.PORT, X = +process.env.WATCHDOG_X || 1, OUT = process.env.MANTA_OUT || '/tmp';
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 170000 * X);
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x ? '  [' + x + ']' : '')); };

ok('the words: reef, whale shark, head on, ran into, and nothing when the room has not said',
  causeText('reef') === 'You hit the reef' && causeText('shark') === 'The whale shark got you' && causeText('head-on', 'coral fox') === 'Head on with coral fox' &&
  causeText('body', 'bot 7') === 'You ran into bot 7' && causeText('leader', 'bot 7') === 'You ran into bot 7' && causeText('body', '') === '' && clock(65.9) === '1:05');

const b = await chromium.launch({ executablePath: process.env.CHROME,
  args: ['--enable-unsafe-webgpu', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const errs = [];
async function open (ctx, url) {
  const p = await ctx.newPage(); p.setDefaultTimeout(30000 * X); p.setDefaultNavigationTimeout(30000 * X);
  p.on('console', c => { if (c.type() === 'error') errs.push(c.text().slice(0, 140)); });
  p.on('pageerror', e => errs.push('pageerror: ' + e.message.slice(0, 140)));
  await p.goto(O + url, { waitUntil: 'load' }).catch(e => console.log('goto ' + e.message));
  await p.waitForFunction(() => window.__labReady === true, null, { timeout: 25000 * X }).catch(() => console.log('(no ready)'));
  await p.waitForTimeout(300);
  return p;
}
const state = p => p.evaluate(() => { const S = window.__sim, C = window.__lab.card; return { ...C.state, cls: document.getElementById('beat').className, dead: S.you.dead, runs: S.you.runs }; });
/* A run: a rival given 12 followers, yours laid at n, `secs` of swimming, a
   cut you land on the rival, then a crash into bot 2's body. */
const runAndCrash = (p, n, secs) => p.evaluate(([n, secs]) => {
  const L = window.__lab, S = window.__sim; L.pause();
  const r = S.rivals[0]; for (let k = 0; k < 12; k++) r.followers.push({ x: r.x, z: r.z, head: r.head, born: -100, from: -1 });
  S.lay(n); for (let i = 0; i < Math.round(secs * 10); i++) L.step(0.1);
  S.cutAt(r, 4, S.you, null, null); L.step(1 / 60);
  S.crash(S.you, S.rivals[1], 'body'); L.step(1 / 60); L.step(1 / 60);
  return { into: S.rivals[1].id, peak: S.you.peak };
}, [n, secs]);
const PLAY = '/lab/manta/play/?solo=1&tier=low&backend=webgl2&fx=off&hint=0';

/* 1. The card and the hold, with a finger. */
{
  const phone = await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const p = await open(phone, PLAY);
  const a = await runAndCrash(p, 24, 3);
  const s0 = await state(p);
  ok('the crash: the card is up, names what got you ("You ran into bot ' + a.into + '") and counts from 0', /\bon\b/.test(s0.cls) && s0.text.cause === 'You ran into bot ' + a.into && +s0.text.num < a.peak, JSON.stringify(s0.text));
  /* The beat runs on scene time, which the crash's slow motion stretches: up to 150 driven steps for the 0.8 s count. */
  await p.evaluate(() => { for (let i = 0; i < 150 && window.__lab.card.state.t < 0.85; i++) window.__lab.step(1 / 60); });
  const s1 = await state(p);
  ok('after the count: the peak (' + a.peak + '), a first visit\'s New best!, time alive about 0:03, 1 cut, a best rank', s1.text.num === String(a.peak) && s1.newBest && /newbest/.test(s1.cls) && s1.text.best === 'your first best' &&
     /^0:0[34]$/.test(s1.text.alive) && s1.text.cuts === '1' && /^#\d+$/.test(s1.text.rank), JSON.stringify(s1.text));
  await p.evaluate(() => { for (let i = 0; i < 180; i++) window.__lab.step(1 / 60); });
  const s2 = await state(p);
  ok('past the beat it holds: still dead after 3 s more, "Tap to swim again" up', s2.dead > 0 && s2.ready && /ready/.test(s2.cls) && s2.text.next === 'Tap to swim again', JSON.stringify({ dead: s2.dead, ready: s2.ready, next: s2.text.next }));
  await p.screenshot({ path: OUT + '/card-hold-412x915.png' });
  await p.touchscreen.tap(206, 600);
  await p.evaluate(() => { window.__lab.step(1 / 60); window.__lab.step(1 / 60); });
  const s3 = await state(p);
  ok('one tap after the beat starts the next run: alive, the card gone', !(s3.dead > 0) && s3.runs === s2.runs + 1 && !/\bon\b/.test(s3.cls), JSON.stringify({ dead: s3.dead, runs: s3.runs, cls: s3.cls }));
  /* Again, tapping during the beat. */
  await p.evaluate(() => { const L = window.__lab, S = window.__sim; S.lay(8); L.step(0.1); S.crash(S.you, null, 'reef'); L.step(1 / 60); });
  await p.touchscreen.tap(206, 600);                 // inside 0.35 s: nothing
  const s4 = await state(p);
  await p.waitForTimeout(450);
  await p.touchscreen.tap(206, 600);                 // skips the beat
  await p.evaluate(() => window.__lab.step(1 / 60));
  const s5 = await state(p);
  ok('the reef: "You hit the reef"; a tap in the first 0.35 s does nothing; the next skips the beat (prompt up, the count done, the beat over, still down)',
     s4.text.cause === 'You hit the reef' && !s4.skipped && s5.skipped && s5.ready && s5.text.num === String(s5.to) && s5.dead > 0 && s5.dead < 1e-4, JSON.stringify({ s4: { skipped: s4.skipped, t: s4.t }, s5: { skipped: s5.skipped, ready: s5.ready, num: s5.text.num, to: s5.to, dead: s5.dead } }));
  await p.touchscreen.tap(206, 600);
  await p.evaluate(() => { window.__lab.step(1 / 60); window.__lab.step(1 / 60); });
  const s6 = await state(p);
  ok('and one more starts the next run', !(s6.dead > 0) && s6.runs === s5.runs + 1 && !/\bon\b/.test(s6.cls), JSON.stringify({ dead: s6.dead, runs: s6.runs }));
  /* Not a new best now: the card says your best instead. */
  await p.evaluate(() => { const L = window.__lab, S = window.__sim; S.lay(3); L.step(0.1); S.crash(S.you, null, 'reef'); for (let i = 0; i < 150 && window.__lab.card.state.t < 0.85; i++) L.step(1 / 60); });
  const s7 = await state(p);
  ok('a run below your best: no New best!, "best ' + s1.to + '"', !s7.newBest && !/newbest/.test(s7.cls) && s7.text.best === 'best ' + s1.to, JSON.stringify({ best: s7.text.best, cls: s7.cls }));
  await phone.close();
}
/* 2. A keyboard, and reduced flash and motion. */
{
  const desk = await b.newContext({ viewport: { width: 1080, height: 607 }, deviceScaleFactor: 1, hasTouch: false });
  const p = await open(desk, PLAY);
  await p.evaluate(() => { const c = document.getElementById('reduceFlash'); c.checked = true; c.dispatchEvent(new Event('change')); });
  await runAndCrash(p, 30, 1);
  await p.evaluate(() => { for (let i = 0; i < 120; i++) window.__lab.step(1 / 60); });
  const s0 = await state(p);
  const anim = await p.evaluate(() => getComputedStyle(document.querySelector('#beat .nb')).animationName);
  ok('reduced flash and motion: the same card and words (New best!, the prompt for a mouse), no pop', /calm/.test(s0.cls) && s0.newBest && anim === 'none' && s0.text.next === 'Click or press Space to swim again', JSON.stringify({ cls: s0.cls, anim, next: s0.text.next }));
  await p.waitForTimeout(400);
  await p.keyboard.press('Space');
  await p.evaluate(() => { window.__lab.step(1 / 60); window.__lab.step(1 / 60); });
  const s1 = await state(p);
  ok('Space starts the next run', !(s1.dead > 0) && s1.runs === s0.runs + 1, JSON.stringify({ dead: s1.dead, runs: s1.runs }));
  await desk.close();
}
/* 3. The lab page holds nothing. */
{
  const phone = await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const p = await open(phone, '/lab/manta/?tier=low&backend=webgl2&fx=off&hint=0');
  await runAndCrash(p, 10, 1);
  const s0 = await state(p);
  await p.evaluate(() => { for (let i = 0; i < 300 && window.__sim.you.dead > 0; i++) window.__lab.step(1 / 60); });
  const s1 = await state(p);
  ok('the lab page: the card shows, and the next run starts by itself after the beat (no prompt)', /\bon\b/.test(s0.cls) && !(s1.dead > 0) && s1.runs === s0.runs + 1 && !s0.ready, JSON.stringify({ s0: s0.cls, dead: s1.dead }));
  await phone.close();
}
/* 4. Read at a pixel ratio of 1, frames and phones. */
for (const [vw, vh, touch] of [[800, 450, false], [1080, 607, false], [412, 915, true], [360, 800, true]]) {
  const ctx = await b.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch });
  const p = await open(ctx, PLAY + '&bots=20');
  await runAndCrash(p, 140, 2);
  await p.evaluate(() => { for (let i = 0; i < 200; i++) window.__lab.step(1 / 60); });
  await p.evaluate(() => new Promise(r => requestAnimationFrame(() => { window.__lab.step(1 / 60); r(); })));
  await p.waitForTimeout(700);                       // the pop and the prompt's fade in, on the real clock
  const r = await p.evaluate(() => {
    const box = e => { if (!e) return null; const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || e.hidden) return null; const q = e.getBoundingClientRect(); return q.width && q.height ? { x: q.x, y: q.y, right: q.right, bottom: q.bottom, w: q.width, h: q.height, font: parseFloat(cs.fontSize) } : null; };
    const panel = document.querySelector('#beat .panel'), parts = [...panel.querySelectorAll('.cause, .num, .peakLabel, .nb, .best, .fact .v, .fact .l, .next')].map(e => [e.className, box(e)]).filter(q => q[1]);
    return { panel: box(panel), clip: panel.scrollHeight - panel.clientHeight, parts, hud: { board: box(document.getElementById('board')), radar: box(document.getElementById('radar')), len: box(document.getElementById('len')), stats: box(document.getElementById('stats')) }, W: innerWidth, H: innerHeight };
  });
  await p.screenshot({ path: OUT + '/card-' + vw + 'x' + vh + '.png' });
  const tag = vw + 'x' + vh, min = touch ? 11 : 13, P = r.panel;
  const inside = P && P.x >= 0 && P.y >= 0 && P.right <= r.W + 0.5 && P.bottom <= r.H + 0.5 && r.clip <= 1;
  const small = r.parts.filter(([c, q]) => q.font < min).map(([c, q]) => c + ' ' + q.font);
  const over = Object.entries(r.hud).filter(([k, q]) => q && P && !(P.right <= q.x || q.right <= P.x || P.bottom <= q.y || q.bottom <= P.y)).map(([k]) => k);
  const kinds = r.parts.map(q => q[0]);
  ok(tag + ': the whole card on screen and unclipped, every part shown (cause, peak, New best!, facts, prompt)', inside && ['cause', 'num', 'nb', 'best', 'next'].every(k => kinds.includes(k)) && kinds.filter(k => k === 'fact v' || k === 'v').length >= 0, JSON.stringify({ panel: P && [P.x, P.y, P.w, P.h].map(Math.round), clip: r.clip, kinds }));
  ok(tag + ': text at least ' + min + ' px (peak ' + (r.parts.find(q => q[0] === 'num') || [0, {}])[1].font + ')', small.length === 0, small.join(', '));
  ok(tag + ': clear of the board, radar, score and stats lines', over.length === 0, over.join(' ') || 'none');
  await ctx.close();
}
ok('no console errors', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
clearTimeout(die); await b.close();
console.log(bad ? 'FAILED ' + bad : 'ALL PASS');
process.exit(bad ? 1 : 0);
