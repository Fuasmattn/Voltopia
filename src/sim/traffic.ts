import { BALANCE } from '../shared/constants.ts';
import { RoadClass, TileType } from '../shared/types.ts';
import { markDirty, type SimState } from './state.ts';

/** Lanes per road tile: one per heading (N, E, S, W). */
export const LANES_PER_TILE = 4;

/** Occupancy key of one lane: a road tile plus the direction of travel on it. */
export function laneKey(tile: number, heading: number): number {
  return tile * LANES_PER_TILE + heading;
}

/** The road tile a lane key belongs to. */
export function laneTile(lane: number): number {
  return Math.floor(lane / LANES_PER_TILE);
}

/** Vehicles one lane of this tile holds before followers must wait. */
export function laneCapacity(state: SimState, tile: number): number {
  return state.layers.roadClass[tile] === RoadClass.Avenue
    ? BALANCE.vehicles.avenueMaxPerTile
    : BALANCE.vehicles.maxPerRoadTile;
}

/** Number of overlay/diff buckets the 0..255 load is quantised into. */
export const TRAFFIC_LEVELS = 8;

/** 0..TRAFFIC_LEVELS-1 bucket of a load value. */
export function trafficLevel(load: number): number {
  return Math.min(TRAFFIC_LEVELS - 1, Math.floor((load / 256) * TRAFFIC_LEVELS));
}

/**
 * Fold this tick's lane occupancy into the smoothed per-tile load. The
 * busiest lane over the tile's lane capacity is the tick's target; the
 * stored value moves toward it by trafficLoadSmoothing, always at least
 * one step, so it reaches 0 and 255 exactly. A tile is marked dirty only
 * when its quantised level changes, which keeps the diffs small.
 */
export function updateTrafficLoad(state: SimState, occupancy: Map<number, number>): void {
  const { layers } = state;
  const smoothing = BALANCE.vehicles.trafficLoadSmoothing;
  const busiest = new Map<number, number>();
  for (const [lane, count] of occupancy) {
    const tile = laneTile(lane);
    busiest.set(tile, Math.max(busiest.get(tile) ?? 0, count));
  }
  for (let i = 0; i < layers.tileType.length; i++) {
    const previous = layers.trafficLoad[i];
    let next: number;
    if (layers.tileType[i] !== TileType.Road) {
      next = 0;
    } else {
      const occupied = Math.min(1, (busiest.get(i) ?? 0) / laneCapacity(state, i));
      const delta = (occupied * 255 - previous) * smoothing;
      next = previous + (delta > 0 ? Math.ceil(delta) : Math.floor(delta));
      next = Math.min(255, Math.max(0, next));
    }
    if (next === previous) continue;
    layers.trafficLoad[i] = next;
    if (trafficLevel(next) !== trafficLevel(previous)) markDirty(state, i);
  }
}
