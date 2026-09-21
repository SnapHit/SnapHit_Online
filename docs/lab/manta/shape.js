/* The animal's outline, measured off Nathan's reference photo.
 *
 * Split out of mantas.js, which drives ten of these along paths and is long
 * enough already. Everything here is shape: nothing in this file knows about
 * instances, tints, headings or the scene.
 */
import { BufferGeometry, Float32BufferAttribute } from 'three';
import { Fn, vec2, vec3, float, clamp, length, max, mix, smoothstep } from 'three/tsl';
import { U } from './params.js';

/* A manta seen from above, measured off Nathan's reference photo with both
   wings averaged. Wingspan 1.0, nose towards -Z.

   `across` is the distance out from the midline; `front` and `back` are how
   far behind the head's front the leading and trailing edges sit there. In
   words, which is what to check the numbers against: about twice as wide as
   long; a nearly straight, very slightly convex leading edge swept back about
   29 degrees; a broad root about 0.35 from front to back; a sickle-shaped
   wing whose trailing edge bows forward to its most advanced point at 0.44
   out, then curls back into a sharp tip. The tip is a point, not a curve. */
export const STATIONS = [
  //across  front  back
  [ 0.12,   0.08,  0.43 ],   // shoulder
  [ 0.16,   0.10,  0.39 ],
  [ 0.20,   0.13,  0.37 ],
  [ 0.25,   0.15,  0.33 ],
  [ 0.30,   0.17,  0.31 ],
  [ 0.35,   0.19,  0.29 ],
  [ 0.40,   0.22,  0.28 ],
  [ 0.44,   0.24,  0.28 ],   // the trailing edge's most forward point
  [ 0.47,   0.26,  0.29 ],
  [ 0.49,   0.28,  0.30 ],
  [ 0.50,   0.29,  0.30 ],   // the wingtip
];

/* Where the head's front sits in geometry z. Everything else is measured back
   from it. Chosen, not inherited: at 0.82 of a wingspan from nose to tail tip
   a leader is 32.8 units long against 31 of spacing, so the origin has to sit
   far enough forward that a leader's tail clears the first follower's head.
   Measured over a lap at this value; see the report for the margin. */
export const HEAD_FRONT = -0.34;
/* At the midline the body ends here, where the tail starts. */
export const BODY_BACK  = 0.52;
/* The photo's tail is far too thin to see at game size, so it is drawn to a
   width rather than to scale: these half-widths put a follower's tail at 2.0
   CSS pixels across at the base and 1.3 at the tip on a 412-wide phone, which
   still reads on the lowest resolution rung. */
export const TAIL_LEN   = 0.30;
/* A fine pale thread, not a bright blunt stick. At 1E's widths the tail read
   as a stick with a square end: 2.0 CSS pixels across, full width all the way
   to a flat tip, and a rear brighter than the body. These put it at about 1.3
   CSS pixels at the root and 0.5 at the tip on the smallest manta on a
   412-wide phone. */
export const TAIL_W0    = 0.022;
export const TAIL_W1    = 0.008;
const TAIL_SEGS  = 6;

/* How hard a turn has to be before the bank and the tail's sway reach full
   travel. The figure eight's tightest apex turns at about 3 radians a second,
   so this saturates through the corners and stays near zero on the straights. */
export const TURN_REF   = 2.0;

const lerp = (a, b, t) => a + (b - a) * t;

/* The leading edge. Inside 0.10 the front is not a curve but two short
   rounded lobes side by side — the rolled head fins — with a notch between
   them at the midline. */
function leadingEdge (a) {
  if (a <= 0.10) return 0.055 - 0.030 * Math.sin(Math.PI * a / 0.10);
  if (a < 0.12)  return lerp(0.055, 0.08, (a - 0.10) / 0.02);
  for (let i = 0; i < STATIONS.length - 1; i++) {
    const [a0, f0] = STATIONS[i], [a1, f1] = STATIONS[i + 1];
    if (a <= a1) return lerp(f0, f1, (a - a0) / (a1 - a0));
  }
  return STATIONS[STATIONS.length - 1][1];
}

/* The trailing edge, with the midline pinned to where the tail starts. */
function trailingEdge (a) {
  if (a <= 0.12) return lerp(BODY_BACK, 0.43, a / 0.12);
  for (let i = 0; i < STATIONS.length - 1; i++) {
    const [a0, , b0] = STATIONS[i], [a1, , b1] = STATIONS[i + 1];
    if (a <= a1) return lerp(b0, b1, (a - a0) / (a1 - a0));
  }
  return STATIONS[STATIONS.length - 1][2];
}

/* The stations the strip is actually built on: every measured one, plus an
   even fill, so the polyline passes through all eleven measurements and still
   has enough vertices between them for the wingbeat to bend it smoothly. */
function stationsAcross () {
  const set = new Set([0, 0.05, 0.10, 0.12]);
  for (let k = 0; k <= 18; k++) set.add(Math.round(k / 18 * 0.50 * 1e4) / 1e4);
  for (const st of STATIONS) set.add(st[0]);
  return [...set].sort((x, y) => x - y);
}

/* One strip per wing across the stations, so every vertex at the same
   distance from the spine rotates by the same flap angle and the wing bends
   along its length instead of hinging at a hub.
   POSITION ONLY, and that is load-bearing: WebGPU guarantees only eight
   vertex buffers per pipeline and three allocates one per attribute, so the
   two extra per-vertex attributes this used to carry took the mesh to nine
   and the device refused the pipeline. Nothing was drawn and nothing was
   said. Where a vertex sits on the tail, and how pale it is there, are both
   worked out in the shader from the coordinates instead, which costs no
   buffer and cannot drift from the geometry. */
export function mantaGeometry () {
  const pos = [];
  const push = (x, z) => { pos.push(x, 0, z); };
  const A = stationsAcross();

  for (const sign of [1, -1]) {
    for (let i = 0; i < A.length - 1; i++) {
      const a0 = A[i], a1 = A[i + 1];
      const L0 = HEAD_FRONT + leadingEdge(a0),  T0 = HEAD_FRONT + trailingEdge(a0);
      const L1 = HEAD_FRONT + leadingEdge(a1),  T1 = HEAD_FRONT + trailingEdge(a1);
      /* The tip: front and back meet, so the second triangle folds to nothing
         and the wing ends on a point. */
      push(sign * a0, L0); push(sign * a0, T0); push(sign * a1, L1);
      push(sign * a0, T0); push(sign * a1, T1); push(sign * a1, L1);
    }
  }

  /* The tail. It is the only geometry behind where the body ends, so the
     shader can tell a tail vertex from a body one by its z alone. */
  const tz = k => HEAD_FRONT + BODY_BACK + TAIL_LEN * k;
  const tw = k => lerp(TAIL_W0, TAIL_W1, k);
  for (let i = 0; i < TAIL_SEGS; i++) {
    const k0 = i / TAIL_SEGS, k1 = (i + 1) / TAIL_SEGS;
    const z0 = tz(k0), z1 = tz(k1), w0 = tw(k0), w1 = tw(k1);
    push(-w0, z0); push( w0, z0); push(-w1, z1);
    push( w0, z0); push( w1, z1); push(-w1, z1);
  }

  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  return g;
}

/* Where the tail begins, in geometry z. The shader needs it to tell the tail
   from the body without a per-vertex flag. */
export const TAIL_Z0 = HEAD_FRONT + BODY_BACK;



/* ------------------------------------------------------------ the markings */

/* The photo's pattern, as maths on the outline coordinates: no texture, no
   image file, and nothing per vertex, so the vertex buffer count is untouched.
   `u` is the distance out from the midline, 0 to 0.5; `v` is the distance
   behind the head's front.

   Every patch is an ELLIPTICAL falloff, cubed smooth at its edge. An earlier
   attempt bounded each patch in u and v separately, which is a rectangle in
   outline space however soft its edges, and on screen the shoulder patches
   came out as two crisp blocks. Rounded, or it is not the photo's animal.

   In the photo the patches are about five times the back. That ratio belongs
   to a daylight photograph of a dark animal in bright water; this is a night
   ocean where the animals carry the light. So the pattern carries over and the
   contrast does not: the back stays at the tier colour and the marks are
   paler — mixed towards a white of the same peak component — and brighter. */
const ellipse = (du, dv) => {
  const e = clamp(float(1.0).sub(length(vec2(du, dv))), 0, 1);
  return e.mul(e).mul(float(3.0).sub(e.mul(2.0)));
};

export function markings (tint, shade, gx, gz) {
  return Fn(() => {
    const u = gx.abs();
    const v = gz.sub(HEAD_FRONT);
    const peak = max(max(tint.x, tint.y), tint.z);
    const white = vec3(peak, peak, peak);
    const col = tint.mul(shade).toVar();

    /* Two shoulder patches, one each side of the spine, from just behind the
       head to about 0.22 back and about 0.14 out. They meet at the front and
       part behind, so the ellipse's centre walks outwards down its length —
       that is the V. */
    const centre = float(0.045).add(clamp(v.sub(0.05).div(0.17), 0, 1).mul(0.055));
    const shoulder = ellipse(u.sub(centre).div(0.062), v.sub(0.135).div(0.092))
      .mul(U.marks);
    col.assign(mix(col, mix(tint, white, 0.35).mul(1.22).mul(shade), clamp(shoulder, 0, 1)));

    /* Pale wingtips over the outer tenth of the span, fading inwards along
       the trailing side: the leading edge runs from 0.025 at the spine to
       0.29 at the tip, so this is measured from that line back. */
    const lead = float(0.025).add(u.mul(0.53));
    const tipMark = smoothstep(float(0.425), float(0.50), u)
      .mul(smoothstep(lead.sub(0.008), lead.add(0.05), v))
      .mul(U.marks);
    col.assign(mix(col, mix(tint, white, 0.30).mul(1.16).mul(shade), clamp(tipMark, 0, 1)));

    /* A faint lighter stripe along the spine, 0.20 to 0.40 back. */
    const stripe = ellipse(u.div(0.055), v.sub(0.30).div(0.115)).mul(U.marks).mul(0.55);
    col.assign(mix(col, mix(tint, white, 0.15).mul(1.10).mul(shade), clamp(stripe, 0, 1)));

    return col;
  })();
}
