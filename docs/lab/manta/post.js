/* Bloom and the final grade.
 *
 * This is a RenderPipeline, which is what r186 calls the thing every online
 * example still calls PostProcessing. Two consequences worth stating, because
 * both are easy to get wrong and silent when you do:
 *
 *   renderer.render(scene, camera) DISAPPEARS from the loop. The scene render
 *   happens inside PassNode.updateBefore(), into the pass's own target, and
 *   pipeline.render() draws the result. Calling both renders the scene twice.
 *
 *   pipeline.render() takes NO arguments. Only DirectRenderPipeline takes
 *   (scene, camera), and passing them here is silently ignored.
 *
 * Tone mapping and the output colour transform are applied by the pipeline
 * itself, exactly once, after this node. So everything below works in the
 * renderer's LINEAR working space and must not tone map by hand.
 */
import { RenderPipeline, ACESFilmicToneMapping, AgXToneMapping, NeutralToneMapping, NoToneMapping, Vector3 } from 'three';
import { pass, uv, rand, fract, time, float, vec4, Fn, uniform } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { vignette } from 'three/addons/tsl/display/CRT.js';
import { P, U, onParam } from './params.js';

export const TONE_MODES = {
  off:     NoToneMapping,
  aces:    ACESFilmicToneMapping,
  agx:     AgXToneMapping,
  neutral: NeutralToneMapping,
};

/* Bloom tints, linear, and normalised so that changing the tint changes the
   COLOUR of the bloom and not how much of it there is. Without the
   normalisation a saturated tint also dims the effect and the two are
   impossible to judge separately. */
function linearTint (r, g, b) {
  const s = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const v = [s(r / 255), s(g / 255), s(b / 255)];
  const y = 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  return v.map(c => c / Math.max(y, 1e-4));
}
export const TINTS = {
  gold: linearTint(255, 200, 112),   // #ffc870
  teal: linearTint(120, 232, 214),   // #78e8d6, the blue-green the world uses
  white: [1, 1, 1],
};

/* "A subtle vignette at about 15 percent in the corners." CRT.js's vignette
   puts the edges at (1 - intensity), so this number IS the percentage. */
const uVignette = uniform(0.15);

export function createPost ({ renderer, scene, camera, tint = 'gold', tone = 'neutral' }) {
  const scenePass = pass(scene, camera);
  const sceneColor = scenePass.getTextureNode('output');

  const bloomPass = bloom(sceneColor, P.bloomStrength, 0.5, P.bloomThreshold);
  bloomPass.setResolutionScale(0.5);          // low resolution, as the doc asks

  function setTint (name) {
    const t = TINTS[name] || TINTS.white;
    /* Five entries, one per mip. Tinting every mip equally keeps the colour
       constant across the bloom's whole falloff. */
    for (let i = 0; i < bloomPass.bloomTintColors.length; i++) {
      bloomPass.bloomTintColors[i].set(t[0], t[1], t[2]);
    }
  }
  setTint(tint);

  /* The grade, in linear working space. Bloom is added, then the vignette,
     then grain. Grain is centred on zero and scaled: FilmNode's own grain is
     one-sided and roughly doubles the brightness it is applied to, which is
     not what "2 percent grain" means. */
  const graded = Fn(() => {
    const composed = sceneColor.rgb.add(bloomPass.rgb);
    const shaded = vignette(composed, uVignette, float(0.6), uv());
    const grain = rand(fract(uv().add(time))).sub(0.5).mul(U.grain).mul(2.0);
    return vec4(shaded.add(grain), 1.0);
  })();

  renderer.toneMapping = TONE_MODES[tone] !== undefined ? TONE_MODES[tone] : NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;

  const pipeline = new RenderPipeline(renderer);
  pipeline.outputNode = graded;

  /* The drawer writes into params; the bloom node's own uniforms have to be
     told. strength and threshold are uniforms on the node, so this costs a
     uniform write and not a shader rebuild. */
  onParam((key, value) => {
    if (key === 'bloomStrength') bloomPass.strength.value = value;
    if (key === 'bloomThreshold') bloomPass.threshold.value = value;
  });

  return {
    render () { pipeline.render(); },
    setTint,
    setTone (name) {
      renderer.toneMapping = TONE_MODES[name] !== undefined ? TONE_MODES[name] : NeutralToneMapping;
    },
    setVignette (v) { uVignette.value = v; },
    get passes () { return 1 + 1 + bloomPass._nMips * 2 + 1; },   // scene, high pass, blurs, composite
    dispose () { try { bloomPass.dispose(); } catch (e) {} },
  };
}
