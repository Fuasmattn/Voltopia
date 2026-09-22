import { BALANCE } from '../shared/constants.ts';
import { DIRECTIONS, inBounds, tileIndex, tileX, tileY } from '../shared/grid.ts';
import { clearPowerLines } from './powerLines.ts';
import {
  BuildIntent,
  bumpGridVersion,
  isBuildable,
  markDirty,
  snapshotTile,
  Terrain,
  TileType,
  withNeighbors,
  Zone,
  type SimState,
  type UndoEntry,
} from './state.ts';

/** Recompute the 4-bit connection mask of a tile (0 for non-roads). */
export function recomputeRoadMask(state: SimState, index: number): void {
  const { layers } = state;
  const previous = layers.roadMask[index];
  let mask = 0;
  if (layers.tileType[index] === TileType.Road) {
    const x = tileX(index, state.size);
    const y = tileY(index, state.size);
    for (const { dx, dy, bit } of DIRECTIONS) {
      if (!inBounds(x + dx, y + dy, state.size)) continue;
      const neighbor = tileIndex(x + dx, y + dy, state.size);
      if (layers.tileType[neighbor] === TileType.Road) mask |= bit;
    }
  }
  if (mask !== previous) {
    layers.roadMask[index] = mask;
    markDirty(state, index);
  }
}

export interface BuildResult {
  rejected?: string;
}

/**
 * Build roads on the given tiles. Only empty, unbuilt tiles are paved;
 * existing roads on the path are kept (and not charged again).
 */
export function buildRoads(state: SimState, tiles: number[]): BuildResult {
  const { layers } = state;
  const buildable = tiles.filter((index) => isBuildable(state, index, BuildIntent.Road));
  if (buildable.length === 0) return {};

  const { roadPerTile, bridgePerTile } = BALANCE.costs;
  const cost = buildable.reduce(
    (sum, index) => sum + (layers.terrain[index] === Terrain.River ? bridgePerTile : roadPerTile),
    0,
  );
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
    layers.tileType[index] = TileType.Road;
    layers.zone[index] = Zone.None;
    layers.density[index] = 0;
    layers.variant[index] = 0;
    markDirty(state, index);
  }
  for (const index of affected) recomputeRoadMask(state, index);

  state.undoStack.push(undo);
  return {};
}

/**
 * Remove roads, zones, buildings and plants from the given tiles. A tile
 * that carries a power line loses only the line; whatever else stands
 * there survives for a second pass.
 */
export function bulldozeTiles(state: SimState, tiles: number[]): BuildResult {
  const { layers } = state;
  const lineTiles = tiles.filter((index) => layers.powerLine[index] !== 0);
  const clearable = tiles.filter(
    (index) =>
      layers.powerLine[index] === 0 &&
      (layers.tileType[index] !== TileType.Empty ||
        layers.zone[index] !== Zone.None ||
        layers.density[index] !== 0),
  );
  if (lineTiles.length === 0 && clearable.length === 0) return {};

  const affected = withNeighbors(state, [...lineTiles, ...clearable]);
  const undo: UndoEntry = {
    moneyDelta: 0,
    tiles: [...affected].map((index) => snapshotTile(state, index)),
  };

  if (lineTiles.length > 0) clearPowerLines(state, lineTiles);
  for (const index of clearable) {
    layers.tileType[index] = TileType.Empty;
    layers.zone[index] = Zone.None;
    layers.density[index] = 0;
    layers.variant[index] = 0;
    layers.plantType[index] = 0;
    layers.buildingAge[index] = 0;
    markDirty(state, index);
  }
  for (const index of affected) recomputeRoadMask(state, index);
  // A cleared tile may have been a plant: connectivity must be recomputed.
  if (clearable.length > 0) bumpGridVersion(state);

  state.undoStack.push(undo);
  return {};
}

/** Revert the most recent build/bulldoze action. */
export function undoLastAction(state: SimState): BuildResult {
  const entry = state.undoStack.pop();
  if (!entry) return { rejected: 'nothingToUndo' };

  const { layers } = state;
  state.money += entry.moneyDelta;
  for (const tile of entry.tiles) {
    layers.tileType[tile.index] = tile.tileType;
    layers.roadMask[tile.index] = tile.roadMask;
    layers.powerLine[tile.index] = tile.powerLine;
    layers.zone[tile.index] = tile.zone;
    layers.density[tile.index] = tile.density;
    layers.variant[tile.index] = tile.variant;
    layers.plantType[tile.index] = tile.plantType;
    markDirty(state, tile.index);
  }
  bumpGridVersion(state);
  return {};
}
