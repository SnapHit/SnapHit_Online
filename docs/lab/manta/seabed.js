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
import { Fn, float, uv, sin, floor, fract, rand, mod, step, vec2, vec4, mix, smoothstep, length } from 'three/tsl';

const SIZE = 1024;
/* 300 world units a tile: the largest features land at a wingspan and above,
   and one texel is 0.29 units, finer than a CSS pixel on the test phone. */
export const TILE_UNITS = 300;

const TAU = Math.PI * 2;

/* Tileable value noise. The lattice index is taken modulo N, so the pattern
   wraps exactly and the tile has no seam; the smoothstep interpolation is what
   keeps it from being a grid of hard cells.

   This replaces sums of sines. Four sines with integer frequencies interfere
   into a REGULAR lattice of humps — evenly sized soft round patches, which is
   exactly what Nathan saw mottling the whole frame in a blurred screenshot.
   Noise at several incommensurate grid sizes has no single scale in it at
   all, which is the thing the spectrum check is looking for. */
const vnoise = (p, N) => {
  const g = p.mul(N);
  const i = floor(g);
  const f = fract(g);
  const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0)));
  const h = (a, b) => rand(mod(i.add(vec2(a, b)), float(N)));
  return mix(mix(h(0, 0), h(1, 0), u.x), mix(h(0, 1), h(1, 1), u.x), u.y);
};

/* Several octaves at sizes that share no common factor, so nothing in the
   result repeats at a scale the eye can lock onto. */
const fbm = (p, sizes) => {
  let v = float(0), w = 0;
  let amp = 1;
  for (const n of sizes) { v = v.add(vnoise(p, n).mul(amp)); w += amp; amp *= 0.55; }
  return v.div(w);
};

export function createSeabed () {
  const rt = new RenderTarget(SIZE, SIZE, { type: UnsignedByteType, depthBuffer: false, stencilBuffer: false });
  rt.texture.wrapS = rt.texture.wrapT = RepeatWrapping;
  rt.texture.minFilter = rt.texture.magFilter = LinearFilter;
  rt.texture.generateMipmaps = false;

  const mat = new NodeMaterial();
  mat.fragmentNode = Fn(() => {
    const p = uv();

    /* Reef and sand patches at a wingspan and above: three octaves of noise
       rather than four sines, so the shapes are irregular and multi-scale.
       This carries the most contrast, as the reference photo's largest
       features do. */
    const big = fbm(p, [3, 5, 7]).sub(0.5);
    const reef = smoothstep(float(0.06), float(0.36), big).mul(0.16);
    const sand = smoothstep(float(-0.04), float(-0.34), big).mul(0.11);

    /* A fifth of a wingspan is about eight units, which is near 37 across the
       tile. 31, 43 and 59 share no factor with each other or with the octaves
       above. */
    const mid = fbm(p, [31, 43, 59]).sub(0.5).mul(0.24);

    /* The finest grain. It used to be one hash per texel, which is an
       axis-aligned lattice of dots and showed as exactly that under a
       contrast stretch. Two interpolated octaves at sizes that do not divide
       the texture give grain with no grid in it. */
    const grain = fbm(p, [211, 349]).sub(0.5).mul(0.07);

    /* Rubble: each speck sits at a HASHED POSITION inside its cell rather
       than filling the cell, so the specks are scattered instead of ruled. */
    const rc = p.mul(97.0);
    const rid = floor(rc), rf = fract(rc);
    const rpos = vec2(rand(rid.add(vec2(7.0, 3.0))), rand(rid.add(vec2(19.0, 11.0))));
    const rubble = step(length(rf.sub(rpos)), float(0.055))
      .mul(step(float(0.55), rand(rid.add(vec2(31.0, 5.0))))).mul(0.16);

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
