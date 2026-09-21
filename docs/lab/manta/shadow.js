/* The mantas' shadows on the seabed.
 *
 * A world-locked, low-resolution picture of the animals from straight above,
 * drawn flat white on black once a frame, which the ocean samples with an
 * offset and uses to darken the FLOOR only. The water above it and the
 * mantas themselves are untouched: a shadow is something the moonlight does
 * not reach, and the manta is between the two.
 *
 * WHY A SECOND SCENE AND A SECOND MESH. Adding an Object3D to another scene
 * removes it from the one it was in, so the shadow pass owns its own mesh —
 * the same geometry and the same position node as the real one, so the
 * shadow beats its wings in step with the animal that casts it. The main
 * scene's ocean is a backgroundNode, and this scene has none, so what lands
 * in the target is mantas on black and nothing else.
 *
 * WHY THE TARGET IS SQUARE AND FOLLOWS THE VIEW: the same reason the light
 * memory's is. The mapping from world to uv is the exact inverse of the one
 * the ocean samples with, so the two agree by construction.
 */
import { RenderTarget, Scene, OrthographicCamera, RendererUtils, UnsignedByteType } from 'three';
import { texture, uniform } from 'three/tsl';

/* Wider than the view so a shadow does not clip at the edge as its manta
   swims off. Matches the light memory's cover, so both squares are the same
   patch of water. */
const COVER = 1.15;
export const SHADOW_SIZE = 256;

export function createShadows () {
  const rt = new RenderTarget(SHADOW_SIZE, SHADOW_SIZE,
    { depthBuffer: false, stencilBuffer: false, type: UnsignedByteType });

  /* The mesh arrives later. The ocean's shader is built before the mantas
     exist — createScene() builds it, and createMantas() runs after — so what
     the ocean needs at build time is only this target and its extent. */
  const scene = new Scene();
  let attached = false;
  function attach (mesh) { scene.add(mesh); attached = true; }

  /* Top down and still, exactly as the real camera is, so a manta's shadow
     sits under the manta before the offset moves it. */
  const camera = new OrthographicCamera(-500, 500, 500, -500, 0.1, 4000);
  camera.position.set(0, 1000, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);

  const uHalf = uniform(500);                    // half extent, world units
  function setView (view) {
    const half = Math.max(view.w, view.h) * COVER * 0.5;
    uHalf.value = half;
    camera.left = -half; camera.right = half;
    /* Same sign convention as the real camera in scene.js, which sets
       top = +h/2 with up = -z: get this backwards and every shadow lands on
       the wrong side of its manta. */
    camera.top = half;   camera.bottom = -half;
    camera.updateProjectionMatrix();
  }

  let state = undefined;
  let drawn = 0;
  function render (renderer) {
    if (!attached) return;
    /* The same save/restore the light memory uses: an off-screen render in
       the middle of a frame otherwise leaves the renderer pointing at the
       wrong target. undefined, NOT null, for the first save. The clear
       colour set below needs no restoring of its own — saveRendererState in
       the vendored r186 captures clearColor and clearAlpha, checked in the
       source rather than assumed. */
    state = RendererUtils.resetRendererState(renderer, state);
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    RendererUtils.restoreRendererState(renderer, state);
    drawn++;
  }

  return {
    render, attach, setView, uHalf,
    out: texture(rt.texture),
    target: rt,
    get drawn () { return drawn; },
    size: SHADOW_SIZE,
    dispose () { try { rt.dispose(); } catch (e) {} },
  };
}
