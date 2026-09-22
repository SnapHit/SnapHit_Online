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
import { Vector2 } from 'three';
import { Fn, vec2, vec3, color, clamp, exp, float, floor, fract, length, max, min, mix, pow, rand, sin, smoothstep, screenUV, texture, uniform } from 'three/tsl';
import { uTime } from './clock.js';
import { TILE_UNITS as SEABED_TILE } from './seabed.js';
import { U } from './params.js';
import { lightTarget } from './lighten.js';

/* Screen aspect, pushed in from fit() rather than read from a screen-size
   node, so the pattern is never stretched and the plumbing stays explicit. */
/* The reef's warm, its dark floor beyond the line, and how much of each.
   Levels are separate from the colours so the conditions can be re-measured
   against one number rather than a hue. */
const REEF_WARM = color(0xff7a2e);
const REEF_DEEP = color(0x1b0c07);
const REEF_RING_LEVEL = 0.115;
const REEF_EDGE_LEVEL = 0.055;
const REEF_WARN_LEVEL = 0.030;

/* CONDITION 2 BY CONSTRUCTION. 7.2 asks that the seabed's and the caustics'
   brightest crests stay below the dimmest manta's median, and for four
   sessions that passed or failed by where the camera happened to be: some
   patches of moonlit floor are far brighter than others, so the same build
   measured 61 in one place and 197 in another. A bar you can walk across is
   not a bar.

   So the moonlit water — the body, the floor, the caustics and the surface
   ripple, everything that is not life — is given a soft ceiling on its
   LUMINANCE before anything alive is added. Below the knee it is untouched,
   which is where ordinary ocean sits; above it, it approaches the ceiling
   and never reaches it. Hue is preserved because the cap scales the colour
   rather than clamping its channels, which 7.2 forbids.

   0.10 in linear luminance, against a manta's band floor of 0.248: no patch
   of water anywhere can come near an animal, wherever you are. */
const WATER_CAP = 0.10;
const WATER_KNEE = 0.055;

export const uAspect = uniform(1.0);
/* The view in world units, so a pixel can work out where in the ocean it is
   and read the light memory there. */
/* Where the camera is looking, in world units. */
export const uCam = uniform(new Vector2(0, 0));
export const uViewW = uniform(385);
export const uViewH = uniform(855);

/* The cut's shockwave: a ring expanding from a point, pushing the water
   outward. Amplitude zero means no distortion and the ring costs a few ALU
   ops a pixel, so it is always in the shader rather than being a second
   variant that would have to compile on first use — a stutter exactly when
   the set piece fires is the one thing it cannot afford. */
export const uShockC = uniform(new Vector2(0, 0));
export const uShockR = uniform(0);
export const uShockA = uniform(0);

/* The low tier drops the surface ripple. A uniform rather than a second
   shader variant: compiling a new one the moment the device is already
   struggling is exactly the wrong time to pay for it. */
export const uRippleOn = uniform(1);
/* The arena's radius, so the water knows where the reef is. Fed from the
   simulation's parameters, which own it. */
export const uArenaR = uniform(2000);


/* Blue-green, from the palette already in use. */
const PLANKTON = color(0x4fd8c8);
/* "An ambient 2 to 3 percent so the water has depth at rest." At the bottom
   of that range, for the headroom reason below. */
const PLANKTON_AMBIENT = 0.020;
/* RIBBON and SPARKLE: how much of the light memory shows as a smooth ribbon
   and how much as sparkle. The ribbon is what makes a wake readable at a
   glance; the sparkle is what makes it look alive.

   Both defaults (0.20 and 4.0) live in params.js now, so the tuning drawer can
   move them without a shader rebuild. The reasoning stays here.

   The split is the whole answer to a conflict the measurements turned up. A
   smooth glow bright enough to see lifts every pixel around it, so a dim manta
   swimming through a wake loses its contrast: measured at 1.43 times its
   surroundings inside a wake against 3.39 in clear water, with the same code.
   Sparkle carries the same sense of stirred, living water while leaving most
   of the pixels between the crests dark, so a silhouette still reads against
   it. Section 7.2 asks for both a glow and plankton; this is which of the two
   does the work.

   The ribbon went 0.45 to 0.17 once, chasing the hierarchy rule's "brightest
   water" figure, and that was a mistake: the figure barely responded (28.2 at
   0.19, 28.2 again at 0.17), because what sets it is the seabed crests and
   ripple this page already had, not the wake. On the phone the result was a
   trail you could barely see.

   The same thing was measured again, harder, under brief 1D: taking the ribbon
   from 0.20 to 0.05 moved an unattached manta's contrast against the water
   around it only from 2.25 to 2.37 times, and setting the DEPOSIT to zero
   moved it not at all (2.20 to 2.34). What lifts the water in the failing case
   is the bloom halo of a train manta a wingspan and a half away: with bloom
   strength at 0 the same frame reads 3.11 times. Neither of these two numbers
   is the lever for that, which is why neither was changed. */

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
/* Hue 195 where the moon reaches, 207 in shadow, saturation 0.93. */
const SEABED_LIT    = color(0x12c4ff);
const SEABED_SHADOW = color(0x1294ff);
/* Set so the lit centre's median lands near 35 on the suites' 0-255 scale,
   where the old water body sat at 13. Measured against the render. */
const SEABED_LEVEL  = 0.058;
const RIPPLE     = color(0x0f3352);
/* Marine snow sits 10 to 20 per cent above the water it is in. */
const SNOW_LEVEL = 0.16;

/* 0.16, down from 0.25, and the ripple with it. Pushing the water blue lifted
   its bright crests to a luminance of 34 while the dim tier of mantas sits at
   59: a separation of 1.7, where the first palette had 3.4. The hierarchy is
   the one thing section 7.2 calls non-negotiable, and an unattached manta that
   only just beats a seabed crest is not dim, it is lost. The blue stays in the
   base water, which is what was asked for; the additive layers give up the
   headroom instead. */

/* "Low opacity", but measured rather than guessed. At 0.16 of the original
   dim colour the ripple was a sub-one-in-255 modulation and invisible. It is
   0.18 of a brighter blue now, which is about the same on screen as the 0.30
   it was, but costs less headroom. */
const RIPPLE_LEVEL = 0.18;

/* Set by main.js once the light memory exists. Null until then, and the
   shader is built without the plankton term in that case, so the ocean still
   draws if the light memory could not be created. */
let lm = null;
export function useLightMemory (memory) { lm = memory; }
/* The baked seabed, set before the ocean node is built. */
let seabedTex = null;
export function useSeabed (s) { seabedTex = s; }
/* The baked caustic web and the shadow target. */
let caustics = null;
export function useCaustics (c) { caustics = c; }
/* High crosses two caustic webs, medium one, low holds it still. */
export const uCausticLayers = uniform(2);
/* The mantas' shadows on the floor, drawn by shadow.js into a world-locked
   target. Null until it is created, and the shader is built without the term
   in that case. */
let shadows = null;
export function useShadows (s) { shadows = s; }
/* Down and to the LEFT, about half a wingspan, which is where the moon in the
   top right corner of the sky would throw them.

   MIND THE SIGN. A pixel at w shows the ink it finds at w + offset, so the
   darkening appears at m - offset for a manta at m. Down and left is
   (-half, +half) in world terms — world.y grows downward on screen — so the
   SAMPLE has to be taken at (+half, -half). Getting this backwards puts every
   shadow up and to the right, which still looks like a shadow and is wrong. */
const SHADOW_OFFSET = 20;        // world units, half of a 40-unit wingspan

/* A second, slower light memory under the fast one: the fading light painting
   a match leaves behind. Off by default. */
let lmSlow = null;
export function useLongMemory (memory) { lmSlow = memory; }

export function oceanNode () {
  return Fn(() => {
    /* screenUV.y is 0 at the TOP and 1 at the bottom. r186's ScreenNode
       documents its coordinate as "according to WebGPU standards" and flips
       it on WebGL so both backends agree, which is why the same code works on
       either. Checked in the vendored source, then confirmed by sampling the
       render: an earlier guess had this upside down. */
    /* The scene's clock, not the renderer's. See clock.js. */
    const t = uTime;

    /* Where this pixel is in the ocean, before anything bends it. */
    /* Plus where the camera is. EVERY world layer is computed from this one
       vector — the seabed, the caustics, the marine snow, the light memory
       and the shadows — so the whole ocean scrolls from a single uniform
       instead of five parallax hacks that can disagree with each other. */
    const w0 = vec2(screenUV.x.sub(0.5).mul(uViewW), screenUV.y.sub(0.5).mul(uViewH)).add(uCam);
    /* The shockwave, as a displacement in world units: a narrow ring at
       uShockR, pushing directly away from the centre. Everything below reads
       the displaced position, so the water, the seabed, the ripple and the
       plankton all bend together rather than sliding over each other. */
    const rel = w0.sub(uShockC);
    const dist = length(rel);
    const band = dist.sub(uShockR);
    const ring = exp(band.mul(band).mul(-0.0009));
    const push = rel.div(max(dist, float(0.001))).mul(ring.mul(uShockA));
    const world = w0.add(push);
    const suv = vec2(
      world.x.div(uViewW).add(0.5),
      world.y.div(uViewH).add(0.5)
    );

    const p = vec2(suv.x.mul(uAspect), suv.y);

    /* 1. the water. The gradient breathes very slowly, and a wide slow wave
          across it stops the horizontal banding a pure vertical ramp shows on
          an 8-bit display. */
    const grad = suv.y
      .add(sin(p.x.mul(2.1).add(t.mul(0.045))).mul(0.055))
      .add(sin(t.mul(0.021)).mul(0.05));
    const water = mix(WATER_TOP, WATER_DEEP, smoothstep(float(-0.15), float(1.05), grad));

    /* 2. the moonlit seabed. A real floor — sand, rubble and dark reef, from
          the texture baked in seabed.js — seen through moonlit water, on slow
          parallax so it sits BELOW the swimming layer rather than on it.

          Slightly soft, on purpose: the floor is several metres down and the
          swimming layer is not, so a crisp floor would fight the animals for
          the eye. The parallax factor doubles as that softening, since the
          same world distance covers fewer texels.

          The moonlight is a lit pool on the view, about 0.6 at the edges as
          the reference photo is, with a broad brighter haze towards the moon
          at the top right. Hue follows the light: cyan-teal where the moon
          reaches, bluer in shadow. Only the water and the floor take this —
          the animals and their wakes are added afterwards and never see it. */
    /* 1.6, not 0.55. At 0.55 one tile covered 545 world units against a
       385-unit view, so the largest features were bigger than the screen and
       the floor rendered as a smooth gradient with no texture in it at all.
       At 1.6 a tile is 187 units, so reef and sand patches run one and a half
       to five wingspans and the grain lands under a CSS pixel. */
    const floorUV = world.mul(1.6).div(SEABED_TILE);
    const bedV = seabedTex === null ? float(0.5) : texture(seabedTex.texture, floorUV).r;

    /* The pool, in screen space so it follows the view and not the world. */
    const fromCentre = length(vec2(suv.x.sub(0.5).mul(uAspect), suv.y.sub(0.5)));
    const pool = mix(float(1.0), float(0.60), smoothstep(float(0.0), float(0.46), fromCentre));
    /* The moon is up and to the right: screenUV.y is 0 at the top. */
    const toMoon = length(vec2(suv.x.sub(0.86).mul(uAspect), suv.y.sub(0.10)));
    const haze = smoothstep(float(0.95), float(0.0), toMoon).mul(0.30);
    const litness = clamp(pool.add(haze), 0, 1.35);
    const moon = litness.mul(U.moonlight);

    /* 195 degrees lit, 207 in shadow, saturation 0.93, straight off the
       reference photo. */
    const bedHue = mix(SEABED_SHADOW, SEABED_LIT, clamp(litness.sub(0.6).div(0.6), 0, 1));
    /* Caustics: the same tileable web sampled TWICE at different scales,
       scrolling in different directions, with the smaller of the two kept.
       One web alone slides across the floor like a projected slide; two
       crossing webs interfere, so knots appear where both agree and dissolve
       as they drift apart — the light flows and re-forms without anything
       being animated. The coordinates are bent by the surface ripple, which
       is the one thing that makes it read as refracted rather than painted,
       and the whole thing is softened as if seen through several metres of
       water.

       It MULTIPLIES the moonlight, so it brightens lit sand and barely
       touches dark reef, exactly as light through water does. */
    const cT = t.mul(U.causticSpeed);
    const wob = vec2(
      sin(world.y.mul(0.020).add(cT.mul(0.12))).mul(3.2),
      sin(world.x.mul(0.017).sub(cT.mul(0.10))).mul(3.2));
    const bent = world.add(wob);
    const causticAt = (span, dx, dz) => caustics === null ? float(0.5)
      : texture(caustics.texture,
          vec2(bent.x.div(span).add(cT.mul(dx)), bent.y.div(span).add(cT.mul(dz)))).r;
    const webA = causticAt(float(150.0), 0.0035, 0.0021);
    const webB = causticAt(float(95.0), -0.0026, 0.0032);
    const web = mix(webA, min(webA, webB), clamp(uCausticLayers.sub(1.0), 0, 1));
    /* Softened, and centred on 1 so the web lifts the lit floor rather than
       darkening everything it is not on. */
    const caustic = float(1.0).add(web.sub(0.25).mul(U.caustic));

    /* Cloud passes. One very large, very soft mask drifting across the view:
       at its darkest the moon is about a third. Slow on purpose — a pass comes
       round about once a minute and each transition takes several seconds. */
    /* A SWEEP, not shapes. This was two sines added together, and the sum of
       two sines is a regular lattice of humps — evenly sized soft round
       patches drifting over the whole frame, which is what Nathan saw. A
       cloud is now one travelling wave along one slowly turning direction,
       with a wavelength longer than the view, so what crosses the screen is a
       broad band of dimming with no edge and no shape to it.

       The direction turns over minutes, so successive passes do not all come
       from the same corner. */
    const cAng = t.mul(0.013);
    const cDir = vec2(sin(cAng), sin(cAng.add(1.571)));
    const cloudPhase = world.x.mul(cDir.x).add(world.y.mul(cDir.y)).mul(0.0021).sub(t.mul(0.055));
    const cloudF = sin(cloudPhase);
    const cloud = float(1.0).sub(smoothstep(float(0.15), float(0.95), cloudF).mul(U.cloud).mul(0.67));

    /* The shadows, on the FLOOR only. Darkening the water as well would put a
       grey smear over the whole column and read as dirt rather than as a
       shadow; the animal is between the moon and the sand, so what it takes
       away is the light landing on the sand.

       Blurred as it is read, not in a pass of its own: nine taps a texel and
       a half apart, which at 256 over a 15% oversized view is about six world
       units — enough to lose the polygon edges without a second target and a
       second pipeline. */
    let shade = float(1.0);
    if (shadows !== null) {
      const sUV = w => w.sub(shadows.uCentre).div(shadows.uHalf.mul(2.0)).add(0.5);
      const step2 = shadows.uHalf.mul(2.0).div(float(256.0)).mul(1.5);
      let acc = float(0.0);
      for (const [ox, oz] of [[0,0],[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]) {
        const at = world.add(vec2(float(SHADOW_OFFSET).add(step2.mul(ox)),
                                  float(-SHADOW_OFFSET).add(step2.mul(oz))));
        acc = acc.add(texture(shadows.out, sUV(at)).r);
      }
      shade = float(1.0).sub(acc.div(9.0).mul(U.shadow));
    }

    const seabed = bedHue.mul(bedV.mul(moon).mul(caustic).mul(cloud).mul(SEABED_LEVEL)).mul(shade);

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
    const ripple = RIPPLE.mul(crest.mul(RIPPLE_LEVEL)).mul(uRippleOn);

    /* 5. THE REEF, and it has to be seen. A crash ends the run now, so an
          invisible wall is a fairness problem rather than a look problem:
          Nathan crashed into nothing on the phone. Three parts, all here
          because the ocean already knows where every pixel is in the world.

          Warm colour is free here and nowhere else: 7.2 takes warm off danger
          duty for the mantas and gives the reef its own way of reading as
          danger — by its place, its ring and its slow pulse, the way
          slither's border does.

          a. a ring that pulses, 120 units of it inside the line and 90 out,
             so it is visible from half a screen away at every zoom;
          b. beyond the line the water stops being ocean: much darker, with a
             rough reef texture and the warm edge on top of it;
          c. within about a screen of it, the side of the screen facing it
             leans warm. Slow and small — a warning, never a flash. */
    const reefD = length(w0);
    /* 260 units of it inside the line, not 120. Half a screen is 427 units,
       so a 120-unit ring is a strip a dozen pixels tall at the very edge of
       the frame from that distance — present, but not a thing you read as
       danger in time. At 260 it is a band you cannot miss while there is
       still room to turn. */
    const ringBand = smoothstep(uArenaR.sub(float(260)), uArenaR, reefD)
      .mul(float(1.0).sub(smoothstep(uArenaR, uArenaR.add(float(90)), reefD)));
    /* About four seconds a breath, which is a pulse and not a flicker. */
    const reefPulse = sin(uTime.mul(1.6)).mul(0.5).add(0.5).mul(0.42).add(0.58);
    const reefRing = REEF_WARM.mul(ringBand.mul(ringBand)).mul(reefPulse).mul(REEF_RING_LEVEL);
    const outside = smoothstep(uArenaR.sub(float(4)), uArenaR.add(float(26)), reefD);
    /* Rubble, in cells about two thirds of a wingspan across. */
    const reefRough = rand(floor(w0.div(float(26)))).mul(0.55).add(0.45);
    /* The warm goes ALONG THE EDGE and not across the whole outside: lit from
       end to end it made the far side of the line brighter than the ocean,
       which is the opposite of what it is for. A band 90 units deep, and past
       that dark rubble. */
    const edgeBand = outside.mul(float(1.0).sub(smoothstep(uArenaR.add(float(8)), uArenaR.add(float(95)), reefD)));
    const reefBeyond = REEF_DEEP.mul(reefRough).mul(outside)
      .add(REEF_WARM.mul(edgeBand).mul(REEF_EDGE_LEVEL).mul(reefPulse));
    /* What is left of the ocean where the reef has taken over. */
    const reefDim = float(1.0).sub(outside.mul(0.8));

    const camD = length(uCam);
    const toReef = uArenaR.sub(camD);                       // units still to go
    const warnNear = float(1.0).sub(smoothstep(float(280), uViewH, toReef));
    const radial = uCam.div(max(camD, float(1.0)));         // which way the reef lies
    const fromMid = vec2(screenUV.x.sub(0.5), screenUV.y.sub(0.5));
    const facing = clamp(fromMid.x.mul(radial.x).add(fromMid.y.mul(radial.y)).mul(2.4), 0, 1);
    const reefWarn = REEF_WARM.mul(facing.mul(facing)).mul(warnNear).mul(REEF_WARN_LEVEL);

    const reef = reefRing.add(reefBeyond).add(reefWarn);

    /* The ceiling, applied to the moonlit water as one thing. Identity below
       the knee, asymptotic to the cap above it, and the colour is scaled so
       the hue survives. */
    const capWater = (c) => {
      const lum = c.x.mul(0.2126).add(c.y.mul(0.7152)).add(c.z.mul(0.0722));
      const over = max(lum.sub(float(WATER_KNEE)), float(0.0));
      const room = float(WATER_CAP - WATER_KNEE);
      const held = float(WATER_KNEE).add(room.mul(float(1.0).sub(exp(over.div(room).negate()))));
      const want = min(lum, held);
      return c.mul(want.div(max(lum, float(1e-5))));
    };

    /* 4. the plankton, which is the only part of the ocean that knows what has
          happened in it. It reads the light memory at this pixel's world
          position: near zero in still water, and bright along anything that
          has swum past. Cost is per pixel and does not know how many mantas
          there are, which is the point. */
    if (lm === null) return capWater(water.mul(reefDim).add(seabed.mul(reefDim)).add(ripple)).add(reef);

    /* The exact inverse of the mapping the light memory pass uses, so the two
       agree by construction rather than by coincidence. */
    /* The exact inverse of the light memory pass's own mapping, centre and
       all, so the two agree by construction rather than by coincidence. */
    const lmUV = world.sub(lm.uCentre).div(lm.uHalf.mul(2.0)).add(0.5);
    const stir = texture(lm.out, lmUV).rgb;

    /* POINTS, not dashes. This was two crossing sine waves raised to a power,
       and the product of two waves is bright along the line where both are
       bright — so every speck in the ocean leaned the same way, like rain on
       glass. Nathan called it out twice. A hash-placed point per cell of a
       world grid has no preferred direction at all: the cell says where, the
       distance from it says how bright, and nothing in it knows about an
       angle.

       Drift, and only drift: the field moves, and no point ever changes
       brightness where it stands, so nothing twinkles. */
    const dot1 = (cell, dx, dz, seed, sharp) => {
      const q = vec2(world.x.div(cell).add(t.mul(dx)), world.y.div(cell).add(t.mul(dz)));
      const id = floor(q), f = fract(q);
      const h = vec2(rand(id.add(seed)), rand(id.add(seed).add(vec2(11.3, 7.7))));
      const d = length(f.sub(h));
      return pow(max(float(1.0).sub(d.mul(sharp)), float(0.0)), float(2.0));
    };
    /* Three grids at different sizes, so the field is not a lattice. */
    const sparkle = dot1(7.0, 0.020, -0.014, vec2(0.0, 0.0), 7.0)
      .add(dot1(4.3, -0.016, 0.022, vec2(23.0, 51.0), 8.5).mul(0.7))
      .add(dot1(2.9, 0.011, 0.017, vec2(71.0, 13.0), 10.0).mul(0.45))
      .mul(U.plankton);

    /* Fresh wake whiteness. The newest, brightest light a manta leaves burns
       towards white before it cools back to the blue-green it deposited, which
       is what makes a wake look hot at its head. At the committed 0 the mix
       weight is exactly zero, so `hot` IS `stir` and the render is unchanged
       rather than nearly unchanged. The window runs from 0.04 to 0.22 because
       the light memory's own steady state near a manta sits around 0.25: below
       0.04 is a cooled tail and should not burn at all. */
    const peak = max(max(stir.x, stir.y), stir.z);
    /* Towards a WARM white where the wake is warm: a scarlet train's wake
       lightened towards plain white read pink, and a wake is the widest
       lightened thing on the screen. See lighten.js. */
    const hot = mix(stir, lightTarget(stir),
                    smoothstep(float(0.04), float(0.22), peak).mul(U.whiteness));

    /* Marine snow: points of one to three device pixels, only a little
       brighter than the water they sit in, at three depths drifting at
       different slow rates so there is parallax. Denser where the water is
       lighter. Well under the bloom threshold, and nothing here twinkles. */
    const lightHere = clamp(float(1.0).sub(grad), 0, 1);
    const snowKeep = (cell, seed) => smoothstep(float(0.0), float(0.10),
      clamp(mix(float(0.25), float(1.0), lightHere).mul(U.snow), 0, 1)
        .sub(rand(floor(vec2(world.x.div(cell), world.y.div(cell))).add(seed).add(vec2(3.7, 9.2)))));
    const snowMask = dot1(64.0, 0.010, 0.014, vec2(5.0, 2.0), 26.0).mul(snowKeep(64.0, vec2(5.0, 2.0)))
      .add(dot1(36.0, -0.007, 0.026, vec2(41.0, 17.0), 30.0).mul(snowKeep(36.0, vec2(41.0, 17.0))).mul(0.6))
      .add(dot1(26.0, 0.015, -0.008, vec2(93.0, 61.0), 34.0).mul(snowKeep(26.0, vec2(93.0, 61.0))).mul(0.4));
    const snow = water.mul(min(snowMask, float(1.5)).mul(SNOW_LEVEL));

    const plankton = PLANKTON.mul(sparkle.mul(PLANKTON_AMBIENT))   // everywhere, faint
      .add(hot.mul(sparkle).mul(U.sparkle))                        // bright where stirred
      .add(hot.mul(U.ribbon))
      /* The long memory, faint and blue-green, under everything else. At 0
         the CPU skips its pass entirely, so it costs nothing until asked. */
      .add(lmSlow === null ? vec3(0, 0, 0)
        : PLANKTON.mul(texture(lmSlow.out, world.div(lmSlow.uHalf.mul(2.0)).add(0.5)).rgb)
            .mul(U.longMemory).mul(0.8));                                     // the ribbon itself

    /* Life goes on top of the ceiling, never under it: 7.2 caps moonlight,
       not the plankton a manta stirs. */
    return capWater(water.mul(reefDim).add(seabed.mul(reefDim)).add(ripple))
      .add(snow).add(plankton).add(reef);
  })();
}
