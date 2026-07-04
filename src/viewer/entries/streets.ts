import { registerAsset } from '../registry';
import {
  buildStreets,
  buildStreetsShibuya,
  buildStreetsRamp,
  buildStreetsBridge
} from '../../world/streets';

// Task 7 verification: the full street network, plus zoomed-in sub-assets for the
// Shibuya crossing and a ramp jump (the whole network is ~1800m long, too big to
// judge fine detail in one auto-framed shot).
registerAsset('streets', (rng) => buildStreets(rng));
registerAsset('streetsShibuya', (rng) => buildStreetsShibuya(rng));
registerAsset('streetsRamp', (rng) => buildStreetsRamp(rng));
registerAsset('streetsBridge', (rng) => buildStreetsBridge(rng));
