import { registerAsset } from '../registry';
import { buildStreets } from '../../world/streets';
import type { Rng } from '../../utils/rng';

registerAsset('streets', (rng: Rng) => buildStreets(rng));
