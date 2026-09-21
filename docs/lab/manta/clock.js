/* One clock, for everything that moves.
 *
 * TSL's `time` is the renderer's wall clock. Reading it inside a shader makes
 * that shader immune to anything the scene does with its own clock, and two
 * consequences of that are real rather than theoretical:
 *
 *   The cut's slow motion stopped at the water's edge. The mantas slowed and
 *   the ripple, the seabed and the grain carried on at full speed, which is
 *   the opposite of "everything in the water slows together".
 *
 *   Nothing could be held still. A test that renders the same frame twice got
 *   two different frames, because `time` had moved between the two calls. That
 *   cost most of a session in brief 1D before the control caught it.
 *
 * So the scene keeps one clock — main.js's simTime, which the cut already
 * scales — and every shader reads it from here. A frame can now be frozen and
 * stepped by an exact number of seconds.
 */
import { uniform } from 'three/tsl';

/* Seconds of scene time. Written once a frame by main.js, and by the step
   hook when a test is driving. */
export const uTime = uniform(0);

export function setSceneTime (seconds) { uTime.value = seconds; }
