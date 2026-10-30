/* 4A stage 6: the pictures. Each is a seed and a staged moment at 412x915
   on WebGL2 at the high tier, in the game's look. Until 4C the first six
   were pairs against ?look=classic (the end of stage 1), which 4C removed
   with the code only it used; every scene is now a single.
   Pictures, not checks: the only assertion is that every page loaded and
   drew without console errors. SCENES (comma list) picks from first,
   firstswim, cut, crash, giant, radar, pinkflash, catch, sharkcut; default
   all. Output in
   MANTA_OUT/pics. About 25 s a scene under SwiftShader. */
import { chromium } from '../lib/tools.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const O = 'http://127.0.0.1:' + process.env.PORT, OUT = (process.env.MANTA_OUT || '/tmp') + '/pics';
mkdirSync(OUT, { recursive: true });
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 380000 * (+process.env.WATCHDOG_X || 1));
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x ? '  [' + x + ']' : '')); };
const b = await chromium.launch({ executablePath: process.env.CHROME, args: ['--enable-unsafe-webgpu', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const errs = [];
/* A fresh context each time: a first visit, nothing stored. */
async function open (q) {
  const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const p = await ctx.newPage(); p.setDefaultTimeout(150000); p.setDefaultNavigationTimeout(40000);   // 4C: a 300-long train's screenshot at the high tier took 42 s on a 2-core container under SwiftShader (the 40 s limit failed before 4C too)
  p.on('console', c => { if (c.type() === 'error' && !/popErrorScope/.test(c.text())) errs.push(c.text().slice(0, 140)); });
  p.on('pageerror', e => errs.push('pageerror: ' + e.message.slice(0, 140)));
  await p.goto(O + '/lab/manta/?seed=7&paused=1&tier=high&backend=webgl2&' + q, { waitUntil: 'load' }).catch(e => console.log('goto ' + e.message));
  await p.waitForFunction(() => window.__labReady === true && window.__labDrew === true, null, { timeout: 35000, polling: 100 }).catch(() => console.log('(no ready)'));
  await p.waitForTimeout(400);
  return { p, ctx };
}
const steps = (p, n) => p.evaluate(n => { for (let i = 0; i < n; i++) window.__lab.step(1 / 60); }, n);

/* The staged moments. Each returns once the page shows the moment. */
const STAGE = {
  /* The first frame of a first visit: the hint up, nothing else yet (the reveal waits for the first swim, so this frame is the same in both looks). */
  first: async p => { await steps(p, 2); },
  /* The first swim's first frame: the first input starts the reveal (new): a quarter wider, the board hidden, the hint still up. */
  firstswim: async p => { await steps(p, 2); await p.evaluate(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })); window.__lab.step(1 / 60); window.__lab.step(1 / 60); }); },
  /* Your cut at its peak: rival 1 laid 12 long across your bow 150 ahead and cut by you there (as artpass.mjs stages it); the kick and the slash on the cut frame. */
  cut: async p => { await p.evaluate(async () => { const S = window.__sim, you = S.you, r = S.rivals[1]; const fx = -Math.sin(you.head), fz = -Math.cos(you.head);
    const m = await import('/lab/manta/simcore.js'); m.layLong(r, 12, S.params); r.dead = 0;
    const px = you.x + fx * 150, pz = you.z + fz * 150, dx = px - r.x, dz = pz - r.z;
    r.x += dx; r.z += dz; for (const f of r.followers) { f.x += dx; f.z += dz; } for (const q of r.trail) { q.x += dx; q.z += dz; }
    S.cutAt(r, 3, you, px, pz); window.__lab.step(1 / 60); window.__lab.step(1 / 60); }); },
  /* The crash: past the reveal (so the board is up), a 30-long train cut to 10, then the crash, 0.25 s of scene time in (the vignette deepening, the card part way through its count from 10 up to 30). */
  crash: async p => { await steps(p, 90); await p.evaluate(() => { const S = window.__sim; S.cutAt(S.you, 10, S.rivals[0], null, null); for (let i = 0; i < 6; i++) window.__lab.step(1 / 60);
    S.you.dead = 1.5; const t0 = S.time; for (let k = 0; k < 150 && S.time - t0 < 0.25; k++) window.__lab.step(1 / 60); }); },
  /* A giant train far out: 300 long, the zoom eased all the way out. */
  giant: async p => { await steps(p, 240); },
  /* The interface in play: the board, the radar and the rest, a few seconds in. */
  radar: async p => { await steps(p, 120); },
  /* The singles start 80 frames in, as the harnesses do, so the laid train has settled into its colour. The pink manta mid flash: appearing now, 120 ahead, its roll at the belly. */
  pinkflash: async p => { await steps(p, 80); await p.evaluate(() => { const S = window.__sim, you = S.you, fx = -Math.sin(you.head), fz = -Math.cos(you.head);
    S.pink.lastGone = -1e9; window.__lab.step(1 / 60); const pk = S.pink; pk.x = you.x + fx * 120; pk.z = you.z + fz * 120; pk.head = you.head + Math.PI; pk.roll = -1; pk.rollAt = 1e9; window.__lab.step(1 / 60); pk.x = you.x + fx * 120; pk.z = you.z + fz * 120; pk.roll = 0.5; window.__lab.step(0); }); },
  /* A catch: you burst onto it; the pink light burst a tenth of a second in and the ten new followers arriving. */
  catch: async p => { await steps(p, 80); await p.evaluate(() => { const S = window.__sim, you = S.you, L = window.__lab;
    S.pink.lastGone = -1e9; L.step(1 / 60); S.pink.roll = -1; S.pink.x = you.x; S.pink.z = you.z;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })); L.step(1 / 60); L.step(1 / 60);
    window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true })); for (let i = 0; i < 5; i++) L.step(1 / 60); }); },
  /* The whale shark set across your train 150 behind your leader (as shark.mjs stages it), eight frames after the cut: the body on screen, the freed followers scattering. */
  sharkcut: async p => { await steps(p, 80); await p.evaluate(async () => { const m = await import('/lab/manta/params.js'); m.setParam('sharkOn', 1); const S = window.__sim, you = S.you, L = window.__lab;
    S.shark.lastGone = -1e9; L.step(1 / 60); const sh = S.shark; const fx = -Math.sin(you.head), fz = -Math.cos(you.head), px = you.x - fx * 150, pz = you.z - fz * 150;
    sh.head = you.head + Math.PI / 2; const sx = -Math.sin(sh.head), sz = -Math.cos(sh.head);
    sh.x = px + sx * 40; sh.z = pz + sz * 40; sh.turn = 0;
    for (let k = 0; k < 30; k++) { L.step(1 / 60); if (S.you.dead > 0 || S.shark.cuts > 0) break; } for (let i = 0; i < 8; i++) L.step(1 / 60); }); },
};
const SCENES = { first: 'train=0', firstswim: 'train=0', cut: 'train=30&hint=0', crash: 'train=30&hint=0', giant: 'train=300&hint=0', radar: 'train=40&hint=0' };
/* The pink scenes without bots (as pink.mjs stages them): its appearance needs a spot clear of every leader by 800, which ten bots' leaders in a 2000 arena rarely leave, and its appearance is what the scene wants to show, not the spot. */
const SINGLES = Object.assign(SCENES, { pinkflash: 'train=20&hint=0&bots=0', catch: 'train=20&hint=0&bots=0', sharkcut: 'train=40&hint=0' });
const WANT = (process.env.SCENES || Object.keys(SINGLES).join(',')).split(',');

/* A frame drawn after an animation-frame yield: a thing shown for the first time (the shark's mesh, the pink manta's slot) is not drawn by a step driven inside one evaluate until the page has yielded once; measured: body luminance 47 (water 33) without the yield, 7 with it. The game's own loop yields every frame, so this is the harness's concern only. */
const settle = p => p.evaluate(() => new Promise(r => requestAnimationFrame(() => { window.__lab.step(1 / 60); r(); })));
async function shot (q, key) {
  const { p, ctx } = await open(q);
  await STAGE[key](p);
  await settle(p);
  const t0 = Date.now(); const png = await p.screenshot(); console.log('  (' + key + ': screenshot ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
  const info = await p.evaluate(() => ({ t: window.__sim.time, len: window.__sim.you.followers.length, zoom: window.__lab.zoomDrawn ? window.__lab.zoomDrawn() : null }));
  await ctx.close();
  return { png, info };
}
for (const key of WANT) {
  if (SINGLES[key]) {
    const n = await shot(SINGLES[key], key);
    writeFileSync(OUT + '/' + key + '.png', n.png);
    console.log('  ' + key + ': at ' + n.info.t.toFixed(2) + ' s, length ' + n.info.len + ' -> ' + key + '.png');
  } else console.log('  unknown scene ' + key);
}
ok('every page loaded and drew without console errors (' + WANT.length + ' scenes)', errs.length === 0, JSON.stringify([...new Set(errs)]).slice(0, 300));
clearTimeout(die); await b.close(); process.exit(bad ? 1 : 0);
