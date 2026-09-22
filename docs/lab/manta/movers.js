/* Where everybody swims.
 *
 * The figure eight and its arc-length table, the three rival trains, the four
 * wild mantas and the mantas a cut has set loose. It writes position and
 * heading into the instanced attributes once a frame and nothing else; what
 * those mantas look like is mantas.js's business and what colour they are is
 * colours.js's.
 *
 * TWO RULES HOLD THE WHOLE FILE TOGETHER, both learned the hard way:
 * a follower sits a fixed distance back along the leader's path measured by
 * ARC LENGTH, never by the path's parameter; and every manta steers its
 * heading and then moves ALONG it, never having its position written as a
 * function of the clock. The comments below say what each one cost.
 */
import { TURN_REF } from './shape.js';

const TAU = Math.PI * 2;

/* A slow figure eight, sized to sit inside the view at either shape: the short
   side of the view is 385 units whichever way the phone is held, because the
   area is fixed, so nothing may exceed about 190 units from the centre.

   The SHAPE is chosen for its tightest turn, not just to fit. For this curve
   the apex radius works out at A*A/(4*B), and the first version — 140 by 300 —
   turned inside 15.7 units while a manta is 40 units across: a hairpin
   tighter than the animal, which the train visibly piles up in. Scanned the
   family against the view limit; 175 by 145 turns inside 40.7 units, just
   over one wingspan, which is the best available without flattening the eight
   into a bar. A gentler path is not reachable at this view size, so the
   remaining bunching on a bend is geometry and not a bug. */
const FIG8_A = 175, FIG8_B = 145;
/* World units a second, set rather than derived: shortening the path must not
   quietly change how fast the train swims. This is the speed the phone saw. */
const TRAIN_SPEED = 120;
const SPACING = 31;           // design doc's 22, scaled with the sizes above

export function createMovers ({ aPos, aHead, aMotion, COUNT, RIVAL_TRAINS, RIVAL_LEN, WILD_COUNT }) {
  const prevHead = new Float32Array(COUNT);
  const lagTurn  = new Float32Array(COUNT);

  /* The figure eight, and an arc-length table over it.
  
     THE TABLE IS THE POINT. Placing a follower at a fixed offset in the path
     PARAMETER is not the same as placing it a fixed distance back, because a
     lemniscate is traversed much faster through its middle than round its
     ends. Converting distance to parameter with the leader's instantaneous
     speed — which is what this did first — is only right where the whole
     train sits in one stretch of even speed. Everywhere else the error grows
     with each follower, so the tail of the train stretches and snaps back
     through every turn. That is exactly what it looked like on the phone.
  
     So: sample the curve once, accumulate chord lengths, and invert that to
     get the parameter at any arc length. Each follower then sits exactly
     SPACING units of path behind the one ahead, at every point of the cycle.
     2048 samples over a path of about 1,200 units is well under a unit of
     quantisation, and the whole table is built once at startup. */
  const fig8 = t => [FIG8_A * Math.cos(t), FIG8_B * Math.sin(2 * t) / 2];

  const ARC_N = 2048;
  const arcT = new Float64Array(ARC_N + 1);
  const arcS = new Float64Array(ARC_N + 1);
  {
    let acc = 0, prev = fig8(0);
    for (let i = 1; i <= ARC_N; i++) {
      const t = TAU * i / ARC_N, p = fig8(t);
      acc += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
      arcT[i] = t; arcS[i] = acc; prev = p;
    }
  }
  const PATH_LENGTH = arcS[ARC_N];

  function tAtArc (s) {
    s = ((s % PATH_LENGTH) + PATH_LENGTH) % PATH_LENGTH;
    let lo = 0, hi = ARC_N;
    while (lo + 1 < hi) { const mid = (lo + hi) >> 1; if (arcS[mid] <= s) lo = mid; else hi = mid; }
    const span = arcS[hi] - arcS[lo];
    const f = span > 1e-9 ? (s - arcS[lo]) / span : 0;
    return arcT[lo] + (arcT[hi] - arcT[lo]) * f;
  }

  /* A manta cut out of the train stops being placed on the path and starts
     carrying its own position and heading, exactly as the loose singles do.
     Null puts it back under the train's control. */
  const freed = new Array(COUNT).fill(null);
  function setFree (i, state) { freed[i] = state; }
  const isFree = i => freed[i] !== null;

  let half = { w: 200, h: 420 };
  function setBounds (view) { half = { w: view.w / 2, h: view.h / 2 }; }

  /* The rival leaders and the wild mantas carry their own position and
     heading and are advanced a step at a time, rather than having a position
     written as a function of the clock.
  
     THIS IS WHY. The first version set x = -sin(head)*dist and
     z = -cos(head)*dist, with head itself drifting. Differentiate that and a
     second term falls out, head' * dist, at right angles to the nose. dist
     grows without bound, so after a minute the sideways component was about
     177 units a second against a forward speed of 62: the manta was very
     nearly crabbing. It also got worse the longer the page stayed open, which
     is why only some of them ever looked wrong.
  
     Steering the heading and then moving ALONG it cannot produce that, and it
     is what the greybox will have to do anyway. */
  const rivalLeads = [0, 1, 2].map(i => ({
    head:  0.9 + i * 2.1,
    speed: 72 + i * 9,
    phase: i * 2.0,
    x: (i - 1) * 90,
    z: (i - 1) * 170,
    trail: [],
  }));
  const wilds = [0, 1, 2, 3].map(i => ({
    head:  0.4 + i * 1.6,
    speed: 48 + i * 7,
    phase: i * 1.3,
    x: (i % 2 ? 1 : -1) * (70 + i * 35),
    z: (i < 2 ? -1 : 1) * (110 + i * 45),
  }));
  let lastSecs = null;

  const wrap = (v, lim) => { const s = lim * 2; return ((v + lim) % s + s) % s - lim; };
  /* The shorter way round from b to a, so interpolating two headings across
     the seam of a full turn does not spin a manta the long way. */
  const angleTo = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };

  function place (i, x, z, y, heading) {
    aPos.setXYZ(i, x, y, z);
    aHead.setX(i, heading);
  }

  function update (secs) {
    /* Clamped, so a hidden tab or a test driving update() out of order cannot
       teleport anyone. Hoisted: the scattered mantas and the loose singles
       both integrate against it. */
    const dt = lastSecs === null ? 0 : Math.min(Math.max(secs - lastSecs, 0), 0.1);
    lastSecs = secs;

    /* Your train. The leader's position along the path is a distance, not a
       parameter, and each follower is exactly SPACING units of path behind
       the one ahead. Heading comes from half a unit further along the same
       curve, so it is right even where the parameter is moving fastest. */
    const sLead = secs * TRAIN_SPEED;
    for (let i = 0; i < 5; i++) {
      const f = freed[i];
      if (f !== null) {
        /* Scattered, and still swimming headfirst: heading first, then move
           along it, which is the rule the loose mantas already follow. */
        f.head += (f.turn || 0) * dt;
        f.x += -Math.sin(f.head) * f.speed * dt;
        f.z += -Math.cos(f.head) * f.speed * dt;
        place(i, wrap(f.x, half.w + 34), wrap(f.z, half.h + 34), 0, f.head);
        continue;
      }
      const s = sLead - i * SPACING;
      const [x, z] = fig8(tAtArc(s));
      const [x2, z2] = fig8(tAtArc(s + 0.5));
      place(i, x, z, 0, Math.atan2(-(x2 - x), -(z2 - z)));
    }

    /* Three rival trains. Each leader cruises with a slow weave, exactly as
       the loose mantas do, and its followers sit a fixed spacing back along
       its RECENT PATH measured by arc length — the greybox's follower rule
       from 10.2, and the same rule your own train follows on the figure
       eight. A follower steers to the heading of the path there and moves
       along it, so nothing ever crabs sideways. */
    const MARGIN = 34;
    /* A TRAIN WRAPS AS A UNIT, so its boundary has to clear the view by the
       whole train and not just by one manta. At MARGIN the leader crossed 34
       units outside the view and re-seeded its trail behind its new position,
       which put its two followers 62 units the other side of the edge, in
       plain sight: 4 of 6 wraps landed inside the picture, the nearest 31
       units in. Measured by stepping the page at a true 1/60 and asking of
       every jump whether the animal was on screen at either end of it. The
       wild mantas are single and keep MARGIN. */
    const TRAIN_MARGIN = MARGIN + (RIVAL_LEN - 1) * SPACING + 30;
    for (let r = 0; r < RIVAL_TRAINS; r++) {
      const lead = rivalLeads[r];
      lead.head += Math.sin(secs * 0.17 + lead.phase) * 0.10 * dt;
      const nx = lead.x - Math.sin(lead.head) * lead.speed * dt;
      const nz = lead.z - Math.cos(lead.head) * lead.speed * dt;
      /* Wrapping would put a kink in the recorded path, so the trail is reset
         when the leader crosses the edge and the followers close up again. */
      const wx = wrap(nx, half.w + TRAIN_MARGIN), wz = wrap(nz, half.h + TRAIN_MARGIN);
      const jumped = Math.hypot(wx - lead.x, wz - lead.z) > 200;
      lead.x = wx; lead.z = wz;
      const base = 5 + r * RIVAL_LEN;
      place(base, lead.x, lead.z, r * 6 - 6, lead.head);

      const trail = lead.trail;
      /* A WRAP MUST NOT COLLAPSE THE TRAIN. Emptying the trail left the
         followers with nowhere to sit, so they stacked on the leader and the
         train closed to a point until it had swum a spacing clear again —
         measured over a lap, a rival gap of 0 against a spacing of 31. The
         trail is re-seeded as a straight line behind the leader's new
         position instead, so the whole train wraps together and comes back
         on at the far edge still in formation. */
      if (jumped) {
        trail.length = 0;
        const bx = Math.sin(lead.head), bz = Math.cos(lead.head);   // behind it
        const need = (RIVAL_LEN - 1) * SPACING + 60;
        for (let q = 16; q >= 0; q--) {
          const d = need * (q / 16);
          trail.push({ x: lead.x + bx * d, z: lead.z + bz * d, h: lead.head, s: need - d });
        }
      }
      const lastP = trail[trail.length - 1];
      const step = lastP ? Math.hypot(lead.x - lastP.x, lead.z - lastP.z) : 0;
      if (!lastP || step > 1.5) {
        trail.push({ x: lead.x, z: lead.z, h: lead.head, s: (lastP ? lastP.s : 0) + step });
        const need = (RIVAL_LEN - 1) * SPACING + 60;
        while (trail.length > 2 && trail[trail.length - 1].s - trail[0].s > need) trail.shift();
      }
      /* The leader is up to 1.5 units past the last point it recorded, and
         measuring the spacing from that point instead of from where it
         actually is let the first gap read 32.5 against a spacing of 31. So
         the leader's live position is the head of the path, carried in a
         reused object rather than a fresh one every frame. */
      const tailP = trail[trail.length - 1];
      const headPt = lead.headPt || (lead.headPt = { x: 0, z: 0, h: 0, s: 0 });
      if (tailP) {
        headPt.x = lead.x; headPt.z = lead.z; headPt.h = lead.head;
        headPt.s = tailP.s + Math.hypot(lead.x - tailP.x, lead.z - tailP.z);
      }
      const at = q => (q < trail.length ? trail[q] : headPt);
      const top = trail.length;                       // index of headPt
      const headS = tailP ? headPt.s : 0;
      for (let k = 1; k < RIVAL_LEN; k++) {
        const want = headS - k * SPACING;
        if (!trail.length) { place(base + k, lead.x, lead.z, r * 6 - 6, lead.head); continue; }
        /* Between the two recorded points, not snapped to the earlier one:
           the path is only sampled every 1.5 units, and snapping let a gap
           run up to 1.5 units long and step as the trail advanced. */
        let pt = trail[0];
        for (let q = top; q >= 0; q--) {
          const a = at(q);
          if (a.s > want) continue;
          const nx2 = q < top ? at(q + 1) : null;
          if (!nx2) { pt = a; break; }
          const f = (want - a.s) / Math.max(nx2.s - a.s, 1e-6);
          pt = { x: a.x + (nx2.x - a.x) * f,
                 z: a.z + (nx2.z - a.z) * f,
                 h: a.h + angleTo(nx2.h, a.h) * f };
          break;
        }
        place(base + k, pt.x, pt.z, r * 6 - 6, pt.h);
      }
    }

    /* Four wild mantas, cruising and weaving on their own. */
    for (let i = 0; i < WILD_COUNT; i++) {
      const m = wilds[i];
      m.head += Math.sin(secs * 0.13 + m.phase) * 0.12 * dt;
      m.x = wrap(m.x - Math.sin(m.head) * m.speed * dt, half.w + MARGIN);
      m.z = wrap(m.z - Math.cos(m.head) * m.speed * dt, half.h + MARGIN);
      place(5 + RIVAL_TRAINS * RIVAL_LEN + i, m.x, m.z, (i % 2) * 24 - 12, m.head);
    }

    /* How hard everyone is turning, worked out from the headings this frame
       rather than from the paths, so it is right for the train, the singles
       and anything scattered alike. The lagged copy is a first-order filter:
       the tail is still swinging out when the turn has finished. */
    if (dt > 0) {
      const k = 1 - Math.exp(-dt / 0.25);
      for (let i = 0; i < COUNT; i++) {
        const h = aHead.getX(i);
        let d = h - prevHead[i];
        while (d >  Math.PI) d -= TAU;
        while (d < -Math.PI) d += TAU;
        prevHead[i] = h;
        const rate = d / dt;
        lagTurn[i] += (rate - lagTurn[i]) * k;
        const c = v => Math.max(-1, Math.min(1, v / TURN_REF));
        aMotion.setY(i, c(rate)); aMotion.setZ(i, c(lagTurn[i]));
      }
      aMotion.needsUpdate = true;
    } else {
      for (let i = 0; i < COUNT; i++) prevHead[i] = aHead.getX(i);
    }

    aPos.needsUpdate = true;
    aHead.needsUpdate = true;
  }
  return { update, setBounds, setFree, isFree, pathLength: PATH_LENGTH, spacing: SPACING };
}
