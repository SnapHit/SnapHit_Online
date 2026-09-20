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
  InstancedMesh, BufferGeometry, Float32BufferAttribute, InstancedBufferAttribute,
  MeshBasicNodeMaterial, DoubleSide, DynamicDrawUsage, Matrix4
} from 'three';
import {
  Fn, vec3, float, sin, cos, clamp, time, positionGeometry, varying,
  instancedBufferAttribute
} from 'three/tsl';

export const COUNT = 10;

const TAU = Math.PI * 2;
/* 0.35: one full beat every 2.9 seconds. 1.4 read as fluttering, 0.65 was
   still too quick on the phone. A cruising manta beats about this often.
   The half-radian phase offset between followers is unchanged, because the
   ripple down the train was the one part that already worked. */
const BEATS_PER_SECOND = 0.35;
const FLAP_AMPLITUDE = 0.75;      // radians at the wingtip
/* 1.4, up from 1.1. Grace is not only rate: the further the tip trails the
   root, the more a wing behaves like something flexible being swept through
   water and the less like a hinged plank. At a slower beat there is room for
   more of this before it reads as a wobble. */
const SPAN_LAG = 1.4;             // travelling wave: the tip trails the root

/* The brightness hierarchy from section 7.2, and it is not negotiable: your
   train brightest, rivals bright, anything unattached dim, background darkest.
   No warm colours anywhere in this spike; warm is reserved for danger. */
const YOURS  = 0xa8fff2;
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

/* A manta seen from above, wingspan 1.0, nose towards -Z: a swept disc, two
   cephalic fins at the front and a thin tail. Drawn as a fan from a point
   just behind the nose, so the outline is the only thing that has to be
   right. DoubleSide, so winding cannot make it invisible. */
function mantaGeometry () {
  const outline = [
    [ 0.00, -0.46], [ 0.11, -0.40], [ 0.24, -0.30], [ 0.38, -0.13],
    [ 0.50,  0.04], [ 0.30,  0.09], [ 0.13,  0.14], [ 0.045, 0.30],
    [ 0.028, 0.50], [-0.028, 0.50], [-0.045, 0.30], [-0.13,  0.14],
    [-0.30,  0.09], [-0.50,  0.04], [-0.38, -0.13], [-0.24, -0.30],
    [-0.11, -0.40],
  ];
  const fins = [
    [[ 0.055, -0.44], [ 0.150, -0.60], [ 0.115, -0.40]],
    [[-0.055, -0.44], [-0.150, -0.60], [-0.115, -0.40]],
  ];
  const pos = [];
  const hub = [0.00, -0.06];
  for (let i = 0; i < outline.length - 1; i++) {
    const a = outline[i], b = outline[i + 1];
    pos.push(hub[0], 0, hub[1], a[0], 0, a[1], b[0], 0, b[1]);
  }
  for (const f of fins) for (const v of f) pos.push(v[0], 0, v[1]);

  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  return g;
}

/* ------------------------------------------------------------- the mesh */

export function createMantas (scene) {
  const aPos   = new InstancedBufferAttribute(new Float32Array(COUNT * 3), 3).setUsage(DynamicDrawUsage);
  const aHead  = new InstancedBufferAttribute(new Float32Array(COUNT), 1).setUsage(DynamicDrawUsage);
  const aSize  = new InstancedBufferAttribute(new Float32Array(COUNT), 1).setUsage(DynamicDrawUsage);
  const aPhase = new InstancedBufferAttribute(new Float32Array(COUNT), 1).setUsage(DynamicDrawUsage);
  const aTint  = new InstancedBufferAttribute(new Float32Array(COUNT * 3), 3).setUsage(DynamicDrawUsage);

  const nPos   = instancedBufferAttribute(aPos,   'vec3');
  const nHead  = instancedBufferAttribute(aHead,  'float');
  const nSize  = instancedBufferAttribute(aSize,  'float');
  const nPhase = instancedBufferAttribute(aPhase, 'float');
  const nTint  = instancedBufferAttribute(aTint,  'vec3');

  const material = new MeshBasicNodeMaterial({ side: DoubleSide });

  material.positionNode = Fn(() => {
    const g = positionGeometry;
    const r = g.x.abs();                    // distance from the spine, 0 .. 0.5
    const span = r.mul(2.0);                // 0 at the spine, 1 at the tip

    /* The beat. Amplitude grows with the span so the spine barely moves and
       the tips do the work, and the tip trails the root, so one wing is a
       travelling wave rather than a rigid plank. */
    const theta = sin(
      time.mul(TAU * BEATS_PER_SECOND).add(nPhase).sub(span.mul(SPAN_LAG))
    ).mul(FLAP_AMPLITUDE).mul(span);

    /* Rotate each wing element about the spine. x narrows by cos, y lifts by
       sin. Under a top-down camera the narrowing is the visible half. */
    const flexed = vec3(g.x.mul(cos(theta)), r.mul(sin(theta)), g.z).mul(nSize);

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
  const shade = float(1.0).sub(clamp(positionGeometry.z.add(0.46).div(0.96), 0, 1).mul(0.18));
  material.colorNode = varying(nTint.mul(shade));

  const mesh = new InstancedMesh(mantaGeometry(), material, COUNT);
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
      tint: tint(YOURS, 1.0) });
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

  for (let i = 0; i < COUNT; i++) {
    aSize.setX(i, roles[i].size);
    const t = roles[i].tint;
    aTint.setXYZ(i, t[0], t[1], t[2]);
    /* Each follower's beat is about half a radian behind the one ahead, so
       the whole train ripples like a single ribbon rather than flapping in
       unison. Everything else gets a scattered phase. */
    aPhase.setX(i, roles[i].kind === 'train' ? -0.5 * roles[i].idx : (i * 1.37) % TAU);
  }
  aSize.needsUpdate = aTint.needsUpdate = aPhase.needsUpdate = true;

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

  let half = { w: 200, h: 420 };
  function setBounds (view) { half = { w: view.w / 2, h: view.h / 2 }; }

  const wrap = (v, lim) => { const s = lim * 2; return ((v + lim) % s + s) % s - lim; };

  function place (i, x, z, y, heading) {
    aPos.setXYZ(i, x, y, z);
    aHead.setX(i, heading);
  }

  function update (secs) {
    /* Your train. The leader's position along the path is a distance, not a
       parameter, and each follower is exactly SPACING units of path behind
       the one ahead. Heading comes from half a unit further along the same
       curve, so it is right even where the parameter is moving fastest. */
    const sLead = secs * TRAIN_SPEED;
    for (let i = 0; i < 5; i++) {
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
      const j = 5 + i;
      const base = 0.9 + i * 2.1;
      const head = base + Math.sin(secs * 0.17 + i * 2.0) * 0.28;
      const sp = 62 + i * 11;
      const dist = secs * sp + i * 240;
      const x = wrap(Math.sin(head) * -dist + (i - 1) * 60, half.w + MARGIN);
      const z = wrap(Math.cos(head) * -dist + (i - 1) * 150, half.h + MARGIN);
      place(j, x, z, 0, head);
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

    aPos.needsUpdate = true;
    aHead.needsUpdate = true;
  }

  /* aPos is exposed so a test can drive update() across a whole cycle and
     measure the gaps, which is the only honest way to check the spacing. */
  return { mesh, update, setBounds, count: COUNT, aPos, pathLength: PATH_LENGTH, spacing: SPACING };
}
