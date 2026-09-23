import { BALANCE } from '../shared/constants.ts';
import type { Zone } from '../shared/types.ts';
import type { BuildResult } from './roads.ts';
import {
  BuildIntent,
  isBuildable,
  markDirty,
  slopeCostMultiplier,
  snapshotTile,
  type SimState,
  type UndoEntry,
} from './state.ts';

/**
 * Paint a zone onto empty tiles. Tiles that already carry a building,
 * a road or a plant are skipped; repainting the same zone is free.
 */
export function paintZones(state: SimState, tiles: number[], zone: Zone): BuildResult {
  const { layers } = state;
  const paintable = tiles.filter(
    (index) => isBuildable(state, index, BuildIntent.Zone) && layers.zone[index] !== zone,
  );
  if (paintable.length === 0) return {};

  const cost = paintable.reduce(
    (sum, index) => sum + Math.round(BALANCE.costs.zonePerTile * slopeCostMultiplier(state, index)),
    0,
  );
  if (cost > state.money) {
    return { rejected: 'notEnoughMoney' };
  }

  const undo: UndoEntry = {
    moneyDelta: cost,
    tiles: paintable.map((index) => snapshotTile(state, index)),
  };

  state.money -= cost;
  for (const index of paintable) {
    layers.zone[index] = zone;
    markDirty(state, index);
  }
  state.undoStack.push(undo);
  return {};
}
