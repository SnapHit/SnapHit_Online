/* THE WHALE SHARK ON SCREEN (4A stage 5, design doc 7.2): a vast dark shape
 * seen mostly by the plankton it disturbs. One flat capsule of its own
 * (its own mesh and pipeline: position, normal and uv, three vertex buffers; the
 * mantas' pipeline stays at six of eight), drawn under the mantas, its body
 * darker than the water with a grid of pale spots that reads as texture,
 * never as light. The glow it stirs is the light memory's (follow.js stamps
 * its length each frame), so the ocean paints the plankton around a hole
 * where the body is. Hidden when it is not in the water: no draw call.
 */
import { Mesh, Shape, ShapeGeometry, DoubleSide } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { positionGeometry, vec3, float, sin, step, mix, Fn } from 'three/tsl';

export function createSharkMesh (scene, { len = 320, wide = 70 } = {}) {
  /* A capsule in the XY plane, laid flat: +y becomes -z, so at heading 0 the
     head points up the screen like a manta's nose. The geometry's origin is
     the body's centre; the simulation's (x, z) is the head. */
  const r = wide / 2, L = len - wide;
  const shape = new Shape();
  shape.absarc(0, L / 2, r, 0, Math.PI, false);
  shape.lineTo(-r, -L / 2);
  shape.absarc(0, -L / 2, r, Math.PI, Math.PI * 2, false);
  shape.lineTo(r, L / 2);
  const geo = new ShapeGeometry(shape, 10);
  geo.rotateX(-Math.PI / 2);
  /* Both sides, as the mantas: a flat shape seen from straight above must
     not depend on its winding. */
  const mat = new MeshBasicNodeMaterial({ side: DoubleSide });
  /* Linear levels against the water: the body well under the water's own
     dark (measured on screen at luminance 6 against 28 to 38 beside it), the
     spots about the water's level, so they read as a faint grey texture on
     a black shape, never as light (a first cut at six tenths of the water
     was invisible: the grade crushes it into the body). */
  const body = vec3(0.0005, 0.0014, 0.0040), spot = vec3(0.0040, 0.0110, 0.0280);
  mat.colorNode = Fn(() => {
    const p = positionGeometry;
    const grid = sin(p.x.mul(0.26)).mul(sin(p.z.mul(0.22))).add(sin(p.x.mul(0.09).add(p.z.mul(0.13))).mul(0.25));
    return mix(body, spot, step(float(0.72), grid));
  })();
  mat.toneMapped = true;
  const mesh = new Mesh(geo, mat);
  mesh.position.y = -2;
  mesh.frustumCulled = false;
  scene.add(mesh);
  /* WARM: drawn parked far outside the view for its first two frames, so
     its pipeline is compiled and its buffers uploaded at load, not in the
     middle of a run the first time it appears (a shader compile then would
     be a dropped frame on the phone). Parked it covers no pixel, so the
     frame is unchanged. */
  const PARK = 1e5;
  let warm = 2;
  mesh.position.set(PARK, -2, PARK);
  /* Head at (x, z), heading h: the centre sits half a length behind the head. */
  function set (alive, x, z, h) {
    if (!alive) {
      if (warm > 0) { warm--; mesh.visible = true; mesh.position.set(PARK, -2, PARK); return; }
      if (mesh.visible) mesh.visible = false; return;
    }
    mesh.visible = true;
    mesh.position.x = x + Math.sin(h) * len / 2;
    mesh.position.z = z + Math.cos(h) * len / 2;
    mesh.rotation.y = h;
  }
  return { mesh, set, len, wide };
}
