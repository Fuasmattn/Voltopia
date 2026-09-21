import { BALANCE } from '../shared/constants.ts';
import { SupplyStatus, TileType } from '../shared/types.ts';
import type { SimState } from './state.ts';

/**
 * Move city happiness toward its target: a comfortable base, reduced by
 * taxes above the neutral rate and by buildings without (sufficient)
 * power. Smoothing avoids jumpy reactions to single bad ticks.
 */
export function happinessStep(state: SimState): void {
  const { layers } = state;
  const config = BALANCE.happiness;

  let buildings = 0;
  let troubled = 0;
  for (let i = 0; i < layers.tileType.length; i++) {
    if (layers.tileType[i] !== TileType.Empty || layers.density[i] === 0) continue;
    buildings++;
    if (layers.supplied[i] !== SupplyStatus.Supplied) troubled++;
  }
  const troubledShare = buildings > 0 ? troubled / buildings : 0;

  const taxPenalty =
    Math.max(0, state.taxRate - BALANCE.tax.happinessNeutralRate) * config.taxPenaltyWeight;
  const supplyPenalty = troubledShare * config.undersupplyPenaltyWeight;

  const target = Math.min(1, Math.max(0, config.base - taxPenalty - supplyPenalty));
  state.happiness += (target - state.happiness) * config.smoothing;
}
