import { BALANCE } from '../shared/constants.ts';
import { StopState } from '../shared/types.ts';
import type { BuildResult } from './roads.ts';
import {
  markDirty,
  snapshotTile,
  stopStateOfAge,
  TileType,
  type SimState,
  type UndoEntry,
} from './state.ts';

export { stopDueTicks, stopServiceTicks, stopStateOfAge } from './state.ts';

/** A road tile that carries a bus stop. */
export function isBusStop(state: SimState, index: number): boolean {
  const { tileType, busStop } = state.layers;
  return tileType[index] === TileType.Road && busStop[index] !== 0;
}

/** Service bucket of a tile; tiles without a stop count as served. */
export function stopState(state: SimState, index: number): StopState {
  if (!isBusStop(state, index)) return StopState.Served;
  return stopStateOfAge(state.layers.stopAge[index]);
}

/**
 * Mark bus stops on the given road tiles. Tiles that already carry a stop
 * are kept and not charged again; tiles that are not roads are skipped.
 * A drag that hits no road at all is rejected so the player learns why.
 */
export function buildBusStops(state: SimState, tiles: number[]): BuildResult {
  const { layers } = state;
  const buildable = tiles.filter(
    (index) => layers.tileType[index] === TileType.Road && layers.busStop[index] === 0,
  );
  if (buildable.length === 0) {
    const blocked = tiles.find((index) => layers.busStop[index] === 0);
    if (blocked === undefined) return {};
    return { rejected: 'needsRoadTile' };
  }
  const cost = buildable.length * BALANCE.costs.busStop;
  if (cost > state.money) return { rejected: 'notEnoughMoney' };

  const undo: UndoEntry = {
    moneyDelta: cost,
    tiles: buildable.map((index) => snapshotTile(state, index)),
  };
  state.money -= cost;
  for (const index of buildable) {
    layers.busStop[index] = 1;
    // A fresh stop starts served so coverage shows up at once.
    layers.stopAge[index] = 0;
    markDirty(state, index);
  }
  state.undoStack.push(undo);
  return {};
}

/** Remove the stops from the given tiles; the roads stay. The caller owns the undo entry. */
export function clearBusStops(state: SimState, tiles: number[]): void {
  const { layers } = state;
  for (const index of tiles) {
    layers.busStop[index] = 0;
    layers.stopAge[index] = 0;
    markDirty(state, index);
  }
}

export function countBusStops(state: SimState): number {
  const { busStop } = state.layers;
  let count = 0;
  for (let i = 0; i < busStop.length; i++) if (busStop[i] !== 0) count++;
  return count;
}
