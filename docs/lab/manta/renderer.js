/* The renderer, the automatic fallback and the frame loop.
 *
 * Nothing in here knows what is being drawn. It is handed a scene and a camera
 * and a set of hooks, and its whole job is to get a backend up, keep it up,
 * and say honestly which one is running.
 *
 * THE AUTOMATIC FALLBACK is a game rule and not a lab nicety. Chromium 141
 * reproduces the case exactly: WebGPU initialises cleanly and then the first
 * draw throws, because r186 sends swizzle as a string on every texture view
 * and that build wants a dictionary. Somebody on an older Chrome has to get a
 * game, not an apology, so the page rebuilds itself on WebGL2 and carries on.
 *
 * Two things make that harder than it looks.
 *
 * A canvas keeps the first context type it is ever given. Once
 * getContext('webgpu') has been called on it, getContext('webgl2') returns
 * null for the rest of its life, so the fallback has to swap in a new canvas
 * element. Reusing the old one draws nothing, and draws nothing silently.
 *
 * And a backend that dies on frame 400 is not the same event as one that never
 * drew at all. Only the opening frames are on probation; after that a throw
 * stops the loop and is reported.
 */
import { WebGPURenderer } from 'three';

const PROBATION = 10;

export function createLab ({ scene, camera, forceWebGL, hooks }) {
  let canvas = document.getElementById('gl');
  let renderer = null;
  let fellBack = false;
  let goodFrames = 0;
  let firstFrameClaimed = false;

  const pixelRatio = () => Math.min(devicePixelRatio, 2);

  async function build (force, tag) {
    const r = new WebGPURenderer({ canvas, antialias: true, forceWebGL: force });
    r.setPixelRatio(pixelRatio());
    r.setSize(innerWidth, innerHeight, false);
    performance.mark('manta:' + tag + '-start');
    await r.init();
    performance.mark('manta:' + tag + '-end');
    return r;
  }

  function freshCanvas () {
    const old = canvas;
    canvas = document.createElement('canvas');
    canvas.id = 'gl';
    old.replaceWith(canvas);
  }

  function isWebGPU () { return renderer && renderer.backend.isWebGPUBackend === true; }

  /* The WebGL2 renderer string, where the browser exposes it. Many hide it
     behind the debug extension and some hide it outright, so a plain RENDERER
     read is the floor. */
  function glRendererString () {
    try {
      const gl = renderer.backend.gl;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const v = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      return v ? String(v) : null;
    } catch (e) { return null; }   // not exposed on this device, which is an answer too
  }

  function announce () {
    hooks.onBackend({
      webgpu: isWebGPU(),
      forced: forceWebGL,
      fellBack,
      glString: isWebGPU() ? null : glRendererString(),
    });
  }

  async function fallBack (what, err) {
    if (fellBack || forceWebGL) return false;
    fellBack = true;
    if (renderer) {
      try { renderer.setAnimationLoop(null); } catch (e) {}
      try { await renderer.dispose(); } catch (e) {}
      renderer = null;
    }
    freshCanvas();
    try {
      renderer = await build(true, 'init2');
    } catch (e) {
      hooks.onError('WebGPU failed, and so did the WebGL2 rebuild', e);
      return false;
    }
    hooks.onNote('WebGPU failed here, so this is drawing on WebGL2 instead. ' + what, err);
    /* Everything holding GPU resources belongs to the renderer that just
       died. The light memory and the post stack are rebuilt against the new
       one before the loop restarts. */
    hooks.onRebuild(renderer);
    /* Measure the backend that is actually running, not the one that died. */
    goodFrames = 0; firstFrameClaimed = false;
    hooks.onReset();
    resize();
    announce();
    loop();
    return true;
  }

  let prevNow = null;
  function loop () {
    renderer.setAnimationLoop(() => {
      const now = performance.now();
      /* Clamped: a hidden tab must not hand the light memory a one-second
         step and wipe it, or the mantas a teleport. */
      /* The RAW wall time between frames, unclamped. The quality controller
         is judged on this and not on the clamped dt below: the clamp exists
         so a hidden tab cannot teleport anything, and feeding it to the
         controller would report a sleeping device as a fast one. */
      const rawMs = prevNow === null ? 1000 / 60 : now - prevNow;
      const dt = prevNow === null ? 1 / 60 : Math.min(Math.max((now - prevNow) / 1000, 1 / 240), 0.1);
      prevNow = now;
      try {
        hooks.onUpdate(now, dt);
        /* Offscreen work first: the light memory has to be a finished frame
           before the ocean shader samples it. */
        hooks.onBeforeRender(renderer, dt);
        hooks.onDraw(renderer, scene, camera);
      } catch (e) {
        renderer.setAnimationLoop(null);
        if (!forceWebGL && !fellBack && goodFrames < PROBATION) { fallBack('First draw threw.', e); return; }
        hooks.onError('render', e);
        return;
      }
      goodFrames++;
      if (!firstFrameClaimed) {
        firstFrameClaimed = true;
        /* Timed on the animation frame after the first render is submitted, so
           it is closer to when the pixels were presented than to when the work
           was queued. */
        requestAnimationFrame(() => hooks.onFirstFrame(renderer));
      }
      hooks.onFrame(now, renderer, rawMs);
    });
  }

  function resize () {
    const w = innerWidth, h = innerHeight;
    hooks.onFit(w, h);
    if (renderer) { renderer.setPixelRatio(pixelRatio()); renderer.setSize(w, h, false); }
  }

  async function start () {
    resize();
    try {
      renderer = await build(forceWebGL, 'init');
    } catch (e) {
      /* Three.js has its own fallback inside init(), so reaching here means
         both backends refused. Try the rebuild anyway: it is one more attempt
         on a fresh canvas and it costs nothing when it fails. */
      if (!forceWebGL && await fallBack('renderer.init() rejected.', e)) return true;
      hooks.onError('renderer init', e);
      return false;
    }
    announce();
    loop();
    return true;
  }

  addEventListener('resize', resize);
  addEventListener('orientationchange', () => setTimeout(resize, 120));

  /* Stopping the loop on demand. A browser test that wants to compare where
     a manta is with what the pixels show has to freeze both at the same
     instant; without this the scene moves between reading the positions and
     taking the screenshot, which is about twenty world units at cruise. */
  /* A resolution step, and nothing else. It deliberately does NOT go through
     onFit: the camera frustum, the manta layout and the light memory's world
     coverage all depend only on CSS geometry, which a change of backing-store
     density does not alter. Rebuilding them on every rung would be the
     130 ms hitch NOTES.md already records paying for once. */
  function setPixelRatio (r) {
    if (!renderer) return;
    renderer.setPixelRatio(r);
    renderer.setSize(innerWidth, innerHeight, false);
  }

  function pause () { if (renderer) renderer.setAnimationLoop(null); }
  function resume () { if (renderer) loop(); }

  return { start, resize, pause, resume, setPixelRatio, get renderer () { return renderer; } };
}
