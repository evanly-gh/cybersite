import { registerAsset } from '../registry';
import { buildFarField } from '../../world/farField';

// Task 8 verification: Ring 2 skyline + sky/moon/ocean backdrop. World-scale (sky
// dome r=3200m) — always view this one via `?cam=` (see viewer.ts), not the default
// auto-framed turntable.
registerAsset('farField', (rng) => buildFarField(rng));
