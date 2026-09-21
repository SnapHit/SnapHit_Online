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
  { key: 'fade',           label: 'light memory fade',    def: 0.993, min: 0.90, max: 0.999, step: 0.001, gpu: false },
  { key: 'stamp',          label: 'wake deposit',         def: 1.00,  min: 0,    max: 3,     step: 0.05,  gpu: false },
  /* 4.0 and 0.20 were constants in ocean.js until the drawer needed them.
     Their reasoning still lives there, above the line that reads them: the
     wake's energy goes into sparkle rather than into a smooth ribbon, because
     a smooth glow bright enough to see lifts every pixel around it and a dim
     manta swimming through the wake loses its contrast. */
  { key: 'sparkle',        label: 'sparkle strength',     def: 4.00,  min: 0,    max: 8,     step: 0.1,   gpu: true  },
  { key: 'ribbon',         label: 'ribbon strength',      def: 0.20,  min: 0,    max: 1,     step: 0.01,  gpu: true  },
  /* 0 is the committed look, and at 0 the shader mixes by exactly zero, so
     the render is unchanged rather than nearly unchanged. Above 0 the newest,
     brightest light in a wake burns towards white before cooling back to the
     blue-green the manta deposited. Section 7.2 keeps the wake blue-green, so
     this is a question for Nathan's eye, not a number to guess at. */
  { key: 'whiteness',      label: 'fresh wake whiteness', def: 0,     min: 0,    max: 1,     step: 0.01,  gpu: true  },
  { key: 'plankton',       label: 'plankton density',     def: 1.00,  min: 0,    max: 3,     step: 0.05,  gpu: true  },
  { key: 'bloomStrength',  label: 'bloom strength',       def: 0.60,  min: 0,    max: 2,     step: 0.05,  gpu: false },
  /* 0.40, not the brief's starting 0.25. At 0.25 bloom lifted a rival to 231.9
     against the train's 231.6: both clipped to the tone mapper's white point
     and the top of the hierarchy collapsed, leaving hue as the only thing
     telling your train from a rival's. Section 7.2 forbids exactly that.
     The brief says to pull the threshold up rather than brighten anything. */
  { key: 'bloomThreshold', label: 'bloom threshold',      def: 0.40,  min: 0,    max: 1,     step: 0.01,  gpu: false },
  { key: 'grain',          label: 'grain',                def: 0.02,  min: 0,    max: 0.10,  step: 0.002, gpu: true  },
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
