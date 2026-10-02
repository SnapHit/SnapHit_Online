/* 3J stage 2: typed names. PART=first | clean | change. wrangler dev (PORT). */
import { chromium } from '../lib/tools.mjs';
const TREE = process.env.TREE || decodeURIComponent(new URL('../../..', import.meta.url).pathname).replace(/\/$/, '');
const { cleanName } = await import(TREE + '/docs/lab/manta/roomcore.js');
const O = 'http://127.0.0.1:' + process.env.PORT, PART = process.env.PART, SHOTS = (process.env.SHOTS || process.env.MANTA_OUT || '/tmp') || '/tmp';
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 88000);
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + '[' + PART + '] ' + n + (x ? '  [' + x + ']' : '')); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const launch = () => chromium.launch({ executablePath: process.env.CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const off = [], errs = [], dialogs = [];
async function page (b, w, h, init) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true });
  if (init) await ctx.addInitScript(init);
  const p = await ctx.newPage(); p.setDefaultTimeout(30000); p.setDefaultNavigationTimeout(30000);
  p.on('console', c => { if (c.type() === 'error') errs.push(c.text().slice(0, 160)); });
  p.on('pageerror', e => errs.push('pageerror: ' + e.message.slice(0, 160)));
  p.on('dialog', d => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
  p.on('request', r => { const u = r.url(); if (!u.startsWith(O) && !u.startsWith(O.replace('http', 'ws')) && !/^(data|about|blob):/.test(u)) off.push(u); });
  return { p, ctx };
}
const Q = 'backend=webgl2&tier=low';
const playing = p => p.waitForFunction(() => window.__lab && window.__lab.room && window.__lab.room.me && window.__lab.room.id >= 0, null, { timeout: 30000 }).then(() => true).catch(() => false);
const inBox = (r, W, H) => r && r.x >= 0 && r.y >= 0 && r.x + r.width <= W && r.y + r.height <= H;
if (PART === 'first') {
  const b = await launch();
  /* No saved name: the panel over a live lobby, as a watcher. */
  const { p } = await page(b, 412, 915);
  await p.goto(O + '/lab/manta/play/?' + Q, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__lab && window.__lab.room && window.__lab.room.connected && window.__sim.rivals.some(t => t && !t.hole), null, { timeout: 30000 }).catch(() => {});
  const s0 = await p.evaluate(async () => { const S = window.__sim, R = window.__lab.room, t = S.rivals.find(q => q && !q.hole && !q.dead), x0 = t && t.x;
    await new Promise(r => setTimeout(r, 1500)); const panel = document.getElementById('namePanel'), box = document.getElementById('nameBox');
    return { panel: !panel.hidden && panel.getBoundingClientRect().height > 0, placeholder: box.placeholder, watching: R.connected && !R.play, moved: t ? Math.hypot(t.x - x0) : 0, query: window.MANTA_QUERY,
      bar: ['friends', 'solo', 'privacyLink'].every(id => { const r = document.getElementById(id).getBoundingClientRect(); return r.width > 0 && r.bottom <= document.getElementById('namePanel').getBoundingClientRect().top; }) }; });
  ok('first visit: the name panel over a live lobby, watching, bots swimming, the play bar still reachable', s0.panel && s0.watching && s0.moved > 5 && s0.bar && /room=lobby/.test(s0.query) && !/play=1/.test(s0.query), JSON.stringify(s0));
  /* Screenshots: portrait, landscape, and each with the keyboard's share taken off the height. */
  const shots = [];
  for (const [w, h, tag] of [[412, 915, 'port'], [412, 520, 'port-keyboard'], [915, 412, 'land'], [915, 190, 'land-keyboard']]) {
    await p.setViewportSize({ width: w, height: h }); await wait(400);
    const r = await p.evaluate(() => ({ box: document.getElementById('nameBox').getBoundingClientRect().toJSON(), play: document.getElementById('playBtn').getBoundingClientRect().toJSON(), overflow: document.documentElement.scrollWidth - innerWidth }));
    shots.push(tag + ': box ' + (inBox(r.box, w, h) ? 'in' : 'OUT') + ', Play ' + (inBox(r.play, w, h) ? 'in' : 'OUT') + ', overflow ' + r.overflow);
    if (!inBox(r.box, w, h) || !inBox(r.play, w, h) || r.overflow) shots.bad = true;
    await p.screenshot({ path: SHOTS + '/namepanel-' + w + 'x' + h + '.png' });
  }
  await p.setViewportSize({ width: 412, height: 915 });
  ok('the box and Play stay on screen in portrait and landscape, with the keyboard\'s space allowed for, no overflow', !shots.bad, shots.join('; '));
  /* One tap on Play, a typed name: swimming, with that name, kept on the phone. */
  await p.fill('#nameBox', '  Zoë 🦈🌊 ');
  const t0 = Date.now(); await Promise.all([p.waitForNavigation({ waitUntil: 'load', timeout: 20000 }).catch(() => {}), p.click('#playBtn')]);
  const went = await playing(p);
  const n1 = await p.evaluate(() => new Promise(res => { const t0 = performance.now(); const f = () => { const n = window.__sim.youName(); if (n && n !== window.__lab.room.name || performance.now() - t0 > 4000) res([n, localStorage.getItem('manta:name')]); else setTimeout(f, 100); }; f(); })).catch(e => [e.message]);
  ok('one tap on Play swims with the typed name, cleaned, and keeps it', went && n1[0] === 'Zoë 🦈🌊' && n1[1] === 'Zoë 🦈🌊', (Date.now() - t0) + ' ms to swimming; name ' + JSON.stringify(n1));
  /* With a saved name, straight in. */
  const { p: p2 } = await page(b, 412, 915, () => { try { localStorage.setItem('manta:name', 'saved sam'); } catch (_) {} });
  await p2.goto(O + '/lab/manta/play/?' + Q, { waitUntil: 'load' });
  const went2 = await playing(p2);
  const s2 = await p2.evaluate(() => new Promise(res => setTimeout(() => res({ panel: !document.getElementById('namePanel').hidden, name: window.__sim.youName() }), 1500)));
  ok('with a saved name, the page goes straight in, no panel', went2 && !s2.panel && s2.name === 'saved sam', JSON.stringify(s2));
  ok('zero off-origin, no page errors, no dialogs', off.length === 0 && errs.length === 0 && dialogs.length === 0, JSON.stringify([off.slice(0, 2), errs.slice(0, 2), dialogs]));
  await b.close();
}
if (PART === 'first2') {
  const b = await launch();
  /* Empty box: the placeholder is the name. */
  const { p: p3 } = await page(b, 412, 915);
  await p3.goto(O + '/lab/manta/play/?' + Q, { waitUntil: 'load' });
  await p3.waitForSelector('#namePanel:not([hidden])', { timeout: 20000 }).catch(() => {});
  const ph = await p3.evaluate(() => document.getElementById('nameBox').placeholder);
  await Promise.all([p3.waitForNavigation({ waitUntil: 'load', timeout: 20000 }).catch(() => {}), p3.click('#playBtn')]); const went3 = await playing(p3);
  const n3 = await p3.evaluate(() => new Promise(res => setTimeout(() => res(window.__sim.youName()), 1500)));
  ok('an empty box swims with the generated name it showed', went3 && n3 === ph, 'placeholder ' + ph + ', name ' + n3);
  /* Storage blocked: the panel still shows, and Play still plays, with the name. */
  const { p: p4 } = await page(b, 412, 915, () => { const t = () => { throw new Error('blocked'); }; Storage.prototype.getItem = t; Storage.prototype.setItem = t; });
  await p4.goto(O + '/lab/manta/play/?' + Q, { waitUntil: 'load' });
  const panel4 = await p4.waitForSelector('#namePanel:not([hidden])', { timeout: 20000 }).then(() => true).catch(() => false);
  await p4.fill('#nameBox', 'no storage'); await Promise.all([p4.waitForNavigation({ waitUntil: 'load', timeout: 20000 }).catch(() => {}), p4.click('#playBtn')]); const went4 = await playing(p4);
  const n4 = await p4.evaluate(() => new Promise(res => setTimeout(() => res([window.__sim.youName(), location.search]), 2000)));
  ok('with storage blocked the panel shows and Play plays with the typed name (not left in the address)', panel4 && went4 && n4[0] === 'no storage' && !/[?&]n=/.test(n4[1]), JSON.stringify({ panel4, went4, n4 }));
  ok('zero off-origin, no page errors, no dialogs', off.length === 0 && errs.length === 0 && dialogs.length === 0, JSON.stringify([off.slice(0, 2), errs.slice(0, 2), dialogs]));
  await b.close();
}
if (PART === 'clean') {
  const { player } = await import('./playclient.mjs');
  const INPUTS = [['emoji and accents', '  Zoë 🦈🌊 '], ['right to left', 'שלום עולם'], ['17+ characters', 'abcdefghijklmnopqrstu'],
    ['zero-width', 'a​b‌c‍d﻿e'], ['direction override', '‮gnp.exe'], ['30 combining marks', 'x' + '́'.repeat(30)],
    ['<b>x</b>', '<b>x</b>'], ['<img onerror>', '<img src=x onerror=alert(1)>'], ['emoji family', '👨‍👩‍👧 ok']];
  const b = await launch(), { p } = await page(b, 412, 915, () => { try { localStorage.setItem('manta:name', 'watcher w'); } catch (_) {} });
  const code = (await (await fetch(O + '/lab/manta/rooms/new', { method: 'POST', headers: { Origin: O, 'X-Test-Address': 'nm' + Math.random() } })).json()).code;
  await p.goto(O + '/lab/manta/play/?room=' + code + '&' + Q, { waitUntil: 'load' });
  await playing(p);
  const cs = [];
  for (const [, n] of INPUTS) { const c = player(+process.env.PORT, code, {}); cs.push(c); await c.opened; c.sendRaw({ t: 'nm', n }); await wait(150); }
  await wait(2500);
  const seen = await p.evaluate(() => { const S = window.__sim, board = document.getElementById('board');
    return { names: [...Array(12).keys()].map(i => S.nameOf(i)), board: board.textContent, boardEls: [...board.querySelectorAll('*')].map(e => e.tagName),
      labelEls: [...document.querySelectorAll('#labels *')].filter(e => e.children.length).length, imgs: document.querySelectorAll('img').length, x: window.__x || 0 }; });
  for (let i = 0; i < INPUTS.length; i++) {
    const [what, n] = INPUTS[i], want = cleanName(n), id = cs[i].play.id, got = seen.names[id];
    ok(what + ': ' + JSON.stringify(n).slice(0, 44) + ' arrives as ' + JSON.stringify(want), got === want && seen.board.includes(want), 'room says ' + JSON.stringify(got) + ' for #' + id + (seen.board.includes(want) ? ', on the board as text' : ', NOT on the board'));
  }
  ok('shown as plain text: no element made from a name, no image, no script run, no dialog', seen.boardEls.every(t => t === 'B' || t === 'SPAN' || t === 'BR') && seen.labelEls === 0 && seen.imgs === 0 && dialogs.length === 0,
     'board elements ' + JSON.stringify([...new Set(seen.boardEls)]) + ', label elements with children ' + seen.labelEls + ', <img> ' + seen.imgs + ', dialogs ' + dialogs.length);
  /* The room's own limit, bypassing the phone's: two names 100 ms apart, the second ignored. */
  cs[0].sendRaw({ t: 'nm', n: 'first try' }); await wait(5200); cs[0].sendRaw({ t: 'nm', n: 'second try' }); await wait(100); cs[0].sendRaw({ t: 'nm', n: 'third try' }); await wait(800);
  const r5 = await p.evaluate(id => window.__sim.nameOf(id), cs[0].play.id);
  ok('the room takes at most one name change every 5 s (a second 100 ms later is ignored)', r5 === 'second try', 'after "second try" then "third try" 100 ms later, the room says ' + JSON.stringify(r5));
  for (const c of cs) { clearInterval(c.timer); try { c.ws.close(); } catch (_) {} }
  await b.close();
}
if (PART === 'change') {
  const code = (await (await fetch(O + '/lab/manta/rooms/new', { method: 'POST', headers: { Origin: O, 'X-Test-Address': 'ch' + Math.random() } })).json()).code;
  const b1 = await launch(), b2 = await launch();
  const { p: a } = await page(b1, 412, 915, () => { try { if (!localStorage.getItem('manta:name')) localStorage.setItem('manta:name', 'anna'); } catch (_) {} });
  const { p: q, ctx: qc } = await page(b2, 915, 412, () => { try { if (!localStorage.getItem('manta:name')) localStorage.setItem('manta:name', 'bob'); } catch (_) {} });
  await a.goto(O + '/lab/manta/play/?room=' + code + '&' + Q, { waitUntil: 'load' }); await playing(a);
  await q.goto(O + '/lab/manta/play/?room=' + code + '&' + Q, { waitUntil: 'load' }); await playing(q);
  const idB = await q.evaluate(() => window.__lab.room.id);
  await a.waitForFunction(id => window.__sim.nameOf(id) === 'bob', idB, { timeout: 15000 }).catch(() => {});
  const before = await a.evaluate(id => window.__sim.nameOf(id), idB);
  /* The pencil on B: tap it, type, Done. A times the change on its own clock. */
  await q.evaluate(() => new Promise(r => setTimeout(r, 5200)));        // past the first name's 5 s
  await q.click('#signal button');
  await q.fill('#signal ~ div input, body > div input[aria-label="Your name"]', 'bobby 🐟');
  await q.evaluate(() => { document.addEventListener('click', e => { if (e.target && e.target.textContent === 'Done') window.__sentAt = Date.now(); }, true); });
  await a.evaluate(id => { window.__seenAt = null; const iv = setInterval(() => { if (window.__sim.nameOf(id) === 'bobby 🐟') { window.__seenAt = Date.now(); clearInterval(iv); } }, 2); setTimeout(() => clearInterval(iv), 15000); }, idB);
  await q.click('text=Done');
  await a.waitForFunction(() => window.__seenAt !== null, null, { timeout: 10000 }).catch(() => {});
  const seenAt = await a.evaluate(() => window.__seenAt), sentAt = await q.evaluate(() => window.__sentAt || null);
  const dt = seenAt && sentAt ? seenAt - sentAt : null;
  const boardA = await a.evaluate(() => document.getElementById('board').textContent);
  ok('a name changed with the pencil shows on the other player\'s board within one snapshot (50 ms) of leaving the phone', dt !== null && dt <= 60 && boardA.includes('bobby 🐟'), 'seen ' + (dt === null ? 'never' : dt + ' ms') + ' after the phone sent it (from "' + before + '"); board ' + (boardA.includes('bobby 🐟') ? 'has it' : 'lacks it'));
  /* The phone's own limit: past 5 s one change goes, and one straight after is refused. */
  await wait(5200);
  const rs = await q.evaluate(() => [window.__sim.setName('bob two'), window.__sim.setName('bob three')]);
  await wait(800);
  const now2 = await a.evaluate(id => window.__sim.nameOf(id), idB);
  ok('the phone allows one change every 5 s: the next straight after is refused', rs[0] === 'ok' && rs[1] === 'soon' && now2 === 'bob two', JSON.stringify(rs) + ', A sees ' + JSON.stringify(now2));
  /* Dropped for 3 s: back within 15 s with the same manta and name. */
  await qc.setOffline(true); await wait(3000); await qc.setOffline(false);
  await q.waitForFunction(() => window.__lab.room.connected && window.__lab.room.me, null, { timeout: 20000 }).catch(() => {});
  await wait(1500);
  const r1 = await a.evaluate(id => window.__sim.nameOf(id), idB), idB2 = await q.evaluate(() => window.__lab.room.id);
  ok('a reconnect within 15 s keeps the name', r1 === 'bob two' && idB2 === idB, 'B #' + idB + ' -> #' + idB2 + ', named ' + r1);
  /* A reload remembers it (new socket, name from the phone). */
  await q.reload({ waitUntil: 'load' }); await playing(q); await wait(1500);
  const idB3 = await q.evaluate(() => window.__lab.room.id), r2 = await a.evaluate(id => window.__sim.nameOf(id), idB3);
  ok('a reload remembers the name', r2 === 'bob two', 'after reload B is #' + idB3 + ' named ' + r2);
  await a.screenshot({ path: SHOTS + '/names-room-412x915.png' }); await q.screenshot({ path: SHOTS + '/names-room-915x412.png' });
  ok('zero off-origin, no page errors', off.length === 0 && errs.length === 0, JSON.stringify([off.slice(0, 2), errs.slice(0, 3)]));
  await b1.close(); await b2.close();
}
console.log('names-' + PART + ' failures: ' + bad); clearTimeout(die); process.exit(bad ? 1 : 0);
