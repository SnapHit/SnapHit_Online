/* 4D part 4: sound (design doc 10.8, sound.js; NOTES.md, Sound).

   OFFLINE: each voice rendered through the game's own mix (bus and limiter)
   in an OfflineAudioContext at 48 kHz, mono, and measured here in Node:
   peak (dBFS), loudness (the loudest 400 ms, K-weighted as ITU-R BS.1770,
   in LUFS) and length; the bed over 10 s (integrated, gated). Every voice
   peaks under -1 dBFS, and no event voice is more than 9 LU louder than
   the quietest of them (your cut and crash are meant to be the loudest);
   the bed sits at least 20 LU under the events. A busy 10 s mix (the bed,
   60 events) renders in a measured time: the audio thread's cost.
   LIVE, on the feedback page in solo: no AudioContext before a tap and the
   pill reads SOUND ON, breathing; a tap starts it and the bed; recruits,
   a burst, a cut and a crash each play; the voices are capped at 10 with
   the rest dropped; the pill turns it off (suspended, kept under
   manta:sound as 'off', SOUND OFF, settled); a new visit stays off and
   silent after a tap, and the pill turns it back on; a hidden page is
   suspended and resumed when shown; zero requests off the origin.
   FRAME COST: the same driven run of 600 frames with events, sound on and
   ?sound=0, alternated over three rounds, mean and 95th percentile of a
   frame; and the JS time inside the sound module per frame.
   Run with lib/serve.sh; HARNESS_TIMEOUT=240. Writes sound-levels.json
   to MANTA_OUT. */
import { writeFileSync } from 'node:fs';
import { chromium } from '../lib/tools.mjs';
const O = 'http://127.0.0.1:' + process.env.PORT, X = +process.env.WATCHDOG_X || 1, OUT = process.env.MANTA_OUT || '/tmp';
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 220000 * X);
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x ? '  [' + x + ']' : '')); };
const b = await chromium.launch({ executablePath: process.env.CHROME,
  args: ['--enable-unsafe-webgpu', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const errs = [], reqs = [];
async function open (ctx, url) {
  const p = await ctx.newPage(); p.setDefaultTimeout(30000 * X); p.setDefaultNavigationTimeout(30000 * X);
  p.on('console', c => { if (c.type() === 'error') errs.push(c.text().slice(0, 140)); });
  p.on('pageerror', e => errs.push('pageerror: ' + e.message.slice(0, 140)));
  p.on('request', r => reqs.push(r.url()));
  await p.goto(O + url, { waitUntil: 'load' }).catch(e => console.log('goto ' + e.message));
  await p.waitForFunction(() => window.__labReady === true, null, { timeout: 25000 * X }).catch(() => console.log('(no ready)'));
  return p;
}

/* ------------------------------------------------ K-weighted loudness */
const KW = [[1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585],
            [1.0, -2.0, 1.0, -1.99004745483398, 0.99007225036621]];   // 48 kHz, BS.1770
function kweight (x) {
  let y = Float64Array.from(x);
  for (const [b0, b1, b2, a1, a2] of KW) {
    const o = new Float64Array(y.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < y.length; i++) { const v = b0 * y[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = y[i]; y2 = y1; y1 = v; o[i] = v; }
    y = o;
  }
  return y;
}
const lufs = ms => -0.691 + 10 * Math.log10(Math.max(ms, 1e-12));
function measure (x, rate = 48000) {
  let peak = 0; for (const v of x) peak = Math.max(peak, Math.abs(v));
  const k = kweight(x), win = Math.round(0.4 * rate), hop = Math.round(0.1 * rate), blocks = [];
  for (let s = 0; s + win <= Math.max(k.length, win); s += hop) { let e = 0; for (let i = s; i < s + win; i++) e += (k[i] || 0) ** 2; blocks.push(e / win); }
  const momentary = lufs(Math.max(...blocks));
  const abs = blocks.filter(m => lufs(m) > -70), rel = lufs(abs.reduce((a, m) => a + m, 0) / Math.max(1, abs.length)) - 10;
  const gated = abs.filter(m => lufs(m) > rel);
  const integrated = lufs(gated.reduce((a, m) => a + m, 0) / Math.max(1, gated.length));
  return { peak: +(20 * Math.log10(Math.max(peak, 1e-9))).toFixed(1), momentary: +momentary.toFixed(1), integrated: +integrated.toFixed(1) };
}

/* ---------------------------------------------------------- offline */
const desk = await b.newContext({ viewport: { width: 1080, height: 607 }, deviceScaleFactor: 1, hasTouch: false });
const P = await open(desk, '/lab/manta/play/?solo=1&tier=low&backend=webgl2&fx=off&hint=0&paused=1');
const renders = await P.evaluate(async () => {
  const S = await import('/lab/manta/sound.js');
  const one = async (name, fn, secs) => {
    const ac = new OfflineAudioContext(1, Math.round(48000 * secs), 48000), mix = S.makeMix(ac);
    const r = fn(ac, mix.bus, 0.01);
    const buf = await ac.startRendering();
    return { name, dur: r.dur, data: Array.from(buf.getChannelData(0)) };
  };
  const out = [];
  out.push(await one('recruit (length 1)', (ac, o, t) => S.voice.recruit(ac, o, t, 1), 0.8));
  out.push(await one('recruit (length 40)', (ac, o, t) => S.voice.recruit(ac, o, t, 40), 0.8));
  out.push(await one('burst', (ac, o, t) => S.voice.burst(ac, o, t), 0.9));
  out.push(await one('cut, yours', (ac, o, t) => S.voice.cut(ac, o, t, true), 1.4));
  out.push(await one('cut, another\'s', (ac, o, t) => S.voice.cut(ac, o, t, false), 1.4));
  out.push(await one('crash, yours', (ac, o, t) => S.voice.crash(ac, o, t, true), 1.0));
  out.push(await one('crash, another\'s', (ac, o, t) => S.voice.crash(ac, o, t, false), 1.0));
  out.push(await one('pink appears', (ac, o, t) => S.voice.pinkAppear(ac, o, t), 1.0));
  out.push(await one('pink caught', (ac, o, t) => S.voice.pinkCatch(ac, o, t), 1.1));
  out.push(await one('ocean bed', (ac, o, t) => S.voice.bed(ac, o, t, 10), 10.05));
  /* A busy 10 s: the bed and sixty events, the render timed. */
  const ac = new OfflineAudioContext(1, 48000 * 10, 48000), mix = S.makeMix(ac);
  S.voice.bed(ac, mix.bus, 0, 10);
  const kinds = ['recruit', 'recruit', 'recruit', 'burst', 'cut', 'crash', 'pinkCatch'];
  for (let i = 0; i < 60; i++) { const k = kinds[i % kinds.length], t = 0.1 + i * 0.16; S.voice[k](ac, mix.bus, t, k === 'recruit' ? i : true); }
  const t0 = performance.now(); await ac.startRendering(); const busy = performance.now() - t0;
  return { out, busy };
});
const levels = renders.out.map(r => ({ name: r.name, seconds: +r.dur.toFixed(2), ...measure(r.data) }));
writeFileSync(OUT + '/sound-levels.json', JSON.stringify({ levels, busyRenderMs: renders.busy }, null, 1));
for (const l of levels) console.log('   ' + l.name.padEnd(20) + ' peak ' + String(l.peak).padStart(6) + ' dBFS   loudness ' + String(l.name === 'ocean bed' ? l.integrated : l.momentary).padStart(6) + ' LUFS' + (l.name === 'ocean bed' ? ' (integrated over 10 s)' : ' (loudest 400 ms)') + '   ' + l.seconds + ' s');
const ev = levels.filter(l => l.name !== 'ocean bed'), bed = levels.find(l => l.name === 'ocean bed');
const loud = Math.max(...ev.map(l => l.momentary)), quiet = Math.min(...ev.filter(l => !/another/.test(l.name)).map(l => l.momentary));
ok('every voice peaks under -1 dBFS through the mix', levels.every(l => l.peak < -1), levels.map(l => l.peak).join(' '));
ok('no event voice more than 9 LU louder than the quietest of your own (' + (loud - quiet).toFixed(1) + ' LU between ' + quiet + ' and ' + loud + ' LUFS)', loud - quiet <= 9);
ok('the bed is very quiet: ' + bed.integrated + ' LUFS, at least 20 LU under the loudest event', loud - bed.integrated >= 20);
ok('a busy 10 s (the bed, 60 events) renders offline in ' + Math.round(renders.busy) + ' ms (' + (renders.busy / 10000 * 100).toFixed(1) + '% of real time) under SwiftShader\'s CPU', renders.busy < 10000);
await P.close();

/* ------------------------------------------------------------- live */
const PLAY = '/lab/manta/play/?solo=1&tier=low&backend=webgl2&fx=off&hint=0&paused=1';
{
  const p = await open(desk, PLAY);
  const pill = () => p.evaluate(() => { const e = document.getElementById('sound'), S = window.__lab.sound; let k = null; try { k = localStorage.getItem('manta:sound'); } catch (_) { k = 'blocked'; }
    return { text: e && e.textContent, cls: e && e.className, anim: e && getComputedStyle(e).animationName, ctx: S.context ? S.context.state : null, on: S.on, key: k, counts: S.counts, voices: S.voices, dropped: S.dropped }; });
  const a = await pill();
  ok('before any tap: no AudioContext, the pill reads SOUND ON and breathes', a.ctx === null && a.text === 'SOUND ON' && a.anim === 'soundBreathe' && a.key === null, JSON.stringify(a));
  await p.mouse.click(540, 300);
  await p.waitForTimeout(400);
  const c = await pill();
  ok('a tap starts it (the context running), the pill unchanged', c.ctx === 'running', JSON.stringify(c));
  /* The page's controls write sim.input every step: stood aside, so the burst here holds. */
  await p.evaluate(() => { const L = window.__lab, S = window.__sim; L.pause(); if (L.controls) L.controls.apply = () => {};
    for (let i = 0; i < 4; i++) { S.lay(5 + i * 4); L.step(1 / 60); L.step(0.2); }
    S.you.bursting = true; S.input.burst = true; L.step(1 / 60); S.input.burst = false; L.step(0.2);
    const r = S.rivals[0]; for (let k = 0; k < 10; k++) r.followers.push({ x: r.x, z: r.z, head: r.head, born: -100, from: -1 });
    S.cutAt(r, 3, S.you, null, null); L.step(1 / 60); L.step(0.2);
    S.crash(S.you, null, 'reef'); L.step(1 / 60); });
  const d = await pill();
  /* Recruits are throttled to one in 50 ms of the audio clock, and these driven steps run faster than that: one is enough here (the frame-cost run hears many). */
  ok('recruits, a burst, your cut and your crash each play', d.counts.recruit >= 1 && d.counts.burst >= 1 && d.counts.cut >= 1 && d.counts.crash >= 1, JSON.stringify(d.counts));
  /* Every kind as fast as its throttle allows, for a second of real time: far more than ten would sound at once. */
  const cap = await p.evaluate(async () => { const S = window.__lab.sound; let most = 0; const d0 = S.dropped;
    for (let i = 0; i < 60; i++) { S.cut(false); S.crash(false); S.recruit(i); S.burst(); S.pink('appear'); most = Math.max(most, S.voices); await new Promise(r => setTimeout(r, 16)); }
    return { most, dropped: S.dropped - d0 }; });
  ok('the voices are capped at 10, the rest dropped (' + cap.dropped + ' dropped)', cap.most === 10 && cap.dropped > 0, JSON.stringify(cap));
  await p.click('#sound');
  await p.waitForTimeout(300);
  const e = await pill();
  ok('the pill turns it off: suspended, SOUND OFF, settled (no breathing), kept as off', e.text === 'SOUND OFF' && /shy/.test(e.cls) && e.anim === 'none' && e.ctx === 'suspended' && e.key === 'off' && !e.on, JSON.stringify(e));
  await p.close();
  const p2 = await open(desk, PLAY);
  await p2.mouse.click(540, 300); await p2.waitForTimeout(300);
  const f = await p2.evaluate(() => { const e = document.getElementById('sound'), S = window.__lab.sound; return { text: e.textContent, cls: e.className, ctx: S.context ? S.context.state : null }; });
  ok('a new visit stays off: SOUND OFF, settled, and no AudioContext after a tap', f.text === 'SOUND OFF' && /shy/.test(f.cls) && f.ctx === null, JSON.stringify(f));
  await p2.click('#sound'); await p2.waitForTimeout(400);
  const g = await p2.evaluate(() => { const S = window.__lab.sound; let k = null; try { k = localStorage.getItem('manta:sound'); } catch (_) { /* blocked */ } return { on: S.on, ctx: S.context ? S.context.state : null, key: k, text: document.getElementById('sound').textContent }; });
  ok('the pill turns it back on: running, kept as on', g.on && g.ctx === 'running' && g.key === 'on' && g.text === 'SOUND ON', JSON.stringify(g));
  const h = await p2.evaluate(async () => { const S = window.__lab.sound;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange'));
    await new Promise(r => setTimeout(r, 300)); const hidden = S.context.state;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange'));
    await new Promise(r => setTimeout(r, 300)); return { hidden, shown: S.context.state }; });
  ok('hidden, suspended; shown again, running', h.hidden === 'suspended' && h.shown === 'running', JSON.stringify(h));
  await p2.close();
}

/* ------------------------------------------------------- frame cost */
{
  const run = async q => {
    const p = await open(desk, '/lab/manta/play/?solo=1&tier=low&backend=webgl2&hint=0&paused=1' + q);
    await p.mouse.click(540, 300); await p.waitForTimeout(300);
    const r = await p.evaluate(() => { const L = window.__lab, S = window.__sim, so = L.sound; L.pause(); if (L.controls) L.controls.apply = () => {}; const ms = [];
      const c0 = so ? so.cost : { ms: 0, calls: 0 };
      for (let i = 0; i < 600; i++) {
        if (i % 40 === 0) S.lay(10 + (i / 40) * 3);
        S.input.burst = i % 90 < 20;
        if (i % 150 === 75) { const r = S.rivals[0]; for (let k = 0; k < 6; k++) r.followers.push({ x: r.x, z: r.z, head: r.head, born: -100, from: -1 }); S.cutAt(r, 2, S.you, null, null); }
        const t0 = performance.now(); L.step(1 / 60); ms.push(performance.now() - t0);
      }
      const c1 = so ? so.cost : { ms: 0, calls: 0 };
      ms.sort((a, b) => a - b);
      return { mean: ms.reduce((a, v) => a + v, 0) / ms.length, median: ms[Math.floor(ms.length / 2)], p95: ms[Math.floor(ms.length * 0.95)], soundMs: c1.ms - c0.ms, soundCalls: c1.calls - c0.calls, counts: so ? so.counts : null, state: so && so.context ? so.context.state : null }; });
    await p.close();
    return r;
  };
  const on = [], off = [];
  for (let k = 0; k < 3; k++) { on.push(await run('')); off.push(await run('&sound=0')); }
  const avg = (a, f) => a.reduce((s, r) => s + r[f], 0) / a.length;
  const res = { onMean: avg(on, 'mean'), offMean: avg(off, 'mean'), onMedian: avg(on, 'median'), offMedian: avg(off, 'median'), onP95: avg(on, 'p95'), offP95: avg(off, 'p95'), soundMsPerFrame: avg(on, 'soundMs') / 600, calls: on[0].soundCalls, counts: on[0].counts, state: on[0].state };
  writeFileSync(OUT + '/sound-frame.json', JSON.stringify({ res, on, off }, null, 1));
  console.log('   frame (600 driven frames, three rounds each, fx on, low tier, 1080x607, SwiftShader): sound on median ' + res.onMedian.toFixed(2) + ' ms, p95 ' + res.onP95.toFixed(2) + ', mean ' + res.onMean.toFixed(1) + '; ?sound=0 median ' + res.offMedian.toFixed(2) + ' ms, p95 ' + res.offP95.toFixed(2) + ', mean ' + res.offMean.toFixed(1) + ' (the mean is a few long frames: shader compiles); inside sound.js ' + (res.soundMsPerFrame * 1000).toFixed(1) + ' microseconds a frame (' + res.calls + ' calls)');
  ok('the frame cost of sound: inside sound.js under 0.1 ms a frame on average, and the median frame with sound within 10 percent (or 0.3 ms) of the frame without', res.soundMsPerFrame < 0.1 && res.onMedian <= Math.max(res.offMedian * 1.1, res.offMedian + 0.3) && res.state === 'running' && res.counts.burst > 0, JSON.stringify({ counts: res.counts }));
}
const off = reqs.filter(u => !u.startsWith(O) && !u.startsWith('data:'));
ok('zero requests off the origin', off.length === 0, off.slice(0, 3).join(' '));
/* The play counter's beacon when the test fakes a hidden page: python's static server answers a POST with 501 (as desktop.mjs allows). */
const real = errs.filter(e => !/status of 501/.test(e));
ok('no console errors (python\'s 501 to the play counter\'s beacon aside)', real.length === 0, JSON.stringify(real.slice(0, 3)));
clearTimeout(die); await b.close();
console.log(bad ? 'FAILED ' + bad : 'ALL PASS');
process.exit(bad ? 1 : 0);
