/* 4C part 5: the play counter, the feedback box and the lab panel's plays
   and messages, in the rooms Worker (design doc 10.6), through wrangler dev.

   MODE=on, NAMES=1 DIRECT=1 VARS="--var FEEDBACK_KEY:raywake-test-key":
     the Worker: /count, /feedback and /plays only by POST from this site;
       a count is five small numbers and nothing else (an address, a name or
       any other key refused); a feedback message over 500 characters
       refused; three a day from one address, a fourth refused, another
       address let in; each is one Worker request and one registry request
       on the daily budget guard; at 80 percent both rest (503 resting);
       nothing that came with a request (the addresses, the page's user
       agent) is anywhere in the room's stored state afterwards.
     the counter on the feedback page: nothing sent while the page is on
       screen; hidden, exactly one sendBeacon with v=1, the run, and n=0 for
       a first visit (n=1 with a day kept from an earlier UTC day, n=0 with
       today's); a second hide inside the same 5 minutes of play sends
       nothing; past a minute of play the run counts as long, and past 5
       minutes one more request goes; a room join counted once; the counts
       land in today's row.
     the feedback box: shown on the page (not a link), says it sent; over
       500 characters it says so; a fourth message from one connection is
       refused with a plain note; resting and unreachable each said plainly.
     the lab panel: the 7 days of counts, no messages without the key, a
       wrong key said so, the right key shows the latest messages newest
       first as plain text (markup in a message stays text: no element made,
       no script run), and the key is remembered under manta:feedbackKey.
   MODE=off, DIRECT=1 VARS="--var ROOMS_OPEN:false": the feedback page solo
     with its off note; the feedback box says at once that rooms are off and
     says so again on Send; a count is refused (rooms are off); the lab
     panel says rooms are off. No page errors in either mode.
   Needs CHROME. About 2 minutes for on, 40 s for off. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '../lib/tools.mjs';
const PORT = +process.env.PORT, O = 'http://127.0.0.1:' + PORT, MODE = process.env.MODE || 'on', KEY = 'raywake-test-key';
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 400000 * (+process.env.WATCHDOG_X || 1));
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + '[' + MODE + '] ' + n + (x ? '  [' + x + ']' : '')); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const R = '/lab/manta/rooms/';
const UA = 'RaywakeTestAgent/4C-' + Math.random().toString(36).slice(2, 8);
const post = async (path, body, headers = {}) => { const r = await fetch(O + R + path, { method: 'POST', body, headers: Object.assign({ Origin: O }, headers) }); return { status: r.status, text: await r.text() }; };
const plays = async (key, addr) => { const r = await post('plays', undefined, Object.assign({ 'X-Test-Address': addr || 'panel' }, key ? { 'X-Feedback-Key': key } : {})); try { return Object.assign(JSON.parse(r.text), { status: r.status }); } catch (_) { return { status: r.status, text: r.text }; } };
const budget = async q => { const r = await fetch(O + R + 'budget' + (q || '')); return r.json(); };
const today = new Date().toISOString().slice(0, 10);
const b = await chromium.launch({ executablePath: process.env.CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const errs = [], off = [];
async function page (opts = {}) {
  const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, hasTouch: true, userAgent: UA });
  if (opts.name !== false) await ctx.addInitScript(n => { try { localStorage.setItem('manta:name', n); } catch (_) {} }, opts.name || 'plays tester');
  if (opts.lastDay) await ctx.addInitScript(d => { try { localStorage.setItem('manta:lastPlayDay', d); } catch (_) {} }, opts.lastDay);
  if (opts.addr) await ctx.setExtraHTTPHeaders({ 'X-Test-Address': opts.addr });
  const p = await ctx.newPage(); p.setDefaultTimeout(30000); p.setDefaultNavigationTimeout(30000);
  p.on('pageerror', e => errs.push(e.message.slice(0, 160)));
  p.on('console', c => { if (c.type() === 'error' && !/WebSocket connection to|Failed to load resource|popErrorScope/.test(c.text())) errs.push(c.text().slice(0, 160)); });
  p.counts = [];
  p.on('request', r => { const u = r.url(); if (!u.startsWith(O) && !u.startsWith(O.replace('http', 'ws')) && !/^(data|about|blob):/.test(u)) off.push(u);
    if (u.includes(R + 'count')) p.counts.push({ body: r.postData(), headers: r.headers(), type: r.resourceType() }); });
  p.ctx = ctx; return p;
}
const hide = (p, h) => p.evaluate(h => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => h ? 'hidden' : 'visible' });
  document.dispatchEvent(new Event('visibilitychange')); }, h);
const ready = p => p.waitForFunction(() => window.__labReady === true && window.__sim && window.__sim.you, null, { timeout: 30000, polling: 200 }).catch(() => {});
const swimming = p => p.waitForFunction(() => { const S = window.__sim, R = window.__lab && window.__lab.room; return S && S.you && !(S.you.dead > 0) && (!R || (R.play && R.me)); }, null, { timeout: 30000, polling: 200 }).then(() => true).catch(() => false);
const fbSend = async (p, text) => { await p.evaluate(t => { if (document.getElementById('fbBox').hidden) document.getElementById('fbOpen').click(); document.getElementById('fbText').value = t; document.getElementById('fbText').dispatchEvent(new Event('input')); document.getElementById('fbSend').click(); }, text);
  await p.waitForFunction(() => !/Sending/.test(document.getElementById('fbSay').textContent) && document.getElementById('fbSay').textContent, null, { timeout: 15000 }).catch(() => {});
  return p.evaluate(() => document.getElementById('fbSay').textContent); };
const XSS = '<img src=x onerror="window.__xss=1"><b>bold</b> & <script>window.__xss=2</script> plain';

if (MODE === 'off') {
  const r = await post('count', 'v=1&n=0&r=1&j=0&m=0');
  ok('a count is refused while rooms are off (503 rooms are off)', r.status === 503 && /off/.test(r.text), r.status + ' ' + r.text);
  const p = await page();
  await p.goto(O + '/lab/manta/play/?backend=webgl2&tier=low&fx=off', { waitUntil: 'load' }).catch(e => errs.push('goto ' + e.message));
  await p.waitForFunction(() => /solo=1/.test(location.search), null, { timeout: 15000 }).catch(() => {});
  await ready(p);
  await p.click('#fbOpen');
  const first = await p.evaluate(() => ({ shown: !document.getElementById('fbBox').hidden, say: document.getElementById('fbSay').textContent }));
  ok('solo with rooms off, the feedback box says at once that rooms are off', first.shown && /Rooms are off/.test(first.say), JSON.stringify(first));
  const said = await fbSend(p, 'hello from a phone with rooms off');
  ok('and Send says so plainly', /Rooms are off just now, so feedback cannot be sent/.test(said), said);
  await p.goto(O + '/lab/manta/?backend=webgl2&tier=low&fx=off', { waitUntil: 'load' }).catch(e => errs.push('goto ' + e.message));
  await ready(p);
  await p.click('#chip'); await p.waitForSelector('#playsOpen', { timeout: 10000 }).catch(() => {}); await p.click('#playsOpen').catch(() => {});
  await p.waitForFunction(() => !/Asking/.test((document.getElementById('playsSay') || {}).textContent || 'Asking'), null, { timeout: 15000 }).catch(() => {});
  const lab = await p.evaluate(() => (document.getElementById('playsSay') || {}).textContent);
  ok('the lab panel says rooms are off', /Rooms are off/.test(lab), lab);
  await p.ctx.close();
} else {
  /* 1. The Worker's own rules. */
  const g = await fetch(O + R + 'count'); ok('/count answers only a POST (405)', g.status === 405, String(g.status));
  const nf = await fetch(O + R + 'count', { method: 'POST', body: 'v=1&r=1' }); ok('/count without this site\'s Origin is refused (403)', nf.status === 403, String(nf.status));
  const shapes = { 'an address': 'v=1&r=1&ip=203.0.113.9', 'a name': 'v=1&r=1&name=coral', 'nothing': '', 'all zeros': 'v=0&r=0', 'a huge number': 'r=5000', 'too long': 'v=1&r=1&' + 'j=0&'.repeat(20) };
  const refused = []; for (const [k, body] of Object.entries(shapes)) { const r = await post('count', body); if (r.status !== 400) refused.push(k + ' ' + r.status); }
  ok('a count is five small numbers and nothing else: an address, a name, empty, all zero, huge or long are refused (400)', refused.length === 0, refused.join(', ') || 'all 400');
  const ff = await fetch(O + R + 'feedback', { method: 'POST', body: 'hello' }); ok('/feedback without this site\'s Origin is refused (403)', ff.status === 403, String(ff.status));
  const long = await post('feedback', 'x'.repeat(501), { 'X-Test-Address': 'long-1' });
  const exact = await post('feedback', '\u{1F98B}'.repeat(500), { 'X-Test-Address': 'long-2' });
  ok('feedback over 500 characters is refused (413); 500 characters, emoji included, is taken', long.status === 413 && exact.status === 200, long.status + ' / ' + exact.status);
  const u0 = (await budget()).use;
  const c1 = await post('count', 'v=1&n=0&r=2&j=1&m=1');
  const u1 = (await budget()).use;
  const f1 = await post('feedback', 'budget check', { 'X-Test-Address': 'budget-1' });
  const u2 = (await budget()).use;
  /* The budget asks are registry requests too: each read adds one. */
  ok('a count and a feedback message each count once on the daily budget guard (a Worker request, a registry request)', c1.status === 200 && f1.status === 200 && u1.w - u0.w === 1 && u2.w - u1.w === 1 && u1.reg - u0.reg === 2 && u2.reg - u1.reg === 2,
     'w +' + (u1.w - u0.w) + ' +' + (u2.w - u1.w) + ', reg +' + (u1.reg - u0.reg) + ' +' + (u2.reg - u1.reg) + ' (each budget read is one)');
  const quota = []; for (let i = 0; i < 4; i++) quota.push((await post('feedback', 'quota ' + i, { 'X-Test-Address': 'quota-addr-7' })).status);
  const other = await post('feedback', 'from another address', { 'X-Test-Address': 'quota-addr-8' });
  ok('three messages a day from one address, the fourth refused (429), another address let in', quota.join(',') === '200,200,200,429' && other.status === 200, quota.join(',') + ' then ' + other.status);
  await budget('?extra=0.8');
  const rc = await post('count', 'v=1&n=0&r=1&j=0&m=0'), rf = await post('feedback', 'resting', { 'X-Test-Address': 'rest-1' });
  ok('at 80 percent both rest: a count and a message refused (503 resting)', rc.status === 503 && /resting/.test(rc.text) && rf.status === 503 && /resting/.test(rf.text), rc.status + ' ' + rc.text.slice(0, 30) + ' / ' + rf.status);
  /* The page says so too. */
  { const p = await page({ addr: 'rest-page' });
    await p.goto(O + '/lab/manta/play/?solo=1&backend=webgl2&tier=low&fx=off', { waitUntil: 'load' }).catch(e => errs.push('goto ' + e.message));
    await ready(p);
    const said = await fbSend(p, 'sent while resting');
    ok('the feedback box says plainly when rooms are resting, and until when', /Rooms are resting until .+, so feedback cannot be sent until then/.test(said), said);
    await p.route('**/lab/manta/rooms/feedback', r => r.abort());
    const said2 = await fbSend(p, 'sent while unreachable');
    ok('and when the server cannot be reached', /could not reach the server/.test(said2), said2);
    await p.ctx.close(); }
  await budget('?extra=0');

  /* 2. The counter on the feedback page, solo. */
  const before = (await plays()).days[0];
  { const p = await page();
    await p.goto(O + '/lab/manta/play/?solo=1&backend=webgl2&tier=low&fx=off', { waitUntil: 'load' }).catch(e => errs.push('goto ' + e.message));
    await ready(p); const swam = await swimming(p); await wait(1500);
    const vis = { sent: p.counts.length, pending: await p.evaluate(() => window.__count.pending) };
    ok('solo: a run started, and nothing is sent while the page is on screen', swam && vis.sent === 0 && vis.pending.v === 1 && vis.pending.r === 1 && vis.pending.n === 0, JSON.stringify(vis));
    await hide(p, true); await wait(800);
    const one = p.counts.slice();
    const hdr = one[0] ? one[0].headers : {};
    ok('hidden, exactly one sendBeacon: "v=1&n=0&r=1&j=0&m=0" (a first visit, one run), and nothing else in it', one.length === 1 && one[0].body === 'v=1&n=0&r=1&j=0&m=0' && (one[0].type === 'beacon' || one[0].type === 'ping'), JSON.stringify(one.map(c => c.body + ' ' + c.type)));
    ok('the beacon carries no cookie and no name', !('cookie' in hdr) && !/plays tester/.test(JSON.stringify(one)), Object.keys(hdr).join(','));
    await hide(p, false); await p.evaluate(() => window.__count.addPlay(61)); await hide(p, true); await wait(500);
    ok('a minute of play later, hidden again inside the same 5 minutes: nothing more is sent (the long run waits)', p.counts.length === 1 && (await p.evaluate(() => window.__count.pending.m)) === 1, p.counts.length + ' sent');
    await hide(p, false); await p.evaluate(() => window.__count.addPlay(300)); await wait(800);
    ok('past 5 minutes of play, one more request goes, carrying the long run', p.counts.length === 2 && p.counts[1].body === 'v=0&n=0&r=0&j=0&m=1', JSON.stringify(p.counts.map(c => c.body)));
    await p.ctx.close(); }
  const after = (await plays()).days[0];
  ok('the counts land in today\'s row: one visit, one run, one long run, nobody returning', after.day === today && after.v - before.v === 1 && after.r - before.r === 1 && after.m - before.m === 1 && after.n === before.n, JSON.stringify({ before, after }));

  /* 3. Returning: a day kept from an earlier UTC day says yes; today's says no. */
  for (const [day, want] of [['2026-01-02', 1], [today, 0]]) {
    const p = await page({ lastDay: day });
    await p.goto(O + '/lab/manta/play/?solo=1&backend=webgl2&tier=low&fx=off', { waitUntil: 'load' }).catch(e => errs.push('goto ' + e.message));
    await ready(p); await swimming(p); await wait(600); await hide(p, true); await wait(600);
    const kept = await p.evaluate(() => localStorage.getItem('manta:lastPlayDay'));
    ok('a phone that last played on ' + (want ? 'an earlier UTC day' : 'this UTC day') + ' is sent as returning ' + (want ? 'yes' : 'no') + ' (n=' + want + '), and keeps today', p.counts.length === 1 && new URLSearchParams(p.counts[0].body).get('n') === String(want) && kept === today, JSON.stringify(p.counts.map(c => c.body)) + ' kept ' + kept);
    await p.ctx.close();
  }

  /* 4. A room join, counted once. */
  { const p = await page();
    await p.goto(O + '/lab/manta/play/?backend=webgl2&tier=low&fx=off', { waitUntil: 'load' }).catch(e => errs.push('goto ' + e.message));
    await ready(p); const seated = await swimming(p); await wait(3000);
    const pend = await p.evaluate(() => window.__count.pending);
    await hide(p, true); await wait(800);
    ok('in the public room: the join counted once with the run', seated && pend.j === 1 && pend.r === 1 && p.counts.length === 1 && /j=1/.test(p.counts[0].body), JSON.stringify(pend) + ' ' + JSON.stringify(p.counts.map(c => c.body)));
    await p.ctx.close(); }

  /* 5. The feedback box on the page. */
  { const p = await page({ addr: 'box-addr-1' });
    await p.goto(O + '/lab/manta/play/?solo=1&backend=webgl2&tier=low&fx=off', { waitUntil: 'load' }).catch(e => errs.push('goto ' + e.message));
    await ready(p);
    const btn = await p.evaluate(() => { const e = document.getElementById('fbOpen'); return e && e.tagName + ' ' + (getComputedStyle(e).display !== 'none'); });
    await p.click('#fbOpen');
    await p.screenshot({ path: (process.env.MANTA_OUT || '/tmp') + '/plays-feedback-box.png' });
    const said = await fbSend(p, XSS);
    ok('the Feedback button opens the box, and a message is sent', /^BUTTON true$/.test(btn) && /Sent\. Thank you!/.test(said), btn + ' / ' + said);
    const over = await fbSend(p, 'y'.repeat(501));
    ok('over 500 characters it says so, before sending', /over 500 characters/.test(over), over);
    await fbSend(p, 'second'); const third = await fbSend(p, 'third'); const fourth = await fbSend(p, 'fourth');
    ok('the fourth message from one connection today is refused with a plain note', /Sent/.test(third) && /three messages from this connection today/.test(fourth), third + ' / ' + fourth);
    await p.ctx.close(); }

  /* 6. The lab panel. */
  { const p = await page();
    await p.goto(O + '/lab/manta/?backend=webgl2&tier=low&fx=off', { waitUntil: 'load' }).catch(e => errs.push('goto ' + e.message));
    await ready(p);
    await p.click('#chip'); await p.waitForSelector('#playsOpen', { timeout: 10000 }).catch(() => {});
    const asked0 = await p.evaluate(() => performance.getEntriesByType('resource').filter(e => /rooms\/plays/.test(e.name)).length);
    await p.click('#playsOpen');
    const settled = () => p.waitForFunction(() => !/Asking/.test((document.getElementById('playsSay') || {}).textContent || 'Asking'), null, { timeout: 15000 }).catch(() => {});
    await settled();
    const s0 = await p.evaluate(() => ({ table: document.getElementById('playsTable').textContent, say: document.getElementById('playsSay').textContent, msgs: document.querySelectorAll('#playsMessages .msg').length }));
    const rows = s0.table.split('\n');
    ok('the lab panel asks nothing until tapped, then shows 7 UTC days of counts, today first', asked0 === 0 && rows.length === 8 && rows[1].startsWith(today) && /Enter the feedback key/.test(s0.say) && s0.msgs === 0, JSON.stringify(s0).slice(0, 300));
    await p.fill('#playsKey', 'not-the-key'); await p.click('#playsShow'); await settled();
    const s1 = await p.evaluate(() => ({ say: document.getElementById('playsSay').textContent, msgs: document.querySelectorAll('#playsMessages .msg').length, kept: localStorage.getItem('manta:feedbackKey') }));
    ok('a wrong key is said to be wrong, shows no messages and is not kept', /That key is wrong/.test(s1.say) && s1.msgs === 0 && !s1.kept, JSON.stringify(s1));
    await p.fill('#playsKey', KEY); await p.click('#playsShow'); await settled();
    await p.screenshot({ path: (process.env.MANTA_OUT || '/tmp') + '/plays-lab-panel.png', fullPage: false });
    const s2 = await p.evaluate(() => { const list = document.getElementById('playsMessages'); return { say: document.getElementById('playsSay').textContent, msgs: [...list.querySelectorAll('.msg span')].map(e => e.textContent), elements: list.querySelectorAll('img, b, script').length, xss: window.__xss, kept: localStorage.getItem('manta:feedbackKey') }; });
    ok('the right key shows the latest messages, newest first, and is remembered under manta:feedbackKey', s2.msgs.length >= 5 && s2.msgs[0] === 'third' && s2.kept === KEY && /newest first/.test(s2.say), JSON.stringify(s2).slice(0, 300));
    ok('markup in a message is shown as text: no element made, no script run', s2.msgs.includes(XSS) && s2.elements === 0 && s2.xss === undefined, 'elements ' + s2.elements + ', __xss ' + s2.xss);
    await p.reload({ waitUntil: 'load' }); await ready(p);
    await p.click('#chip'); await p.waitForSelector('#playsOpen', { timeout: 10000 }).catch(() => {}); await p.click('#playsOpen'); await settled();
    const s3 = await p.evaluate(() => document.querySelectorAll('#playsMessages .msg').length);
    ok('reloaded, the remembered key shows the messages with no typing', s3 >= 5, String(s3));
    await p.ctx.close(); }
  const api = await plays(KEY);
  ok('a stored message is its time and its text and nothing else', api.messages && api.messages.every(m => Object.keys(m).sort().join() === 't,text'), JSON.stringify(api.messages && api.messages[0]));
  /* 7. Nothing that came with a request is stored: the room's state on disk
     holds none of the test addresses or the page's user agent. */
  const dir = process.env.PERSIST || '';
  const hay = [], files = []; const walk = d => { for (const f of readdirSync(d)) { const p = join(d, f); const s = statSync(p); if (s.isDirectory()) walk(p); else { hay.push(readFileSync(p).toString('latin1')); files.push(p.slice(dir.length)); } } };
  if (dir) walk(dir);
  const needles = ['quota-addr-7', 'box-addr-1', 'budget-1', 'rest-page', UA, 'plays tester'];
  const found = needles.filter(n => hay.some(h => h.includes(n)));
  for (const n of found) { const i = hay.findIndex(h => h.includes(n)); const h = hay[i], k = h.indexOf(n); console.log('  (found ' + n + ' in ' + files[i] + ': ...' + JSON.stringify(h.slice(Math.max(0, k - 120), k + 60)) + ')'); }
  ok('nothing that came with a request is in the stored state: no address, no user agent, no name (' + hay.length + ' files)', dir && hay.length > 0 && found.length === 0 && hay.some(h => h.includes('budget check')), found.join(', ') || 'none found');
}
ok('no page errors, nothing off-origin', errs.length === 0 && off.length === 0, JSON.stringify(errs.slice(0, 3)) + ' ' + JSON.stringify(off.slice(0, 3)));
await b.close(); clearTimeout(die); console.log('plays failures: ' + bad); process.exit(bad ? 1 : 0);
