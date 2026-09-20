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
const BEATS_PER_SECOND = 1.4;
const FLAP_AMPLITUDE = 0.75;      // radians at the wingtip
const SPAN_LAG = 1.1;             // travelling wave: the tip trails the root

/* The brightness hierarchy from section 7.2, and it is not negotiable: your
   train brightest, rivals bright, anything unattached dim, background darkest.
   No warm colours anywhere in this spike; warm is reserved for danger. */
const YOURS  = 0xa8fff2;
const RIVALS = [0x58d8c0, 0x64b4ff, 0x9a9bff, 0x58d8c0];
const WILD   = 0x2b4a52;
const RIVAL_LEVEL = 0.45;
const WILD_LEVEL  = 0.15;

const LEADER_SIZE   = 28;   // world units across the wings
const FOLLOWER_SIZE = 20;

/* A slow figure eight, sized to sit inside the view at either shape: the
   short side of the view is 385 units in portrait and 385 in landscape,
   because the area is fixed. */
const FIG8_A = 140, FIG8_B = 300;
const TRAIN_SPEED = 0.55;     // radians of path parameter a second
const SPACING = 22;           // design doc: follower spacing along the path

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

  /* The figure eight, and its tangent, so followers can be placed a fixed
     distance back along the path rather than a fixed parameter. */
  const fig8 = t => [FIG8_A * Math.cos(t), FIG8_B * Math.sin(2 * t) / 2];
  const fig8Speed = t => Math.hypot(-FIG8_A * Math.sin(t), FIG8_B * Math.cos(2 * t));

  let half = { w: 200, h: 420 };
  function setBounds (view) { half = { w: view.w / 2, h: view.h / 2 }; }

  const wrap = (v, lim) => { const s = lim * 2; return ((v + lim) % s + s) % s - lim; };

  function place (i, x, z, y, heading) {
    aPos.setXYZ(i, x, y, z);
    aHead.setX(i, heading);
  }

  function update (secs) {
    const tt = secs * TRAIN_SPEED;

    /* Your train. The leader runs the figure eight; each follower sits
       SPACING further back along the same curve, converted from distance to
       parameter through the local speed so the gap stays even where the
       curve is tight. */
    const speed = Math.max(fig8Speed(tt), 1e-3);
    for (let i = 0; i < 5; i++) {
      const p = tt - (i * SPACING) / speed;
      const [x, z] = fig8(p);
      const [x2, z2] = fig8(p + 0.01);
      place(i, x, z, 0, Math.atan2(-(x2 - x), -(z2 - z)));
    }

    /* Three singles, cruising with a slight drift so they are never quite
       straight lines. */
    for (let i = 0; i < 3; i++) {
      const j = 5 + i;
      const base = 0.9 + i * 2.1;
      const head = base + Math.sin(secs * 0.17 + i * 2.0) * 0.28;
      const sp = 62 + i * 11;
      const dist = secs * sp + i * 240;
      const x = wrap(Math.sin(head) * -dist + (i - 1) * 90, half.w + 70);
      const z = wrap(Math.cos(head) * -dist + (i - 1) * 150, half.h + 70);
      place(j, x, z, 0, head);
    }

    /* Two circling, at different depths. Under an orthographic top-down
       camera the depth does not change how big they look, but it does decide
       which passes over which, which is what gives the ocean volume. */
    for (let i = 0; i < 2; i++) {
      const j = 8 + i;
      const radius = 96 + i * 54;
      const dir = i === 0 ? 1 : -1;
      const w = dir * (0.30 - i * 0.09);
      const a = secs * w + i * 2.4;
      const cx = (i === 0 ? -1 : 1) * (half.w * 0.42);
      const cz = (i === 0 ? 1 : -1) * (half.h * 0.34);
      place(j, cx + Math.cos(a) * radius, cz + Math.sin(a) * radius, i === 0 ? -18 : 18,
            Math.atan2(-(-Math.sin(a) * dir), -(Math.cos(a) * dir)));
    }

    aPos.needsUpdate = true;
    aHead.needsUpdate = true;
  }

  return { mesh, update, setBounds, count: COUNT };
}
