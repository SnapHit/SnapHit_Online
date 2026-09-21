/* The mantas: one InstancedMesh, ten instances, wings flexed in the shader.
 *
 * Everything per-instance is a plain instanced vertex attribute updated from
 * the CPU each frame. No compute passes and no storage buffers: both are
 * WebGPU-only, and the design doc's rule is that the signature look has to
 * hold on the WebGL2 fallback. This file takes the same path on both.
 *
 * r186 NOTE, found by reading the vendored source. createBufferAttribute()
 * only calls setInstanced() on its mat3 and mat4 branches, so
 * instancedBufferAttribute(array, 'vec3') does NOT mark a vec3 as instanced.
 * BufferAttributeNode's constructor does pick it up from the attribute object
 * itself, so passing a real InstancedBufferAttribute works and passing a bare
 * array would silently draw ten mantas on top of each other.
 *
 * THE WINGBEAT, and why it is visible at all. The camera looks straight down,
 * so a wing that only moved up and down would project to nothing. A wing
 * element at distance r from the spine that rotates by theta sits at
 * r*cos(theta) across and r*sin(theta) up, so the beat reads on screen as the
 * silhouette narrowing and widening. That is what you actually see from above.
 */
import {
  InstancedMesh, InstancedBufferAttribute,
  MeshBasicNodeMaterial, DoubleSide, DynamicDrawUsage, Matrix4
} from 'three';
import {
  Fn, vec3, float, sin, cos, sign, clamp, mix, smoothstep, step, positionGeometry, varying,
  instancedBufferAttribute
} from 'three/tsl';
import { uTime } from './clock.js';
import { P, U, onParam } from './params.js';
import { PALETTE, deal, levelFor, levelForYours } from './palette.js';
import { mantaGeometry, markings, STATIONS, HEAD_FRONT, BODY_BACK, TAIL_LEN, TAIL_Z0, TAIL_W0, TAIL_W1, TURN_REF } from './shape.js';

/* Your train of five, three rival trains of three, four wild. Doc v1.8's
   scene: the lab has to show rival TRAINS against wild mantas, not lone
   rivals, because a train is what the game is about. */
export const COUNT = 18;
const RIVAL_TRAINS = 3;
const RIVAL_LEN = 3;              // a leader and two followers
const WILD_COUNT = 4;

const TAU = Math.PI * 2;
/* 0.35: one full beat every 2.9 seconds. 1.4 read as fluttering, 0.65 was
   still too quick on the phone. A cruising manta beats about this often.
   The half-radian phase offset between followers is unchanged, because the
   ripple down the train was the one part that already worked. */
const BEATS_PER_SECOND = 0.35;
/* The wingbeat's depth now lives in params.js as U.flap, so the drawer can
   move it. 0.45 radians at the tip; 0.75 was what made the crescent read as a
   kite through half of every beat. */
/* 1.4, up from 1.1. Grace is not only rate: the further the tip trails the
   root, the more a wing behaves like something flexible being swept through
   water and the less like a hinged plank. At a slower beat there is room for
   more of this before it reads as a wobble. */
const SPAN_LAG = 1.4;             // travelling wave: the tip trails the root

/* The brightness hierarchy from section 7.2, and it is not negotiable: your
   train brightest, rivals bright, anything unattached dim, background darkest.
   No warm colours anywhere in this spike; warm is reserved for danger. */
/* Every manta is bright and saturated now: v1.8 retires the dark wild manta
   along with the conditions that needed it. One base level for everyone —
   scaled per colour, because the seven hues are not equally bright and a flat
   level leaves the dim ones failing condition 3 (see levelFor in palette.js)
   — and your train burns hotter on top of that. */
const BASE_LEVEL = 0.62;
/* Your train is at least 1.4 times the same colour at the base level, and it
   is lifted towards white as well: a saturated hue at full value has nowhere
   brighter to go in its own channels, so the extra has to come out of the
   saturation or it does not come out at all. */
const YOURS_GAIN = 1.55;
const YOURS_WHITE = 0.22;

/* The design doc's table gives leader radius 14 and follower radius 10, which
   is where 28 and 20 came from. Those are greybox gameplay sizes, set against
   a camera that follows and zooms out. This spike has a still camera and is
   judged by eye, and at 28 units — 30 CSS pixels on the test phone — a manta
   was too small to read. Up about 40%. Follower spacing goes up with them, so
   the gap you see between them is unchanged. */
const LEADER_SIZE   = 40;   // world units across the wings
const FOLLOWER_SIZE = 28;

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

const srgbToLinear = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
function tint (hex, level) {
  /* Written as sRGB hex and converted here, for the same reason the ocean
     uses color(): the renderer's working space is linear, and a hex used raw
     comes out about four times too bright. */
  const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
  return [srgbToLinear(r) * level, srgbToLinear(g) * level, srgbToLinear(b) * level];
}

/* ------------------------------------------------------------- geometry */

/* ------------------------------------------------------------- the mesh */

/* The stroke, as an angle about the spine. Amplitude grows with the span so
   the spine barely moves and the tips do the work, and the tip trails the
   root, so one wing is a travelling wave rather than a rigid plank. Shared,
   because the colour has to know the same angle the position used and a
   varying between them would cost a slot this mesh cannot spare. */
const beat = (span, phase) => sin(
  uTime.mul(TAU * BEATS_PER_SECOND).add(phase).sub(span.mul(SPAN_LAG))
).mul(U.flap).mul(span);

/* A light from the top right of the screen, the same corner stage 4's water
   is lit from. The camera looks straight down with screen-right at +x and
   screen-up at -z, so "top right and above" is this. */
const LIGHT = { x: 0.55, y: 0.66, z: -0.51 };

export function createMantas (scene) {
  const aPos   = new InstancedBufferAttribute(new Float32Array(COUNT * 3), 3).setUsage(DynamicDrawUsage);
  const aHead  = new InstancedBufferAttribute(new Float32Array(COUNT), 1).setUsage(DynamicDrawUsage);
  const aSize  = new InstancedBufferAttribute(new Float32Array(COUNT), 1).setUsage(DynamicDrawUsage);
  /* Phase, bank and the lagged bank in ONE attribute, not three. WebGPU
     guarantees only eight vertex buffers per pipeline and three allocates one
     per attribute, so every separate attribute is a slot spent. */
  const aMotion = new InstancedBufferAttribute(new Float32Array(COUNT * 3), 3).setUsage(DynamicDrawUsage);
  const aTint  = new InstancedBufferAttribute(new Float32Array(COUNT * 3), 3).setUsage(DynamicDrawUsage);


  const instanced = [aPos, aHead, aSize, aTint, aMotion];

  const nPos   = instancedBufferAttribute(aPos,   'vec3');
  const nHead  = instancedBufferAttribute(aHead,  'float');
  const nSize  = instancedBufferAttribute(aSize,  'float');
  /* x: the wingbeat's phase. y: how hard this manta is turning, which drives
     the bank. z: the same thing lagged, which drives the tail, still swinging
     when the turn is over. */
  const nMotion = instancedBufferAttribute(aMotion, 'vec3');
  const nTint  = instancedBufferAttribute(aTint,  'vec3');

  /* Per-instance attributes cannot be read in the fragment stage on either
     backend, so each one the colour needs crosses as a varying. These are
     varyings, not new attributes: the vertex buffer count is unchanged. */
  const nTintV   = varying(nTint);
  const nMotionV = varying(nMotion);
  const nHeadV   = varying(nHead);

  const material = new MeshBasicNodeMaterial({ side: DoubleSide });

  material.positionNode = Fn(() => {
    const g = positionGeometry;
    const r = g.x.abs();                    // distance from the spine, 0 .. 0.5
    const span = r.mul(2.0);                // 0 at the spine, 1 at the tip

    /* The beat. Amplitude grows with the span so the spine barely moves and
       the tips do the work, and the tip trails the root, so one wing is a
       travelling wave rather than a rigid plank. */
    /* The scene's clock and not the renderer's, so the cut's slow motion
       slows the wingbeat along with the water. See clock.js. */
    const theta = beat(span, nMotion.x);

    /* Rotate each wing element about the spine. x narrows by cos, y lifts by
       sin. Under a top-down camera the narrowing is the visible half. */
    /* The bank. In a turn the INNER wing foreshortens, up to 8 percent at the
       tip and nothing at the spine, which is what a manta rolling into a
       corner looks like from above. Heading increases to the left, so the
       inner wing is the -x one; straight swimming has bank 0 and stays
       exactly symmetric. */
    const inner = clamp(g.x.negate().mul(2.0).mul(nMotion.y), 0, 1);
    const banked = g.x.mul(cos(theta)).mul(float(1.0).sub(inner.mul(0.08)));

    /* The tail trails. It is driven by the LAGGED turn, so it is still
       swinging out when the turn has finished, and it swings to the outside:
       a left turn throws it right.

       How far along the tail a vertex sits comes from its z, not from a
       per-vertex flag: the tail is the only geometry behind where the body
       ends, so `run` is exactly 0 over the whole body and 0 to 1 down the
       tail. That is one fewer vertex buffer, and on WebGPU the count is what
       matters — see shape.js. */
    const run = clamp(g.z.sub(TAIL_Z0).div(TAIL_LEN), 0, 1);
    const sway = run.mul(nMotion.z).mul(0.06);

    const flexed = vec3(banked.add(sway), r.mul(sin(theta)), g.z).mul(nSize);

    /* Heading, about Y. At heading 0 the nose points -Z, which is up the
       screen under scene.js's camera. */
    const ch = cos(nHead), sh = sin(nHead);
    return vec3(
      flexed.x.mul(ch).add(flexed.z.mul(sh)),
      flexed.y,
      flexed.z.mul(ch).sub(flexed.x.mul(sh))
    ).add(nPos);
  })();

  /* Identity carries the brightness and nothing else modulates it, because
     the hierarchy is the thing this stage has to prove. The only shading is a
     slight fall-off towards the tail so a manta is not a flat cut-out; it is
     18% at most and cannot be mistaken for a tier. Wrapped in one varying:
     the tint is a per-instance vertex attribute and the fragment stage cannot
     read one directly on either backend. */
  /* A slight fall-off from the head towards the tail so a manta is not a flat
     cut-out, and on the tail itself a dark base running pale for its rear two
     thirds. Both from the coordinates, so the geometry carries no per-vertex
     attribute and the mesh stays inside WebGPU's eight vertex buffers. */
  const zg = positionGeometry.z;
  const zNorm = clamp(zg.sub(HEAD_FRONT).div(BODY_BACK), 0, 1);
  const bodyShade = float(1.0).sub(zNorm.mul(0.18));
  /* The tail: 0.55 of the tier colour at the root running to 0.8, so it reads
     as a fine pale thread and is never brighter than the body. */
  const tailRun = clamp(zg.sub(TAIL_Z0).div(TAIL_LEN), 0, 1);
  const tailShade = mix(float(0.55), float(0.80), smoothstep(float(0.04), float(0.45), tailRun));
  const shade = mix(bodyShade, tailShade, step(float(0.001), tailRun));

  /* The stroke, shown by light rather than by shape. Each wing element is a
     flat strip rotated about the spine, so its normal is (-sign(x) sin t,
     cos t, 0) before the heading turns it about Y. Against a fixed light the
     two wings alternately catch and lose it through the beat — up to about 15
     per cent at the tips and nothing at the spine, where the rotation is
     nothing. It averages out across an animal, so the hierarchy's medians
     barely move, but the eye reads the stroke.

     theta is recomputed rather than passed: a varying from the vertex stage
     would be another slot, and beat() is the same function the position used
     with the same inputs. */
  const gx = positionGeometry.x;
  const spanC = gx.abs().mul(2.0);
  const thetaC = beat(spanC, nMotionV.x);
  const nx = sign(gx).negate().mul(sin(thetaC));
  const ny = cos(thetaC);
  const ch = cos(nHeadV), sh = sin(nHeadV);
  /* Only the x component turns; the normal has no z before the heading. */
  const lambert = nx.mul(ch).mul(LIGHT.x).add(ny.mul(LIGHT.y)).add(nx.mul(sh).negate().mul(LIGHT.z));
  const lit = float(1.0).add(lambert.sub(LIGHT.y).mul(0.55).mul(spanC));

  material.colorNode = markings(nTintV, shade, positionGeometry.x, positionGeometry.z)
    .mul(clamp(lit, 0.5, 1.5));

  const mesh = new InstancedMesh(mantaGeometry(), material, COUNT);

  /* Every attribute this mesh needs is one WebGPU vertex buffer, and WebGPU
     guarantees only eight. Counted from the objects rather than written down,
     so it cannot drift from the truth, and reported on the panel because the
     device that enforces the limit is Nathan's phone and not this container.
     Going over does not throw: the device refuses the pipeline, the mesh is
     not drawn, and nothing is said. That is how ten invisible mantas shipped. */
  const vertexBuffers = Object.keys(mesh.geometry.attributes).length + instanced.length;
  mesh.frustumCulled = false;      // every instance is placed by the shader
  /* The instance matrix is identity and stays identity: placement, heading
     and size all come from the attributes above. InstancedMesh allocates it
     zeroed, and a zero matrix would collapse the mesh to a point. */
  const I = new Matrix4();
  for (let i = 0; i < COUNT; i++) mesh.setMatrixAt(i, I);
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);

  /* ------------------------------------------------------ the ten paths */

  /* 0-4    your train, on the figure eight
     5-13   three rival trains: a leader and two followers each
     14-17  four wild mantas                                          */
  const roles = [];
  for (let i = 0; i < 5; i++) {
    roles.push({ kind: 'train', idx: i,
      size: i === 0 ? LEADER_SIZE : FOLLOWER_SIZE, group: 'you' });
  }
  for (let r = 0; r < RIVAL_TRAINS; r++) {
    for (let k = 0; k < RIVAL_LEN; k++) {
      roles.push({ kind: 'rival', idx: k, rival: r,
        size: k === 0 ? LEADER_SIZE : FOLLOWER_SIZE, group: 'rival' + r });
    }
  }
  for (let i = 0; i < WILD_COUNT; i++) {
    roles.push({ kind: 'wild', idx: i, size: FOLLOWER_SIZE, wild: true, group: 'wild' });
  }

  /* The deal. A seed per load, ?seed= to reproduce one, ?player= to pin the
     roll for a test. */
  const query = new URLSearchParams(location.search);
  const seedParam = parseInt(query.get('seed'), 10);
  let seed = Number.isFinite(seedParam) ? seedParam : (Math.random() * 0xffffffff) >>> 0;
  let pinned = query.get('player');
  let dealt = null;

  /* A saturated hue at full value cannot get brighter in its own channels, so
     your train's extra comes out of the saturation too — and now that the dim
     hues carry a level of their own, some of them ask for more than a channel
     has left. Nothing is allowed to sit above 1 and be clipped, because
     clipping a channel moves the HUE, which 7.2 forbids: the colour is scaled
     back inside the range and the luminance that costs is paid back as white,
     by solving for it rather than guessing. */
  const LUM = t => 0.2126 * t[0] + 0.7152 * t[1] + 0.0722 * t[2];
  /* The level every manta that is not in your train uses, per colour. */
  const baseTintFor = hex => tint(hex, levelFor(hex, BASE_LEVEL));
  const yoursTint = hex => {
    const t = tint(hex, levelForYours(hex, BASE_LEVEL) * YOURS_GAIN);
    const want = LUM(t);
    const over = Math.max(1, t[0], t[1], t[2]);
    const scaled = t.map(v => v / over);
    const top = Math.max(scaled[0], scaled[1], scaled[2]);
    const have = LUM(scaled);
    /* w whitens each channel towards the peak, which lifts the luminance from
       `have` towards `top`. Solve w for the luminance the gain asked for, and
       never go below the 22% that was already there. */
    const solved = top > have ? (Math.min(want, top) - have) / (top - have) : 0;
    const w = Math.min(1, Math.max(YOURS_WHITE, solved));
    return scaled.map(v => v + (top - v) * w);
  };

  function rollColours (newSeed) {
    if (newSeed !== undefined) seed = newSeed >>> 0;
    dealt = deal({ seed, pinned, coolWild: P.coolWild >= 0.5,
                   rivals: RIVAL_TRAINS, wilds: WILD_COUNT });
    for (let i = 0; i < COUNT; i++) {
      const r = roles[i];
      let t;
      if (r.kind === 'train') t = yoursTint(dealt.mine.hex);
      else if (r.kind === 'rival') t = baseTintFor(dealt.rivals[r.rival].hex);
      else t = baseTintFor(dealt.wilds[r.idx].hex);
      r.tint = t;
      baseTint[i] = t.slice();
      applyTint(i);
    }
  }

  /* The identity colour each manta was given. Brightness is scaled against
     this rather than against whatever is in the buffer, so a flash and a fade
     cannot drift the hue: the cut changes how bright a manta is, never which
     colour it is. 7.2 forbids relying on hue alone, and the inverse matters
     just as much — the hue has to survive the effect. */
  const baseTint = roles.map(() => [0, 0, 0]);
  function applyTint (i) {
    const t = baseTint[i], k = tintScale[i];
    aTint.setXYZ(i, t[0] * k, t[1] * k, t[2] * k);
    aTint.needsUpdate = true;
  }
  const prevHead = new Float32Array(COUNT);
  const lagTurn  = new Float32Array(COUNT);
  const tintScale = new Float32Array(COUNT).fill(1);

  for (let i = 0; i < COUNT; i++) {
    aSize.setX(i, roles[i].size);
    /* Each follower's beat is about half a radian behind the one ahead, so
       the whole train ripples like a single ribbon rather than flapping in
       unison. Everything else gets a scattered phase. */
    aMotion.setX(i, roles[i].kind === 'train' ? -0.5 * roles[i].idx : (i * 1.37) % TAU);
  }
  aSize.needsUpdate = aTint.needsUpdate = aMotion.needsUpdate = true;

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

  function setTintScale (i, k) {
    const t = baseTint[i];
    tintScale[i] = k;
    aTint.setXYZ(i, t[0] * k, t[1] * k, t[2] * k);
    aTint.needsUpdate = true;
  }
  const getTintScale = i => tintScale[i];

  /* A manta cut out of the train stops being placed on the path and starts
     carrying its own position and heading, exactly as the loose singles do.
     Null puts it back under the train's control. */
  const freed = new Array(COUNT).fill(null);
  function setFree (i, state) { freed[i] = state; }
  const isFree = i => freed[i] !== null;

  let half = { w: 200, h: 420 };
  function setBounds (view) { half = { w: view.w / 2, h: view.h / 2 }; }

  /* The three singles carry their own position and heading and are advanced a
     step at a time, rather than having a position written as a function of
     the clock.
  
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
    for (let r = 0; r < RIVAL_TRAINS; r++) {
      const lead = rivalLeads[r];
      lead.head += Math.sin(secs * 0.17 + lead.phase) * 0.10 * dt;
      const nx = lead.x - Math.sin(lead.head) * lead.speed * dt;
      const nz = lead.z - Math.cos(lead.head) * lead.speed * dt;
      /* Wrapping would put a kink in the recorded path, so the trail is reset
         when the leader crosses the edge and the followers close up again. */
      const wx = wrap(nx, half.w + MARGIN), wz = wrap(nz, half.h + MARGIN);
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

  /* aPos is exposed so a test can drive update() across a whole cycle and
     measure the gaps, which is the only honest way to check the spacing. */
  rollColours();
  onParam(key => { if (key === 'coolWild' || key === 'player') { pinned = pinnedFromParam(); rollColours(); } });

  const isWild = i => roles[i].wild === true;
  /* 0 is the random roll; 1 to 7 pin one of the palette's colours. */
  function pinnedFromParam () {
    const n = Math.round(P.player);
    return n >= 1 && n <= PALETTE.length ? PALETTE[n - 1].key : (query.get('player') || null);
  }

  return { mesh, update, setBounds, count: COUNT, aPos, aHead, aSize, aTint, aMotion, vertexBuffers, isWild,
           rollColours, reroll: () => rollColours((Math.random() * 0xffffffff) >>> 0),
           get colours () { return dealt; }, get seed () { return seed; },
           /* How much hotter your train burns than the same colour would at
              the level every other manta uses. Condition 1, exactly. */
           gainFor: key => {
             const c = PALETTE.find(x => x.key === key); if (!c) return null;
             const L = a => 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
             return L(yoursTint(c.hex)) / L(tint(c.hex, levelFor(c.hex, BASE_LEVEL)));
           },
           setFree, isFree, setTintScale, getTintScale,
           pathLength: PATH_LENGTH, spacing: SPACING,
           /* The outline, so a test can measure what was built against the
              table it was built from rather than against a picture of it. */
           shape: { HEAD_FRONT, BODY_BACK, TAIL_LEN, TAIL_W0, TAIL_W1, STATIONS } };
}
