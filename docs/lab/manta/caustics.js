/* The moonlit seabed's caustic web, baked once into a small tileable texture.
 *
 * Moonlight refracted through the waves lays a slow, flowing web of light
 * across the seabed (doc v1.6, 7.2). The web itself is expensive to evaluate
 * per pixel every frame and does not need to be: it is the same pattern all
 * the time, only moving. So it is generated once at startup into a 256 square
 * texture and sampled twice per pixel afterwards.
 *
 * TILEABLE, and that is the whole trick. The pattern is a sum of sines whose
 * frequency vectors are INTEGERS over the tile, so every one of them has a
 * whole number of cycles across the texture and the edges meet exactly. Any
 * non-integer frequency, or any noise function without a period, leaves a
 * seam that a scrolling sample drags across the screen once a second.
 *
 * The web is where that sum passes through zero: caustics are the folds of a
 * refracted wavefront, which is a curve, not a blob. Raising (1 - |sum|) to a
 * power turns those crossings into thin bright lines.
 *
 * The r186 pattern here — RenderTarget, QuadMesh, NodeMaterial, and
 * RendererUtils.reset/restore around setRenderTarget — is the same one
 * lightmemory.js uses, which is the same one the vendored bloom addon uses.
 */
import { RenderTarget, UnsignedByteType, QuadMesh, NodeMaterial, RendererUtils, LinearFilter, RepeatWrapping } from 'three';
import { Fn, float, uv, sin, abs, max, pow, vec4 } from 'three/tsl';

const SIZE = 256;

/* Integer frequency vectors, so the tile is seamless. Six of them at angles
   that do not line up, which is what stops the web reading as a plaid. */
const WAVES = [
  [1, 0, 0.00], [0, 1, 1.13], [2, 1, 2.41],
  [1, 2, 3.77], [3, -1, 5.02], [-1, 3, 0.64],
];

const TAU = Math.PI * 2;

export function createCaustics () {
  const rt = new RenderTarget(SIZE, SIZE, {
    type: UnsignedByteType, depthBuffer: false, stencilBuffer: false,
  });
  /* Repeat, because the whole point is that it tiles; linear, because a
     caustic edge that steps is a caustic edge nobody believes. */
  rt.texture.wrapS = rt.texture.wrapT = RepeatWrapping;
  rt.texture.minFilter = rt.texture.magFilter = LinearFilter;
  rt.texture.generateMipmaps = false;

  const mat = new NodeMaterial();
  mat.fragmentNode = Fn(() => {
    const p = uv();
    let sum = float(0);
    for (const [a, b, phase] of WAVES) {
      sum = sum.add(sin(p.x.mul(a * TAU).add(p.y.mul(b * TAU)).add(phase)));
    }
    /* Normalised to roughly -1..1, then the zero crossings become ridges. */
    const f = sum.div(WAVES.length);
    const ridge = pow(max(float(1.0).sub(abs(f).mul(6.0)), float(0.0)), float(1.6));
    return vec4(ridge, ridge, ridge, 1.0);
  })();

  const quad = new QuadMesh(mat);
  let baked = false;
  let rendererState;

  /* Once. Nothing about the web changes after this; what moves is where it is
     sampled from. */
  function bake (renderer) {
    if (baked) return;
    rendererState = RendererUtils.resetRendererState(renderer, rendererState);
    renderer.setRenderTarget(rt);
    quad.material = mat;
    quad.render(renderer);
    renderer.setRenderTarget(null);
    RendererUtils.restoreRendererState(renderer, rendererState);
    baked = true;
  }

  return {
    bake,
    get texture () { return rt.texture; },
    get baked () { return baked; },
    size: SIZE,
    dispose () { try { rt.dispose(); mat.dispose(); } catch (e) {} },
  };
}
