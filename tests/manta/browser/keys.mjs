/* 4A stage 1: desktop controls. From four starting headings, every key and
   every pair of keys turns the manta towards the matching SCREEN direction
   at its normal rate; the mouse steers towards the pointer at the near and
   the far zoom; space and a held mouse button burst and the right button
   opens no menu. Real key and mouse events through Playwright; the loop
   paused and the simulation stepped by hand so a case takes milliseconds.
   The hint is hint.mjs and the burst zoom bzoom.mjs. */
import { chromium } from '../lib/tools.mjs';
const O = 'http://127.0.0.1:' + process.env.PORT;
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 85000);
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x ? '  [' + x + ']' : '')); };
const b = await chromium.launch({ executablePath: process.env.CHROME,
  args: ['--enable-unsafe-webgpu', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const errs = [];
async function open (ctx, url) {
  const p = await ctx.newPage(); p.setDefaultTimeout(30000); p.setDefaultNavigationTimeout(30000);
  p.on('console', c => { if (c.type() === 'error') errs.push(c.text().slice(0, 140)); });
  p.on('pageerror', e => errs.push('pageerror: ' + e.message.slice(0, 140)));
  await p.goto(O + url, { waitUntil: 'load' }).catch(e => console.log('goto ' + e.message));
  await p.waitForFunction(() => window.__labReady === true, null, { timeout: 25000 }).catch(() => console.log('(no ready)'));
  await p.waitForTimeout(800);
  return p;
}
const TAU = Math.PI * 2, wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const desk = await b.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1, hasTouch: false });

/* ---------------------------------------------------------------- keys */
{
  const p = await open(desk, '/lab/manta/?tier=low&backend=webgl2&bots=0');
  await p.evaluate(async () => {
    const m = await import('/lab/manta/params.js'); m.setParam('bots', 0);
    window.__lab.pause();
    /* One hand-driven step: the controls write the input, the simulation moves. */
    window.__drive = n => { const S = window.__sim, C = window.__lab.controls; const out = []; for (let k = 0; k < n; k++) { const h0 = S.you.head; C.apply(S.you, 1 / 60); S.step(); out.push(Math.abs(Math.atan2(Math.sin(S.you.head - h0), Math.cos(S.you.head - h0)))); } return out; };
    window.__put = h => { const S = window.__sim; S.you.x = 0; S.you.z = 0; S.you.head = h; S.you.trail.length = 0; S.you.s = 0; };
  });
  await p.mouse.move(683, 384);   // the centre: a pointer that says "straight on" and never wins over a key
  const KEYS = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
  const WASD = { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' };
  const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const combos = [['up'], ['down'], ['left'], ['right'], ['up', 'left'], ['up', 'right'], ['down', 'left'], ['down', 'right']];
  const heads = [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2];
  let cases = 0, passWant = 0, passTurn = 0, passMove = 0, passRate = 0, worst = 0; const fails = [];
  for (const map of [KEYS, WASD]) for (const h0 of heads) for (const combo of combos) {
    cases++;
    const ex = combo.reduce((s, d) => s + DIRS[d][0], 0), ez = combo.reduce((s, d) => s + DIRS[d][1], 0);
    const wantExp = Math.atan2(-ex, -ez);
    await p.evaluate(h => window.__put(h), h0);
    for (const d of combo) await p.keyboard.down(map[d]);
    const r = await p.evaluate(() => { const S = window.__sim; const steps = window.__drive(90); const w = S.input.want; const x1 = S.you.x, z1 = S.you.z; window.__drive(30);
      return { want: w, head: S.you.head, dx: S.you.x - x1, dz: S.you.z - z1, maxStep: Math.max(...steps), rate: S.params.turnCruise / 60 }; });
    for (const d of combo) await p.keyboard.up(map[d]);
    const dWant = Math.abs(wrap(r.want - wantExp)), dHead = Math.abs(wrap(r.head - wantExp));
    const moveAng = Math.abs(wrap(Math.atan2(-r.dx, -r.dz) - wantExp)) * 180 / Math.PI;
    const a = dWant < 1e-6, bb = dHead < 0.02, c = moveAng < 3, d = r.maxStep <= r.rate + 1e-9;
    passWant += a; passTurn += bb; passMove += c; passRate += d; worst = Math.max(worst, moveAng);
    if (!(a && bb && c && d)) fails.push((map === KEYS ? 'arrows ' : 'wasd ') + combo.join('+') + ' from ' + (h0 * 180 / Math.PI).toFixed(0) + '°: want off ' + dWant.toFixed(3) + ' head off ' + dHead.toFixed(3) + ' move off ' + moveAng.toFixed(1) + '° maxStep ' + r.maxStep.toFixed(4));
  }
  ok('every key and pair of keys sets the matching screen direction (' + cases + ' cases: 2 key sets × 4 headings × 8 combos)', passWant === cases, passWant + '/' + cases + ' ' + fails.slice(0, 3).join(' | '));
  ok('the manta turns to it and swims that way on screen (heading within 0.02 rad, travel within 3°)', passTurn === cases && passMove === cases, 'turn ' + passTurn + ' move ' + passMove + ' of ' + cases + ', worst travel ' + worst.toFixed(2) + '°');
  ok('it turns at its normal rate, never a snap (max step = turnCruise / 60)', passRate === cases, passRate + '/' + cases);
  /* Opposite keys cancel; no key holds the heading. */
  await p.evaluate(() => window.__put(0.7));
  await p.keyboard.down('ArrowLeft'); await p.keyboard.down('ArrowRight');
  const both = await p.evaluate(() => { window.__drive(30); return { want: window.__sim.input.want, head: window.__sim.you.head }; });
  await p.keyboard.up('ArrowLeft'); await p.keyboard.up('ArrowRight');
  const none = await p.evaluate(() => { window.__drive(30); return { want: window.__sim.input.want, head: window.__sim.you.head }; });
  ok('left+right cancel and no key holds the heading', both.want === null && Math.abs(both.head - 0.7) < 1e-9 && none.want === null && Math.abs(none.head - 0.7) < 1e-9, JSON.stringify({ both, none }));
  /* Space bursts while held, with a follower to pay with. */
  await p.evaluate(() => { window.__sim.lay(10); });
  await p.keyboard.down('Space');
  const sp = await p.evaluate(() => { window.__drive(2); return { burst: window.__sim.input.burst, bursting: window.__sim.you.bursting }; });
  await p.keyboard.up('Space');
  const sp2 = await p.evaluate(() => { window.__drive(2); return { burst: window.__sim.input.burst, bursting: window.__sim.you.bursting }; });
  ok('space bursts while held and stops on release', sp.burst === true && sp.bursting === true && sp2.burst === false && sp2.bursting === false, JSON.stringify({ sp, sp2 }));
  /* A key typed into a text box is not steering. */
  const typed = await p.evaluate(() => { const i = document.createElement('input'); i.id = 'tmpbox'; document.body.appendChild(i); i.focus(); return document.activeElement === i; });
  await p.keyboard.down('ArrowUp'); const inBox = await p.evaluate(() => { window.__drive(2); return window.__sim.input.want; }); await p.keyboard.up('ArrowUp');
  await p.evaluate(() => { document.getElementById('tmpbox').remove(); document.body.focus(); });
  ok('a key in a text box does not steer', typed && inBox === null, String(inBox));
  await p.close();
}

/* ---------------------------------------------------------------- mouse, at the near and the far zoom */
for (const [label, train] of [['near zoom (length 0)', 0], ['far zoom (length 650)', 650]]) {
  const p = await open(desk, '/lab/manta/?tier=low&backend=webgl2&bots=0&train=' + train);
  await p.evaluate(async () => { const m = await import('/lab/manta/params.js'); m.setParam('bots', 0); window.__lab.pause();
    window.__drive = n => { const S = window.__sim, C = window.__lab.controls; for (let k = 0; k < n; k++) { C.apply(S.you, 1 / 60); S.step(); } };
    window.__put = h => { const S = window.__sim; S.you.head = h; }; });
  const z = await p.evaluate(() => ({ zoom: window.__lab.zoom(), w: window.__lab.view.w, h: window.__lab.view.h, len: window.__sim.you.followers.length }));
  const pts = [[1366 * 0.9, 384], [683, 60], [120, 384], [683, 740], [1100, 120], [200, 700]];
  let good = 0; const notes = [];
  for (const [cx, cy] of pts) {
    await p.evaluate(() => window.__put(2.1));
    await p.mouse.move(cx, cy);
    const r = await p.evaluate(([cx, cy]) => { const S = window.__sim, v = window.__lab.view; window.__drive(1); const want = S.input.want;
      const ex = (cx / innerWidth - 0.5) * v.w, ez = (cy / innerHeight - 0.5) * v.h; const exp = Math.atan2(-ex, -ez);
      const x1 = S.you.x, z1 = S.you.z; window.__drive(120); const dx = S.you.x - x1, dz = S.you.z - z1;
      /* After turning, the leader has moved: the pointer's direction is now from where it IS, so compare the last stretch against the pointer's world point. */
      const px = S.you.x + (cx / innerWidth - 0.5) * v.w, pz = S.you.z + (cy / innerHeight - 0.5) * v.h; const x2 = S.you.x, z2 = S.you.z; window.__drive(10);
      const toward = Math.atan2(-(px - x2), -(pz - z2)), moved = Math.atan2(-(S.you.x - x2), -(S.you.z - z2));
      return { want, exp, dx, dz, off: Math.abs(Math.atan2(Math.sin(moved - toward), Math.cos(moved - toward))) * 180 / Math.PI }; }, [cx, cy]);
    const dWant = Math.abs(wrap(r.want - r.exp));
    if (dWant < 1e-6 && r.off < 3) good++; else notes.push('(' + cx + ',' + cy + ') want off ' + dWant.toFixed(3) + ' travel off ' + r.off.toFixed(1) + '°');
  }
  ok('the mouse steers towards the pointer at the ' + label + ', zoom ' + z.zoom.toFixed(2) + ', view ' + Math.round(z.w) + '×' + Math.round(z.h) + ' (6 pointer places)', good === pts.length, good + '/' + pts.length + ' ' + notes.join(' | '));
  if (train === 0) {
    /* A held button bursts; the right button opens no menu. */
    await p.evaluate(() => { window.__sim.lay(10); window.__menu = null; document.addEventListener('contextmenu', e => { window.__menu = e.defaultPrevented; }); });
    await p.mouse.move(900, 300); await p.mouse.down();
    const d1 = await p.evaluate(() => { window.__drive(2); return { burst: window.__sim.input.burst, bursting: window.__sim.you.bursting }; });
    await p.mouse.up();
    const d2 = await p.evaluate(() => { window.__drive(2); return { burst: window.__sim.input.burst }; });
    ok('a held mouse button bursts and release stops it', d1.burst === true && d1.bursting === true && d2.burst === false, JSON.stringify({ d1, d2 }));
    await p.mouse.click(900, 300, { button: 'right' });
    await p.waitForTimeout(200);
    const menu = await p.evaluate(() => window.__menu);
    ok('right-clicking the game opens no menu (contextmenu default prevented)', menu === true, String(menu));
    const dRight = await p.evaluate(() => { window.__drive(2); return window.__sim.input.burst; });
    ok('the right button released: no burst left behind', dRight === false, String(dRight));
  }
  await p.close();
}

await desk.close();
const real = errs.filter(e => !/popErrorScope/.test(e));
ok('no console errors', real.length === 0, JSON.stringify([...new Set(real)]).slice(0, 400));
clearTimeout(die); await b.close(); process.exit(bad ? 1 : 0);
