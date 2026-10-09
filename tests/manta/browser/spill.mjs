/* 4B: debris past the wild block is drawn as the block draws it. A room's
   570 wild mantas leave the block room for 110 scattered mantas at once
   (380 in solo), so a long train's crash in a room puts debris in the
   spill. Two identical loose mantas are laid in the solo lab's paused
   simulation, one in a block slot and one past the block, and the page's
   own drawing code (follow.js, through followCamera) dresses them; their
   drawn size and tint must match: sinking (half way: dimmed and shrunk),
   glowing (half its glow: brighter, in its train's colour) and plain.
   WebGL2, headless; nothing is stepped, so nothing moves them. */
import { chromium } from '../lib/tools.mjs';
const O = 'http://127.0.0.1:' + process.env.PORT;
const die = setTimeout(() => { console.log('WATCHDOG'); process.exit(3); }, 85000);
const b = await chromium.launch({ executablePath: process.env.CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1 })).newPage();
p.setDefaultTimeout(30000);
const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0, 160))); p.on('console', c => { if (c.type() === 'error') errs.push(c.text().slice(0, 160)); });
let bad = 0; const ok = (n, c, x = '') => { if (!c) bad++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x ? '  [' + x + ']' : '')); };
await p.goto(O + '/lab/manta/?tier=low&backend=webgl2&seed=4242&hint=0', { waitUntil: 'load' }).catch(e => console.log('goto ' + e.message));
await p.waitForFunction(() => window.__labReady === true, null, { timeout: 25000 }).catch(() => console.log('(no ready)'));
await p.waitForTimeout(1000);
const r = await p.evaluate(() => {
  const L = window.__lab, S = window.__sim, F = L.follower, M = L.mantas;
  L.pause();
  const SLOTS = M.WILD_SLOTS, BASE = M.WILD_BASE, sp = S.params;
  if (!(SLOTS > 0 && BASE > 0)) return { error: 'mantas does not expose WILD_SLOTS/WILD_BASE' };
  const x0 = S.you.x, z0 = S.you.z;
  while (S.wild.length < SLOTS + 4) S.wild.push({ alive: false, x: 1e5, z: 1e5, head: 0, loose: false, sinking: 0, glow: 0, wasColour: -1, colour: 0 });
  /* An unglowing manta in the block wears its slot's own colour, and in the
     spill its colour index's (WILD_BASE + colour): block slot 7 and colour 7
     wear the same, so the two can be compared exactly. */
  const inBlock = 7, past = SLOTS + 2;
  const lay = (i, dx, st) => Object.assign(S.wild[i] = { head: 0.5, colour: 7, born: -100, from: -1 }, { alive: true, x: x0 + dx, z: z0 + 60 }, st);
  const read = (slot) => ({ size: M.aSize.getX(slot), tint: [M.aTint.getX(slot), M.aTint.getY(slot), M.aTint.getZ(slot)] });
  const findAt = (x, z) => { for (let j = 0; j < M.drawn; j++) if (Math.abs(M.aPos.getX(j) - Math.fround(x)) < 1e-3 && Math.abs(M.aPos.getZ(j) - Math.fround(z)) < 1e-3) return j; return -1; };
  const cases = {
    sinking: { loose: true, sinking: sp.drain * 0.5, glow: 0, wasColour: -1, looseAt: -100 },
    glowing: { loose: true, sinking: 0, glow: sp.scatterGlow * 0.5, wasColour: S.you.id, looseAt: S.time },
    plain:   { loose: false, sinking: 0, glow: 0, wasColour: -1 },
  };
  const out = {};
  for (const [k, st] of Object.entries(cases)) {
    lay(inBlock, -40, st); lay(past, 40, st);
    F.followCamera(1 / 60); F.followCamera(1 / 60);
    const j = findAt(x0 + 40, z0 + 60);
    out[k] = { block: read(BASE + inBlock), spill: j >= 0 ? read(j) : null, spillSlot: j, blockSlot: BASE + inBlock };
  }
  return out;
}).catch(e => ({ error: e.message }));
if (r.error) ok('the page exposed its drawing', false, r.error);
else {
  const same = (a, b2) => a && b2 && Math.abs(a.size - b2.size) < 1e-4 && a.tint.every((v, i) => Math.abs(v - b2.tint[i]) < 1e-4);
  const fmt = q => q ? 'size ' + q.size.toFixed(3) + ' tint ' + q.tint.map(v => v.toFixed(3)).join('/') : 'not drawn';
  for (const k of ['sinking', 'glowing', 'plain'])
    ok('a ' + k + ' manta past the wild block is drawn as it is inside it', same(r[k].block, r[k].spill),
       'block slot ' + r[k].blockSlot + ': ' + fmt(r[k].block) + '; spill slot ' + r[k].spillSlot + ': ' + fmt(r[k].spill));
  ok('sinking half way shrinks it below a plain one, and glowing brightens it', r.sinking.spill && r.plain.spill && r.sinking.spill.size < r.plain.spill.size &&
     r.glowing.spill.tint.reduce((a, v) => a + v, 0) > 0, 'sinking ' + (r.sinking.spill && r.sinking.spill.size.toFixed(3)) + ' against plain ' + (r.plain.spill && r.plain.spill.size.toFixed(3)));
}
ok('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
await b.close(); clearTimeout(die); process.exit(bad ? 1 : 0);
