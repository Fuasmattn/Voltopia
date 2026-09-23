import { BALANCE } from '../shared/constants.ts';
import { DIRECTIONS, inBounds, LINE_PRESENT, tileIndex, tileX, tileY } from '../shared/grid.ts';
import type { BuildResult } from './roads.ts';
import {
  BuildIntent,
  buildRejection,
  bumpGridVersion,
  isBuildable,
  markDirty,
  slopeCostMultiplier,
  snapshotTile,
  Terrain,
  withNeighbors,
  type SimState,
  type UndoEntry,
} from './state.ts';

/**
 * Recompute a line tile's connection bits from its 4-neighbours. Tiles
 * without a line stay 0; line tiles always keep LINE_PRESENT.
 */
export function recomputePowerLineMask(state: SimState, index: number): void {
  const { layers } = state;
  const previous = layers.powerLine[index];
  if (previous === 0) return;
  let mask = LINE_PRESENT;
  const x = tileX(index, state.size);
  const y = tileY(index, state.size);
  for (const { dx, dy, bit } of DIRECTIONS) {
    if (!inBounds(x + dx, y + dy, state.size)) continue;
    if (layers.powerLine[tileIndex(x + dx, y + dy, state.size)] !== 0) mask |= bit;
  }
  if (mask !== previous) {
    layers.powerLine[index] = mask;
    markDirty(state, index);
  }
}

/** Price of one line tile: overhead crossings over water cost more. */
export function powerLineTileCost(state: SimState, index: number): number {
  const base =
    state.layers.terrain[index] === Terrain.Land
      ? BALANCE.costs.powerLinePerTile
      : BALANCE.costs.powerLineWaterPerTile;
  return Math.round(base * slopeCostMultiplier(state, index));
}

/**
 * Build power lines on the given tiles. Tiles that already carry a line
 * are kept and not charged again; occupied tiles are skipped.
 */
export function buildPowerLines(state: SimState, tiles: number[]): BuildResult {
  const { layers } = state;
  const buildable = tiles.filter(
    (index) => layers.powerLine[index] === 0 && isBuildable(state, index, BuildIntent.PowerLine),
  );
  if (buildable.length === 0) {
    // A drag blocked on every tile explains itself; one that only retraces
    // existing lines (or is partly blocked) stays silent.
    const blocked = tiles.find((index) => layers.powerLine[index] === 0);
    if (blocked === undefined) return {};
    return { rejected: buildRejection(state, blocked, BuildIntent.PowerLine) ?? undefined };
  }

  const cost = buildable.reduce((sum, index) => sum + powerLineTileCost(state, index), 0);
  if (cost > state.money) {
    return { rejected: 'notEnoughMoney' };
  }

  const affected = withNeighbors(state, buildable);
  const undo: UndoEntry = {
    moneyDelta: cost,
    tiles: [...affected].map((index) => snapshotTile(state, index)),
  };

  state.money -= cost;
  for (const index of buildable) {
    layers.powerLine[index] = LINE_PRESENT;
    markDirty(state, index);
  }
  for (const index of affected) recomputePowerLineMask(state, index);
  bumpGridVersion(state);

  state.undoStack.push(undo);
  return {};
}

/**
 * Remove the lines from the given tiles; roads, zones and buildings on
 * them stay. The caller owns the undo entry.
 */
export function clearPowerLines(state: SimState, tiles: number[]): void {
  const { layers } = state;
  for (const index of tiles) {
    layers.powerLine[index] = 0;
    markDirty(state, index);
  }
  for (const index of withNeighbors(state, tiles)) recomputePowerLineMask(state, index);
  bumpGridVersion(state);
}

export function hasPowerLines(state: SimState): boolean {
  const { powerLine } = state.layers;
  for (let i = 0; i < powerLine.length; i++) {
    if (powerLine[i] !== 0) return true;
  }
  return false;
}

export function countPowerLineTiles(state: SimState): number {
  const { powerLine } = state.layers;
  let count = 0;
  for (let i = 0; i < powerLine.length; i++) {
    if (powerLine[i] !== 0) count++;
  }
  return count;
}
