import { BALANCE } from '../shared/constants.ts';
import { tileX, tileY } from '../shared/grid.ts';
import { Rng } from '../shared/rng.ts';
import { Terrain, TileType } from '../shared/types.ts';
import type { BuildResult } from './roads.ts';
import { markDirty, snapshotTile, type SimState, type UndoEntry } from './state.ts';

/** Keeps the woods independent of terrain, water and the gameplay RNG. */
const FOREST_SEED_SALT = 0x2f9b71;

/**
 * Woods: an extra layer over the land, from untouched forest the map
 * starts with to saplings the player plants. Growth stages run 1
 * (sapling) to `maxStage` (mature); only mature woods shelter wind and
 * cost the full felling fee.
 *
 * Building never fails on woods — it fells them, for a fee — so the
 * forest is a cost and a happiness asset, never a wall.
 */

/** Generate the map's untouched woodland: seeded patches of mature forest on land. */
export function generateForest(state: SimState): void {
  const rng = new Rng((state.seed ^ FOREST_SEED_SALT) >>> 0);
  const { size } = state;
  const cfg = BALANCE.forest;
  const noise = valueNoise(rng, size, cfg.noiseCellSize);
  const { forest, terrain } = state.layers;
  for (let i = 0; i < forest.length; i++) {
    if (terrain[i] !== Terrain.Land) continue;
    if (noise[i] < cfg.noiseThreshold) continue;
    forest[i] = cfg.maxStage;
    markDirty(state, i);
  }
}

/** Plant saplings on empty land tiles, charging per tile. */
export function plantForest(state: SimState, tiles: number[]): BuildResult {
  const { layers } = state;
  const plantable = tiles.filter(
    (index) =>
      layers.forest[index] === 0 &&
      layers.terrain[index] === Terrain.Land &&
      layers.tileType[index] === TileType.Empty &&
      layers.density[index] === 0,
  );
  if (plantable.length === 0) return {};

  const cost = plantable.length * BALANCE.forest.plantCost;
  if (cost > state.money) return { rejected: 'notEnoughMoney' };

  const undo: UndoEntry = {
    moneyDelta: cost,
    tiles: plantable.map((index) => snapshotTile(state, index)),
  };
  state.money -= cost;
  for (const index of plantable) {
    layers.forest[index] = 1;
    markDirty(state, index);
  }
  state.undoStack.push(undo);
  return {};
}

/** What felling the woods on this tile costs (0 on open land). */
export function fellingCost(state: SimState, index: number): number {
  return state.layers.forest[index] * BALANCE.forest.fellingCostPerStage;
}

/** Fell the woods on a tile (building on it, or bulldozing them away). */
export function clearForest(state: SimState, index: number): void {
  if (state.layers.forest[index] === 0) return;
  state.layers.forest[index] = 0;
  markDirty(state, index);
}

/**
 * Let the woods grow. Each tick sweeps the slice of tiles whose turn it
 * is, so every tile is visited exactly once per growth interval and
 * advances one stage then — deterministic, no per-tile age layer, and
 * only a fraction of the grid touched per tick.
 */
export function forestStep(state: SimState): void {
  const { forest } = state.layers;
  const stride = BALANCE.forest.growthIntervalTicks;
  for (let i = state.tick % stride; i < forest.length; i += stride) {
    if (forest[i] === 0 || forest[i] >= BALANCE.forest.maxStage) continue;
    forest[i]++;
    markDirty(state, i);
  }
}

/** Share of the land that is wooded, weighted by growth stage (0..1). */
export function forestShare(state: SimState): number {
  const { forest, terrain } = state.layers;
  let land = 0;
  let wooded = 0;
  for (let i = 0; i < forest.length; i++) {
    if (terrain[i] !== Terrain.Land) continue;
    land++;
    wooded += forest[i] / BALANCE.forest.maxStage;
  }
  return land > 0 ? wooded / land : 0;
}

/** Share (0..1) of buildings with woods within the cover radius. */
export function forestCoverage(state: SimState): number {
  const { layers } = state;
  const radius = BALANCE.forest.coverRadius;
  let buildings = 0;
  let covered = 0;
  for (let i = 0; i < layers.tileType.length; i++) {
    if (layers.tileType[i] !== TileType.Empty || layers.density[i] === 0) continue;
    buildings++;
    if (woodedTilesAround(state, i, radius, true) > 0) covered++;
  }
  return buildings > 0 ? covered / buildings : 0;
}

/**
 * Output factor of a wind turbine on this tile: trees slow the wind and
 * add turbulence, so a turbine in closed forest loses up to
 * `maxWindPenalty`. Stage-weighted — saplings barely matter.
 */
export function windForestFactor(state: SimState, index: number): number {
  const cfg = BALANCE.forest;
  const weighted = woodedTilesAround(state, index, cfg.windPenaltyRadius, false);
  return 1 - Math.min(cfg.maxWindPenalty, weighted * cfg.windPenaltyPerTile);
}

/**
 * Woods in the Chebyshev ring around a tile, each weighted by growth
 * stage. `stopAtFirst` returns as soon as any woods are found.
 */
function woodedTilesAround(
  state: SimState,
  index: number,
  radius: number,
  stopAtFirst: boolean,
): number {
  const { forest } = state.layers;
  const { size } = state;
  const cx = tileX(index, size);
  const cy = tileY(index, size);
  const x0 = Math.max(0, cx - radius);
  const x1 = Math.min(size - 1, cx + radius);
  const y0 = Math.max(0, cy - radius);
  const y1 = Math.min(size - 1, cy + radius);
  let weighted = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const stage = forest[y * size + x];
      if (stage === 0) continue;
      if (stopAtFirst) return 1;
      weighted += stage / BALANCE.forest.maxStage;
    }
  }
  return weighted;
}

/** Seeded value noise over the grid, normalised to 0..1. */
function valueNoise(rng: Rng, size: number, cellSize: number): Float32Array {
  const cells = Math.ceil(size / cellSize) + 2;
  const lattice = new Float32Array(cells * cells);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rng.next();
  const field = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = x / cellSize;
      const gy = y / cellSize;
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const tx = smoothstep(gx - x0);
      const ty = smoothstep(gy - y0);
      const v00 = lattice[y0 * cells + x0];
      const v10 = lattice[y0 * cells + x0 + 1];
      const v01 = lattice[(y0 + 1) * cells + x0];
      const v11 = lattice[(y0 + 1) * cells + x0 + 1];
      const top = v00 + (v10 - v00) * tx;
      const bottom = v01 + (v11 - v01) * tx;
      field[y * size + x] = top + (bottom - top) * ty;
    }
  }
  return field;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}
