import { BALANCE } from '../shared/constants.ts';
import { PlantType, TileType } from '../shared/types.ts';
import { countPowerLineTiles } from './powerLines.ts';
import type { BuildResult } from './roads.ts';
import type { SimState } from './state.ts';

export interface EconomyBreakdown {
  taxIncome: number;
  gridUpkeep: number;
  plantUpkeep: number;
  /** Upkeep split per plant type (feeds the budget panel). */
  plantUpkeepByType: Record<PlantType, number>;
  /** Plants placed per type (feeds the budget panel). */
  plantCountByType: Record<PlantType, number>;
  roadTiles: number;
  biogasFuelCost: number;
  gridImportCost: number;
  gridExportRevenue: number;
}

/** Zero-initialised map over every plant type. */
export function emptyPlantMap(): Record<PlantType, number> {
  const map = {} as Record<PlantType, number>;
  for (const value of Object.values(PlantType)) map[value] = 0;
  return map;
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
  const plantUpkeepByType = emptyPlantMap();
  const plantCountByType = emptyPlantMap();
  for (let i = 0; i < tileType.length; i++) {
    if (tileType[i] === TileType.Road) roadTiles++;
    else if (tileType[i] === TileType.Plant) {
      const plant = plantType[i] as PlantType;
      const upkeep = BALANCE.upkeepPerTick.plant[plant] ?? 0;
      plantUpkeep += upkeep;
      plantUpkeepByType[plant] += upkeep;
      plantCountByType[plant]++;
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
  const breakdown: EconomyBreakdown = {
    taxIncome,
    gridUpkeep,
    plantUpkeep,
    plantUpkeepByType,
    plantCountByType,
    roadTiles,
    biogasFuelCost,
    gridImportCost,
    gridExportRevenue,
  };
  state.lastEconomy = breakdown;
  return breakdown;
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
