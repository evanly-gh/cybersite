import { registerAsset } from '../registry';
import { buildStreets, buildShibuya, buildScaffolding } from '../../world/streets';
import type { Rng } from '../../utils/rng';

registerAsset('streets', (rng: Rng) => buildStreets(rng));
registerAsset('shibuya', (rng: Rng) => buildShibuya(rng));
registerAsset('scaffolding', (rng: Rng) => buildScaffolding(rng));
