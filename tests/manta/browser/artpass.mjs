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
const real = errs.filter(e => !/popErrorScope/.test(e));
ok('no console errors', real.length === 0, JSON.stringify([...new Set(real)]).slice(0, 300));
clearTimeout(die); await b.close(); process.exit(bad ? 1 : 0);
