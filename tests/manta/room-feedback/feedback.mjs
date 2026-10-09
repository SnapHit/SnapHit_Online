/* 3G stage 3: the feedback page /lab/manta/play/ under wrangler dev (PORT).
   OFF=1: the same page against a rooms-off copy, which must go solo. */
import { chromium } from '../lib/tools.mjs';
const O = 'http://127.0.0.1:' + process.env.PORT, SHOTS = (process.env.SHOTS || process.env.MANTA_OUT || '/tmp') || '/tmp';
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 88000);
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x ? '  [' + x + ']' : '')); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await chromium.launch({ executablePath: process.env.CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const off = [], non200 = [], errs = []; let revalidated = 0, wsRefused = 0;
/* A second browser for the second player: two pages in one headless browser
   share one software GPU, and the second then never draws a frame. */
let b2 = null;
async function page (w, h, other) {
  if (other && !b2) b2 = await chromium.launch({ executablePath: process.env.CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await (other ? b2 : b).newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true });
  /* 3J: a returning player (a saved name), so the page goes straight in; the first visit's name panel has its own tests. */
  await ctx.addInitScript(() => { try { if (!localStorage.getItem('manta:name')) localStorage.setItem('manta:name', 'tester ' + Math.floor(Math.random() * 90 + 10)); } catch (_) {} });
  const p = await ctx.newPage();
  p.setDefaultTimeout(30000); p.setDefaultNavigationTimeout(30000);
  p.on('console', c => { if (c.type() !== 'error') return; if (/rooms\/ocean\/zzzzzzzz' failed/.test(c.text())) wsRefused++; else errs.push(c.text().slice(0, 200)); });
  p.on('pageerror', e => errs.push('pageerror: ' + e.message.slice(0, 200)));
  p.on('request', r => { const u = r.url(); if (!u.startsWith(O) && !u.startsWith(O.replace('http', 'ws')) && !/^(data|about|blob):/.test(u)) off.push(u); });
  p.on('response', r => { if (r.status() === 304) revalidated++; else if (r.status() !== 200 && r.status() !== 101) non200.push(r.status() + ' ' + r.url().replace(O, '')); });
  return p;
}
const Q = 'backend=webgl2&tier=low';
const state = p => p.evaluate(() => {
  const R = window.__lab && window.__lab.room, S = window.__sim, vis = id => { const e = document.getElementById(id); if (!e) return null; const cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden' && !e.hidden && e.getClientRects().length > 0; };
  return { url: location.search, room: R ? { connected: R.connected, play: R.play, me: !!R.me, id: R.id, name: (window.__sim && window.__sim.youName && window.__sim.youName()) || R.name, snaps: R.snaps, players: R.players || [] } : null, solo: !!S && !R,
    x: S && S.you ? S.you.x : null, z: S && S.you ? S.you.z : null, stats: (document.getElementById('stats') || {}).textContent, note: (document.getElementById('note') || {}).textContent,
    noteShown: vis('noteRow'), share: vis('shareRow') ? document.getElementById('shareLink').value : null, board: (document.getElementById('board') || {}).textContent || '',
    lab: ['chip', 'panel', 'bar', 'plain', 'drawerToggle'].filter(vis), feedback: vis('feedback'), privacy: vis('privacyRow'),
    robots: (document.querySelector('meta[name=robots]') || {}).content, overflow: document.documentElement.scrollWidth - innerWidth, backend: window.__labBackend || '' };
});
const until = async (p, f, ms) => { const t0 = Date.now(); let s; while (Date.now() - t0 < ms) { s = await state(p).catch(() => null); if (s && f(s)) return [s, Date.now() - t0]; await wait(200); } return [s, -1]; };

if (process.env.OFF) {
  const p = await page(412, 915); const t0 = Date.now();
  await p.goto(O + '/lab/manta/play/?' + Q, { waitUntil: 'load' });
  const tLoad = Date.now() - t0;
  const [s, t] = await until(p, s => s.url.includes('solo=1') && s.solo && s.x !== null, 20000);
  let started = null; if (s) { const [s2] = await until(p, q => q.x !== null && Math.hypot(q.x - s.x, q.z - s.z) > 5, 4000); started = s2; }
  ok('rooms off: solo starts itself, with the one-line note', s && s.solo && /could not be reached/.test(s.note) && s.noteShown, s && (s.url + ' note "' + s.note + '"'));
  ok('rooms off: solo within 5 s of the room starting to try (' + (t / 1000).toFixed(1) + ' s from opening, page load ' + (tLoad / 1000).toFixed(1) + ' s)', t > 0 && t - tLoad < 5000 + 3000, 'solo in ' + t + ' ms; load ' + tLoad + ' ms');
  ok('and the solo manta moves', !!started, started ? 'moved' : 'did not move');
  ok('zero off-origin requests', off.length === 0, off.slice(0, 3).join(' '));
  console.log('errors: ' + JSON.stringify(errs.slice(0, 3)) + ' non200: ' + JSON.stringify(non200.slice(0, 5)));
  await b.close(); console.log('feedback-off failures: ' + bad); clearTimeout(die); process.exit(bad ? 1 : 0);
}

const tail = async () => {
  ok('zero off-origin requests', off.length === 0, off.slice(0, 3).join(' '));
  ok('no non-200 responses (' + revalidated + ' cache revalidations, 304, not counted)', non200.length === 0, non200.slice(0, 5).join(', '));
  ok('no page errors (' + wsRefused + ' refused connections to the unissued room zzzzzzzz, expected, not counted)', errs.length === 0, errs.slice(0, 3).join(' | '));
  await b.close(); if (b2) await b2.close(); console.log('feedback failures: ' + bad); clearTimeout(die); process.exit(bad ? 1 : 0);
};
if (process.env.PART === 'b') {
  /* 4. A room that cannot be reached: solo within 5 s, with the note; Solo is one tap. */
  const r = await page(412, 915); const t0 = Date.now();
  await r.goto(O + '/lab/manta/play/?room=zzzzzzzz&' + Q, { waitUntil: 'load' });
  const tLoad = Date.now() - t0;
  const [s4, t4] = await until(r, s => s.url.includes('solo=1') && s.solo && s.x !== null, 20000);
  ok('an unreachable room: solo starts itself with the one-line note', s4 && s4.solo && /could not be reached/.test(s4.note) && s4.noteShown, s4 && s4.url + ' "' + s4.note + '"');
  ok('within 5 s of the room starting to try', t4 > 0 && t4 - tLoad < 8000, 'solo at ' + t4 + ' ms from opening, page load ' + tLoad + ' ms');
  const p = await page(412, 915);
  await p.goto(O + '/lab/manta/play/?' + Q, { waitUntil: 'load' });
  await until(p, s => s.room && s.room.connected && s.room.me, 20000);
  await p.click('#solo'); const [s5] = await until(p, s => s.url.includes('solo=1') && s.solo && s.x !== null, 15000);
  ok('"Solo" is one tap from the room, and "Play online" is shown in its place', !!s5 && await p.isVisible('#online') && !(await p.isVisible('#solo')), s5 && s5.url);
  await wait(1500); await p.screenshot({ path: SHOTS + '/feedback-solo-412x915.png' });
  await tail();
}
/* 1. Portrait: opens, no lab tools, joins lobby at once as a player, plays. */
const p = await page(412, 915);
await p.goto(O + '/lab/manta/play/?' + Q, { waitUntil: 'load' });
const [s1, t1] = await until(p, s => s.room && s.room.connected && s.room.me, 20000);
ok('noindex, nofollow in the head', s1 && s1.robots === 'noindex, nofollow', s1 && s1.robots);
ok('no lab tools visible (chip, panel, bar, report, drawer)', s1 && s1.lab.length === 0, s1 && JSON.stringify(s1.lab));
ok('it joins "lobby" at once as a player', s1 && s1.room.play && s1.room.me && /room=lobby/.test(await p.evaluate(() => window.MANTA_QUERY)), s1 && (s1.room.name + ' #' + s1.room.id + ' in ' + t1 + ' ms'));
ok('the feedback link is hidden while FEEDBACK_URL is empty', s1 && s1.feedback === false);
await p.evaluate(() => { const cv = document.querySelector('canvas'); const ev = (type, x, y) => cv.dispatchEvent(new PointerEvent(type, { pointerId: 11, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true, buttons: type === 'pointerup' ? 0 : 1 })); ev('pointerdown', 380, 700); setTimeout(() => ev('pointerup', 380, 700), 2500); });
const a = await state(p); await wait(3000); const a2 = await state(p);
ok('it plays: the manta moves and the stats line counts a run', Math.hypot(a2.x - a.x, a2.z - a.z) > 20 && /runs [1-9]/.test(a2.stats), 'moved ' + Math.hypot(a2.x - a.x, a2.z - a.z).toFixed(0) + ', "' + a2.stats + '"');
await p.click('#privacyLink'); const pv = await state(p); await p.click('#privacyLink');
ok('the Privacy link shows the privacy note', pv.privacy === true);
ok('portrait: no horizontal overflow', a2.overflow === 0, 'overflow ' + a2.overflow);
await p.screenshot({ path: SHOTS + '/feedback-412x915.png' });
/* The lab panel behind a two-second press on the top-left corner. */
await p.evaluate(() => new Promise(res => { const c = document.getElementById('corner'); c.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 12, bubbles: true, cancelable: true })); setTimeout(() => { c.dispatchEvent(new PointerEvent('pointerup', { pointerId: 12, bubbles: true })); res(); }, 2200); }));
const lab = await state(p);
await p.evaluate(() => new Promise(res => { const c = document.getElementById('corner'); c.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 12, bubbles: true, cancelable: true })); setTimeout(() => { c.dispatchEvent(new PointerEvent('pointerup', { pointerId: 12, bubbles: true })); res(); }, 600); }));
const lab2 = await state(p);
ok('a two-second press on the top-left corner shows the lab chip; a short one does nothing', lab.lab.includes('chip') && lab2.lab.includes('chip'), JSON.stringify(lab.lab));
/* 2. Play with friends: a private room, its link, a Copy button. */
await p.click('#friends');
const [s2] = await until(p, s => /room=[2-9a-hjkmnp-z]{8}/.test(s.url) && s.room && s.room.connected && s.room.me && s.share, 20000);
const code = s2 && (s2.url.match(/room=([2-9a-hjkmnp-z]{8})/) || [])[1];
ok('"Play with friends" makes a private room, joins it and shows its link', !!code && s2.share === O + '/lab/manta/play/?room=' + code, s2 && (s2.share + ' as ' + s2.room.name));
await p.click('#copyLink'); await wait(200);
ok('Copy says it copied', /Copied/.test(await p.textContent('#copyLink')));
/* 3. A second browser, landscape, opens the link and is in the same room. */
const q = await page(915, 412, true);
await q.goto(s2.share + '&' + Q, { waitUntil: 'load' });
/* 4B: the room names every player; the top-ten board of 20 trains need not show a new one. */
const [s3, t3] = await until(q, s => s.room && s.room.connected && s.room.me && s.room.id >= 0 && s.room.players.includes(s2.room.name), 20000);
ok('the link joins the same room from a second browser (the room names the first player to it)', t3 > 0 && s3.room.id !== s2.room.id, s3 ? s3.room.name + ' #' + s3.room.id + ' sees ' + s2.room.name + ' ' + JSON.stringify(s3.room) : 'not joined');
ok('landscape: no horizontal overflow', s3 && s3.overflow === 0, s3 && 'overflow ' + s3.overflow);
await q.screenshot({ path: SHOTS + '/feedback-915x412.png' });
await tail();
