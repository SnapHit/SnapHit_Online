/* Manta trains: the look spike. Entry point, and the only place the parts are
 * wired to each other.
 *
 *   panel.js     every number on screen, and the chip it collapses to
 *   scene.js     the scene, and the camera's fixed view area
 *   ocean.js     the three ocean layers, one shader, no geometry
 *   mantas.js    one instanced mesh, ten mantas, wings flexed in TSL
 *   renderer.js  the backend, the automatic WebGL2 fallback and the loop
 *
 * Imported by relative path from the same folder. No build step, no bundler,
 * nothing added to the import map.
 */
import { REVISION } from 'three';
import * as panel from './panel.js';
import { createScene, describeView } from './scene.js';
import { createLab } from './renderer.js';
import { createMantas } from './mantas.js';

panel.initRows(REVISION);
panel.probeAdapter();

const { scene, camera, fit, view } = createScene();

/* A debug handle. This is a lab page, and a browser test has to be able to
   assert the camera's real frustum rather than the row that describes it. */
const mantas = createMantas(scene);
panel.set('mantas', String(mantas.count) + ' in 1 instanced mesh');

window.__lab = { scene, camera, view, mantas };

const lab = createLab({
  scene,
  camera,
  forceWebGL: panel.FORCE_WEBGL,
  hooks: {
    onFit (w, h) {
      const v = fit(w, h);
      mantas.setBounds(v);
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
       attributes out, once a frame before the draw. */
    onUpdate (now) { mantas.update(now / 1000); },
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

lab.start().then(ok => { if (ok) window.__labReady = true; });
