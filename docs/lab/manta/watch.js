/* What went wrong, where it can be seen.
 *
 * Ten mantas once vanished on WebGPU and the page said nothing: the device
 * refused a pipeline, three's own error channel reported it, and it went to a
 * console no one on a phone can open. So everything that complains is counted
 * and listed here.
 *
 * Three channels, because they fail differently:
 *
 *   The WebGPU device. three sets device.onuncapturederror itself and routes
 *   it to renderer.onError, so that is the hook to take — taking the device
 *   property would silently replace three's handler. addEventListener is added
 *   as well, since it coexists with the property form.
 *
 *   console.error and console.warn. Most of three's own complaints arrive
 *   here, and a warning is worth listing even when nothing looks wrong.
 *
 *   Uncaught errors and unhandled rejections, which index.html catches.
 *
 * A count, not a verdict. Headless Chrome 153 on SwiftShader throws
 * "OperationError: Instance dropped in popErrorScope" while rendering happily
 * at 54 fps, so an error is not the same thing as a dead page: the chip gets a
 * mark, the panel gets the text, and only a renderer that never drew a frame
 * is called FAILED.
 */
const state = { errors: 0, warnings: 0, device: 0, first: '', firstDevice: '' };

let onChange = () => {};
export function onIssue (fn) { onChange = fn; }
export const counts = () => ({ ...state });

function record (kind, text) {
  const line = String(text).replace(/\s+/g, ' ').slice(0, 220);
  if (kind === 'warning') {
    state.warnings++;
  } else {
    state.errors++;
    if (!state.first) state.first = line;
    if (kind === 'device') { state.device++; if (!state.firstDevice) state.firstDevice = line; }
  }
  onChange(kind, line, counts());
}

/* Wrapped once, and the original is always called: a lab page that swallows
   its own console would be worse than one that never had this. */
export function watchConsole () {
  for (const kind of ['error', 'warn']) {
    const original = console[kind].bind(console);
    console[kind] = (...args) => {
      try { record(kind === 'warn' ? 'warning' : 'error', args.map(String).join(' ')); } catch (e) {}
      original(...args);
    };
  }
}

/* Called once the renderer exists, which is the earliest the device does. */
export function watchDevice (renderer) {
  if (!renderer) return 'no renderer';
  const previous = renderer.onError ? renderer.onError.bind(renderer) : null;
  renderer.onError = info => {
    try {
      record('device', (info && info.api ? info.api + ' ' : '') +
                       (info && info.type ? info.type + ': ' : '') +
                       ((info && info.message) || 'unknown device error'));
    } catch (e) {}
    if (previous) previous(info);
  };
  const device = renderer.backend && renderer.backend.device;
  if (!device || !device.addEventListener) return 'renderer.onError only';
  device.addEventListener('uncapturederror', event => {
    const err = event && event.error;
    record('device', 'uncaptured ' + ((err && err.constructor && err.constructor.name) || 'GPUError') +
                     ': ' + ((err && err.message) || '?'));
  });
  return 'device and renderer.onError';
}

export function issueText () {
  return state.errors + (state.errors === 1 ? ' error' : ' errors') +
         '  ·  ' + state.warnings + (state.warnings === 1 ? ' warning' : ' warnings') +
         (state.device ? '  ·  ' + state.device + ' from the GPU device' : '') +
         (state.first ? '\n' + state.first : '');
}
