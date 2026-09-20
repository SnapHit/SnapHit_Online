/* Manta trains: the look spike. Entry point, and the only place the parts are
 * wired to each other.
 *
 *   panel.js     every number on screen, and the chip it collapses to
 *   scene.js     the scene, and the camera's fixed view area
 *   ocean.js     the three ocean layers, one shader, no geometry
 *   renderer.js  the backend, the automatic WebGL2 fallback and the loop
 *
 * Imported by relative path from the same folder. No build step, no bundler,
 * nothing added to the import map.
 */
import { REVISION } from 'three';
import * as panel from './panel.js';
import { createScene, describeView } from './scene.js';
import { createLab } from './renderer.js';

panel.initRows(REVISION);
panel.probeAdapter();

const { scene, camera, fit, view } = createScene();

/* A debug handle. This is a lab page, and a browser test has to be able to
   assert the camera's real frustum rather than the row that describes it. */
window.__lab = { scene, camera, view };

const lab = createLab({
  scene,
  camera,
  forceWebGL: panel.FORCE_WEBGL,
  hooks: {
    onFit (w, h) {
      panel.set('view', describeView(fit(w, h)));
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
    onUpdate (now) { /* Brief 1A stage 2 drives the mantas from here. */ },
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
