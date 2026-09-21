import { BALANCE } from '../shared/constants.ts';
import { PlantType, TileType } from '../shared/types.ts';
import type { SimState } from './state.ts';

export interface EconomyBreakdown {
  taxIncome: number;
  roadUpkeep: number;
  plantUpkeep: number;
  biogasFuelCost: number;
}

/**
 * One tick of the city budget: tax income from residents and jobs minus
 * upkeep for roads and plants (biogas additionally pays per energy unit
 * generated — dispatchable but expensive).
 */
export function economyStep(
  state: SimState,
  population: number,
  jobs: number,
): EconomyBreakdown {
  const { tileType, plantType } = state.layers;

  const taxIncome =
    state.taxRate *
    (population * BALANCE.tax.incomePerResident +
      jobs * BALANCE.tax.incomePerJob);

  let roadTiles = 0;
  let plantUpkeep = 0;
  for (let i = 0; i < tileType.length; i++) {
    if (tileType[i] === TileType.Road) roadTiles++;
    else if (tileType[i] === TileType.Plant) {
      plantUpkeep += BALANCE.upkeepPerTick.plant[plantType[i] as PlantType] ?? 0;
    }
  }
  const roadUpkeep = roadTiles * BALANCE.upkeepPerTick.roadPerTile;
  const biogasFuelCost =
    state.lastEnergy.biogas * BALANCE.upkeepPerTick.biogasFuelCostPerEnergyUnit;

  state.money += taxIncome - roadUpkeep - plantUpkeep - biogasFuelCost;
  return { taxIncome, roadUpkeep, plantUpkeep, biogasFuelCost };
}
