/* The ocean: three layers, all of it in one shader, no geometry.
 *
 * It is the scene's background node, so it costs one full-screen pass and no
 * draw call of its own. The design doc's phone budget is written around that:
 * "the plankton lives in a shader, so cost scales with pixels rather than
 * object counts."
 *
 * Every name here was checked against docs/vendor/three/r186/, not against
 * memory or an online example.
 *
 * Layers, back to front:
 *   1. the water, a vertical gradient from #060b14 near the surface to
 *      #02040a at depth, breathing slowly so it is never a flat wash;
 *   2. the seabed, faint and mottled, drifting on its own slow parallax so
 *      the water reads as having something under it;
 *   3. the surface ripple, thin bright bands over everything at low opacity.
 *
 * Bloom, the light memory texture and the grade are Brief 1B. Nothing here
 * assumes they are absent; they layer on top.
 *
 * No noise texture and no MaterialX noise: the pattern is layered sines, which
 * compile identically on WebGPU and WebGL2 and cost a handful of ALU ops a
 * pixel. Colours are to be tuned on the phone.
 */
import { Fn, vec2, color, float, mix, sin, smoothstep, screenUV, time, uniform } from 'three/tsl';

/* Screen aspect, pushed in from fit() rather than read from a screen-size
   node, so the pattern is never stretched and the plumbing stays explicit. */
export const uAspect = uniform(1.0);

/* color() and not vec3(): the renderer's working space is linear and its
   output is sRGB, so a hex written straight in as a vec3 is read as a linear
   value and comes out about four times too bright. Sampled in headless
   Chromium, #060b14 as a raw vec3 rendered as rgb(37,57,78). color() runs the
   sRGB to linear conversion, so the hex on screen is the hex written here. */
/* Blue, and blue by HUE rather than by brightness. The first palette was
   dark enough to read as black rather than as water, but simply lifting it
   is not available: the dim tier of mantas sits at about rgb(38,64,71), and
   water brightened to meet it stops being a background. So red and green come
   down and blue goes up at roughly the same luminance — #060b14 had its blue
   1.6 times its green, this has it 2.2 times — and the seabed stays teal so
   the world still reads blue-GREEN, which is what section 7.2 asks for. */
const WATER_TOP  = color(0x061228);
const WATER_DEEP = color(0x01040c);
const SEABED     = color(0x0b2430);
const RIPPLE     = color(0x0f3352);

/* 0.16, down from 0.25, and the ripple with it. Pushing the water blue lifted
   its bright crests to a luminance of 34 while the dim tier of mantas sits at
   59: a separation of 1.7, where the first palette had 3.4. The hierarchy is
   the one thing section 7.2 calls non-negotiable, and an unattached manta that
   only just beats a seabed crest is not dim, it is lost. The blue stays in the
   base water, which is what was asked for; the additive layers give up the
   headroom instead. */
const SEABED_LEVEL = 0.16;
/* "Low opacity", but measured rather than guessed. At 0.16 of the original
   dim colour the ripple was a sub-one-in-255 modulation and invisible. It is
   0.18 of a brighter blue now, which is about the same on screen as the 0.30
   it was, but costs less headroom. */
const RIPPLE_LEVEL = 0.18;

export function oceanNode () {
  return Fn(() => {
    /* screenUV.y is 0 at the TOP and 1 at the bottom. r186's ScreenNode
       documents its coordinate as "according to WebGPU standards" and flips
       it on WebGL so both backends agree, which is why the same code works on
       either. Checked in the vendored source, then confirmed by sampling the
       render: an earlier guess had this upside down. */
    const t = time;
    const p = vec2(screenUV.x.mul(uAspect), screenUV.y);

    /* 1. the water. The gradient breathes very slowly, and a wide slow wave
          across it stops the horizontal banding a pure vertical ramp shows on
          an 8-bit display. */
    const band = screenUV.y
      .add(sin(p.x.mul(2.1).add(t.mul(0.045))).mul(0.055))
      .add(sin(t.mul(0.021)).mul(0.05));
    const water = mix(WATER_TOP, WATER_DEEP, smoothstep(float(-0.15), float(1.05), band));

    /* 2. the seabed, on its own slow drift. Three sines at different angles
          and frequencies give a soft mottle with no repeat you can pick out
          at this brightness, and the whole field creeps so the ocean has a
          floor moving under it. */
    const q = vec2(p.x.mul(3.1).add(t.mul(0.0075)), p.y.mul(5.3).add(t.mul(0.0115)));
    const n1 = sin(q.x.add(sin(q.y.mul(1.7)).mul(1.3))).mul(0.5).add(0.5);
    const n2 = sin(q.x.mul(2.3).sub(q.y.mul(1.1)).add(1.7)).mul(0.5).add(0.5);
    const n3 = sin(q.y.mul(3.7).add(q.x.mul(0.6)).sub(2.2)).mul(0.5).add(0.5);
    const bed = n1.mul(0.5).add(n2.mul(0.3)).add(n3.mul(0.2));
    /* Squared, so the faint patches stay dark and only the crests show. */
    const seabed = SEABED.mul(bed.mul(bed).mul(SEABED_LEVEL));

    /* 3. the surface ripple. Two crossing waves, and only the tops of their
          product are kept, which gives short broken highlights rather than
          stripes. */
    /* p.x is already multiplied by the aspect, so a frequency here counts
       cycles across the SHORT side. At 21 and 16 the bands measured 90 to
       115 px on a 412-wide phone, which reads as a broad shimmer rather than
       a ripple; 34 and 30 put them near 55 px in portrait. */
    const r1 = sin(p.x.mul(34.0).add(p.y.mul(13.0)).add(t.mul(0.55)));
    const r2 = sin(p.y.mul(30.0).sub(p.x.mul(9.0)).sub(t.mul(0.40)));
    const crest = smoothstep(float(0.40), float(1.0), r1.mul(r2));
    const ripple = RIPPLE.mul(crest.mul(RIPPLE_LEVEL));

    return water.add(seabed).add(ripple);
  })();
}
