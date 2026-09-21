/* The seabed, generated once into a tileable texture.
 *
 * Sand with a fine grain, scattered rubble, darker reef patches and lighter
 * sand patches. Measured off Nathan's second reference photo, whose contrast
 * GROWS with size: about 3 per cent in the finest grain, 7 per cent at a
 * fifth of a wingspan and 10 per cent at a wingspan and above. A floor with
 * flat contrast at every scale reads as noise; one whose big shapes carry the
 * contrast reads as a place.
 *
 * TILEABLE, the same way caustics.js is: every sine's frequency vector is an
 * INTEGER over the tile, and every hash grid divides the texture exactly, so
 * the edges meet and a scrolling sample never drags a seam across the screen.
 *
 * One tile is TILE_UNITS of world, so the scales above are real distances: a
 * wingspan is 40 units, and a fifth of one is 8.
 */
import { RenderTarget, UnsignedByteType, QuadMesh, NodeMaterial, RendererUtils, LinearFilter, RepeatWrapping } from 'three';
import { Fn, float, uv, sin, floor, fract, rand, step, vec2, vec4, mix, smoothstep } from 'three/tsl';

const SIZE = 1024;
/* 300 world units a tile: the largest features land at a wingspan and above,
   and one texel is 0.29 units, finer than a CSS pixel on the test phone. */
export const TILE_UNITS = 300;

const TAU = Math.PI * 2;
const waves = (p, list) => {
  let s = float(0);
  for (const [a, b, ph] of list) s = s.add(sin(p.x.mul(a * TAU).add(p.y.mul(b * TAU)).add(ph)));
  return s.div(list.length);
};

export function createSeabed () {
  const rt = new RenderTarget(SIZE, SIZE, { type: UnsignedByteType, depthBuffer: false, stencilBuffer: false });
  rt.texture.wrapS = rt.texture.wrapT = RepeatWrapping;
  rt.texture.minFilter = rt.texture.magFilter = LinearFilter;
  rt.texture.generateMipmaps = false;

  const mat = new NodeMaterial();
  mat.fragmentNode = Fn(() => {
    const p = uv();

    /* Reef and sand patches, one to three cycles across the tile — 100 to 300
       world units, a wingspan and above. The largest contrast, about 10 per
       cent, and the thing that makes the floor a place rather than a texture. */
    const big = waves(p, [[1, 0, 0.0], [0, 1, 1.9], [1, 1, 3.3], [2, -1, 5.1]]);
    /* Reef is darker and patchier than sand is lighter, so the big term is
       pushed rather than used straight. */
    const reef = smoothstep(float(0.15), float(0.75), big).mul(0.16);
    const sand = smoothstep(float(-0.10), float(-0.70), big).mul(0.11);

    /* A fifth of a wingspan is 8 units, which is 37 cycles across the tile. */
    const mid = waves(p, [[37, 24, 0.7], [24, 37, 2.2], [53, -11, 4.4], [11, 53, 0.3]]).mul(0.12);

    /* The finest grain: one hashed value per texel-ish cell, 3 per cent. */
    const grain = rand(floor(p.mul(SIZE))).sub(0.5).mul(0.035);

    /* Rubble: sparse brighter speckles, a few per wingspan. */
    const rubCell = floor(p.mul(220.0));
    const rubble = step(float(0.978), rand(rubCell.add(vec2(7.0, 3.0)))).mul(0.16);

    const v = float(0.5).sub(reef).add(sand).add(mid).add(grain).add(rubble);
    return vec4(v, v, v, 1.0);
  })();

  const quad = new QuadMesh(mat);
  let baked = false, ms = 0;
  let rendererState;

  function bake (renderer) {
    if (baked) return;
    const t0 = performance.now();
    rendererState = RendererUtils.resetRendererState(renderer, rendererState);
    renderer.setRenderTarget(rt);
    quad.material = mat;
    quad.render(renderer);
    renderer.setRenderTarget(null);
    RendererUtils.restoreRendererState(renderer, rendererState);
    ms = performance.now() - t0;
    baked = true;
  }

  return {
    bake, size: SIZE, tile: TILE_UNITS,
    get texture () { return rt.texture; },
    get baked () { return baked; },
    get ms () { return ms; },
    dispose () { try { rt.dispose(); mat.dispose(); } catch (e) {} },
  };
}
