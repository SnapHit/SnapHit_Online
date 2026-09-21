/* The light memory.
 *
 * A texture around the camera that fades a little every frame and is stamped
 * by everything that moves through the water. The plankton shader reads it, so
 * a manta's wake glows behind it and the ocean keeps a fading painting of what
 * has happened in it. Section 7.2 calls this the signature effect.
 *
 * TWO TARGETS, PING-PONGED, and the rule is never to sample the one being
 * written. Each frame reads A and writes B, then swaps, so the texture the
 * shader samples is always a finished frame.
 *
 * ONE PASS, NOT TWO. The fade and the stamps happen in the same full-screen
 * pass: it reads the previous target, multiplies it down, and adds every
 * manta's contribution computed analytically from uniforms. That avoids a
 * second draw with additive blending and the renderer-state juggling that
 * comes with it, and the cost is ten capsule-distance evaluations a pixel at
 * 512 by 512, which is the kind of cost the design doc's phone budget is
 * written around: it scales with pixels, not with how many mantas there are.
 *
 * STAMPED ALONG THE SEGMENT the manta moved since the last frame, not at a
 * point, so a fast manta paints a line rather than a dotted trail.
 *
 * The r186 pattern here — RenderTarget, QuadMesh, RendererUtils.reset/restore
 * around setRenderTarget — is copied from the vendored bloom addon, which is
 * the same version and known to work on both backends.
 */
import {
  RenderTarget, HalfFloatType, UnsignedByteType, QuadMesh, NodeMaterial,
  RendererUtils, Vector4,
} from 'three';
import {
  Fn, uv, vec3, vec4, float, texture, uniform, uniformArray,
  clamp, dot, length, max, smoothstep,
} from 'three/tsl';

export const LM_SIZE_DEFAULT = 512;

/* The covered square, as a multiple of the longer view side. Wider than the
   view so a wake that leaves the screen does not clip at the edge. */
const COVER = 1.15;

export function createLightMemory (count) {
  let size = LM_SIZE_DEFAULT;
  let halfFloat = true;
  let note = 'half float';

  const opts = () => ({ depthBuffer: false, stencilBuffer: false, type: halfFloat ? HalfFloatType : UnsignedByteType });
  let rtA = new RenderTarget(size, size, opts());
  let rtB = new RenderTarget(size, size, opts());

  const uFade = uniform(1.0);
  const uHalf = uniform(500);                        // half extent, world units
  const segs = Array.from({ length: count }, () => new Vector4());
  const tints = Array.from({ length: count }, () => new Vector4());
  const uSeg = uniformArray(segs, 'vec4');           // x0, z0, x1, z1
  const uTint = uniformArray(tints, 'vec4');         // rgb premultiplied by strength, w = radius

  /* The texture the pass reads. Its value is swapped each frame rather than
     the material being rebuilt: a TextureNode's value is a uniform binding. */
  const uPrev = texture(rtA.texture);

  const passMat = new NodeMaterial();
  passMat.name = 'manta_lightmemory';
  passMat.fragmentNode = Fn(() => {
    const q = uv();
    /* Quad uv to world xz. The same mapping runs in reverse in the ocean
       shader, so the two agree by construction. */
    const p = q.sub(0.5).mul(uHalf.mul(2.0));

    let acc = vec3(0.0);
    for (let i = 0; i < count; i++) {
      const s = uSeg.element(i);
      const t = uTint.element(i);
      /* Distance from this pixel to the segment the manta swept. */
      const ab = s.zw.sub(s.xy);
      const ap = p.sub(s.xy);
      const h = clamp(dot(ap, ab).div(max(dot(ab, ab), float(1e-4))), 0.0, 1.0);
      const d = length(ap.sub(ab.mul(h)));
      /* Squared falloff: a soft core rather than a flat disc. */
      const f = smoothstep(t.w, float(0.0), d);
      acc = acc.add(t.xyz.mul(f.mul(f)));
    }

    const prev = texture(uPrev, q).rgb.mul(uFade);
    return vec4(prev.add(acc), 1.0);
  })();

  const quad = new QuadMesh(passMat);
  /* undefined, NOT null. RendererUtils.saveRendererState takes the state as a
     default parameter (state = {}), which fires for undefined and not for
     null, so a null here throws on the first frame. The vendored bloom addon
     writes `let _rendererState;` for exactly this reason. */
  let rendererState;
  let enabled = true;

  /* Half float render targets are core on WebGPU and an extension on WebGL2.
     Probed once, after the backend is up and before anything has been drawn,
     so switching the type costs nothing. */
  function attach (renderer) {
    let ok = true;
    if (renderer.backend.isWebGPUBackend !== true) {
      try {
        const gl = renderer.backend.gl;
        ok = !!(gl.getExtension('EXT_color_buffer_half_float') || gl.getExtension('EXT_color_buffer_float'));
      } catch (e) { ok = false; }
    }
    if (!ok) {
      halfFloat = false;
      note = 'unsigned byte — half float render targets unavailable on this backend';
      rtA.texture.type = UnsignedByteType;
      rtB.texture.type = UnsignedByteType;
    }
  }

  /* A copy of whatever is currently in the memory, for resizing. */
  const copyTex = texture(rtA.texture);
  const copyMat = new NodeMaterial();
  copyMat.name = 'manta_lightmemory_copy';
  copyMat.fragmentNode = Fn(() => vec4(texture(copyTex, uv()).rgb, 1.0))();

  /* RESAMPLE, do not clear. RenderTarget.setSize reallocates and throws the
     contents away, so a tier change would wipe every wake on screen at the
     exact moment the device is already struggling — a pop that looks far
     worse than the resolution drop it came from. This renders the old memory
     into new targets at the new size first, so the wake survives the change
     at whatever fidelity the new size allows. */
  function setSize (renderer, n) {
    if (n === size || !renderer) return false;
    const src = rtA;
    const nextA = new RenderTarget(n, n, opts());
    const nextB = new RenderTarget(n, n, opts());
    copyTex.value = src.texture;
    rendererState = RendererUtils.resetRendererState(renderer, rendererState);
    renderer.setRenderTarget(nextA);
    quad.material = copyMat;
    quad.render(renderer);
    renderer.setRenderTarget(null);
    RendererUtils.restoreRendererState(renderer, rendererState);
    try { rtA.dispose(); rtB.dispose(); } catch (e) {}
    rtA = nextA; rtB = nextB; size = n;
    out.value = rtA.texture;
    return true;
  }

  /* The covered square follows the view, so the same patch of water is
     covered whichever way the phone is held. */
  function setView (view) { uHalf.value = Math.max(view.w, view.h) * COVER * 0.5; }

  /* Called once a frame with where every manta was and is. */
  function stamp (i, x0, z0, x1, z1, radius, r, g, b, strength) {
    segs[i].set(x0, z0, x1, z1);
    tints[i].set(r * strength, g * strength, b * strength, radius);
  }
  function clearStamps () {
    for (let i = 0; i < count; i++) { tints[i].w = 0; tints[i].x = tints[i].y = tints[i].z = 0; }
  }

  function render (renderer, dt) {
    if (!enabled) return;
    /* pow(fade, dt*60) so the decay is the same at any frame rate. */
    uFade.value = Math.pow(Math.min(Math.max(uFadeBase, 0), 0.9999), Math.min(dt, 0.1) * 60);
    uPrev.value = rtA.texture;
    rendererState = RendererUtils.resetRendererState(renderer, rendererState);
    renderer.setRenderTarget(rtB);
    quad.material = passMat;
    quad.render(renderer);
    renderer.setRenderTarget(null);
    RendererUtils.restoreRendererState(renderer, rendererState);
    const t = rtA; rtA = rtB; rtB = t;      // the finished frame is now rtA
    out.value = rtA.texture;
  }

  let uFadeBase = 0.985;
  function setFade (v) { uFadeBase = v; }

  /* What the ocean shader samples: always the finished target, never the one
     being written. */
  const out = texture(rtA.texture);

  function dispose () { try { rtA.dispose(); rtB.dispose(); } catch (e) {} }

  return {
    attach, setSize, setView, stamp, clearStamps, render, setFade, dispose,
    out, uHalf,
    get size () { return size; },
    get note () { return note; },
    get enabled () { return enabled; },
    set enabled (v) { enabled = v; },
  };
}
