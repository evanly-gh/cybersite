import { registerAsset } from '../registry';
import { buildMetro, buildMetroTrainDemo, buildMetroPylonDemo } from '../../assets/metro/metro';

/**
 * Task 19 viewer entries.
 *
 * `metro` is the WHOLE city-scale suspended loop — auto-framing can't usefully box it,
 * so view it with an absolute camera override, e.g. a Shibuya-crossing eye-level look:
 *   ?viewer=metro&cam=200,26,80,270,14,-40&t=0.1
 * Sweep `t` to watch the "NIGHT LOOP" consist thread the city (pathU = t*3.2 + phase).
 *
 * `metroTrain` = just the 4-car consist hanging beneath a straight girder (detail).
 * `metroPylon` = one girder segment + a single T-pylon to the ground (detail).
 * `?t=` drives sway (train) and strobe blink.
 */

registerAsset('metro', (rng) => {
  const m = buildMetro(rng);
  return { group: m.group, update: m.update };
});

registerAsset('metroTrain', (rng) => {
  const m = buildMetroTrainDemo(rng);
  return { group: m.group, update: m.update };
});

registerAsset('metroPylon', (rng) => {
  const m = buildMetroPylonDemo(rng);
  return { group: m.group, update: m.update };
});
