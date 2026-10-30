/* 4C part 1: the name is Raywake in every player-facing place, served
   from docs/ (lib/serve.sh): the play page's and the lab page's <title>
   before any script runs and after the page is up; the first visit's name
   panel with "Raywake" above the name box, centred, in a bold face larger
   than the box's own text, and nothing in the panel overlapping, in
   portrait, landscape and a very short landscape; the privacy note; a
   private room's Share button only where the browser has a share sheet,
   sharing "Swim with me in Raywake" with the room's link; the stored name
   key is still manta:name. Screenshots raywake-name-<w>x<h>.png in
   MANTA_OUT. About 40 s. */
import { chromium } from '../lib/tools.mjs';
const O = 'http://127.0.0.1:' + process.env.PORT, OUT = process.env.MANTA_OUT || '/tmp';
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 170000 * (+process.env.WATCHDOG_X || 1));
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x ? '  [' + x + ']' : '')); };
const b = await chromium.launch({ executablePath: process.env.CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const errs = [];
async function open (url, vp, init) {
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 1, hasTouch: true, isMobile: vp.width < vp.height });
  if (init) await ctx.addInitScript(init);
  const p = await ctx.newPage(); p.setDefaultTimeout(30000); p.setDefaultNavigationTimeout(30000);
  p.on('pageerror', e => errs.push(e.message.slice(0, 160)));
  p.on('console', c => { if (c.type() === 'error' && !/WebSocket|Failed to load resource|popErrorScope/.test(c.text())) errs.push(c.text().slice(0, 160)); });
  await p.goto(O + url, { waitUntil: 'load' }).catch(e => errs.push('goto ' + e.message));
  p.ctx = ctx; return p;
}
/* The titles in the served HTML itself, before any script. */
const raw = async path => (await (await fetch(O + path)).text()).match(/<title>([^<]*)<\/title>/)[1];
ok('the play page\'s and the lab page\'s <title> in the HTML as served: "' + await raw('/lab/manta/play/') + '", "' + await raw('/lab/manta/') + '"',
   await raw('/lab/manta/play/') === 'Raywake' && await raw('/lab/manta/') === 'Raywake lab');
{
  const p = await open('/lab/manta/play/?solo=1&backend=webgl2&tier=low', { width: 412, height: 915 });
  await p.waitForFunction(() => window.__labReady === true, null, { timeout: 30000 }).catch(() => {});
  const t = await p.evaluate(() => ({ title: document.title, privacy: document.getElementById('privacy').textContent.replace(/\s+/g, ' ').slice(0, 40), names: [...document.querySelectorAll('.gameName')].map(e => e.textContent) }));
  ok('once up, the play page is titled Raywake and the privacy note opens with it', t.title === 'Raywake' && /^Raywake keeps nothing about you/.test(t.privacy) && t.names.every(n => n === 'Raywake'), JSON.stringify(t));
  const l = await open('/lab/manta/?backend=webgl2&tier=low', { width: 412, height: 915 });
  await l.waitForFunction(() => window.__labReady === true, null, { timeout: 30000 }).catch(() => {});
  ok('once up, the lab page is titled Raywake lab', (await l.evaluate(() => document.title)) === 'Raywake lab');
  await p.ctx.close(); await l.ctx.close();
}
/* The first visit (no name kept): the name panel, with the title over the box. */
for (const vp of [{ width: 412, height: 915 }, { width: 915, height: 412 }, { width: 640, height: 250 }]) {
  const p = await open('/lab/manta/play/?backend=webgl2&tier=low', vp);
  await p.waitForFunction(() => !document.getElementById('namePanel').hidden, null, { timeout: 10000 }).catch(() => {});
  const r = await p.evaluate(() => { const g = id => { const e = document.getElementById(id), r = e.getBoundingClientRect(), cs = getComputedStyle(e); return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom, font: parseFloat(cs.fontSize), weight: +cs.fontWeight, text: e.textContent }; };
    return { title: g('nameTitle'), label: g('nameBox'), box: g('nameBox'), play: g('playBtn'), panel: g('namePanel'), tag: document.getElementById('nameTitle').previousElementSibling, first: document.getElementById('namePanel').firstElementChild.id }; });
  await p.screenshot({ path: OUT + '/raywake-name-' + vp.width + 'x' + vp.height + '.png' });
  const T = r.title, B = r.box, inside = e => e.x >= r.panel.x - 0.5 && e.right <= r.panel.right + 0.5 && e.y >= r.panel.y - 0.5;
  const overlap = (a, c) => !(a.right <= c.x || c.right <= a.x || a.bottom <= c.y || c.bottom <= a.y);
  ok(vp.width + 'x' + vp.height + ' first visit: "' + T.text + '" is the first thing in the name panel, above the box, bold (' + T.weight + ') and larger than the box (' + T.font + ' against ' + B.font + ' px), overlapping nothing',
     T.text === 'Raywake' && r.first === 'nameTitle' && T.bottom <= B.y + 0.5 && T.weight >= 700 && T.font > B.font && inside(T) && !overlap(T, B) && !overlap(T, r.play) && T.h > 0, JSON.stringify({ T, B, panel: r.panel }).slice(0, 300));
  await p.ctx.close();
}
/* A private room's Share: hidden without a share sheet; with one, it shares the game's name and the link. */
{
  const p = await open('/lab/manta/play/?room=abcdefgh&backend=webgl2&tier=low', { width: 412, height: 915 }, () => { try { localStorage.setItem('manta:name', 'share tester'); } catch (_) {} });
  await p.waitForFunction(() => !document.getElementById('shareRow').hidden, null, { timeout: 8000 }).catch(() => {});
  const none = await p.evaluate(() => ({ share: !!navigator.share, hidden: document.getElementById('shareBtn').hidden, link: document.getElementById('shareLink').value }));
  ok('without a share sheet, a private room shows its link and Copy, and no Share button', !none.share && none.hidden && /\?room=abcdefgh$/.test(none.link), JSON.stringify(none));
  await p.ctx.close();
  const q = await open('/lab/manta/play/?room=abcdefgh&backend=webgl2&tier=low', { width: 412, height: 915 }, () => { try { localStorage.setItem('manta:name', 'share tester'); } catch (_) {}
    window.__shared = []; Object.defineProperty(navigator, 'share', { configurable: true, value: d => { window.__shared.push(d); return Promise.resolve(); } }); });
  await q.waitForFunction(() => !document.getElementById('shareRow').hidden, null, { timeout: 8000 }).catch(() => {});
  await q.click('#shareBtn').catch(e => errs.push('share ' + e.message));
  const got = await q.evaluate(() => ({ hidden: document.getElementById('shareBtn').hidden, shared: window.__shared, name: localStorage.getItem('manta:name'), keys: Object.keys(localStorage) }));
  const s = got.shared[0] || {};
  ok('with a share sheet, Share sends "Swim with me in Raywake", titled Raywake, with the room\'s link', !got.hidden && s.title === 'Raywake' && s.text === 'Swim with me in Raywake' && /\/lab\/manta\/play\/\?room=abcdefgh$/.test(s.url), JSON.stringify(got.shared));
  ok('the name is still kept under manta:name (the storage keys keep the manta name)', got.name === 'share tester' && got.keys.every(k => k.startsWith('manta:')), JSON.stringify(got.keys));
  await q.ctx.close();
}
ok('no page errors', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
clearTimeout(die); await b.close(); process.exit(bad ? 1 : 0);
