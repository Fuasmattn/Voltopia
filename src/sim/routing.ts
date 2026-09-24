import { BALANCE } from '../shared/constants.ts';
import { neighbors4 } from '../shared/grid.ts';
import { MinHeap } from '../shared/heap.ts';
import { RoadClass } from '../shared/types.ts';
import { TileType, type SimState } from './state.ts';

/** Cost of driving onto a road tile: avenues are cheaper, loaded tiles dearer. */
export function tileCost(state: SimState, tile: number): number {
  const { roadClass, trafficLoad } = state.layers;
  const base = roadClass[tile] === RoadClass.Avenue ? 1 / BALANCE.vehicles.avenueSpeedFactor : 1;
  return base * (1 + BALANCE.vehicles.routeLoadPenalty * (trafficLoad[tile] / 255));
}

/**
 * Cheapest route over road tiles from `from` to `to` (both included), or
 * null when they are not connected. Dijkstra with per-tile costs from
 * road class and traffic load; ties break by tile index, so the result
 * is deterministic.
 */
export function findRoadPath(state: SimState, from: number, to: number): number[] | null {
  const { tileType } = state.layers;
  if (tileType[from] !== TileType.Road || tileType[to] !== TileType.Road) {
    return null;
  }
  if (from === to) return [from];

  const tiles = state.size * state.size;
  const distance = new Float64Array(tiles).fill(Infinity);
  const cameFrom = new Int32Array(tiles).fill(-1);
  const settled = new Uint8Array(tiles);
  const heap = new MinHeap();
  distance[from] = 0;
  heap.push(0, from);
  while (heap.size > 0) {
    const tile = heap.pop()!;
    if (settled[tile]) continue;
    settled[tile] = 1;
    if (tile === to) break;
    for (const neighbor of neighbors4(tile, state.size)) {
      if (tileType[neighbor] !== TileType.Road || settled[neighbor]) continue;
      const next = distance[tile] + tileCost(state, neighbor);
      if (next < distance[neighbor]) {
        distance[neighbor] = next;
        cameFrom[neighbor] = tile;
        heap.push(next, neighbor);
      }
    }
  }
  if (cameFrom[to] === -1) return null;
  const path = [to];
  let current = to;
  while (current !== from) {
    current = cameFrom[current];
    path.push(current);
  }
  return path.reverse();
}

/**
 * Route cost from one road tile to every road tile reachable within
 * `maxCost` (same tile costs as findRoadPath, so on empty streets the
 * cost is the tile count). Empty when `from` is not a road.
 */
export function roadDistances(
  state: SimState,
  from: number,
  maxCost: number = Infinity,
): Map<number, number> {
  const { tileType } = state.layers;
  const result = new Map<number, number>();
  if (tileType[from] !== TileType.Road) return result;
  const tiles = state.size * state.size;
  const distance = new Float64Array(tiles).fill(Infinity);
  const settled = new Uint8Array(tiles);
  const heap = new MinHeap();
  distance[from] = 0;
  heap.push(0, from);
  while (heap.size > 0) {
    const tile = heap.pop()!;
    if (settled[tile]) continue;
    settled[tile] = 1;
    result.set(tile, distance[tile]);
    for (const neighbor of neighbors4(tile, state.size)) {
      if (tileType[neighbor] !== TileType.Road || settled[neighbor]) continue;
      const next = distance[tile] + tileCost(state, neighbor);
      if (next > maxCost || next >= distance[neighbor]) continue;
      distance[neighbor] = next;
      heap.push(next, neighbor);
    }
  }
  return result;
}
