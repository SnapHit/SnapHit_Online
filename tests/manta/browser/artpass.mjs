/* 4A stage 3: the art pass, one block per change, each against ?look=classic
   and reduced flash and motion. Driven through ?paused=1 and __lab.step, so a
   cut lands on a known frame. Screenshots at 412x915 go to MANTA_OUT as
   art-<moment>-<look>.png, to be looked at. CHANGE=1 runs one block. */
import { chromium } from '../lib/tools.mjs';
const O = 'http://127.0.0.1:' + process.env.PORT, OUT = process.env.MANTA_OUT || '/tmp';
const WANT = process.env.CHANGE ? process.env.CHANGE.split(',') : ['1'];
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 85000);
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x ? '  [' + x + ']' : '')); };
const b = await chromium.launch({ executablePath: process.env.CHROME,
  args: ['--enable-unsafe-webgpu', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const errs = [];
async function open (q) {
  const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const p = await ctx.newPage(); p.setDefaultTimeout(30000); p.setDefaultNavigationTimeout(30000);
  p.on('console', c => { if (c.type() === 'error') errs.push(c.text().slice(0, 140)); });
  p.on('pageerror', e => errs.push('pageerror: ' + e.message.slice(0, 140)));
  await p.goto(O + '/lab/manta/?seed=7&paused=1&hint=0&tier=low&backend=webgl2&train=30' + (q ? '&' + q : ''), { waitUntil: 'load' }).catch(e => console.log('goto ' + e.message));
  await p.waitForFunction(() => window.__labReady === true && window.__labDrew === true, null, { timeout: 25000, polling: 100 }).catch(() => console.log('(no ready)'));
  await p.waitForTimeout(400);
  await p.evaluate(() => { for (let i = 0; i < 30; i++) window.__lab.step(1 / 60); });   // half a second in, the train laid and drawn
  return { p, ctx };
}
/* Read the light memory (max of r, g, b over a 3x3 texel patch) at a world point, as zoom.mjs does, decoded: the target is half float and the readback is the bit pattern. */
const memAt = (p, pts) => p.evaluate(async pts => { const L = window.__lab, lm = L.lm; const half = lm.uHalf.value, cx = lm.uCentre.value.x, cz = lm.uCentre.value.y, n = lm.size; const out = [];
  const h2f = h => { const e = (h >> 10) & 0x1f, m = h & 0x3ff, s = h >> 15 ? -1 : 1; return e === 0 ? s * m / 1024 * Math.pow(2, -14) : e === 31 ? Infinity : s * (1 + m / 1024) * Math.pow(2, e - 15); };
  const dec = v => lm.target.texture.type === 1016 ? h2f(v) : v / 255;
  for (const [x, z] of pts) { const u = (x - cx) / (2 * half) + 0.5, v = (z - cz) / (2 * half) + 0.5; const tx = Math.max(1, Math.min(n - 2, Math.round(u * n))); let mx = 0;
    for (const ty of [Math.round(v * n), Math.round((1 - v) * n)]) { const y = Math.max(1, Math.min(n - 2, ty)); const d = await L.renderer.readRenderTargetPixelsAsync(lm.target, tx - 1, y - 1, 3, 3); for (let i = 0; i < d.length; i += 4) mx = Math.max(mx, dec(d[i]), dec(d[i + 1]), dec(d[i + 2])); }
    out.push(mx); } return out; }, pts);

if (WANT.includes('1')) {
  /* Your own cut: rival 0 laid across your bow and cut by you at a known point. */
  /* Rival 1 (rival 0 lays a wake of its own, which would muddy the memory reading) is given a 12-long train and moved to cross your bow 150 units ahead, then cut by you at that point. */
  const cutByYou = async p => p.evaluate(async () => { const S = window.__sim, you = S.you, r = S.rivals[1]; const fx = -Math.sin(you.head), fz = -Math.cos(you.head);
    const m = await import('/lab/manta/simcore.js'); m.layLong(r, 12, S.params); r.dead = 0;
    const px = you.x + fx * 150, pz = you.z + fz * 150, dx = px - r.x, dz = pz - r.z;
    r.x += dx; r.z += dz; for (const f of r.followers) { f.x += dx; f.z += dz; } for (const q of r.trail) { q.x += dx; q.z += dz; }
    S.cutAt(r, 3, you, px, pz);
    window.__lab.step(1 / 60);
    const cam = window.__lab.camera; return { px, pz, fx, fz, head: you.head, offX: cam.position.x - you.x, offZ: cam.position.z - you.z, kick: window.__lab.follower.kick, slashing: window.__lab.follower.slashing, events: S.events.length }; });
  let onNew = 0;
  for (const look of ['new', 'classic', 'reduced']) {
    const { p, ctx } = await open(look === 'classic' ? 'look=classic' : '');
    if (look === 'reduced') await p.evaluate(() => { const c = document.getElementById('reduceFlash'); c.checked = true; c.dispatchEvent(new Event('change')); });
    const r = await cutByYou(p);
    const along = r.offX * r.fx + r.offZ * r.fz, across = Math.abs(-r.offX * r.fz + r.offZ * r.fx);
    const pts = [[r.px - r.fx * 50, r.pz - r.fz * 50], [r.px, r.pz], [r.px + r.fx * 50, r.pz + r.fz * 50]];
    const beside = pts.map(([x, z]) => [x + r.fz * 40, z - r.fx * 40]);
    const mem = await memAt(p, pts.concat(beside)), on = Math.max(...mem.slice(0, 3)), off = Math.max(...mem.slice(3));
    await p.screenshot({ path: OUT + '/art-cut-' + look + '.png' });
    await p.evaluate(() => { for (let i = 0; i < 20; i++) window.__lab.step(1 / 60); });
    await new Promise(res => setTimeout(res, 350));
    const later = await p.evaluate(() => { const cam = window.__lab.camera, you = window.__sim.you; return { off: Math.hypot(cam.position.x - you.x, cam.position.z - you.z), kick: window.__lab.follower.kick, slashing: window.__lab.follower.slashing }; });
    if (look === 'new') {
      ok('new: your cut kicks the camera about 9 units along your heading on the cut frame (' + along.toFixed(1) + ' along, ' + across.toFixed(1) + ' across)', r.events === 0 && along > 6 && along < 10 && across < 1);
      ok('new: the kick is gone within 0.3 s (' + later.off.toFixed(2) + ' units left)', later.off < 0.5 && later.kick === 0);
      ok('new: the slash writes the light memory along the cutter\'s heading: ' + on.toFixed(3) + ' on the line against ' + off.toFixed(3) + ' forty units beside it', on > 2 * Math.max(0.01, off) && r.slashing === true); onNew = on;
    } else if (look === 'classic') {
      ok('classic: no kick (' + Math.hypot(r.offX, r.offZ).toFixed(2) + ' units) and no slash (' + on.toFixed(3) + ' on the line against ' + off.toFixed(3) + ' beside)', Math.hypot(r.offX, r.offZ) < 0.01 && r.kick === 0 && on <= Math.max(0.01, off * 1.2) && r.slashing === false);
    } else {
      ok('reduced flash and motion: no kick (' + Math.hypot(r.offX, r.offZ).toFixed(2) + ' units) and the slash at 30 percent of the full one (' + on.toFixed(3) + ' against ' + onNew.toFixed(3) + ', ratio ' + (on / Math.max(1e-6, onNew)).toFixed(2) + ')', Math.hypot(r.offX, r.offZ) < 0.01 && Math.abs(on / Math.max(1e-6, onNew) - 0.3) < 0.03 && r.slashing === true);
    }
    await ctx.close();
  }
  /* The moment to look at: a rival cuts your train on screen, both looks. */
  for (const look of ['new', 'classic']) {
    const { p, ctx } = await open(look === 'classic' ? 'look=classic' : '');
    await p.evaluate(() => { const S = window.__sim; S.cutAt(S.you, 8, S.rivals[0], null, null); for (let i = 0; i < 6; i++) window.__lab.step(1 / 60); });
    await p.screenshot({ path: OUT + '/art-cutpeak-' + look + '.png' });
    await ctx.close();
  }
}
if (WANT.includes('2')) {
  /* The crash: a 30-long train cut to 10 (peak 30), then the crash, the beat stepped by sixtieths. */
  const crashRun = async (p, steps) => p.evaluate(n => { const S = window.__sim, F = window.__lab.follower, P0 = window.__lab.post();
    S.cutAt(S.you, 10, S.rivals[0], null, null); for (let i = 0; i < 6; i++) window.__lab.step(1 / 60);
    const len = S.you.followers.length, peak = S.you.peak; S.you.dead = 1.5; const t0 = S.time;
    /* Sampled against SCENE time: the beat, the card and the vignette all run on it, and the crash's slow-motion beat stretches it. */
    const out = []; for (let k = 0; k < n; k++) { window.__lab.step(1 / 60); if (k === 5 || k === 23 || k === 35 || k === 47 || k === 59 || k === 71 || k === 83) out.push({ k, t: +(S.time - t0).toFixed(4), vig: P0 ? P0.vignette : null, card: document.getElementById('beat').textContent, dead: S.you.dead }); }
    return { len, peak, out, vig: P0 ? P0.vignette : null, card: document.getElementById('beat').textContent, dead: S.you.dead, runs: S.you.runs }; }, steps);
  for (const look of ['new', 'classic', 'reduced']) {
    const { p, ctx } = await open(look === 'classic' ? 'look=classic' : '');
    if (look === 'reduced') await p.evaluate(() => { const c = document.getElementById('reduceFlash'); c.checked = true; c.dispatchEvent(new Event('change')); });
    const r = await crashRun(p, 84);
    await p.screenshot({ path: OUT + '/art-crash-' + look + '.png' });
    const at = k => r.out.find(o => o.k === k) || {};
    const near = (a, b, t = 0.012) => a !== null && Math.abs(a - b) < t;
    if (look === 'classic') {
      ok('classic: the vignette stays at 0.15 through the beat and the card shows the peak at once', r.out.every(o => near(o.vig, 0.15) && o.card === String(r.peak)), JSON.stringify(r.out.slice(0, 3)));
    } else {
      const vigWant = t => 0.15 + 0.27 * Math.min(1, t / 0.4), cardWant = t => r.len + Math.round((r.peak - r.len) * Math.min(1, t / 0.5));
      ok(look + ': the vignette deepens 0.15 to 0.42 over 0.4 s of scene time and holds (' + r.out.map(o => o.t.toFixed(2) + 's:' + (o.vig === null ? 'null' : o.vig.toFixed(3))).join(' ') + ')', r.out.every(o => near(o.vig, vigWant(o.t))) && r.out.some(o => o.t >= 0.4) && near(at(83).vig, 0.42));
      ok(look + ': the card counts up from the length the crash took (' + r.len + ') to the peak (' + r.peak + ') over 0.5 s of scene time (' + r.out.map(o => o.t.toFixed(2) + 's:' + o.card).join(' ') + ')', r.len < r.peak && r.out.every(o => Math.abs(+o.card - cardWant(o.t)) <= 1) && r.out.some(o => o.t >= 0.55 && o.card === String(r.peak)));   // the card's clock starts on the beat's first frame, one frame behind t0
    }
    /* Through the restart: the vignette is back at 0.15 within 0.3 s. */
    const back = await p.evaluate(() => { const S = window.__sim, P0 = window.__lab.post(); let restartK = -1; for (let k = 0; k < 120; k++) { window.__lab.step(1 / 60); if (restartK < 0 && !(S.you.dead > 0)) restartK = k; } const atRestart = P0.vignette; for (let k = 0; k < 20; k++) window.__lab.step(1 / 60); return { restartK, atRestart, after: P0.vignette, dead: S.you.dead }; });
    ok(look + ': after the restart the vignette is back at 0.15 within 0.3 s (' + (back.after === null ? 'null' : back.after.toFixed(3)) + ')', back.restartK >= 0 && near(back.after, 0.15), JSON.stringify(back));
    await ctx.close();
  }
}
if (WANT.includes('3')) {
  /* A recruit: the nearest living wild manta is put on your nose and joins on the next step; the new follower's drawn size is read against simcore's own size for its join. */
  const recruit = async p => p.evaluate(async () => { const S = window.__sim, you = S.you, M = window.__lab.mantas, F = window.__lab.follower; const m = await import('/lab/manta/simcore.js');
    const fx = -Math.sin(you.head), fz = -Math.cos(you.head); const w = S.wild.find(q => q && q.alive && !q.loose && !(q.sinking > 0)); w.x = you.x + fx * 18; w.z = you.z + fz * 18;
    const n0 = you.followers.length; const out = []; let boostAt0 = null;
    /* Two frames past the join the pop is at its fullest: the shot is taken there (window.__shotAt), then the rest of the steps run. */
    window.__recruitRest = null;
    for (let k = 0; k < 30; k++) { if (window.__recruitRest === null && you.followers.length > n0 && out.length === 2) { window.__recruitRest = k; break; } window.__lab.step(1 / 60); const n = you.followers.length; if (n > n0) { const f = you.followers[n - 1], age = S.time - f.born, slot = n; const base = m.sizeFor(m.joinMix(f, S.time), S.params); const drawn = M.aSize.getX(slot); if (boostAt0 === null) boostAt0 = F.recruitBoost; out.push({ k, age: +age.toFixed(3), ratio: +(drawn / base).toFixed(3), boost: F.recruitBoost }); } }
    return { joined: you.followers.length - n0, out, boostAt0 }; });
  const recruitRest = async p => p.evaluate(async () => { const S = window.__sim, you = S.you, M = window.__lab.mantas, F = window.__lab.follower; const m = await import('/lab/manta/simcore.js'); const out = [];
    for (let k = window.__recruitRest || 0; k < 30; k++) { window.__lab.step(1 / 60); const n = you.followers.length; const f = you.followers[n - 1], age = S.time - f.born; const base = m.sizeFor(m.joinMix(f, S.time), S.params); out.push({ k, age: +age.toFixed(3), ratio: +(M.aSize.getX(n) / base).toFixed(3), boost: F.recruitBoost }); }
    return out; });
  for (const look of ['new', 'classic', 'reduced']) {
    const { p, ctx } = await open(look === 'classic' ? 'look=classic' : '');
    if (look === 'reduced') await p.evaluate(() => { const c = document.getElementById('reduceFlash'); c.checked = true; c.dispatchEvent(new Event('change')); });
    const r = await recruit(p);
    if (look !== 'reduced') await p.screenshot({ path: OUT + '/art-recruit-' + look + '.png' });
    r.out.push(...await recruitRest(p));
    const early = r.out.filter(o => o.age <= 0.12), mid = r.out.find(o => o.age > 0.25 && o.age < 0.29), late = r.out.filter(o => o.age >= 0.4);
    const boosted = r.out.filter(o => o.age < 0.19).every(o => o.boost === 2), unboosted = r.out.filter(o => o.age > 0.21).every(o => o.boost === 1);
    if (look === 'new') {
      ok('new: the new follower is drawn 1.30x its size for its first 0.12 s, between at 0.27 s, and 1.00x from 0.4 s (' + r.out.map(o => o.age + ':' + o.ratio).slice(0, 8).join(' ') + ' ...)', r.joined >= 1 && early.length >= 5 && early.every(o => Math.abs(o.ratio - 1.3) < 0.01) && mid && mid.ratio > 1.03 && mid.ratio < 1.2 && late.length >= 1 && late.every(o => Math.abs(o.ratio - 1) < 0.001));
      ok('new: your leader\'s deposit is doubled for 0.2 s after the recruit and not after', r.boostAt0 === 2 && boosted && unboosted, JSON.stringify(r.out.map(o => o.age + ':' + o.boost)));
    } else if (look === 'classic') {
      ok('classic: no overshoot (ratio 1.000 throughout) and no deposit boost', r.joined >= 1 && r.out.every(o => Math.abs(o.ratio - 1) < 0.001 && o.boost === 1), JSON.stringify(r.out.slice(0, 4)));
    } else {
      ok('reduced flash and motion: no overshoot, the deposit boost kept', r.joined >= 1 && r.out.every(o => Math.abs(o.ratio - 1) < 0.001) && r.boostAt0 === 2 && boosted, JSON.stringify(r.out.slice(0, 4)));
    }
    await ctx.close();
  }
}
if (WANT.includes('4')) {
  /* A burst for 20 steps straight ahead with a 30-long train; the memory read just behind the leader (new against classic) is the wake the burst writes. */
  const burst = async p => p.evaluate(() => { const S = window.__sim, you = S.you; S.input.burst = true; S.input.want = null;
    /* The controls would overwrite the input each step, so the burst is held through the keyboard: a space keydown on the window. */
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    for (let k = 0; k < 20; k++) window.__lab.step(1 / 60);
    const fx = -Math.sin(you.head), fz = -Math.cos(you.head);
    return { bursting: you.bursting, len: you.followers.length, pts: [[you.x - fx * 30, you.z - fz * 30], [you.x - fx * 60, you.z - fz * 60], [you.x - fx * 90, you.z - fz * 90]] }; });
  const got = {};
  for (const look of ['new', 'classic']) {
    const { p, ctx } = await open(look === 'classic' ? 'look=classic' : '');
    const r = await burst(p);
    const mem = await memAt(p, r.pts);
    got[look] = { bursting: r.bursting, len: r.len, mem };
    await p.screenshot({ path: OUT + '/art-burst-' + look + '.png' });
    await ctx.close();
  }
  const ratio = got.new.mem.map((v, i) => v / Math.max(1e-6, got.classic.mem[i]));
  ok('new: the burst wake just behind your leader is about 1.33x the classic one (cap 2.0 against 1.5) at 30, 60 and 90 units back: ' + ratio.map(x => x.toFixed(2)).join(' '), got.new.bursting && got.classic.bursting && ratio.every(x => x > 1.2 && x < 1.45), JSON.stringify(got));
}

if (WANT.includes('5')) {
  /* The first frame of a session: the drawn zoom against the camera's own, and the board, through the first 1.2 s of scene time. */
  for (const look of ['new', 'classic', 'reduced']) {
    const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    const p = await ctx.newPage(); p.setDefaultTimeout(30000); p.setDefaultNavigationTimeout(30000);
    p.on('pageerror', e => errs.push('pageerror: ' + e.message.slice(0, 140)));
    await p.goto(O + '/lab/manta/?seed=7&paused=1&hint=0&tier=low&backend=webgl2' + (look === 'classic' ? '&look=classic' : ''), { waitUntil: 'load' }).catch(e => console.log('goto ' + e.message));
    await p.waitForFunction(() => window.__labReady === true && window.__labDrew === true, null, { timeout: 25000, polling: 100 }).catch(() => console.log('(no ready)'));
    if (look === 'reduced') await p.evaluate(() => { const c = document.getElementById('reduceFlash'); c.checked = true; c.dispatchEvent(new Event('change')); });
    const r = await p.evaluate(() => { const L = window.__lab, F = L.follower, out = [], vis = () => getComputedStyle(document.getElementById('board')).visibility;
      L.step(1 / 60); out.push({ t: 1 / 60, ratio: F.zoomDrawn / F.zoom, board: vis() });
      for (let k = 2; k <= 90; k++) { L.step(1 / 60); if (k === 36 || k === 72 || k === 73 || k === 90) out.push({ t: k / 60, ratio: F.zoomDrawn / F.zoom, board: vis() }); }
      return out; });
    if (look === 'new') await p.screenshot({ path: OUT + '/art-first-new.png' });
    const at = t => r.find(o => Math.abs(o.t - t) < 1e-6) || {};
    const near = (a, c, t = 0.004) => Math.abs(a - c) < t;
    const sm = m => m * m * (3 - 2 * m), want = t => 1 / (1 + 0.25 * (1 - sm(Math.min(1, t / 1.2))));
    if (look === 'new') ok('new: the first frame is 25% wider (ratio 0.800) and eases in over 1.2 s (0.6 s: ' + want(0.6).toFixed(3) + ', 1.2 s: 1.000); the board waits for it', near(at(1 / 60).ratio, want(1 / 60)) && near(at(0.6).ratio, want(0.6)) && near(at(1.2).ratio, 1) && near(at(1.5).ratio, 1) && at(1 / 60).board === 'hidden' && at(0.6).board === 'hidden' && at(73 / 60).board === 'visible', r.map(o => o.t.toFixed(2) + ':' + o.ratio.toFixed(3) + '/' + o.board).join(' '));
    else ok(look + ': no reveal: ratio 1.000 from the first frame and the board shown', r.every(o => near(o.ratio, 1) && o.board === 'visible'), r.map(o => o.t.toFixed(2) + ':' + o.ratio.toFixed(3) + '/' + o.board).join(' '));
    await ctx.close();
  }
}
const real = errs.filter(e => !/popErrorScope/.test(e));
ok('no console errors', real.length === 0, JSON.stringify([...new Set(real)]).slice(0, 300));
clearTimeout(die); await b.close(); process.exit(bad ? 1 : 0);
