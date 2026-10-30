/* Raywake's portal media (4C, design doc 10.7): covers and preview videos,
   rendered from the game itself, never painted.

     node tools/manta/media.mjs covers [output directory]
       raywake-cover-1920x1080.png, -800x1200.png, -800x800.png: one staged
       moment of the game at each frame's own shape, the title "Raywake"
       the only text, no border, icon or logo
     node tools/manta/media.mjs video16 | video23 [output directory]
       raywake-preview-1920x1080.mp4 and raywake-preview-1080x1620.mp4: the
       same moment as the covers' first frame, then 18 s of play at real
       speed, silent H.264, no cursor, bars or text
     node tools/manta/media.mjs still <name> <w> <h> [output directory]
       one frame of the staged moment, to look at while tuning the staging
     node tools/manta/media.mjs plan [output directory]
       the video's steering run without frames: your length, deaths, and
       every crash and cut, to check a change to the staging or steering

   How: docs/ is served on a free local port by this script (Node's http,
   nothing else), and the lab page is loaded in headless Chromium at half
   the frame's size with ?paused=1, so nothing moves until this script steps it:
   __lab.step(1/30) advances the game by exactly a thirtieth of a second and
   draws one frame, on a fixed clock however long the frame took to draw.
   The game's own interface (board, radar, labels, hint, chip) is hidden.
   WebGL2 through SwiftShader, at the high tier, which draws at a pixel
   ratio of 2 (tiers.js), so a 960x540 page draws a 1920x1080 frame: the
   game as a phone or a laptop with a dense screen shows it. Each video
   frame is the canvas read back as PNG (about 3 s a frame on a 2-core
   container, so about half an hour a video); ffmpeg encodes them at 30
   frames a second. The game's own slow motion at a crash or cut is kept,
   as a player sees it.

   Needs MANTA_TOOLS (Playwright, tests/manta/README.md), CHROME (Chromium
   141, as the harnesses use) and ffmpeg for the videos. The title is set in
   "Inter Display" ExtraBold, falling back to Inter, then any bold sans; the
   script says which face it found. Output defaults to MANTA_OUT, then a
   fresh temp directory, never the repo. It never changes docs/. */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync, existsSync, statSync, mkdirSync, mkdtempSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join, extname, normalize, resolve, relative, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '../..');
const DOCS = join(ROOT, 'docs');
const [MODE = 'covers', ...rest] = process.argv.slice(2);
const OUTARG = MODE === 'still' ? rest[3] : rest[0];
const OUT = resolve(OUTARG || process.env.MANTA_OUT || mkdtempSync(join(tmpdir(), 'raywake-media-')));
if (!relative(ROOT, OUT).startsWith('..')) throw new Error('media never goes inside the repo: ' + OUT);
mkdirSync(OUT, { recursive: true });
if (!process.env.MANTA_TOOLS) throw new Error('MANTA_TOOLS is not set (tests/manta/README.md)');
const { chromium } = createRequire(process.env.MANTA_TOOLS.replace(/\/?$/, '/'))('playwright');

/* THE MOMENT. One seed and one staging for every frame shape, so the three
   covers and both videos are recognisably the same scene: your lime train
   (laid at 46, about 39 once the lead-in's bots have had their go) swimming
   a long curve, two rival trains in the lanes either side of yours, ahead
   on the left and behind on the right, all three heading the same way (on
   crossing courses one of them always crashed into another within a
   second of the video), and the wild mantas of the seeded ocean around
   them. Your lead-in is three seconds, so your wake has built its light,
   and theirs two. Your train is lime by ?player=lime, which pins the roll. */
const SEED = 11, YOU_S = 3, RIVALS_S = 2, FPS = 30, VIDEO_S = 18;
const STAGE = { you: 46, rivals: [
  /* [train length, where its leader is on the frame (world units right and
     down of your leader, the view being about 680 by 380 at this zoom),
     heading (0 swims up the screen, -pi/2 to the right), its curve]; each
     is laid a lead-in's swim short of that, so it arrives there. */
  [30, -150, -60, -0.7, 0.0018],
  [24, 150, 90, -0.7, -0.0012],
],
/* Which bots: the first (orange at this seed) and the third (red), the
   two that stand furthest from your lime. WHICH=0,1 in the environment
   tries others. */
which: [0, 2] };
const WHICH = process.env.WHICH ? process.env.WHICH.split(',').map(Number) : STAGE.which;

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.txt': 'text/plain' };
const server = createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let f = normalize(join(DOCS, decodeURIComponent(u.pathname)));
  if (!f.startsWith(DOCS)) { res.writeHead(403); res.end(); return; }
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html');
  if (!existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(readFileSync(f));
}).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const O = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--hide-scrollbars'] });

/* The staged moment at w x h, ready to step. */
async function stage (w, h, box) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: false });
  const p = await ctx.newPage(); p.setDefaultTimeout(180000); p.setDefaultNavigationTimeout(60000);
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', c => { if (c.type() === 'error' && !/popErrorScope/.test(c.text())) errs.push(c.text()); });
  await p.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = '#chip,#panel,#bar,#board,#len,#radar,#labels,#hint,#signal,#beat,#stats,#plain{display:none!important}html,body{cursor:none}'; document.head.appendChild(s); }); });
  await p.goto(O + '/lab/manta/?seed=' + SEED + '&player=lime&paused=1&hint=0&tier=high&backend=webgl2&bots=10', { waitUntil: 'load' });
  await p.waitForFunction(() => window.__labReady === true && window.__labDrew === true, null, { timeout: 120000, polling: 200 });
  const info = await p.evaluate(async st => {
    const L = window.__lab, S = window.__sim, P = S.params, TAU = Math.PI * 2;
    /* A train laid along a gentle curve ending at (x, z) heading h: the
       trail the simulation follows, oldest first, then its followers. */
    const lay = (t, n, x, z, h, bend) => {
      const sp = P.spacing, step = sp / 4, total = (n + 40) * sp, pts = [];
      let px = x, pz = z, ph = h;
      for (let l = 0; l <= total; l += step) { pts.push({ x: px, z: pz, h: ph }); ph -= bend * step; px += Math.sin(ph) * step; pz += Math.cos(ph) * step; }
      pts.reverse();
      t.trail.length = 0; const s0 = t.s - total;
      pts.forEach((q, i) => t.trail.push({ x: q.x, z: q.z, h: q.h, s: s0 + i * step }));
      t.x = x; t.z = z; t.head = h; t.followers.length = 0;
      for (let k = 0; k < n; k++) t.followers.push({ x, z, head: h, born: -100, from: -1 });
      t.dead = 0;
    };
    const you = S.you;
    /* Somewhere open in the ocean, well inside the reef (radius P.arenaR,
       2000), swimming up and to the right on screen (forward is -sin h,
       -cos h; screen up is -z). Every bot parked well away for now. */
    lay(you, st.you, -500, 700, -0.7, 0.0016);
    S.rivals.forEach((r, i) => { const a = i * TAU / S.rivals.length; lay(r, 4 + i, Math.cos(a) * 1600, Math.sin(a) * 1600, a + Math.PI / 2, 0); });
    window.__media = { lay };
    return { colour: L.mantas.colours.mine.key, seed: L.mantas.seed };
  }, STAGE);
  /* Your lead-in: your wake builds its light along your curve. */
  await p.evaluate(n => { for (let i = 0; i < n; i++) window.__lab.step(1 / 30); }, YOU_S * FPS);
  /* Then the two rivals laid where you are now, beside and ahead of you,
     and their own lead-in, short enough that they are still there. */
  await p.evaluate(st => {
    const S = window.__sim, you = S.you;
    st.rivals.forEach(([n, dx, dz, h, bend], i) => {
      const go = S.params.cruise * st.lead;
      /* Where you will be after the lead-in, plus the offset, less its own swim. */
      const ex = you.x - Math.sin(you.head) * go, ez = you.z - Math.cos(you.head) * go;
      const r = S.rivals[(st.which || [0, 1])[i]]; window.__media.lay(r, n, ex + dx + Math.sin(h) * go, ez + dz + Math.cos(h) * go, h, bend);
      /* Steered by this script, as a room steers a player's train (the
         sim's t.human), so it arrives where it was staged; the video hands
         it back to the bots' brain partway (steer below). */
      r.human = { want: h, burst: false, rewind: 0 };
    });
  }, { ...STAGE, lead: RIVALS_S, which: WHICH });
  await p.evaluate(n => { for (let i = 0; i < n; i++) window.__lab.step(1 / 30); }, RIVALS_S * FPS);
  /* The water under the title kept clear: any wild manta inside the
     title's box (fractions of the frame, with a margin) is moved straight
     down to just below it, where it swims on as before. The trains are
     staged clear of it already. */
  if (box) info.cleared = await p.evaluate(b => {
    const S = window.__sim, you = S.you, V = window.__lab.view; let n = 0;
    for (const m of S.wild || []) {
      if (!m || typeof m.x !== 'number') continue;
      const u = 0.5 + (m.x - you.x) / V.w, v = 0.5 + (m.z - you.z) / V.h;
      if (u > b[0] && u < b[2] && v > b[1] - 0.04 && v < b[3]) { m.z = you.z + (b[3] + 0.03 - 0.5) * V.h; n++; }
    }
    return n;
  }, box);
  info.trains = await p.evaluate(() => { const S = window.__sim, you = S.you, yh = you.head, fx = -Math.sin(yh), fz = -Math.cos(yh), rx = -fz, rz = fx;
    const cam = window.__lab.camera, V = cam.position.constructor, px = t => { const v = new V(t.x, 0, t.z).project(cam); return [Math.round((v.x + 1) * 50), Math.round((1 - v.y) * 50)]; };
    return { screen: [you, ...S.rivals.slice(0, 2)].map(px), view: [Math.round(window.__lab.view.w), Math.round(window.__lab.view.h)], you: [you.followers.length, you.dead, Math.round(you.x), Math.round(you.z)],
      rivals: S.rivals.slice(0, 2).map(t => [t.followers.length, t.dead, Math.round(t.x - you.x), Math.round(t.z - you.z)]) }; });
  return { ctx, p, errs, info };
}
/* One frame of the game, as its own loop would draw it: after an animation
   frame (three renders the post pipeline's scene pass and bloom once per
   animation frame, so a step inside the same task would draw over a stale
   scene), with the shadow pass, which __lab.step leaves to the loop, then
   the step, then the canvas read back as PNG in that same task, while the
   drawing buffer is still there. */
async function frame (p, advance, w, h) {
  await p.evaluate(() => new Promise(r => requestAnimationFrame(() => r())));
  const url = await p.evaluate(dt => { const L = window.__lab; if (L.shadows) L.shadows.render(L.renderer); L.step(dt || 0); return document.getElementById('gl').toDataURL('image/png'); }, advance || 0);
  const png = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
  /* The frame is the size asked for, or nothing is written. */
  const pw = png.readUInt32BE(16), ph = png.readUInt32BE(20);
  if (w && (pw !== w || ph !== h)) throw new Error('the game drew ' + pw + 'x' + ph + ', not ' + w + 'x' + h);
  return png;
}
/* Steering for the video, with the arrow keys as a desktop player would
   (absolute directions on the screen; two held make a diagonal), so no
   cursor is ever drawn. The first two seconds are set (straight on, with a
   burst); after that a small autopilot plays, as a careful player would:
   every frame it scores the eight key directions and straight on by
   swimming each for a second and a half ahead of you, against every other
   train's leader and body, your own body past the first few, and the reef,
   and leans out towards open water inside the reef (below), keeping its
   choice unless another is clearly better. The two staged rivals hold
   their courses for FREE_AT seconds (3), then go back to the bots' own
   brain and play as bots do. */
const PLAN = [[0, []]];
const AUTO_AT = 2.0;
const BURSTS = [[0, false], [1.0, true], [2.0, false], [11.0, true], [12.2, false]];
const FREE_AT = +(process.env.FREE_AT || 3);
async function steer (p, t) {
  await p.evaluate(({ t, plan, bursts, which, freeAt, autoAt }) => {
    const S = window.__sim, P = S.params, you = S.you;
    const key = (k, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { key: k, bubbles: true }));
    const st = window.__steer = window.__steer || { held: [], b: false, freed: false, pick: null };
    if (!st.freed && t >= freeAt) { for (const i of which) S.rivals[i].human = null; st.freed = true; }
    let want = []; for (const [at, ks] of plan) if (t >= at) want = ks;
    let b = false; for (const [at, bb] of bursts) if (t >= at) b = bb;
    if (t >= autoAt && !(you.dead > 0)) {
      const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
      const DIRS = [[[], null], [['ArrowUp'], 0], [['ArrowUp', 'ArrowRight'], -Math.PI / 4], [['ArrowRight'], -Math.PI / 2], [['ArrowDown', 'ArrowRight'], -3 * Math.PI / 4],
        [['ArrowDown'], Math.PI], [['ArrowDown', 'ArrowLeft'], 3 * Math.PI / 4], [['ArrowLeft'], Math.PI / 2], [['ArrowUp', 'ArrowLeft'], Math.PI / 4]];
      const pts = [];
      for (const r of S.rivals) { if (!r || r.dead > 0) continue; pts.push([r.x, r.z, 1.6]); for (const f of r.followers) pts.push([f.x, f.z, 1]); }
      you.followers.forEach((f, k) => { if (k >= 6) pts.push([f.x, f.z, 1]); });
      const R = P.arenaR || 2000, r0 = Math.hypot(you.x, you.z);
      /* The circle: anticlockwise round the middle at about 900, pulled in or out towards it. */
      /* The lean (a heading h swims along (-sin h, -cos h)): straight out
         from the middle, turned left by up to 0.8 rad the further out you
         are than 900. With the reef's own penalty that settles into a
         swim round the ocean about 350 inside the reef, away from the
         bots' fights in the middle. (Leaning along the circle at 900
         instead kept you among the bots, and in a dry run they cut your
         38 down to 10.) */
      const tang = Math.atan2(-you.z, you.x) - Math.PI / 2, ring = Math.max(-0.9, Math.min(0.9, (r0 - 900) / 600));
      const score = h => {
        let x = you.x, z = you.z, hd = you.head, bad = 0;
        const sp = P.cruise * 0.1, turn = (P.turnCruise || 5.2) * 0.1;
        for (let i = 1; i <= 15; i++) {
          if (h !== null) hd += Math.max(-turn, Math.min(turn, wrap(h - hd)));
          x -= Math.sin(hd) * sp; z -= Math.cos(hd) * sp;
          const wgt = 1.6 - i / 15;
          for (const [px, pz, k] of pts) { const d = Math.hypot(px - x, pz - z); if (d < 95) bad += wgt * k * (95 - d) * (95 - d); }
          const out = Math.hypot(x, z) - (R - 300); if (out > 0) bad += wgt * out * out * 4;
        }
        /* the lean: how far the end heading is from the circle's, eased in or out of the ring */
        const goal = wrap(tang + ring * 0.9);
        return bad + 900 * Math.abs(wrap(hd - goal));
      };
      const scored = DIRS.map(([ks, h]) => [ks, score(h)]).sort((a, c) => a[1] - c[1]);
      const cur = st.pick && scored.find(q => q[0].join() === st.pick.join());
      const best = scored[0];
      st.pick = cur && cur[1] <= best[1] * 1.15 + 50 ? cur[0] : best[0];
      want = st.pick;
    }
    for (const k of st.held) if (!want.includes(k)) key(k, false);
    for (const k of want) if (!st.held.includes(k)) key(k, true);
    st.held = want.slice();
    if (b !== st.b) { key(' ', b); st.b = b; }
  }, { t, plan: PLAN, bursts: BURSTS, which: WHICH, freeAt: FREE_AT, autoAt: AUTO_AT });
}
/* The title over a frame: "Raywake", centred near the top, white with a
   soft glow, in the cleanest bold face here. */
async function titled (png, w, h, size, top) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.setContent('<!doctype html><style>html,body{margin:0;width:' + w + 'px;height:' + h + 'px;overflow:hidden;background:#000}' +
    'img{position:absolute;left:0;top:0;width:' + w + 'px;height:' + h + 'px}' +
    'h1{position:absolute;left:0;right:0;top:' + top + 'px;margin:0;text-align:center;font:800 ' + size + 'px/1 "Inter Display","Inter",system-ui,sans-serif;letter-spacing:-0.01em;color:#fbfdff;' +
    'text-shadow:0 0 ' + Math.round(size * 0.35) + 'px rgba(140,240,255,.45),0 ' + Math.round(size * 0.04) + 'px ' + Math.round(size * 0.12) + 'px rgba(0,8,20,.55)}</style>' +
    '<img src="data:image/png;base64,' + png.toString('base64') + '"><h1>Raywake</h1>');
  await p.evaluate(() => document.fonts.ready);
  const face = await p.evaluate(() => ['Inter Display', 'Inter'].find(f => document.fonts.check('800 40px "' + f + '"')) || 'a fallback bold sans');
  const out = await p.screenshot({ type: 'png' });
  await ctx.close();
  return { out, face };
}
/* A frame rendered at rw x rh, scaled to w x h by the compositor (smooth). */
async function scaled (png, rw, rh, w, h) {
  if (rw === w && rh === h) return png;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.setContent('<!doctype html><style>html,body{margin:0;overflow:hidden}img{width:' + w + 'px;height:' + h + 'px;display:block}</style><img src="data:image/png;base64,' + png.toString('base64') + '">');
  const out = await p.screenshot({ type: 'png' }); await ctx.close(); return out;
}

const COVERS = [
  /* name, page size (the frame drawn is twice it), cover size, title size and top */
  ['1920x1080', 960, 540, 1920, 1080, 150, 64],
  ['800x1200', 540, 810, 800, 1200, 132, 92],
  ['800x800', 540, 540, 800, 800, 112, 58],
];
/* The title's box on a cover of w x h, as fractions of the frame, with a
   margin: "Raywake" at weight 800 is about 4.2 em wide and 1.2 em tall
   with its descender. */
const titleBox = (w, h, size, top) => { const half = size * 2.1 + w * 0.04; return [0.5 - half / w, (top - h * 0.02) / h, 0.5 + half / w, (top + size * 1.2 + h * 0.02) / h]; };
const BOX = Object.fromEntries(COVERS.map(([name, , , w, h, size, top]) => [name, titleBox(w, h, size, top)]));
const report = { mode: MODE, out: OUT, files: [] };
if (MODE === 'covers') {
  for (const [name, vw, vh, w, h, size, top] of COVERS) {
    const rw = vw * 2, rh = vh * 2, t0 = Date.now(), s = await stage(vw, vh, BOX[name]);
    const raw = await frame(s.p, 0, rw, rh);
    if (s.errs.length) console.log('page errors: ' + JSON.stringify(s.errs.slice(0, 3)));
    const { out, face } = await titled(await scaled(raw, rw, rh, w, h), w, h, size, top);
    const f = join(OUT, 'raywake-cover-' + name + '.png'); writeFileSync(f, out);
    writeFileSync(join(OUT, 'raywake-frame-' + rw + 'x' + rh + '.png'), raw);
    report.files.push({ file: f, w, h, bytes: out.length, face, colour: s.info.colour, seconds: (Date.now() - t0) / 1000 });
    await s.ctx.close();
  }
} else if (MODE === 'video16' || MODE === 'video23') {
  const [w, h] = MODE === 'video16' ? [1920, 1080] : [1080, 1620];   // drawn by a page half that size
  const dir = join(OUT, 'frames-' + w + 'x' + h); rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  /* The first frame is the matching cover's frame, the title's water kept clear the same way. */
  const t0 = Date.now(), s = await stage(w / 2, h / 2, BOX[MODE === 'video16' ? '1920x1080' : '800x1200']);
  const n = VIDEO_S * FPS;
  for (let i = 0; i < n; i++) {
    const t = i / FPS;
    if (i) await steer(s.p, t);
    writeFileSync(join(dir, 'f' + String(i).padStart(5, '0') + '.png'), await frame(s.p, i ? 1 / FPS : 0, w, h));
    if (i % 60 === 0) console.log('frame ' + i + ' of ' + n + ', ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s');
  }
  if (s.errs.length) console.log('page errors: ' + JSON.stringify(s.errs.slice(0, 3)));
  await s.ctx.close();
  const f = join(OUT, 'raywake-preview-' + w + 'x' + h + '.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(dir, 'f%05d.png'), '-c:v', 'libx264', '-preset', 'slow', '-crf', process.env.CRF || '20',
    '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-movflags', '+faststart', '-an', f]);
  report.files.push({ file: f, w, h, frames: n, fps: FPS, bytes: statSync(f).size, seconds: (Date.now() - t0) / 1000 });
} else if (MODE === 'plan') {
  /* The video's steering run without drawing frames (a small page, steps
     only), to see where everyone goes: your length, whether anyone died,
     and how far from the middle of the ocean you are, each second. */
  const s = await stage(240, 135, null), log = [];
  await s.p.evaluate(() => { const S = window.__sim, ev = S.events, push = ev.push.bind(ev); window.__evlog = [];
    ev.push = (...es) => { for (const e of es) if (e && (e.kind === 'crash' || e.kind === 'cut')) window.__evlog.push(S.time.toFixed(1) + ' ' + e.kind + ' ' + e.id + (e.kind === 'crash' ? ' into ' + e.into + ' (' + e.how + ')' : ' by ' + e.by)); return push(...es); }; });
  const t00 = await s.p.evaluate(() => window.__sim.time);
  for (let i = 0; i < VIDEO_S * FPS; i++) {
    const t = i / FPS;
    if (i) { await steer(s.p, t); await s.p.evaluate(() => window.__lab.step(1 / 30)); }
    if (i % FPS === 0) log.push(await s.p.evaluate(({ t, which }) => { const S = window.__sim, y = S.you;
      return t + 's you ' + y.followers.length + (y.dead ? ' DEAD' : '') + ' at r ' + Math.round(Math.hypot(y.x, y.z)) + '; rivals ' + which.map(i => { const r = S.rivals[i]; return r.followers.length + (r.dead ? ' dead' : '') + ' ' + Math.round(Math.hypot(r.x - y.x, r.z - y.z)) + ' away'; }).join(', '); }, { t, which: WHICH }));
  }
  report.files.push({ log, you: await s.p.evaluate(() => window.__sim.you.id), which: await s.p.evaluate(w => w.map(i => window.__sim.rivals[i].id), WHICH), t0: t00, events: await s.p.evaluate(() => window.__evlog), errors: s.errs.slice(0, 3) });
  await s.ctx.close();
} else if (MODE === 'still') {
  const [name = 'still', w = 1920, h = 1080] = rest;
  const s = await stage(w / 2, h / 2);
  const f = join(OUT, name + '.png'); writeFileSync(f, await frame(s.p, 0, +w, +h));
  report.files.push({ file: f, errors: s.errs.slice(0, 3), info: s.info });
  await s.ctx.close();
} else throw new Error('mode: covers, video16, video23 or still');
await browser.close(); server.close();
console.log(JSON.stringify(report, null, 1));
