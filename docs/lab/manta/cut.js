/* The cut: the set piece section 7.2 calls the signature move.
 *
 * A shockwave ripples the water outward from where the train was severed, a
 * burst of light is stamped into the light memory, the followers behind the
 * cut break formation and scatter on their own headings, flashing and then
 * fading to dim, and the whole thing plays through a brief beat of slow
 * motion. The train reforms a few seconds later so it can be fired again.
 *
 * ACCESSIBILITY IS NOT AN OPTION HERE. 7.2: "cap flashes at three a second,
 * offer a reduced-flash setting, and never rely on hue alone to tell you from
 * rivals." So:
 *
 *   flashes are rate limited page-wide, not per effect, because three effects
 *   each politely flashing once a second is still nine flashes a second;
 *
 *   prefers-reduced-motion, or the panel's own switch, drops the flash to 30%
 *   and skips the slow motion and the distortion entirely — the parts that
 *   move the whole screen — while keeping the scatter, which is the part that
 *   carries the information;
 *
 *   nothing here changes a hue. The scatter reads as BRIGHTNESS falling and
 *   formation breaking, both of which survive any colour vision.
 */
import { uShockC, uShockR, uShockA } from './ocean.js';

/* THE SHORT PARTS OF THIS ARE INVISIBLE TO A HEADLESS BROWSER, and that, not
   a wiring fault, is why the burst "never reached the screen" in 1G and 1H.
   SwiftShader draws this page at 1.3 frames a second: measured, the first
   frame after a trigger lands at 0.773 s, and 0 of the next 14 frames fell
   inside the burst (0.30 s), the shockwave (0.45 s) or the slow beat
   (0.25 s). All three were over before anything was drawn.

   So the clock the set piece runs on is injectable. The page keeps
   performance.now() — a beat specified in milliseconds still lasts that many
   milliseconds on the phone — and only a test replaces it, so a check can
   stand the cut still at 0.15 s and look at it. */
let clock = () => performance.now();
export function setCutClock (fn) { clock = typeof fn === 'function' ? fn : () => performance.now(); }

/* Page-wide flash ledger. Every flash anywhere asks here first. */
const flashes = [];
/* How many flashes the ledger holds right now: a test reads it to prove an
   off-screen event spent nothing. */
export const flashCount = () => flashes.length;
export function flashAllowed (now) {
  while (flashes.length && now - flashes[0] > 1000) flashes.shift();
  if (flashes.length >= 3) return false;
  flashes.push(now);
  return true;
}

const SHOCK_TIME = 0.45;      // the ripple's whole life
const SHOCK_REACH = 300;      // world units the ring travels
const SHOCK_PUSH = 26;        // world units of displacement at the ring
const SLOW_TIME = 0.25;       // the slow motion beat
const SLOW_SCALE = 0.35;
const FADE_TIME = 4.0;        // flash down to dim
const REFORM_TIME = 6.0;
const FLASH_PEAK = 2.4;       // multiple of the manta's own brightness
/* What the burst deposits into the light memory at its brightest. 7.2 wants
   its first half second brighter than your train and then a fall back into
   the wake, and the deposit accumulates over the frames it is stamped for, so
   this is not the brightness you see — it is what gets there. Measured on
   WebGL2: at 0.055 the burst peaked at half the train's brightness. */
const BURST_DEPOSIT = 0.38;
const DIM_LEVEL = 0.22;       // where a scattered manta ends up

/* The cut is between the second and third follower, so indices 3 and 4 are
   the ones that come away. */
const CUT_FROM = 3;

const easeInOut = x => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

export function createCut ({ mantas, lm, burstSlot, scatter = true }) {
  /* SCATTER IS THE SPIKE'S, and only the spike's. In the game the simulation
     owns every instance slot, and this scatter freed slots 3 and 4 of your
     train and swam them round the camera as mantas that did not exist in the
     simulation: drawn, dimmed, impossible to collect, and left standing
     where the timeline ended. It also held the timeline open for its six
     second re-form, and anything that happened meanwhile never fired. In the
     game the set piece ends with its shockwave, and each event fires. */
  const END = scatter ? REFORM_TIME : SHOCK_TIME;
  let fired = 0;
  /* The set piece runs on a REAL clock, not on accumulated frame deltas.
     Those deltas are clamped so a hidden tab cannot teleport anything, and
     that clamp turns the whole sequence into slow motion on a slow device:
     measured at four frames a second the cut's own timeline advanced at
     0.22x and it never reached the fade or the reform. A beat specified in
     milliseconds has to last that many milliseconds whatever the frame rate. */
  let t0 = -1;
  let t = -1;                  // seconds since the cut, or -1 for idle
  let reduced = false;
  let flashScale = 1;
  let centre = { x: 0, z: 0 };
  let lastScale = 1;

  const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const systemReduced = () => (mq ? mq.matches : false);
  let userReduced = false;
  const isReduced = () => userReduced || systemReduced();

  /* What the time scale would be at a given moment. Pure, so the shape of
     the beat can be checked without having to catch it: at four frames a
     second there is at most one frame inside a 250 ms window. */
  /* The shockwave's shape, pure, for the same reason as scaleAt: its whole
     life is 450 ms and a slow device samples it once. */
  function shockAt (secs) {
    if (isReduced() || secs < 0 || secs > SHOCK_TIME) return { r: 0, a: 0 };
    const k = secs / SHOCK_TIME;
    return { r: k * SHOCK_REACH, a: SHOCK_PUSH * (1 - k) * (1 - k) };
  }

  function scaleAt (secs) {
    if (isReduced() || secs < 0 || secs >= SLOW_TIME) return 1;
    return 1 + (SLOW_SCALE - 1) * Math.sin((secs / SLOW_TIME) * Math.PI);
  }

  function trigger (at = null) {
    if (scatter && t >= 0 && t < REFORM_TIME) return false;   // the spike's one at a time
    reduced = isReduced();
    flashScale = (flashAllowed(clock()) ? 1 : 0.25) * (reduced ? 0.30 : 1);
    fired++;

    /* At the contact point when there is one (the game); the spike cuts its
       scripted train between followers 2 and 3. */
    const a = CUT_FROM - 1, b = CUT_FROM;
    centre = at ? { x: at.x, z: at.z } : {
      x: (mantas.aPos.getX(a) + mantas.aPos.getX(b)) / 2,
      z: (mantas.aPos.getZ(a) + mantas.aPos.getZ(b)) / 2,
    };

    for (let i = CUT_FROM; i < (scatter ? 5 : CUT_FROM); i++) {
      const head = mantas.aHead.getX(i);
      /* Each on its own heading, fanned either side of where it was going,
         and each with its own gentle turn so the group keeps opening out
         rather than travelling as a smaller train. */
      const spread = (i - CUT_FROM - 0.5) * 1.15 + (Math.sin(i * 12.9898) * 0.35);
      mantas.setFree(i, {
        x: mantas.aPos.getX(i),
        z: mantas.aPos.getZ(i),
        head: head + spread,
        speed: 95 + (i - CUT_FROM) * 18,
        turn: spread * 0.22,
      });
      mantas.setTintScale(i, 1 + (FLASH_PEAK - 1) * flashScale);
      /* It comes away still wearing your colour: 7.2 says a severed follower
         glows in its train's colour first and only then drifts to its own. */
      if (mantas.setCutMix) mantas.setCutMix(i, 0);
    }
    t0 = clock();
    t = 0;
    return true;
  }

  function update (dt) {
    if (t < 0) return 1;
    t = (clock() - t0) / 1000;

    /* The shockwave. Skipped outright under reduced motion: it moves every
       pixel on screen, which is exactly what that setting is asking not to
       happen. */
    if (!reduced && t <= SHOCK_TIME) {
      const k = t / SHOCK_TIME;
      uShockC.value.set(centre.x, centre.z);
      uShockR.value = k * SHOCK_REACH;
      uShockA.value = SHOCK_PUSH * (1 - k) * (1 - k);
    } else if (uShockA.value !== 0) {
      uShockA.value = 0;
    }

    /* The burst, stamped into the light memory so it leaves a mark that fades
       with everything else rather than being a sprite that vanishes. */
    if (lm && burstSlot !== undefined) {
      if (t < 0.30) {
        const k = 1 - t / 0.30;
        lm.stamp(burstSlot, centre.x, centre.z, centre.x, centre.z,
                 70 + t * 260, 0.55, 1.0, 0.92, BURST_DEPOSIT * k * k * flashScale);
      } else {
        lm.stamp(burstSlot, 0, 0, 0, 0, 1, 0, 0, 0, 0);
      }
    }

    /* Flash down to dim, and the colour with it. The brightness falls from
       the flash to DIM_LEVEL over the same four seconds that the hue crosses
       from the train's colour to the manta's own — 7.2: it "glows in that
       colour while it's up for grabs, until its own colour returns". The two
       are deliberately on one timeline: a manta that is fading out and
       changing colour at different rates reads as two separate events. */
    if (t <= FADE_TIME) {
      const k = Math.min(t / FADE_TIME, 1);
      const peak = 1 + (FLASH_PEAK - 1) * flashScale;
      const level = peak + (DIM_LEVEL - peak) * easeInOut(k);
      const mix = easeInOut(k);
      for (let i = CUT_FROM; i < (scatter ? 5 : CUT_FROM); i++) {
        mantas.setTintScale(i, level);
        if (mantas.setCutMix) mantas.setCutMix(i, mix);
      }
    } else if (t < REFORM_TIME) {
      /* And back again as the train re-forms: the colour returns over the
         two seconds between the fade ending and the manta rejoining, so the
         train does not snap back into your colour in one frame. */
      const k = (t - FADE_TIME) / Math.max(REFORM_TIME - FADE_TIME, 1e-6);
      for (let i = CUT_FROM; i < (scatter ? 5 : CUT_FROM); i++) {
        if (mantas.setCutMix) mantas.setCutMix(i, 1 - easeInOut(Math.min(k, 1)));
      }
    }

    if (t >= END) {
      for (let i = CUT_FROM; i < (scatter ? 5 : CUT_FROM); i++) {
        mantas.setFree(i, null); mantas.setTintScale(i, 1);
        if (mantas.setCutMix) mantas.setCutMix(i, 0);
      }
      if (lm && burstSlot !== undefined) lm.stamp(burstSlot, 0, 0, 0, 0, 1, 0, 0, 0, 0);
      t = -1;
      return 1;
    }

    /* The slow motion beat, eased in and out so it does not snap. Skipped
       under reduced motion, which scaleAt() also honours. */
    lastScale = reduced ? 1 : scaleAt(t);
    return lastScale;
  }

  return {
    trigger, update, scaleAt, shockAt,
    get lastScale () { return lastScale; },
    get running () { return t >= 0; },
    get fired () { return fired; },
    get elapsed () { return t; },
    get reduced () { return isReduced(); },
    setUserReduced (v) { userReduced = v; },
  };
}
