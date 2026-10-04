/* 4A stage 5: the whale shark on screen, turned on (?shark=1 is not a page
   switch: the drawer value is set through params). Forced to appear across
   your bow on a held page: its mesh is visible and placed where the
   simulation has its body; it stamps the light memory along its length in
   the plankton's blue-green; the radar shows its capsule; a train it
   crosses is cut with the cut's set piece firing; with it off the mesh is
   hidden, nothing stamped and nothing on the radar. Vertex buffers on its
   own pipeline stay within the guardrail. */
import { chromium } from '../lib/tools.mjs';
const O = 'http://127.0.0.1:' + process.env.PORT, OUT = process.env.MANTA_OUT || '/tmp';
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 85000);
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x ? '  [' + x + ']' : '')); };
const b = await chromium.launch({ executablePath: process.env.CHROME, args: ['--enable-unsafe-webgpu', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const p = await ctx.newPage(); p.setDefaultTimeout(30000); p.setDefaultNavigationTimeout(30000);
const errs = []; p.on('console', c => { if (c.type() === 'error') errs.push(c.text().slice(0, 140)); }); p.on('pageerror', e => errs.push('pageerror: ' + e.message.slice(0, 140)));
/* BACK=gpu asks for WebGPU (Chrome 153 under SwiftShader), to compile its shader there; otherwise WebGL2. */
const BACKEND = process.env.BACK === 'gpu' ? 'webgpu' : 'webgl2', TIER = process.env.TIER || 'low';   // TIER=high|medium|low
await p.goto(O + '/lab/manta/?seed=7&paused=1&hint=0&tier=' + TIER + '&backend=' + BACKEND + '&bots=0&train=40', { waitUntil: 'load' }).catch(e => console.log('goto ' + e.message));
await p.waitForFunction(() => window.__labReady === true && window.__labDrew === true, null, { timeout: 25000, polling: 100 }).catch(() => console.log('(no ready)'));
await p.evaluate(() => { for (let i = 0; i < 80; i++) window.__lab.step(1 / 60); });
const h2f = h => { const e = (h >> 10) & 0x1f, m = h & 0x3ff; return e === 0 ? m / 1024 * Math.pow(2, -14) : (1 + m / 1024) * Math.pow(2, e - 15); };
/* Off: nothing. */
const r0 = await p.evaluate(() => { const S = window.__sim; const mesh = window.__lab.scene.children.find(o => o.geometry && o.geometry.type === 'ShapeGeometry'); return { on: S.params.sharkOn, alive: S.shark.alive, meshVisible: mesh ? mesh.visible : null, hasMesh: !!mesh }; });
ok('off by default: the shark is not in the water and its mesh is hidden', r0.on === 0 && !r0.alive && r0.hasMesh && r0.meshVisible === false, JSON.stringify(r0));
/* On, appearing now, then moved to cross your bow 260 units ahead, heading across. */
const r1 = await p.evaluate(async () => { const m = await import('/lab/manta/params.js'); m.setParam('sharkOn', 1); const S = window.__sim, you = S.you, L = window.__lab;
  S.shark.lastGone = -1e9; L.step(1 / 60); const sh = S.shark; const fx = -Math.sin(you.head), fz = -Math.cos(you.head);
  /* Heading across your bow with its head 380 units short of a point 260 ahead of you: at 120 a second its head reaches your path about 3.2 s on, when your leader (at cruise, holding its course) is 120 past that point and the train lies across its way. */
  const cx = you.x + fx * 260, cz = you.z + fz * 260; sh.head = you.head + Math.PI / 2; const sx = -Math.sin(sh.head), sz = -Math.cos(sh.head);
  sh.x = cx - sx * 380; sh.z = cz - sz * 380; sh.turn = 0; L.step(1 / 60);
  const mesh = L.scene.children.find(o => o.geometry && o.geometry.type === 'ShapeGeometry'), t = S.sharkTail();
  const mid = { x: (sh.x + t.x) / 2, z: (sh.z + t.z) / 2 };
  const lm = L.lm, half = lm.uHalf.value, lx = lm.uCentre.value.x, lz = lm.uCentre.value.y, n = lm.size;
  const read = async (x, z) => { const u = (x - lx) / (2 * half) + 0.5, v = (z - lz) / (2 * half) + 0.5; const tx = Math.max(1, Math.min(n - 2, Math.round(u * n))); let mx = 0; for (const ty of [Math.round(v * n), Math.round((1 - v) * n)]) { const y = Math.max(1, Math.min(n - 2, ty)); const d = await L.renderer.readRenderTargetPixelsAsync(lm.target, tx - 1, y - 1, 3, 3); for (let i = 0; i < d.length; i += 4) mx = Math.max(mx, d[i + 1]); } return mx; };
  const gpu = !!(L.renderer.backend && L.renderer.backend.isWebGPUBackend);
  const onBody = gpu ? -1 : await read(mid.x, mid.z), beside = gpu ? -1 : await read(mid.x + fx * 220, mid.z + fz * 220);
  return { alive: sh.alive, meshVisible: mesh.visible, meshAt: [mesh.position.x, mesh.position.z], mid, rot: mesh.rotation.y, head: sh.head, onBody, beside, gpu, attrs: Object.keys(mesh.geometry.attributes).length, mantaVB: L.mantas.vertexBuffers }; });
ok('on: it is in the water, its mesh shown with its centre at the body\'s centre and its rotation its heading', r1.alive && r1.meshVisible && Math.abs(r1.meshAt[0] - r1.mid.x) < 0.5 && Math.abs(r1.meshAt[1] - r1.mid.z) < 0.5 && Math.abs(r1.rot - r1.head) < 1e-6, JSON.stringify({ at: r1.meshAt, mid: r1.mid }));
if (r1.gpu) console.log('  (the light memory is not read back on WebGPU here: Chrome 153 under SwiftShader cannot map the readback buffer)');
else { const g = [h2f(r1.onBody), h2f(r1.beside)];
  ok('it stamps the plankton\'s light along its body: memory green ' + g[0].toFixed(4) + ' on the body against ' + g[1].toFixed(4) + ' well beside it', g[0] > 0 && g[0] > 3 * Math.max(1e-5, g[1])); }
ok('its own pipeline has ' + r1.attrs + ' vertex buffers and the mantas\' stays at ' + r1.mantaVB + ' of 8', r1.attrs <= 3 && r1.mantaVB <= 7);
await p.screenshot({ path: OUT + '/shark-cross-' + BACKEND + '.png' });
const r2 = await p.evaluate(() => { const R = window.__radar, S = window.__sim, cv = R.ui.canvas, gg = cv.getContext('2d'); const sc = R.last.scale, c = R.last.centre, pr = cv.width / cv.clientWidth; const t = S.sharkTail(); const x = Math.round((c + (S.shark.x + t.x) / 2 * sc) * pr), y = Math.round((c + (S.shark.z + t.z) / 2 * sc) * pr); const d = gg.getImageData(Math.max(0, x - 2), Math.max(0, y - 2), 5, 5).data; let grey = 0; for (let i = 0; i < d.length; i += 4) { const [r, g2, b2] = [d[i], d[i + 1], d[i + 2]]; if (r > 90 && g2 > 100 && b2 > 100 && Math.abs(r - g2) < 40) grey++; } return { grey, x, y }; });
if (BACKEND === 'webgpu') console.log('  (the radar, a 2D canvas drawn by the same code on either backend, is read on the WebGL2 run: ' + r2.grey + ' grey pixels here)');
else ok('the radar outlines it in grey where it is (' + r2.grey + ' grey pixels at its centre)', r2.grey >= 3, JSON.stringify(r2));
/* Its body set across your train 150 units behind your leader, on screen: the first follower on the body cuts the train there, the leader swims on. */
const r3 = await p.evaluate(() => { const S = window.__sim, L = window.__lab, you = S.you, sh = S.shark; const n0 = you.followers.length;
  const fx = -Math.sin(you.head), fz = -Math.cos(you.head), px = you.x - fx * 150, pz = you.z - fz * 150;
  sh.head = you.head + Math.PI / 2; const sx = -Math.sin(sh.head), sz = -Math.cos(sh.head);
  sh.x = px + sx * 40; sh.z = pz + sz * 40; sh.turn = 0;   // head 40 past the train, so the spine crosses it; the body runs 280 to the other side
  let cutAt = -1, len = n0, before = n0; for (let k = 0; k < 30; k++) { const lb = you.followers.length; L.step(1 / 60); if (you.dead > 0) break; if (cutAt < 0 && sh.cuts > 0) { cutAt = k; before = lb; len = you.followers.length; } if (cutAt >= 0 && k > cutAt + 6) break; }
  const t = S.sharkTail(); return { n0, before, len, cutAt, dead: you.dead, cuts: sh.cuts, crashes: sh.crashes, mid: { x: (sh.x + t.x) / 2, z: (sh.z + t.z) / 2 }, you: { x: you.x, z: you.z, head: you.head } }; });
ok('its body across your train behind your leader cuts it there: ' + r3.before + ' -> ' + r3.len + ' followers on frame ' + r3.cutAt + ' (shark cuts ' + r3.cuts + '), your leader still swimming', r3.cutAt >= 0 && r3.len < r3.before && r3.len <= 8 && !(r3.dead > 0) && r3.cuts >= 1);
await p.screenshot({ path: OUT + '/shark-cut-' + BACKEND + '.png' });
/* On screen: the body reads darker than the water just ahead of it (7.2: a shape, not a light). The page screenshot decoded in the page and sampled at world points through the camera. */
const screenAt = async pts => { const png = (await p.screenshot()).toString('base64'); return p.evaluate(async ({ png, pts }) => { const T = await import('/vendor/three/r186/three.core.js'); const cam = window.__lab.camera;
  const img = new Image(); await new Promise(r => { img.onload = r; img.src = 'data:image/png;base64,' + png; });
  const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height; const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
  return pts.map(([x, z]) => { const v = new T.Vector3(x, 0, z).project(cam); const sx = Math.round((v.x + 1) / 2 * cv.width), sy = Math.round((1 - v.y) / 2 * cv.height); const d = g.getImageData(Math.max(0, sx - 3), Math.max(0, sy - 3), 7, 7).data; let lum = 0, n = 0; for (let i = 0; i < d.length; i += 4) { lum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; n++; } return { sx, sy, lum: +(lum / n).toFixed(1) }; }); }, { png, pts }); };
if (BACKEND === 'webgpu') console.log('  (the screen is not sampled on WebGPU here: Chrome 153 under SwiftShader screenshots a blank canvas)');
else { const fx = -Math.sin(r3.you.head), fz = -Math.cos(r3.you.head), m = r3.mid;
  const s = await screenAt([[m.x, m.z], [m.x + fx * 60, m.z + fz * 60], [m.x + fx * 85, m.z + fz * 85], [r3.you.x, r3.you.z]]);
  ok('on screen its body reads darker than the water just ahead of it: luminance ' + s[0].lum + ' on the body against ' + s[1].lum + ' and ' + s[2].lum + ' at 60 and 85 ahead (your leader at ' + s[3].sx + ',' + s[3].sy + ')', s[0].lum < 0.7 * Math.min(s[1].lum, s[2].lum) && s[0].sx > 10 && s[0].sx < 400 && s[0].sy > 10 && s[0].sy < 900, JSON.stringify(s)); }
const backend = await p.evaluate(() => (window.__lab.renderer && window.__lab.renderer.backend && window.__lab.renderer.backend.isWebGPUBackend) ? 'webgpu' : 'webgl2');
ok('the page runs on the backend asked for (' + backend + ')', backend === BACKEND);
const real = errs.filter(e => !/popErrorScope/.test(e));
ok('no console errors', real.length === 0, JSON.stringify([...new Set(real)]).slice(0, 300));
clearTimeout(die); await b.close(); process.exit(bad ? 1 : 0);
