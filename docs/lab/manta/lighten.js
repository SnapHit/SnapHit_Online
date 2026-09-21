/* How a colour is allowed to get lighter, and why warm ones are not allowed
 * all the way.
 *
 * PINK IS RESERVED FOR THE PINK MANTA (7.2), and a light red IS pink. Three
 * places lighten a manta's colour — the markings, your train's hotter burn
 * and the fresh head of a wake — and each of them used to lighten towards
 * plain white. On Nathan's screenshot, at marking strength 2, that came out
 * measured as: coral wild mantas at hue 355 to 9 degrees and saturation 0.20
 * to 0.27, pale pink; the red rival's body at hue 352 to 356, rose; and an
 * orange train at hue 22 and saturation 0.41, peach.
 *
 * So a warm colour lightens towards a WARM white instead: its own hue, held
 * at a saturation floor. It gets lighter and it stays red or orange. A cool
 * colour has no pink to fall into and lightens towards white as before.
 *
 * Warm is read from the colour itself — red is its largest channel — rather
 * than from a per-instance flag, because a flag would be a seventh vertex
 * buffer and WebGPU guarantees eight for what the mesh already needs.
 */
import { Fn, vec3, float, max, min, step } from 'three/tsl';

/* Saturation, HSV style: (max - min) / max. Below about 0.6 a warm colour
   reads pink or peach rather than red or orange, so that is where lightening
   stops.

   THE FLOOR IS IN LINEAR SPACE AND THE EYE IS NOT. The renderer works in
   linear and the screen shows sRGB, and the transfer curve lifts a small
   channel far more than a large one — so a floor of 0.62 in here came out as
   0.35 on the screen, and scarlet bodies measured at saturation 0.51 with
   the pink check asking for 0.6. Measured through the curve: 0.86 linear is
   0.59 on screen, 0.88 is 0.62, 0.90 is 0.65. 0.90 is the floor, for a
   little margin over the line the check draws.

   It leaves a warm colour very little room to lighten, which is the point: a
   red with room to lighten is a pink. */
export const SAT_FLOOR = 0.90;

/* The colour that lightening moves towards, in the shader. White for a cool
   colour; for a warm one, its own hue at the saturation floor and the same
   peak value, so any mix of the two is at least that saturated. */
export const lightTarget = /*#__PURE__*/ Fn(([c]) => {
  const m = max(max(c.x, c.y), c.z).max(1e-6);
  const n = min(min(c.x, c.y), c.z);
  const sat = m.sub(n).div(m);
  const warm = step(c.y, c.x).mul(step(c.z, c.x));
  /* 1 - (1 - c/m) * (floor/sat), scaled back up by m: the smallest channel
     lands at 1 - floor and the largest stays at m, so the hue does not move
     and the saturation is exactly the floor. */
  const k = float(SAT_FLOOR).div(sat.max(1e-6)).min(1.0);
  const warmWhite = vec3(1.0, 1.0, 1.0).sub(vec3(1.0, 1.0, 1.0).sub(c.div(m)).mul(k)).mul(m);
  return vec3(m, m, m).mul(float(1.0).sub(warm)).add(warmWhite.mul(warm));
});

/* The same rule on the CPU, for the tints worked out in JavaScript rather
   than in a shader. Same maths deliberately: a train that whitened one way in
   the buffer and another way in its markings would not match itself. */
export function lightTargetJS (c) {
  const m = Math.max(c[0], c[1], c[2], 1e-6);
  const n = Math.min(c[0], c[1], c[2]);
  const sat = (m - n) / m;
  const warm = c[0] >= c[1] && c[0] >= c[2];
  if (!warm) return [m, m, m];
  const k = Math.min(1, SAT_FLOOR / Math.max(sat, 1e-6));
  return c.map(v => (1 - (1 - v / m) * k) * m);
}
