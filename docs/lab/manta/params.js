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
  { key: 'fade',           label: 'light memory fade',    def: 0.987, min: 0.90, max: 0.999, step: 0.001, gpu: false },
  { key: 'stamp',          label: 'wake deposit',         def: 3,  min: 0,    max: 3,     step: 0.05,  gpu: false },
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
  { key: 'sparkle',        label: 'sparkle strength',     def: 7.9,  min: 0,    max: 8,     step: 0.1,   gpu: true  },
  { key: 'ribbon',         label: 'ribbon strength',      def: 0.25,  min: 0,    max: 1,     step: 0.01,  gpu: true  },
  /* 0 is the committed look, and at 0 the shader mixes by exactly zero, so
     the render is unchanged rather than nearly unchanged. Above 0 the newest,
     brightest light in a wake burns towards white before cooling back to the
     blue-green the manta deposited. Section 7.2 keeps the wake blue-green, so
     this is a question for Nathan's eye, not a number to guess at. */
  { key: 'whiteness',      label: 'fresh wake whiteness', def: 1,     min: 0,    max: 1,     step: 0.01,  gpu: true  },
  /* Nathan had this at its old cap of 3, so the cap moved. 5 is where the
     conditions still hold and not a round number picked for comfort: at 5,
     with marine snow at its own new cap, condition 3 reads 2.04 and 2.03 at
     the two tiers that hold it tightest, against a bar of 2.0. */
  { key: 'plankton',       label: 'plankton density',     def: 5,  min: 0,    max: 6,     step: 0.05,  gpu: true  },
  { key: 'bloomStrength',  label: 'bloom strength',       def: 0.15,  min: 0,    max: 2,     step: 0.05,  gpu: false },
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
  { key: 'bloomRadius',    label: 'bloom radius',         def: 0.53,  min: 0,    max: 1,     step: 0.01,  gpu: false },
  { key: 'bloomThreshold', label: 'bloom threshold',      def: 0.35,  min: 0,    max: 1,     step: 0.01,  gpu: false },
  { key: 'grain',          label: 'grain',                def: 0.012,  min: 0,    max: 0.10,  step: 0.002, gpu: true  },
  /* 0.45 radians at the tip, down from 0.75. The outline is right when the
     animal is still and the stroke was ruining it: cos(0.75) narrows the
     outer wing by 27 per cent, which steepens the leading edge from 29 to
     about 40 degrees and makes the crescent read as a kite for much of every
     beat. At 0.45 a straight-swimming manta never narrows by more than about
     10 per cent. What the stroke lost in shape it gets back in light. */
  { key: 'flap',           label: 'wingbeat depth',       def: 0.9,  min: 0.2,  max: 0.9,   step: 0.01,  gpu: true  },
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
  /* How brightly the moon lights the floor. 1 puts the lit centre's median
     near 35 on the suites' 0-255 scale, where the old water body sat at 13.
     The cap is where the conditions still hold, measured at the two tiers
     that hold it tightest, on a frame with every source of life switched off
     so what is measured is moonlight. It is NOT condition 2 that binds here:
     the crests stay under the dimmest manta up to about 3.5. It is condition
     3 — a manta has to be twice the ring of water around it, and moonlight
     brightens that ring. At 2.75 it reads 2.04 and 2.09; at 3.00 it is
     exactly 2.00 and 2.01, on the bar; at 4.00 both conditions fail, 1.76
     and 1.74 with crests at 88.7 against a dimmest manta of 84.5. So 2.75,
     which leaves margin rather than sitting on the line. */
  { key: 'caustic',        label: 'caustic strength',     def: 1.5,  min: 0,    max: 1.5,   step: 0.01,  gpu: true  },
  { key: 'causticSpeed',   label: 'caustic speed',        def: 3,  min: 0,    max: 3,     step: 0.05,  gpu: true  },
  /* How deeply a cloud dims the moon. 1 takes it to about a third at the
     darkest point of a pass, which comes round about once a minute and takes
     several seconds each way — 7.2 says moonlight changes slowly, never a
     flash. */
  { key: 'cloud',          label: 'cloud amount',         def: 0,  min: 0,    max: 1.5,   step: 0.05,  gpu: true  },
  { key: 'moonlight',      label: 'moonlight strength',   def: 2.75,  min: 0,    max: 2.75,  step: 0.05,  gpu: true  },
  /* How dark a manta's shadow makes the sand under it. The shadow is on the
     FLOOR only, offset down and left about half a wingspan. */
  /* Also at its cap, and shadows only ever darken the floor, so nothing in
     the conditions pushes back: widened to 2 for headroom. */
  { key: 'shadow',         label: 'shadow strength',      def: 2,  min: 0,    max: 2,     step: 0.05,  gpu: true  },
  /* Was capped at 2, which is where Nathan left it. 4 is the same story as
     plankton: measured together at both caps, the conditions still hold. */
  { key: 'snow',           label: 'marine snow density',  def: 2.75,  min: 0,    max: 4,     step: 0.05,  gpu: true  },
  /* The fading light painting 7.2 calls the signature effect. 0 by default,
     and at 0 the whole pass is skipped rather than merely multiplied out.
     Capped at 0.6: it is added to the same water the hierarchy measures. */
  { key: 'longMemory',     label: 'long memory',          def: 0.05,     min: 0,    max: 0.6,   step: 0.01,  gpu: true  },
  /* 0 is the random roll that v1.8 asks for; 1 to 7 pin one of the palette's
     colours, in its order: lime, coral, orange, red, violet, purple, azure. */
  { key: 'player',         label: 'player colour 0=random 1-7', def: 0, min: 0, max: 7, step: 1, gpu: false },
  /* Which colours wild mantas may be dealt. 0 is warm and cool, 1 swaps the
     four warm hues for a turquoise so the comparison is like for like. */
  { key: 'coolWild',       label: 'wild palette 0=warm+cool 1=cool', def: 0, min: 0, max: 1, step: 1, gpu: false },
  { key: 'marks',          label: 'marking strength',     def: 2,  min: 0,    max: 2,     step: 0.05,  gpu: true  },
  /* ------------------------------------------------------------- game.
     Section 10.2's table, on sliders because these are the numbers that
     decide whether the four rules are fun, and that is judged on a phone
     rather than in a test. They are read by sim.js, which has no idea a
     drawer exists. */
  { key: 'cruise',         label: 'cruise speed',         def: 160,   min: 80,   max: 320,   step: 5,     gpu: false },
  { key: 'burstSpeed',     label: 'burst speed',          def: 340,   min: 120,  max: 520,   step: 5,     gpu: false },
  { key: 'turnCruise',     label: 'turn rate cruising',   def: 3.1,   min: 1,    max: 6,     step: 0.1,   gpu: false },
  { key: 'turnBurst',      label: 'turn rate bursting',   def: 4.1,   min: 1,    max: 6,     step: 0.1,   gpu: false },
  { key: 'recruitR',       label: 'recruit radius',       def: 21,    min: 15,   max: 120,   step: 1,     gpu: false },
  { key: 'spacing',        label: 'follower spacing',     def: 19,    min: 12,   max: 60,    step: 1,     gpu: false },
  { key: 'wildCount',      label: 'wild count',           def: 20,   min: 20,   max: 300,   step: 10,    gpu: false },
  { key: 'regrow',         label: 'regrowth interval',    def: 0.5,     min: 0.2,  max: 8,     step: 0.1,   gpu: false },
  { key: 'wildSize',       label: 'wild size',            def: 28,    min: 10,   max: 28,    step: 1,     gpu: false },
  { key: 'burstCost',      label: 'burst cost interval',  def: 0.35,  min: 0.1,  max: 1.5,   step: 0.05,  gpu: false },
  { key: 'arenaR',         label: 'arena radius',         def: 4000,  min: 800,  max: 4000,  step: 100,   gpu: false },
  { key: 'bloomPull',      label: 'bloom pull',           def: 0.36,  min: 0,    max: 1,     step: 0.02,  gpu: false },
  { key: 'bots',           label: 'bot count',            def: 10,    min: 0,    max: 20,    step: 1,     gpu: false },
  { key: 'trainScale',     label: 'train size',           def: 1,     min: 0.6,  max: 2,     step: 0.05,  gpu: false },
  { key: 'scatterGlow',    label: 'scatter glow',         def: 10,     min: 0.5,  max: 10,    step: 0.5,   gpu: false },
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
