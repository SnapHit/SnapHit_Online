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
  { key: 'fade',           label: 'light fade',      def: 0.985, min: 0.90, max: 0.999, step: 0.001, gpu: false },
  { key: 'stamp',          label: 'stamp strength',  def: 1.00,  min: 0,    max: 3,     step: 0.05,  gpu: false },
  { key: 'plankton',       label: 'plankton',        def: 1.00,  min: 0,    max: 3,     step: 0.05,  gpu: true  },
  { key: 'bloomStrength',  label: 'bloom strength',  def: 0.60,  min: 0,    max: 2,     step: 0.05,  gpu: false },
  { key: 'bloomThreshold', label: 'bloom threshold', def: 0.25,  min: 0,    max: 1,     step: 0.01,  gpu: false },
  { key: 'grain',          label: 'grain',           def: 0.02,  min: 0,    max: 0.10,  step: 0.002, gpu: true  },
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

/* Plain text, for the Copy values button: exactly what a later brief needs to
   paste back into the SPEC above. */
export function paramText () {
  return SPEC.map(s => {
    const v = P[s.key];
    const changed = Math.abs(v - s.def) > 1e-9;
    return s.key + ': ' + v + (changed ? '   (default ' + s.def + ')' : '');
  }).join('\n');
}
