/* The scene and the camera.
 *
 * The camera rule is the one thing in this file that is not obvious, and it is
 * from section 10.2 of the design doc: at zoom 1 every screen sees the same
 * AREA of ocean, about what a 390 by 844 phone sees, fitted to that screen's
 * shape. Not the same width, not the same height: the same number of square
 * world units.
 *
 *     width  = sqrt(area * aspect)
 *     height = area / width
 *
 * which gives width / height = aspect and width * height = area exactly.
 *
 * A laptop therefore never sees more ocean than a phone, challenge scores stay
 * comparable across devices, and Brief 1B's light memory texture covers the
 * same patch of water everywhere. At zoom 1 on a 390 by 844 phone one world
 * unit is one CSS pixel, which is why the design doc's parameter table reads
 * the way it does.
 *
 * The camera is top down and still. It does not follow anything in this spike:
 * following is a greybox concern and a still camera makes the look easier to
 * judge.
 */
import { Scene, OrthographicCamera } from 'three';
import { oceanNode, uAspect } from './ocean.js';

/* 390 x 844 CSS pixels, the reference phone. */
export const VIEW_AREA = 329160;

export function createScene () {
  const scene = new Scene();
  scene.backgroundNode = oceanNode();

  /* Top down: the camera sits above the XZ plane looking straight down, and up
     is -Z so a manta pointing -Z points up the screen. The frustum is set in
     fit(), because it depends on the viewport. */
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 4000);
  camera.position.set(0, 1000, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);

  const view = { w: 0, h: 0, pxPerUnit: 0 };

  /* Zoom multiplies what you see, and the same-area rule holds at every one
     of them: the area is VIEW_AREA / zoom^2 and the shape still follows the
     screen, so a laptop at zoom 0.55 sees exactly what a phone does. */
  let zoom = 1, lastW = 0, lastH = 0;
  function setZoom (z) {
    const next = Math.max(0.2, Math.min(4, z));
    if (Math.abs(next - zoom) < 1e-4) return false;
    zoom = next;
    if (lastW) fit(lastW, lastH);
    return true;
  }

  function fit (cssW, cssH) {
    lastW = cssW; lastH = cssH;
    const aspect = cssW / cssH;
    const area = VIEW_AREA / (zoom * zoom);
    const w = Math.sqrt(area * aspect);
    const h = area / w;
    camera.left = -w / 2; camera.right = w / 2;
    camera.top = h / 2;   camera.bottom = -h / 2;
    camera.updateProjectionMatrix();
    uAspect.value = aspect;
    view.w = w; view.h = h; view.pxPerUnit = cssW / w;
    return view;
  }

  /* The camera follows your leader. Its height and its looking-down are
     unchanged; only where it sits over the water moves. */
  function lookAtWorld (x, z) {
    camera.position.set(x, 1000, z);
    camera.lookAt(x, 0, z);
    camera.up.set(0, 0, -1);
    camera.updateMatrixWorld();
  }

  return { scene, camera, fit, view, setZoom, lookAtWorld, get zoom () { return zoom; } };
}

export const describeView = v =>
  Math.round(v.w) + ' × ' + Math.round(v.h) + ' units  ·  ' +
  v.pxPerUnit.toFixed(2) + ' px per unit';
