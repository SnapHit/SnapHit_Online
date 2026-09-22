/* The mantas: one InstancedMesh, eighteen instances, wings flexed in the
 * shader.
 *
 * Where they swim is movers.js and what colour they are is colours.js. This
 * file is the mesh: the outline, the wingbeat, the markings and the shading.
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
import { U } from './params.js';
import { createColours } from './colours.js';
import { mantaGeometry, markings, STATIONS, HEAD_FRONT, BODY_BACK, TAIL_LEN, TAIL_Z0, TAIL_W0, TAIL_W1 } from './shape.js';
import { createMovers } from './movers.js';

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

/* The design doc's table gives leader radius 14 and follower radius 10, which
   is where 28 and 20 came from. Those are greybox gameplay sizes, set against
   a camera that follows and zooms out. This spike has a still camera and is
   judged by eye, and at 28 units — 30 CSS pixels on the test phone — a manta
   was too small to read. Up about 40%. Follower spacing goes up with them, so
   the gap you see between them is unchanged. */
const LEADER_SIZE   = 40;   // world units across the wings
const FOLLOWER_SIZE = 28;



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

  const geometry = mantaGeometry();
  const mesh = new InstancedMesh(geometry, material, COUNT);

  /* The same animals again, flat white on black, for the shadow pass.
     The SAME geometry and the SAME position node, so a shadow beats its
     wings with the manta that casts it and cannot drift out of step with it;
     only the colour differs. A second InstancedMesh rather than the same one
     moved into another scene, because adding an Object3D to a second scene
     REMOVES IT FROM THE FIRST, and a shadow pass that quietly steals the
     mantas out of the picture is worse than no shadow pass. Same attributes,
     so this pipeline is the same 6 vertex buffers as the one above. */
  const shadowMaterial = new MeshBasicNodeMaterial({ side: DoubleSide });
  shadowMaterial.positionNode = material.positionNode;
  shadowMaterial.colorNode = vec3(1.0, 1.0, 1.0);
  const shadowMesh = new InstancedMesh(geometry, shadowMaterial, COUNT);
  shadowMesh.frustumCulled = false;

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
  for (let i = 0; i < COUNT; i++) { mesh.setMatrixAt(i, I); shadowMesh.setMatrixAt(i, I); }
  mesh.instanceMatrix.needsUpdate = true;
  shadowMesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);

  /* --------------------------------------------- who each instance is */

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

  const colours = createColours({ COUNT, roles, aTint,
                                 rivals: RIVAL_TRAINS, wilds: WILD_COUNT, train: 5 });

  for (let i = 0; i < COUNT; i++) {
    aSize.setX(i, roles[i].size);
    /* Each follower's beat is about half a radian behind the one ahead, so
       the whole train ripples like a single ribbon rather than flapping in
       unison. Everything else gets a scattered phase. */
    aMotion.setX(i, roles[i].kind === 'train' ? -0.5 * roles[i].idx : (i * 1.37) % TAU);
  }
  aSize.needsUpdate = aTint.needsUpdate = aMotion.needsUpdate = true;

  /* Where everyone swims is movers.js; what they look like is here. */
  const movers = createMovers({ aPos, aHead, aMotion, COUNT,
                                RIVAL_TRAINS, RIVAL_LEN, WILD_COUNT });
  const { update, setBounds, setCentre, setFree, isFree } = movers;

  const isWild = i => roles[i].wild === true;

  /* aPos and aHead are exposed so a test can drive update() across a whole
     cycle and measure the gaps, which is the only honest way to check the
     spacing. */
  return { mesh, shadowMesh, update, setBounds, setCentre, count: COUNT, aPos, aHead, aSize, aTint, aMotion, vertexBuffers, isWild,
           rollColours: colours.rollColours, reroll: colours.reroll,
           get colours () { return colours.colours; }, get seed () { return colours.seed; },
           gainFor: colours.gainFor,
           setFree, isFree,
           setTintScale: colours.setTintScale, getTintScale: colours.getTintScale,
           setCutMix: colours.setCutMix, getCutMix: colours.getCutMix,
           ownColour: colours.ownColour,
           pathLength: movers.pathLength, spacing: movers.spacing,
           /* The outline, so a test can measure what was built against the
              table it was built from rather than against a picture of it. */
           shape: { HEAD_FRONT, BODY_BACK, TAIL_LEN, TAIL_W0, TAIL_W1, STATIONS } };
}
