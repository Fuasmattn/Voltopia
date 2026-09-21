import { BALANCE } from '../shared/constants.ts';
import type { Zone } from '../shared/types.ts';
import type { BuildResult } from './roads.ts';
import { markDirty, TileType, type SimState, type UndoEntry } from './state.ts';

/**
 * Paint a zone onto empty tiles. Tiles that already carry a building,
 * a road or a plant are skipped; repainting the same zone is free.
 */
export function paintZones(
  state: SimState,
  tiles: number[],
  zone: Zone,
): BuildResult {
  const { layers } = state;
  const paintable = tiles.filter(
    (index) =>
      layers.tileType[index] === TileType.Empty &&
      layers.density[index] === 0 &&
      layers.zone[index] !== zone,
  );
  if (paintable.length === 0) return {};

  const cost = paintable.length * BALANCE.costs.zonePerTile;
  if (cost > state.money) {
    return { rejected: 'notEnoughMoney' };
  }

  const undo: UndoEntry = {
    moneyDelta: cost,
    tiles: paintable.map((index) => ({
      index,
      tileType: layers.tileType[index],
      roadMask: layers.roadMask[index],
      zone: layers.zone[index],
      density: layers.density[index],
      variant: layers.variant[index],
      plantType: layers.plantType[index],
    })),
  };

  state.money -= cost;
  for (const index of paintable) {
    layers.zone[index] = zone;
    markDirty(state, index);
  }
  state.undoStack.push(undo);
  return {};
}
