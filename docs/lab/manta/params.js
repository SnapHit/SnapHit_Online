/* The tunable numbers, in one place.
 *
 * Defaults live here in code, which is what a fresh load always gets. The
 * drawer's sliders write into this registry for the current session only, so
 * nothing Nathan drags on the phone can become the committed look by
 * accident: he reads the values back out with Copy values and a later brief
 * types them in here.
 *
 * Shader-side parameters are TSL uniforms so a drag costs a uniform write and
 * not a shader rebuild. CPU-side ones are plain numbers read each frame.
 */
import { uniform } from 'three/tsl';

export const SPEC = [
  /* 0.993: a half life of about 1.9 seconds at 60 fps, where 0.985 gave 0.76.
     The design doc asks for "a fading light painting of itself", and at three
     quarters of a second there was barely a painting. */
  { key: 'fade',           label: 'light memory fade',    def: 0.991, min: 0.90, max: 0.999, step: 0.001, gpu: false },
  { key: 'stamp',          label: 'wake deposit',         def: 2.70,  min: 0,    max: 3,     step: 0.05,  gpu: false },
  /* Nathan tuned these on the phone and they are his values, with one
     exception. At ribbon 0.79 the brightest wake read 54.6 against an
     unattached manta's 43.1 at high tier and 50.3 against 42.8 at medium, so
     condition 2 of section 7.2 — the wake's median never exceeds an
     unattached manta — failed at two tiers out of three. The ribbon is the
     first lever the brief names and it is the right one: the sparkle term is
     a ninth power, so at the MEDIAN wake pixel it is near zero and the smooth
     ribbon is almost the whole of what that median measures. 0.79 to 0.40.
     Everything else is exactly as he set it. */
  /* 4.0 and 0.20 were constants in ocean.js until the drawer needed them.
     Their reasoning still lives there, above the line that reads them: the
     wake's energy goes into sparkle rather than into a smooth ribbon, because
     a smooth glow bright enough to see lifts every pixel around it and a dim
     manta swimming through the wake loses its contrast. */
  { key: 'sparkle',        label: 'sparkle strength',     def: 6.40,  min: 0,    max: 8,     step: 0.1,   gpu: true  },
  { key: 'ribbon',         label: 'ribbon strength',      def: 0.35,  min: 0,    max: 1,     step: 0.01,  gpu: true  },
  /* 0 is the committed look, and at 0 the shader mixes by exactly zero, so
     the render is unchanged rather than nearly unchanged. Above 0 the newest,
     brightest light in a wake burns towards white before cooling back to the
     blue-green the manta deposited. Section 7.2 keeps the wake blue-green, so
     this is a question for Nathan's eye, not a number to guess at. */
  { key: 'whiteness',      label: 'fresh wake whiteness', def: 1.00,     min: 0,    max: 1,     step: 0.01,  gpu: true  },
  { key: 'plankton',       label: 'plankton density',     def: 0.60,  min: 0,    max: 3,     step: 0.05,  gpu: true  },
  { key: 'bloomStrength',  label: 'bloom strength',       def: 0.25,  min: 0,    max: 2,     step: 0.05,  gpu: false },
  /* 0.40, not the brief's starting 0.25. At 0.25 bloom lifted a rival to 231.9
     against the train's 231.6: both clipped to the tone mapper's white point
     and the top of the hierarchy collapsed, leaving hue as the only thing
     telling your train from a rival's. Section 7.2 forbids exactly that.
     The brief says to pull the threshold up rather than brighten anything. */
  /* The halo's reach, not its brightness. BloomNode blends five mip levels
     and this is the blend: at 0 the tight mips dominate and the glow hugs its
     source, at 1 the wide ones do and it spreads. The reach is what lifts the
     water two wingspans from a 220-bright train member and puts an unattached
     manta below 2.5 times its surroundings, so this is the lever for
     condition 3 — not the strength, which Nathan set, and not the threshold,
     which is what keeps a rival from clipping to the player's white. */
  { key: 'bloomRadius',    label: 'bloom radius',         def: 0.00,  min: 0,    max: 1,     step: 0.01,  gpu: false },
  { key: 'bloomThreshold', label: 'bloom threshold',      def: 0.40,  min: 0,    max: 1,     step: 0.01,  gpu: false },
  { key: 'grain',          label: 'grain',                def: 0.02,  min: 0,    max: 0.10,  step: 0.002, gpu: true  },
  /* 0.45 radians at the tip, down from 0.75. The outline is right when the
     animal is still and the stroke was ruining it: cos(0.75) narrows the
     outer wing by 27 per cent, which steepens the leading edge from 29 to
     about 40 degrees and makes the crescent read as a kite for much of every
     beat. At 0.45 a straight-swimming manta never narrows by more than about
     10 per cent. What the stroke lost in shape it gets back in light. */
  { key: 'flap',           label: 'wingbeat depth',       def: 0.45,  min: 0.2,  max: 0.9,   step: 0.01,  gpu: true  },
  /* 4x multisampling on the scene pass, high tier only. A switch rather than
     a number because it is a render target option, and here so Nathan can see
     what it costs on the phone. */
  { key: 'antialias',      label: 'antialias (4x)',       def: 1,     min: 0,    max: 1,     step: 1,     gpu: false },
  /* How strongly the photo's pattern shows. The ruling is to BRIGHTEN the
     markings rather than darken the back: in the photo the back is dark and
     the patches pale, but in this game's light the back is the median the
     hierarchy measures, so darkening it darkens the animal and condition 3
     goes with it. The back therefore stays at its tier colour and the marks
     go up from there. */
  /* Which colour your own train wears. Three presets rather than a free hue,
     because 7.2 reserves warm for danger and pink for the pink manta, and a
     slider over the whole wheel would hand Nathan both. 0 lime, 1 ice white,
     2 the old mint. Lime is the committed one: the brightest of the saturated
     hues, opposite the blue world, and it survives video compression, which
     white next to a white-hot wake does not. */
  { key: 'player',         label: 'player colour 0lime 1ice 2mint', def: 0, min: 0, max: 2, step: 1, gpu: false },
  { key: 'marks',          label: 'marking strength',     def: 1.00,  min: 0,    max: 2,     step: 0.05,  gpu: true  },
];

/* Plain numbers, read from JS each frame. */
export const P = {};
/* TSL uniforms, for the ones a shader reads. */
export const U = {};

for (const s of SPEC) {
  P[s.key] = s.def;
  if (s.gpu) U[s.key] = uniform(s.def);
}

/* Listeners let a parameter that is neither a plain read nor a uniform — the
   bloom node's own properties, for instance — keep itself in step. */
const listeners = [];
export const onParam = fn => listeners.push(fn);

export function setParam (key, value) {
  P[key] = value;
  if (U[key]) U[key].value = value;
  for (const fn of listeners) fn(key, value);
}

export function resetParams () {
  for (const s of SPEC) setParam(s.key, s.def);
}

/* Plain text, for the Copy values button: every value, one per line, name
   and number, which is exactly what a later brief needs to type back into the
   SPEC above. Rounded to the slider's own step, because a range input reports
   0.6000000000000001 and that is not a number anyone wants to read back. */
export function decimals (step) {
  return Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));
}

export function paramText () {
  return SPEC.map(s => s.label + ': ' + P[s.key].toFixed(decimals(s.step))).join('\n');
}
