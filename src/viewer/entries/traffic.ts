import { registerAsset } from '../registry';
import { buildTraffic } from '../../choreography/traffic';

/**
 * Task 15 viewer entry — traffic system.
 *
 * Shows the full deterministic traffic assembly: 23 ground cars (~5 types),
 * 5 hover vehicles, Shibuya crowd clusters, and the city-scale metro loop.
 *
 * Sweep `?t=` (0→1) to scrub vehicle positions along the route — same t always
 * yields the same configuration (scrub-safe / no wall-clock accumulation).
 *
 * Suggested camera for viewing the Shibuya crossing area:
 *   ?viewer=traffic&cam=240,30,50,240,0,0&t=0.32
 */
registerAsset('traffic', (rng) => {
  const traffic = buildTraffic(rng);
  return { group: traffic.group, update: traffic.update };
});
