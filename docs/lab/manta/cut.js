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

/* Page-wide flash ledger. Every flash anywhere asks here first. */
const flashes = [];
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
const DIM_LEVEL = 0.22;       // where a scattered manta ends up

/* The cut is between the second and third follower, so indices 3 and 4 are
   the ones that come away. */
const CUT_FROM = 3;

const easeInOut = x => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

export function createCut ({ mantas, lm, burstSlot }) {
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

  function trigger () {
    if (t >= 0 && t < REFORM_TIME) return false;   // already running
    reduced = isReduced();
    flashScale = (flashAllowed(performance.now()) ? 1 : 0.25) * (reduced ? 0.30 : 1);

    /* Cut where the train actually is, between followers 2 and 3. */
    const a = CUT_FROM - 1, b = CUT_FROM;
    centre = {
      x: (mantas.aPos.getX(a) + mantas.aPos.getX(b)) / 2,
      z: (mantas.aPos.getZ(a) + mantas.aPos.getZ(b)) / 2,
    };

    for (let i = CUT_FROM; i < 5; i++) {
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
    }
    t0 = performance.now();
    t = 0;
    return true;
  }

  function update (dt) {
    if (t < 0) return 1;
    t = (performance.now() - t0) / 1000;

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
                 70 + t * 260, 0.55, 1.0, 0.92, 0.055 * k * k * flashScale);
      } else {
        lm.stamp(burstSlot, 0, 0, 0, 0, 1, 0, 0, 0, 0);
      }
    }

    /* Flash down to dim. Brightness only: the hue never moves. */
    if (t <= FADE_TIME) {
      const k = Math.min(t / FADE_TIME, 1);
      const peak = 1 + (FLASH_PEAK - 1) * flashScale;
      const level = peak + (DIM_LEVEL - peak) * easeInOut(k);
      for (let i = CUT_FROM; i < 5; i++) mantas.setTintScale(i, level);
    }

    if (t >= REFORM_TIME) {
      for (let i = CUT_FROM; i < 5; i++) { mantas.setFree(i, null); mantas.setTintScale(i, 1); }
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
    get elapsed () { return t; },
    get reduced () { return isReduced(); },
    setUserReduced (v) { userReduced = v; },
  };
}
