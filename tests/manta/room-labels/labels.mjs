/* 3J stage 1: labels over leaders. PART=solo | room | crash. Headless
   Chromium, WebGL2, against wrangler dev (PORT). */
import { chromium } from '../lib/tools.mjs';
const O = 'http://127.0.0.1:' + process.env.PORT, PART = process.env.PART, SHOTS = (process.env.SHOTS || process.env.MANTA_OUT || '/tmp') || '/tmp';
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 88000);
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + '[' + PART + '] ' + n + (x ? '  [' + x + ']' : '')); };
const launch = () => chromium.launch({ executablePath: process.env.CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const off = [], non200 = [], errs = []; let revalidated = 0;
async function page (b, w, h) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true });
  /* 3K: a returning player, so the feedback page goes straight in (the solo lab has no name: "you"). */
  if (process.env.PART !== 'solo' && process.env.PART !== 'cost') await ctx.addInitScript(() => { try { if (!localStorage.getItem('manta:name')) localStorage.setItem('manta:name', 'lab ' + Math.floor(Math.random() * 900 + 100)); } catch (_) {} });
  const p = await ctx.newPage();
  p.setDefaultTimeout(30000); p.setDefaultNavigationTimeout(30000);
  p.on('console', c => { if (c.type() === 'error') errs.push(c.text().slice(0, 160)); });
  p.on('pageerror', e => errs.push('pageerror: ' + e.message.slice(0, 160)));
  p.on('request', r => { const u = r.url(); if (!u.startsWith(O) && !u.startsWith(O.replace('http', 'ws')) && !/^(data|about|blob):/.test(u)) off.push(u); });
  p.on('response', r => { if (r.status() === 304) revalidated++; else if (r.status() !== 200 && r.status() !== 101) non200.push(r.status() + ' ' + r.url().replace(O, '')); });
  return p;
}
/* In the page: every shown label's box against the leader it names, the
   leader projected through the camera's own matrices (not the labels'
   arithmetic), less the label's lift. */
const SAMPLE = () => {
  const L = window.__lab, S = window.__sim, cam = L.camera, P = S.params || {};
  const me = cam.matrixWorldInverse.elements, pe = cam.projectionMatrix.elements;
  const proj = (x, z) => { const vx = me[0] * x + me[8] * z + me[12], vy = me[1] * x + me[9] * z + me[13], vz = me[2] * x + me[10] * z + me[14];
    const nx = pe[0] * vx + pe[4] * vy + pe[8] * vz + pe[12], ny = pe[1] * vx + pe[5] * vy + pe[9] * vz + pe[13];
    return [(nx + 1) / 2 * innerWidth, (1 - ny) / 2 * innerHeight]; };
  const ppu = L.view.pxPerUnit, lift = ((P.spacing || 31) + (P.followerR || 10) * (P.trainScale || 1) + 2) * ppu + 3;
  const leaders = []; const you = S.you;
  if (you && !S.watching && !(you.dead > 0)) leaders.push({ who: 'you', x: you.x, z: you.z });
  for (const t of S.rivals || []) if (t && !t.hole && !(t.dead > 0)) leaders.push({ who: t.id, x: t.x, z: t.z });
  const els = [...document.querySelectorAll('#labels > div')].filter(e => e.style.display !== 'none');
  let worst = 0, matched = 0; const texts = [];
  for (const e of els) { const r = e.getBoundingClientRect(), ax = r.left + r.width / 2, ay = r.bottom; texts.push([e.textContent, e.style.color]);
    let best = 1e9; for (const q of leaders) { const [sx, sy] = proj(q.x, q.z); best = Math.min(best, Math.hypot(ax - sx, ay - (sy - lift))); }
    if (best > 2 && !window.__bad) window.__bad = { text: e.textContent, ax, ay, leaders: leaders.map(q => [q.who, ...proj(q.x, q.z).map(v => Math.round(v))]), cam: [cam.position.x, cam.position.z], you: [you.x, you.z, you.dead], lift };
    worst = Math.max(worst, best); matched++; }
  let onScreen = 0; for (const q of leaders) { const [sx, sy] = proj(q.x, q.z); if (sx > -80 && sx < innerWidth + 80 && sy - lift > -20 && sy < innerHeight + 20) onScreen++; }
  return { worst: leaders.length ? worst : 0, empty: !leaders.length, labels: els.length, onScreen, texts, youDead: you ? you.dead : 0, zoom: +ppu.toFixed(3), overflow: document.documentElement.scrollWidth - innerWidth };
};
const wait = ms => new Promise(r => setTimeout(r, ms));
if (PART === 'solo') {
  const b = await launch(), p = await page(b, 412, 915);
  await p.goto(O + '/lab/manta/?backend=webgl2&tier=low', { waitUntil: 'load' });
  await p.waitForFunction(() => window.__sim && window.__sim.you && window.__labLabels && window.__labLabels.frames > 3, null, { timeout: 30000 }).catch(() => {});
  const res = [];
  for (const zf of [1.5, 0.4]) {   // both ends of the camera's range (3L): pinned flat, then the ease settles
    await p.evaluate(zf => { const P = window.__lab.params.P; P.zoomNear = zf; P.zoomFar = zf; }, zf);
    await wait(3500);
    /* A full turn: the finger walks round the leader. */
    const r = await p.evaluate(async sample => { const f = eval(sample), cv = document.querySelector('canvas'), out = [];
      const ev = (type, x, y) => cv.dispatchEvent(new PointerEvent(type, { pointerId: 11, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true, buttons: type === 'pointerup' ? 0 : 1 }));
      const h0 = window.__sim.you.head; let turned = 0, last = h0;
      ev('pointerdown', 206 + 150, 457);
      for (let k = 0; k < 40 && turned < 2 * Math.PI; k++) { const a = k / 4; ev('pointermove', 206 + 150 * Math.cos(a), 457 + 150 * Math.sin(a));
        await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
        const h = window.__sim.you.head; turned += Math.abs(Math.atan2(Math.sin(h - last), Math.cos(h - last))); last = h; out.push(f()); }
      ev('pointerup', 206, 457); return { turned, samples: out }; }, '(' + SAMPLE.toString() + ')').catch(e => ({ error: e.message }));
    if (r.error) { ok('ran at zoomFar ' + zf, false, r.error); continue; }
    const worst = Math.max(...r.samples.map(s => s.worst)), miss = r.samples.filter(s => s.labels !== s.onScreen).length;
    res.push({ zf, ppu: r.samples[0].zoom, turned: +r.turned.toFixed(2), worst: +worst.toFixed(2), frames: r.samples.length, miss, max: Math.max(...r.samples.map(s => s.labels)) });
  }
  console.log(JSON.stringify(res));
  ok('each label tracks its leader within 2 CSS px across a full turn, at both ends of the zoom', res.length === 2 && res.every(q => q.worst <= 2 && q.turned >= 2 * Math.PI - 0.3), res.map(q => 'zoom ' + q.zf + ' (' + q.ppu + ' px/unit): worst ' + q.worst + ' px over ' + q.frames + ' frames, turned ' + q.turned + ' rad').join('; '));
  ok('one label for every leader on screen, no more, no fewer', res.length === 2 && res.every(q => q.miss === 0), res.map(q => q.miss + ' frames off, up to ' + q.max + ' labels').join('; '));
  await b.close();
}
if (PART === 'cost') {
  const b = await launch(), p = await page(b, 412, 915);
  await p.goto(O + '/lab/manta/?backend=webgl2&tier=low', { waitUntil: 'load' });
  await p.waitForFunction(() => window.__sim && window.__sim.you && window.__labLabels && window.__labLabels.frames > 3, null, { timeout: 30000 }).catch(() => {});
  /* The cost, with all eleven leaders on screen. */
  await p.evaluate(() => { const P = window.__lab.params.P; P.zoomNear = 0.25; P.zoomFar = 0.25; });
  await wait(3500);
  const c = await p.evaluate(async () => { const L = window.__labLabels, t0 = L.total, f0 = L.frames; let mx = 0, n = 0, labels = 0;
    for (let k = 0; k < 30; k++) { await new Promise(r => requestAnimationFrame(r)); mx = Math.max(mx, L.ms); labels = Math.max(labels, L.count); n++; }
    return { mean: (L.total - t0) / Math.max(1, L.frames - f0), max: mx, labels, frames: L.frames - f0, texts: [...document.querySelectorAll('#labels > div')].filter(e => e.style.display !== 'none').map(e => e.textContent) }; });
  ok('cost per frame with 11 leaders on screen', c.labels >= 11, 'mean ' + c.mean.toFixed(3) + ' ms, max ' + c.max.toFixed(3) + ' ms over ' + c.frames + ' frames; ' + c.labels + ' labels: ' + JSON.stringify(c.texts));
  ok('solo: bots say "bot" and you say "you" (no saved name)', c.texts.filter(t => t === 'you').length === 1 && c.texts.filter(t => t === 'bot').length >= 10, JSON.stringify(c.texts));
  await b.close();
}
if (PART === 'room') {
  const code = (await (await fetch(O + '/lab/manta/rooms/new', { method: 'POST', headers: { Origin: O, 'X-Test-Address': 'lb' + Math.random() } })).json()).code;
  const b1 = await launch(), b2 = await launch();
  const a = await page(b1, 412, 915), q = await page(b2, 915, 412);
  await a.goto(O + '/lab/manta/play/?room=' + code + '&backend=webgl2&tier=low', { waitUntil: 'load' });
  await a.waitForFunction(() => window.__lab && window.__lab.room && window.__lab.room.me && window.__lab.room.name, null, { timeout: 30000 }).catch(() => {});
  await q.goto(O + '/lab/manta/play/?room=' + code + '&backend=webgl2&tier=low', { waitUntil: 'load' });
  await q.waitForFunction(() => window.__lab && window.__lab.room && window.__lab.room.me && window.__lab.room.name, null, { timeout: 30000 }).catch(() => {});
  const nameA = await a.evaluate(() => window.__sim.youName()), nameB = await q.evaluate(() => window.__sim.youName());
  /* Bring B's leader onto A's screen: steer both to the middle of the room is slow; instead read A's labels whenever B is in view, for 12 s. */
  let seenB = null, own = null, bots = 0, worst = 0;
  for (let k = 0; k < 24; k++) {
    const s = await a.evaluate(async sample => { const f = eval(sample); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return f(); }, '(' + SAMPLE.toString() + ')').catch(() => null);
    if (s) { worst = Math.max(worst, s.worst); for (const [t, col] of s.texts) { if (t === nameB) seenB = col; if (t === nameA) own = col; if (t === 'bot') bots++; } }
    if (seenB && own && bots) break;
    await a.evaluate(n => { const S = window.__sim, R = window.__lab.room; }, nameB);
    await wait(500);
  }
  /* If B never swam into view, check it where A's page has B's train: nameOf gives B's name for B's id. */
  const idB = await q.evaluate(() => window.__lab.room.id), nameOnA = await a.evaluate(id => window.__sim.nameOf(id), idB);
  ok('A\'s own label is A\'s name in A\'s train colour', own !== null && own !== 'rgb(230, 241, 251)', nameA + ' in ' + own);
  ok('bots are labelled "bot"', bots > 0, bots + ' bot labels seen');
  ok('B\'s leader carries B\'s name on A\'s screen (or, out of view, A\'s page names B\'s train)', seenB !== null || nameOnA === nameB, 'B is ' + nameB + ' #' + idB + '; ' + (seenB ? 'seen over B in ' + seenB : 'not in view; nameOf(' + idB + ') on A = ' + nameOnA));
  ok('labels track within 2 CSS px in the room', worst <= 2, 'worst ' + worst.toFixed(2) + ' px ' + JSON.stringify(await a.evaluate(() => window.__bad || null)).slice(0, 600));
  /* 3K: a pencil rename (setName, as Done calls it), and the floating labels follow. */
  const rn = await q.evaluate(() => window.__sim.setName('renamed 🐟'));
  await wait(1500);
  const ownB = await q.evaluate(async sample => { const f = eval(sample); let t = []; const t0 = performance.now();
    while (performance.now() - t0 < 5000) { await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); t = f().texts.map(x => x[0]); if (t.includes('renamed 🐟')) break; } return t; }, '(' + SAMPLE.toString() + ')');
  const onA = await a.evaluate(id => window.__sim.nameOf(id), idB);
  const labelsA = await a.evaluate(async sample => { const f = eval(sample); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return f().texts.map(t => t[0]); }, '(' + SAMPLE.toString() + ')');
  ok('after a pencil rename the floating label follows: B\'s own label, and A\'s name for B (its label too when B is in view)', rn === 'ok' && ownB.includes('renamed 🐟') && !ownB.includes(nameB) && onA === 'renamed 🐟' && !labelsA.includes(nameB),
     'setName ' + rn + '; B\'s labels ' + JSON.stringify(ownB.filter(t => t !== 'bot')) + '; A names B ' + JSON.stringify(onA) + '; A\'s labels ' + JSON.stringify(labelsA.filter(t => t !== 'bot')));
  const oa = await a.evaluate(() => document.documentElement.scrollWidth - innerWidth), oq = await q.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  ok('no horizontal overflow, portrait and landscape', oa === 0 && oq === 0, oa + ' / ' + oq);
  await a.screenshot({ path: SHOTS + '/labels-room-412x915.png' }); await q.screenshot({ path: SHOTS + '/labels-room-915x412.png' });
  ok('zero off-origin requests', off.length === 0, off.slice(0, 3).join(' '));
  ok('no non-200 (304 revalidations aside: ' + revalidated + ') and no page errors', non200.length === 0 && errs.length === 0, JSON.stringify(non200.slice(0, 3)) + ' ' + JSON.stringify(errs.slice(0, 3)));
  await b1.close(); await b2.close();
}
if (PART === 'crash') {
  /* The staged room: straight on, your leader runs into bot 2's body, crashes, and is put back. */
  const b = await launch(), p = await page(b, 412, 915);
  const name = Array.from({ length: 8 }, () => 'abcdefghjkmnpqrstuvwxyz23456789'[Math.floor(Math.random() * 31)]).join('');
  await p.goto(O + '/lab/manta/play/?room=' + name + '&stage=cut&backend=webgl2&tier=low', { waitUntil: 'load' });
  await p.waitForFunction(() => window.__lab && window.__lab.room && window.__lab.room.me && window.__lab.room.name, null, { timeout: 30000 }).catch(() => {});
  const r = await p.evaluate(async sample => { const f = eval(sample), R = window.__lab.room, out = [];
    const t0 = performance.now(); while (performance.now() - t0 < 12000) { await new Promise(res => requestAnimationFrame(res)); const s = f(); out.push([s.youDead > 0, s.texts.some(t => t[0] === window.__sim.youName())]); }
    return out; }, '(' + SAMPLE.toString() + ')').catch(e => ({ error: e.message }));
  if (r.error) ok('ran', false, r.error); else {
    const deadShown = r.filter(([d, s]) => d && s).length, dead = r.filter(([d]) => d).length, alive = r.filter(([d]) => !d).length, aliveShown = r.filter(([d, s]) => !d && s).length;
    let crashes = 0; for (let i = 1; i < r.length; i++) if (r[i][0] && !r[i - 1][0]) crashes++;
    ok('through crashes and restarts: your label hides in the death beat and comes back', crashes >= 1 && dead > 0 && deadShown === 0 && aliveShown >= alive - 2,
       crashes + ' crashes; ' + dead + ' dead frames with your label ' + deadShown + ' times; ' + alive + ' alive frames with it ' + aliveShown + ' times');
  }
  await b.close();
}
console.log('labels-' + PART + ' failures: ' + bad); clearTimeout(die); process.exit(bad ? 1 : 0);
