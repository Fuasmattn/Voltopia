import { BALANCE } from '../shared/constants.ts';
import { PlantType, TileType } from '../shared/types.ts';
import { countPowerLineTiles } from './powerLines.ts';
import type { BuildResult } from './roads.ts';
import type { SimState } from './state.ts';

export interface EconomyBreakdown {
  taxIncome: number;
  gridUpkeep: number;
  plantUpkeep: number;
  biogasFuelCost: number;
  gridImportCost: number;
  gridExportRevenue: number;
}

/**
 * One tick of the city budget: tax income from residents and jobs minus
 * upkeep for roads and plants (biogas additionally pays per energy unit
 * generated — dispatchable but expensive).
 */
export function economyStep(state: SimState, population: number, jobs: number): EconomyBreakdown {
  const { tileType, plantType } = state.layers;

  const taxIncome =
    state.taxRate * (population * BALANCE.tax.incomePerResident + jobs * BALANCE.tax.incomePerJob);

  let roadTiles = 0;
  let plantUpkeep = 0;
  for (let i = 0; i < tileType.length; i++) {
    if (tileType[i] === TileType.Road) roadTiles++;
    else if (tileType[i] === TileType.Plant) {
      plantUpkeep += BALANCE.upkeepPerTick.plant[plantType[i] as PlantType] ?? 0;
    }
  }
  // Grid upkeep: roads and power lines share one line item.
  const gridUpkeep =
    roadTiles * BALANCE.upkeepPerTick.roadPerTile +
    countPowerLineTiles(state) * BALANCE.upkeepPerTick.powerLinePerTile;
  const biogasFuelCost =
    state.lastEnergy.biogas * BALANCE.upkeepPerTick.biogasFuelCostPerEnergyUnit;
  const gridImportCost = state.lastEnergy.gridImport * BALANCE.market.importCostPerEnergyUnit;
  const gridExportRevenue = state.lastEnergy.gridExport * BALANCE.market.exportRevenuePerEnergyUnit;

  state.money +=
    taxIncome + gridExportRevenue - gridUpkeep - plantUpkeep - biogasFuelCost - gridImportCost;
  return {
    taxIncome,
    gridUpkeep,
    plantUpkeep,
    biogasFuelCost,
    gridImportCost,
    gridExportRevenue,
  };
}

/** One-off, city-wide building insulation: halves the heating load. Not undoable. */
export function buyInsulation(state: SimState): BuildResult {
  if (state.insulation) return { rejected: 'alreadyInsulated' };
  const cost = BALANCE.costs.insulation;
  if (cost > state.money) return { rejected: 'notEnoughMoney' };
  state.money -= cost;
  state.insulation = true;
  return {};
}
