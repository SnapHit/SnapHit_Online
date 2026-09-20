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

  function fit (cssW, cssH) {
    const aspect = cssW / cssH;
    const w = Math.sqrt(VIEW_AREA * aspect);
    const h = VIEW_AREA / w;
    camera.left = -w / 2; camera.right = w / 2;
    camera.top = h / 2;   camera.bottom = -h / 2;
    camera.updateProjectionMatrix();
    uAspect.value = aspect;
    view.w = w; view.h = h; view.pxPerUnit = cssW / w;
    return view;
  }

  return { scene, camera, fit, view };
}

export const describeView = v =>
  Math.round(v.w) + ' × ' + Math.round(v.h) + ' units  ·  ' +
  v.pxPerUnit.toFixed(2) + ' px per unit';
