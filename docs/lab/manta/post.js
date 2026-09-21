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
import { pass, uv, rand, fract, float, vec4, Fn, uniform } from 'three/tsl';
import { uTime } from './clock.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { vignette } from 'three/addons/tsl/display/CRT.js';
import { P, U, onParam } from './params.js';

export const TONE_MODES = {
  off:     NoToneMapping,
  aces:    ACESFilmicToneMapping,
  agx:     AgXToneMapping,
  neutral: NeutralToneMapping,
};

/* Bloom is UNTINTED, and that is settled in section 7.2: "Bloom is untinted,
   so it amplifies each source's own colour and identity hues survive the
   glow." The tint options that existed during the spike are gone with the
   code that applied them — a gold tint spent the danger colour on everything
   bright and turned the player's own train yellow-green. */

/* "A subtle vignette at about 15 percent in the corners." CRT.js's vignette
   puts the edges at (1 - intensity), so this number IS the percentage. */
const uVignette = uniform(0.15);

export function createPost ({ renderer, scene, camera, tone = 'neutral' }) {
  const scenePass = pass(scene, camera);
  const sceneColor = scenePass.getTextureNode('output');

  const bloomPass = bloom(sceneColor, P.bloomStrength, 0.5, P.bloomThreshold);
  bloomPass.setResolutionScale(0.5);          // low resolution, as the doc asks

  /* The grade, in linear working space. Bloom is added, then the vignette,
     then grain. Grain is centred on zero and scaled: FilmNode's own grain is
     one-sided and roughly doubles the brightness it is applied to, which is
     not what "2 percent grain" means. */
  const graded = Fn(() => {
    const composed = sceneColor.rgb.add(bloomPass.rgb);
    const shaded = vignette(composed, uVignette, float(0.6), uv());
    const grain = rand(fract(uv().add(uTime))).sub(0.5).mul(U.grain).mul(2.0);
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
    /* Halved again on the medium tier: the bloom chain is the most expensive
       thing on the page and its resolution is the cheapest thing to give up. */
    setBloomResolution (s) { bloomPass.setResolutionScale(s); },
    setTone (name) {
      renderer.toneMapping = TONE_MODES[name] !== undefined ? TONE_MODES[name] : NeutralToneMapping;
    },
    setVignette (v) { uVignette.value = v; },
    get passes () { return 1 + 1 + bloomPass._nMips * 2 + 1; },   // scene, high pass, blurs, composite
    dispose () { try { bloomPass.dispose(); } catch (e) {} },
  };
}
