/* Manta trains: the look spike. Entry point, and the only place the parts are
 * wired to each other.
 *
 *   params.js       the tunable numbers, and their defaults
 *   panel.js        every number on screen, and the chip it collapses to
 *   scene.js        the scene, and the camera's fixed view area
 *   ocean.js        the ocean layers and the plankton, one shader
 *   lightmemory.js  the fading texture every moving thing stamps into
 *   mantas.js       one instanced mesh, ten mantas, wings flexed in TSL
 *   renderer.js     the backend, the automatic WebGL2 fallback and the loop
 *
 * Imported by relative path from the same folder. No build step, no bundler,
 * nothing added to the import map.
 */
import { REVISION } from 'three';
import * as panel from './panel.js';
import { P } from './params.js';
import { createScene, describeView } from './scene.js';
import { useLightMemory, uViewW, uViewH } from './ocean.js';
import { createLightMemory } from './lightmemory.js';
import { createLab } from './renderer.js';
import { createMantas, COUNT } from './mantas.js';

const query = new URLSearchParams(location.search);
/* ?fx=off builds the page without the light memory, the plankton or anything
   that reads them, so the cost of the look can be measured against the bare
   scene on a real phone rather than guessed at. */
export const FX = query.get('fx') !== 'off';

panel.initRows(REVISION);
panel.probeAdapter();

/* Before the scene: the ocean shader is built once, and whether it carries a
   plankton term at all depends on whether there is a light memory to read. */
const lm = FX ? createLightMemory(COUNT) : null;
if (lm) useLightMemory(lm);

const { scene, camera, fit, view } = createScene();
const mantas = createMantas(scene);
panel.set('mantas', String(mantas.count) + ' in 1 instanced mesh');
panel.set('lm', lm ? (lm.size + '×' + lm.size + '  ·  ' + lm.note) : 'off (?fx=off)');

window.__lab = { scene, camera, view, mantas, lm, FX };
/* lab is assigned below, once createLab has run. */

/* ------------------------------------------------------ stamping the wake */

/* Where each manta was last frame, so it can be stamped along the segment it
   swept rather than at a point. A fast manta must paint a line. */
const prevX = new Float32Array(COUNT), prevZ = new Float32Array(COUNT);
let havePrev = false;
let lmAttached = false;

/* Tuned against the render, not guessed: with a fade of 0.985 a pixel under a
   passing manta accumulates about fifty frames of this before it clears, so
   the per-frame figure is small by design. */
/* 0.0018, and the ceiling is measured rather than guessed.
  
   The phone reports 60 fps on both backends with a worst 1% of 17.7 ms and
   four draw calls, so the light memory costs almost nothing and there is no
   reason for it to be faint. But at 0.0030 the hierarchy inverts: the wake
   measured 63 against a dim manta's 56, so the water became brighter than an
   unattached manta and that manta's contrast with its own surroundings fell
   to 1.63. At 0.0018 the order holds and the dim manta still reads at 3.39
   times the water around it.
  
   Together with a fade of 0.993 this is about two and a half times the
   deposit and two and a half times the persistence of what was on the phone
   before. */
const STAMP_BASE = 0.0018;
const CRUISE = 120;               // world units a second, the reference speed

function stampMantas (dt) {
  if (!lm) return;
  const { aPos, aSize, aTint } = mantas;
  for (let i = 0; i < COUNT; i++) {
    const x = aPos.getX(i), z = aPos.getZ(i);
    const x0 = havePrev ? prevX[i] : x, z0 = havePrev ? prevZ[i] : z;
    const moved = Math.hypot(x - x0, z - z0);
    /* A manta that has wrapped across the world did not swim that line, so it
       stamps a point rather than a stripe across the whole ocean. */
    const jumped = moved > 200;
    const speed = dt > 0 ? moved / dt : 0;
    const speedFactor = Math.min(Math.max(speed / CRUISE, 0.25), 1.5);
    const s = STAMP_BASE * P.stamp * (dt * 60) * speedFactor;
    lm.stamp(i,
      jumped ? x : x0, jumped ? z : z0, x, z,
      aSize.getX(i) * 1.2,                       // about 1.2 wingspans
      aTint.getX(i), aTint.getY(i), aTint.getZ(i), s);
    prevX[i] = x; prevZ[i] = z;
  }
  havePrev = true;
}

/* ---------------------------------------------------------------- the lab */

const lab = createLab({
  scene,
  camera,
  forceWebGL: panel.FORCE_WEBGL,
  hooks: {
    onFit (w, h) {
      const v = fit(w, h);
      mantas.setBounds(v);
      uViewW.value = v.w; uViewH.value = v.h;
      if (lm) lm.setView(v);
      panel.set('view', describeView(v));
      panel.set('viewport', panel.describeViewport());
    },
    onBackend ({ webgpu, forced, fellBack, glString }) {
      panel.announce(
        webgpu ? 'WebGPU' : 'WebGL2',
        webgpu ? '' : 'webgl2',
        forced   ? 'fallback forced with ?backend=webgl2'
        : webgpu ? 'WebGPU was available and is in use'
        : fellBack ? 'WebGPU started and then could not draw, so this rebuilt itself on WebGL2 — the error is below'
        : 'WebGPU was not available, so Three.js fell back to WebGL2 during init'
      );
      if (glString && !panel.gpuInfoKnown()) panel.set('gpuinfo', glString);
    },
    /* The mantas are driven from the CPU: scripted paths in, instanced
       attributes out, once a frame before anything is drawn. */
    onUpdate (now, dt) {
      mantas.update(now / 1000);
      stampMantas(dt);
    },
    onBeforeRender (renderer, dt) {
      if (!lm) return;
      /* Probed once, on the first frame, before anything has been drawn into
         the targets: changing the texture type afterwards would be too late. */
      if (!lmAttached) { lm.attach(renderer); lmAttached = true;
        panel.set('lm', lm.size + '×' + lm.size + '  ·  ' + lm.note); }
      lm.setFade(P.fade);
      lm.render(renderer, dt);
    },
    onDraw (renderer, sc, cam) { renderer.render(sc, cam); },
    onRebuild (renderer) {
      /* The renderer that owned these has gone. Probe the new backend and let
         the targets reallocate against it. */
      lmAttached = false;
      havePrev = false;
    },
    onFrame (now, renderer) {
      panel.accountFrame(now);
      panel.set('draws', String(renderer.info.render.drawCalls));
    },
    onFirstFrame () { panel.markFirstFrame(); },
    onReset () { panel.resetFrames(); },
    onNote (what, e) { window.__labNote(what, e); },
    onError (what, e) { window.__labError(what, e); },
  },
});

window.__lab.lab = lab;
window.__lab.pause = () => lab.pause();
window.__lab.resume = () => lab.resume();
window.__lab.renderer = () => lab.renderer;

lab.start().then(ok => { if (ok) window.__labReady = true; });
