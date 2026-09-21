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
import { mantaGeometry, markings, STATIONS, HEAD_FRONT, BODY_BACK, TAIL_LEN, TAIL_Z0, TAIL_W0, TAIL_W1, TURN_REF } from './shape.js';

export const COUNT = 10;

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
/* Electric lime, doc v1.6: "Slither's lesson is saturated colour on dark".
   White was ruled out because it merges with the fresh wake and the moonlight,
   and at whiteness 1.00 the freshest wake IS white. The presets are what the
   drawer offers; PLAYERS[0] is the committed one. */
const PLAYERS = [0xc8ff3c, 0xeaf6ff, 0xa8fff2];
const YOURS  = PLAYERS[0];
/* Lime is a slightly darker colour than the mint it replaces — 229 against
   236 in sRGB luminance — and 7.2 says your train is the brightest thing on
   screen, so the level carries it back rather than the hue being compromised.
   Measured against the render, not computed: at 1.00 the train's median read
   218 where mint read 225. */
const PLAYER_LEVEL = 1.12;
const RIVALS = [0x58d8c0, 0x64b4ff, 0x9a9bff, 0x58d8c0];
const WILD   = 0x2b4a52;
const RIVAL_LEVEL = 0.45;
/* 0.75, not 0.15. The percentages in the brief describe where each tier sits,
   but #2b4a52 is ALREADY a dark colour: cutting it to 15% of its linear value
   put an unattached manta at rgb(18,29,33) against an ocean that reaches
   rgb(8,16,26), so it was invisible on the phone rather than dim. At 0.75 it
   lands near rgb(38,64,71) — about seven times the brightest water and still
   a quarter of a rival, so the hierarchy is intact and the tier can be found.
   Yours and the rivals are untouched: those read correctly. */
const WILD_LEVEL  = 0.75;

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

  /* 0-4  your train: a leader and four followers on the figure eight
     5-7  three singles cruising with a slight drift
     8-9  two circling at different depths                                */
  const roles = [];
  for (let i = 0; i < 5; i++) {
    roles.push({ kind: 'train', idx: i,
      size: i === 0 ? LEADER_SIZE : FOLLOWER_SIZE,
      tint: tint(YOURS, PLAYER_LEVEL) });
  }
  for (let i = 0; i < 3; i++) {
    /* Two of the singles are rival leaders, one is unattached and dim. */
    const rival = i < 2;
    roles.push({ kind: 'single', idx: i,
      size: rival ? LEADER_SIZE : FOLLOWER_SIZE,
      tint: rival ? tint(RIVALS[i], RIVAL_LEVEL) : tint(WILD, WILD_LEVEL) });
  }
  for (let i = 0; i < 2; i++) {
    roles.push({ kind: 'circle', idx: i,
      size: LEADER_SIZE,
      tint: tint(RIVALS[i + 2], RIVAL_LEVEL) });
  }

  /* The identity colour each manta was given. Brightness is scaled against
     this rather than against whatever is in the buffer, so a flash and a fade
     cannot drift the hue: the cut changes how bright a manta is, never which
     colour it is. 7.2 forbids relying on hue alone, and the inverse matters
     just as much — the hue has to survive the effect. */
  const baseTint = roles.map(r => r.tint.slice());
  const prevHead = new Float32Array(COUNT);
  const lagTurn  = new Float32Array(COUNT);
  const tintScale = new Float32Array(COUNT).fill(1);

  /* The player's colour is a preset the drawer can change, so the train's
     base tint is rewritten rather than baked. Everything downstream reads
     baseTint, including the cut's fades, so a colour change cannot be undone
     by the next flash. */
  function setPlayer (which) {
    const hex = PLAYERS[Math.max(0, Math.min(PLAYERS.length - 1, Math.round(which)))];
    for (let i = 0; i < COUNT; i++) {
      if (roles[i].kind !== 'train') continue;
      const t = tint(hex, PLAYER_LEVEL);
      baseTint[i] = t.slice();
      const k = tintScale[i];
      aTint.setXYZ(i, t[0] * k, t[1] * k, t[2] * k);
    }
    aTint.needsUpdate = true;
  }
  onParam((key, value) => { if (key === 'player') setPlayer(value); });

  for (let i = 0; i < COUNT; i++) {
    aSize.setX(i, roles[i].size);
    const t = roles[i].tint;
    aTint.setXYZ(i, t[0], t[1], t[2]);
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
  const singles = [0, 1, 2].map(i => ({
    head:  0.9 + i * 2.1,
    speed: 62 + i * 11,
    phase: i * 2.0,
    x: (i - 1) * 60,
    z: (i - 1) * 150,
  }));
  let lastSecs = null;

  const wrap = (v, lim) => { const s = lim * 2; return ((v + lim) % s + s) % s - lim; };

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

    /* Three singles, cruising with a slight drift so they are never quite
       straight lines. They wrap just far enough outside the view to hide the
       pop — a manta is 40 units across, so 34 clears it — and no further.
       At the old margin of 70 they spent nearly a third of their time in
       dead space off screen, which made the unattached one hard to find
       simply because it was often not there. */
    const MARGIN = 34;
    for (let i = 0; i < 3; i++) {
      const m = singles[i];
      /* A slow weave: the turn rate is what oscillates, so the heading rolls
         gently either side of where it started and the manta always swims
         along its own nose. */
      m.head += Math.sin(secs * 0.17 + m.phase) * 0.10 * dt;
      m.x = wrap(m.x - Math.sin(m.head) * m.speed * dt, half.w + MARGIN);
      m.z = wrap(m.z - Math.cos(m.head) * m.speed * dt, half.h + MARGIN);
      place(5 + i, m.x, m.z, 0, m.head);
    }

    /* Two circling, at different depths. Under an orthographic top-down
       camera the depth does not change how big they look, but it does decide
       which passes over which, which is what gives the ocean volume. */
    for (let i = 0; i < 2; i++) {
      const j = 8 + i;
      /* Radius and centre both scaled off the half-view, so each circle stays
         inside the frame at either orientation instead of swinging out of it
         on the short axis. */
      const radius = Math.min(96 + i * 40, half.w * 0.42);
      const dir = i === 0 ? 1 : -1;
      const w = dir * (0.30 - i * 0.09);
      const a = secs * w + i * 2.4;
      const cx = (i === 0 ? -1 : 1) * (half.w * 0.40);
      const cz = (i === 0 ? 1 : -1) * (half.h * 0.30);
      place(j, cx + Math.cos(a) * radius, cz + Math.sin(a) * radius, i === 0 ? -18 : 18,
            Math.atan2(-(-Math.sin(a) * dir), -(Math.cos(a) * dir)));
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
  setPlayer(P.player);

  return { mesh, update, setBounds, count: COUNT, aPos, aHead, aSize, aTint, aMotion, vertexBuffers, setPlayer, PLAYERS,
           setFree, isFree, setTintScale, getTintScale,
           pathLength: PATH_LENGTH, spacing: SPACING,
           /* The outline, so a test can measure what was built against the
              table it was built from rather than against a picture of it. */
           shape: { HEAD_FRONT, BODY_BACK, TAIL_LEN, TAIL_W0, TAIL_W1, STATIONS } };
}
