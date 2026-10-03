/* 3O stage 2: THE PORTAL PACKAGE, as a portal serves it. ZIP names the zip
   tools/manta/package.mjs made. It is unzipped into a scratch directory and
   served from another origin (127.0.0.1, under /game/, gzipped as portal
   CDNs serve), loaded directly and inside a cross-origin iframe (a parent
   page on localhost), as portals embed games. Run with CHROME set to Chrome
   153 (WebGPU with a device):
     the first frame and play within 20 s on a 300 ms, 1.5 Mbit/s link;
     zero requests outside the package's own files, and no room connection;
     WebGPU directly, WebGL2 with ?backend=webgl2, and in the iframe either
     WebGPU or the WebGL2 fallback, drawing; portal mode (no room buttons,
     chip, corner press or name box; your label "you"; the privacy note);
     nothing stored on the device; no console errors; no horizontal
     overflow in either orientation; all three touch schemes steer and burst. */
import { chromium, PNG } from '../lib/tools.mjs';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdtempSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 85000);
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x ? '  [' + x + ']' : '')); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const ZIP = process.env.ZIP; if (!ZIP || !existsSync(ZIP)) { console.log('ZIP not set or missing: ' + ZIP); process.exit(9); }
const dir = mkdtempSync(join(process.env.MANTA_OUT || tmpdir(), 'portal-unzipped-'));
execFileSync('unzip', ['-q', ZIP, '-d', dir]);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '': 'text/plain; charset=utf-8' };
const seen = [];
/* The package's own origin: everything under /game/, gzipped when asked. */
const game = createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); seen.push(u.pathname);
  if (!u.pathname.startsWith('/game/')) { res.writeHead(404); res.end(); return; }
  let f = normalize(join(dir, decodeURIComponent(u.pathname.slice(6)) || 'index.html'));
  if (!f.startsWith(dir) || !existsSync(f) || statSync(f).isDirectory()) { if (existsSync(join(f, 'index.html'))) f = join(f, 'index.html'); else { res.writeHead(404); res.end(); return; } }
  let body = readFileSync(f); const h = { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' };
  if (!process.env.NOGZIP && /gzip/.test(req.headers['accept-encoding'] || '')) { body = gzipSync(body); h['content-encoding'] = 'gzip'; }
  res.writeHead(200, h); res.end(body);
}).listen(0, '127.0.0.1');
/* The portal's page on another origin, framing the game. */
const parent = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;background:#222}iframe{border:0;width:100%;height:100%;display:block}</style><iframe id="g" src="' + GAME + 'index.html' + (new URL(req.url, 'http://x').search) + '"></iframe>');
}).listen(0, '127.0.0.1');
await new Promise(r => setTimeout(r, 200));
const GAME = 'http://127.0.0.1:' + game.address().port + '/game/', PARENT = 'http://localhost:' + parent.address().port + '/';
const b = await chromium.launch({ executablePath: process.env.CHROME, args: ['--enable-unsafe-webgpu', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const KNOWN = /Instance dropped in popErrorScope/;

async function open (url, { vw = 412, vh = 915, throttle = false, noGpu = false } = {}) {
  const ctx = await b.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  /* WebGPU unavailable, as some portal frames or phones have it: no navigator.gpu in any frame. */
  if (noGpu) await ctx.addInitScript(() => { try { Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined, configurable: true }); } catch (_) {} });
  const p = await ctx.newPage(); p.setDefaultTimeout(30000); p.setDefaultNavigationTimeout(30000);
  const reqs = [], errs = [], known = [];
  ctx.on('request', r => reqs.push(r.url()));
  p.on('console', c => { if (c.type() === 'error') (KNOWN.test(c.text()) ? known : errs).push(c.text().slice(0, 160)); });
  p.on('pageerror', e => (KNOWN.test(e.message) ? known : errs).push('pageerror: ' + e.message.slice(0, 160)));
  if (throttle) { const cdp = await ctx.newCDPSession(p); await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 300, downloadThroughput: 1.5e6 / 8, uploadThroughput: 1.5e6 / 8 }); }
  const t0 = Date.now();
  await p.goto(url, { waitUntil: 'commit' }).catch(e => errs.push('goto ' + e.message));
  return { ctx, p, reqs, errs, known, t0 };
}
const frameOf = async p => { for (let i = 0; i < 100; i++) { const f = p.frames().find(f => f.url().startsWith(GAME)); if (f && f !== p.mainFrame()) return f; await wait(100); } return p.mainFrame(); };
/* Play: drawn, and your manta swimming (its position moves over half a second). */
const playing = async f => { for (let i = 0; i < 10; i++) { const r = await f.evaluate(async () => { const S = window.__sim; if (!S || window.__labDrew !== true) return false; const x0 = S.you.x, z0 = S.you.z; await new Promise(r => setTimeout(r, 500)); return Math.hypot(S.you.x - x0, S.you.z - z0) > 1; }).catch(() => false); if (r) return true; } return false; };
const why = f => f.evaluate(() => ({ drew: window.__labDrew, ready: window.__labReady, dead: window.__sim && window.__sim.you.dead, x: window.__sim && Math.round(window.__sim.you.x) })).catch(e => ({ error: e.message.slice(0, 80) }));
const backend = f => f.evaluate(() => (document.getElementById('backend') || {}).dataset ? document.getElementById('backend').dataset.name : null).catch(() => null);
const ink = async p => { const png = PNG.sync.read(await p.screenshot()); let n = 0, lit = 0; for (let i = 0; i < png.data.length; i += 4 * 97) { n++; if (png.data[i] + png.data[i + 1] + png.data[i + 2] > 60) lit++; } return lit / n; };
const outside = reqs => reqs.filter(u => !u.startsWith(GAME) && !u.startsWith(PARENT) && !u.startsWith('data:'));

/* 1. Directly, on a 300 ms, 1.5 Mbit/s link, Chrome 153. */
{
  const { ctx, p, reqs, errs, known, t0 } = await open(GAME + 'index.html', { throttle: true });
  await p.waitForFunction(() => window.__labDrew === true, null, { timeout: 30000 }).catch(() => {});
  const first = Date.now() - t0;
  const fpNav = await p.evaluate(() => Math.round(performance.now())).catch(() => -1);
  let play = false, at = 0; for (let i = 0; i < 40 && !play; i++) { play = await playing(p); at = Date.now() - t0; }
  const be = await backend(p);
  ok('directly, on a 300 ms, 1.5 Mbit/s link: the first frame within 20 s, and play', play && first <= 20000 && at <= 20000, 'first frame ' + (first / 1000).toFixed(1) + ' s from navigation (page clock ' + (fpNav / 1000).toFixed(1) + ' s), swimming by ' + (at / 1000).toFixed(1) + ' s, ' + be);
  ok('directly, on Chrome 153: drawn on WebGPU with a device', be === 'WebGPU' && (await ink(p)) > 0.05, be);
  const ui = await p.evaluate(() => { const vis = id => { const e = document.getElementById(id); return !!e && getComputedStyle(e).display !== 'none' && !e.hidden && e.getClientRects().length > 0; };
    return { friends: vis('friends'), solo: vis('solo'), online: vis('online'), chip: vis('chip'), corner: vis('corner'), name: vis('namePanel'), privacyLink: vis('privacyLink'), title: document.title,
      room: !!(window.__lab && window.__lab.room), stored: (() => { try { return localStorage.length + sessionStorage.length; } catch (_) { return -1; } })() }; });
  ok('portal mode: no Play with friends, Solo or Play online, no lab chip or corner press, no name box; the Privacy link kept', !ui.friends && !ui.solo && !ui.online && !ui.chip && !ui.corner && !ui.name && ui.privacyLink && !ui.room, JSON.stringify(ui));
  ok('the title is the game\'s name from its one constant', ui.title === 'Manta trains', ui.title);
  await p.click('#privacyLink').catch(() => {});
  const priv = await p.evaluate(() => ({ portal: document.getElementById('privacyPortal').hidden ? null : document.getElementById('privacyPortal').textContent.replace(/\s+/g, ' ').trim(), site: !document.getElementById('privacy').hidden }));
  ok('Privacy says it stores nothing on the device and contacts no server', priv.portal && /stores nothing on this device/.test(priv.portal) && /contacts no\s+server/.test(priv.portal) && !priv.site, priv.portal);
  const label = await p.evaluate(() => (window.__labLabels && window.__labLabels.last ? JSON.stringify(window.__labLabels.last) : [...document.querySelectorAll('div')].map(d => d.textContent).filter(t => t === 'you').length));
  ok('your label reads "you"', /"you"/.test(String(label)) || +label > 0, String(label).slice(0, 120));
  ok('nothing stored on the device after play', ui.stored === 0, ui.stored);
  ok('directly: zero requests outside the package\'s own files, and no room connection', outside(reqs).length === 0 && !reqs.some(u => /rooms\//.test(u)), outside(reqs).slice(0, 3).join(' ') + ' (' + reqs.length + ' requests)');
  ok('directly: no console errors', errs.length === 0, JSON.stringify(errs.slice(0, 3)) + (known.length ? ' (known headless artefact ' + known.length + 'x: popErrorScope)' : ''));
  await ctx.close();
}

if (process.env.NOGZIP) { await b.close(); game.close(); parent.close(); console.log('portal failures: ' + bad + ' (NOGZIP: served uncompressed, case 1 only)'); clearTimeout(die); process.exit(bad ? 1 : 0); }

/* 2. WebGL2, directly. */
{
  const { ctx, p, errs } = await open(GAME + 'index.html?backend=webgl2');
  await p.waitForFunction(() => window.__labDrew === true, null, { timeout: 30000 }).catch(() => {});
  const play = await playing(p), be = await backend(p), lit = await ink(p);
  ok('with ?backend=webgl2: drawn on WebGL2, and play', play && be === 'WebGL2' && lit > 0.05, be + ', ink ' + lit.toFixed(2));
  ok('WebGL2: no console errors', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  await ctx.close();
}

/* 3. Inside a cross-origin iframe, portrait and landscape. */
for (const [vw, vh, tag] of [[412, 915, 'portrait'], [915, 412, 'landscape']]) {
  const { ctx, p, reqs, errs, known } = await open(PARENT, { vw, vh });
  const f = await frameOf(p);
  await f.waitForFunction(() => window.__labDrew === true, null, { timeout: 30000 }).catch(() => {});
  const play = await playing(f), be = await backend(f), lit = await ink(p);
  const gpu = await f.evaluate(() => !!navigator.gpu).catch(() => null);
  ok('in a cross-origin iframe (' + tag + '): it draws and plays, on WebGPU or else the WebGL2 fallback', play && (be === 'WebGPU' || be === 'WebGL2') && lit > 0.05, be + ', navigator.gpu ' + gpu + ', ink ' + lit.toFixed(2));
  const of = await f.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
  ok('in the iframe (' + tag + '): no horizontal overflow', of.sw <= of.iw, of.sw + ' <= ' + of.iw);
  ok('in the iframe (' + tag + '): zero requests outside the package', outside(reqs).length === 0, outside(reqs).slice(0, 3).join(' ') + ' (' + reqs.length + ' requests)');
  ok('in the iframe (' + tag + '): no console errors', errs.length === 0, JSON.stringify(errs.slice(0, 3)) + (known.length ? ' (known artefact ' + known.length + 'x)' : ''));
  await ctx.close();
}

/* 3b. Inside the iframe with WebGPU unavailable there: the WebGL2 fallback takes over. */
{
  const { ctx, p, errs } = await open(PARENT, { noGpu: true });
  const f = await frameOf(p);
  await f.waitForFunction(() => window.__labDrew === true, null, { timeout: 30000 }).catch(() => {});
  const play = await playing(f), be = await backend(f), lit = await ink(p), gpu = await f.evaluate(() => !!navigator.gpu).catch(() => null);
  ok('in the iframe with no WebGPU: the WebGL2 fallback takes over, draws and plays', play && be === 'WebGL2' && gpu === false && lit > 0.05, be + ', navigator.gpu ' + gpu + ', ink ' + lit.toFixed(2) + ', playing ' + play + ' ' + JSON.stringify(await why(f)));
  ok('in the iframe with no WebGPU: no console errors', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  await ctx.close();
}
/* 4. Directly in landscape, then the three touch schemes in portrait. */
{
  const { ctx, p } = await open(GAME + 'index.html?backend=webgl2', { vw: 915, vh: 412 });
  await p.waitForFunction(() => window.__labDrew === true, null, { timeout: 30000 }).catch(() => {});
  const of = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
  ok('directly, landscape: no horizontal overflow', of.sw <= of.iw, of.sw + ' <= ' + of.iw);
  await ctx.close();
}
{
  const { ctx, p } = await open(GAME + 'index.html?backend=webgl2');
  await p.waitForFunction(() => window.__labDrew === true, null, { timeout: 30000 }).catch(() => {});
  const of = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
  ok('directly, portrait: no horizontal overflow', of.sw <= of.iw, of.sw + ' <= ' + of.iw);
  const r = await p.evaluate(async () => {
    const m = await import(new URL('lab/manta/params.js', location.href).href), cv = document.querySelector('canvas');
    const ev = (type, id, x, y) => cv.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 11, clientX: x, clientY: y, bubbles: true, cancelable: true, buttons: type === 'pointerup' ? 0 : 1 }));
    const frames = n => new Promise(r => { let k = 0; const f = () => { if (++k >= n) r(); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
    const read = () => ({ want: window.__sim.input.want, burst: !!window.__sim.input.burst });
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const out = {};
    m.setParam('scheme', 0); await sleep(400);
    ev('pointerdown', 11, 400, 457); await frames(3); out.A_steer = read(); ev('pointerup', 11, 400, 457); await frames(2); await sleep(400);
    ev('pointerdown', 11, 10, 457); ev('pointerup', 11, 10, 457); await sleep(80); ev('pointerdown', 11, 10, 457); await frames(3); out.A_burst = read(); ev('pointerup', 11, 10, 457); await frames(2);
    m.setParam('scheme', 1); await sleep(100);
    ev('pointerdown', 11, 10, 457); await frames(3); out.B_steer = read(); ev('pointerdown', 12, 380, 850); await frames(3); out.B_burst = read(); ev('pointerup', 12, 380, 850); ev('pointerup', 11, 10, 457); await frames(2);
    m.setParam('scheme', 2); await sleep(100);
    ev('pointerdown', 11, 100, 700); ev('pointermove', 11, 160, 700); await frames(3); out.C_steer = read(); ev('pointerdown', 12, 330, 700); await frames(3); out.C_burst = read(); ev('pointerup', 12, 330, 700); ev('pointerup', 11, 160, 700); await frames(2);
    return out; }).catch(e => ({ error: e.message }));
  const steers = s => s && typeof s.want === 'number', bursts = s => s && s.burst === true;
  ok('all three touch schemes steer and burst in the package', ['A', 'B', 'C'].every(k => steers(r[k + '_steer']) && bursts(r[k + '_burst'])), JSON.stringify(r));
  await ctx.close();
}
await b.close(); game.close(); parent.close();
console.log('requests served: ' + seen.length + ', paths outside /game/: ' + seen.filter(s => !s.startsWith('/game/')).length);
console.log('portal failures: ' + bad);
clearTimeout(die); process.exit(bad ? 1 : 0);
