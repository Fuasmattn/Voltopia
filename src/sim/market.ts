import { BALANCE } from '../shared/constants.ts';
import { Zone } from '../shared/types.ts';
import { loadProfileFactor } from './energy.ts';
import type { SimState } from './state.ts';
import { timeOfDay } from './tick.ts';
import { currentSolarFactor, currentWindFactor } from './weather.ts';

/**
 * The electricity spot market. The city trades over one transmission
 * link with the wider green region; the price of every unit moving over
 * it — imports, exports and storage trades — follows a single spot
 * factor per tick.
 *
 * Weather fronts are regional, so the city's own weather doubles as the
 * region's: a clear windy noon floods the region with cheap power, a
 * calm overcast evening (Dunkelflaute at peak demand) makes it dear.
 * Deterministic — no state beyond the existing clock and weather.
 */
export function spotPriceFactor(state: SimState): number {
  const market = BALANCE.market;
  // Regional demand follows the evening-peaked household profile (its
  // curve already spans ~0.2..1).
  const demand = loadProfileFactor(Zone.Residential, timeOfDay(state.tick));
  const supply =
    market.spotSolarShare * currentSolarFactor(state) +
    market.spotWindShare * currentWindFactor(state);
  const factor = 1 + market.spotSwing * (demand - supply);
  return Math.min(market.spotMax, Math.max(market.spotMin, factor));
}
