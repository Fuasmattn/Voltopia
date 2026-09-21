import { BALANCE } from '../shared/constants.ts';
import { DIRECTIONS, inBounds, tileIndex, tileX, tileY } from '../shared/grid.ts';
import { markDirty, TileType, Zone, type SimState, type UndoEntry } from './state.ts';

/** Snapshot one tile's buildable layers for undo. */
function snapshotTile(state: SimState, index: number): UndoEntry['tiles'][number] {
  const { layers } = state;
  return {
    index,
    tileType: layers.tileType[index],
    roadMask: layers.roadMask[index],
    zone: layers.zone[index],
    density: layers.density[index],
    variant: layers.variant[index],
    plantType: layers.plantType[index],
  };
}

/** Collect the given tiles plus their 4-neighbors (deduplicated). */
function withNeighbors(state: SimState, tiles: number[]): Set<number> {
  const affected = new Set<number>();
  for (const index of tiles) {
    affected.add(index);
    const x = tileX(index, state.size);
    const y = tileY(index, state.size);
    for (const { dx, dy } of DIRECTIONS) {
      if (inBounds(x + dx, y + dy, state.size)) {
        affected.add(tileIndex(x + dx, y + dy, state.size));
      }
    }
  }
  return affected;
}

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
  const buildable = tiles.filter(
    (index) =>
      layers.tileType[index] === TileType.Empty && layers.density[index] === 0,
  );
  if (buildable.length === 0) return {};

  const cost = buildable.length * BALANCE.costs.roadPerTile;
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

/** Remove roads, zones, buildings and plants from the given tiles. */
export function bulldozeTiles(state: SimState, tiles: number[]): BuildResult {
  const { layers } = state;
  const clearable = tiles.filter(
    (index) =>
      layers.tileType[index] !== TileType.Empty ||
      layers.zone[index] !== Zone.None ||
      layers.density[index] !== 0,
  );
  if (clearable.length === 0) return {};

  const affected = withNeighbors(state, clearable);
  const undo: UndoEntry = {
    moneyDelta: 0,
    tiles: [...affected].map((index) => snapshotTile(state, index)),
  };

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
    layers.zone[tile.index] = tile.zone;
    layers.density[tile.index] = tile.density;
    layers.variant[tile.index] = tile.variant;
    layers.plantType[tile.index] = tile.plantType;
    markDirty(state, tile.index);
  }
  return {};
}
