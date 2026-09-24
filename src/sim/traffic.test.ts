import { describe, expect, it } from 'vitest';
import { BALANCE } from '../shared/constants.ts';
import { tileIndex } from '../shared/grid.ts';
import { RoadClass } from '../shared/types.ts';
import { buildRoads } from './roads.ts';
import { createSimState } from './state.ts';
import {
  LANES_PER_TILE,
  laneCapacity,
  laneKey,
  laneTile,
  TRAFFIC_LEVELS,
  trafficLevel,
  updateTrafficLoad,
} from './traffic.ts';

const SIZE = 16;
const at = (x: number, y: number) => tileIndex(x, y, SIZE);

function roadState() {
  const state = createSimState(1, SIZE);
  state.layers.elevation.fill(0);
  buildRoads(state, [at(2, 5), at(3, 5), at(4, 5)]);
  buildRoads(state, [at(5, 5)], true);
  state.dirty.clear();
  return state;
}

describe('lanes', () => {
  it('keys lanes per tile and heading and maps back to the tile', () => {
    expect(laneKey(7, 3)).toBe(7 * LANES_PER_TILE + 3);
    expect(laneTile(laneKey(7, 3))).toBe(7);
  });

  it('capacity is maxPerRoadTile on streets and avenueMaxPerTile on avenues', () => {
    const state = roadState();
    expect(laneCapacity(state, at(3, 5))).toBe(BALANCE.vehicles.maxPerRoadTile);
    expect(laneCapacity(state, at(5, 5))).toBe(BALANCE.vehicles.avenueMaxPerTile);
    expect(state.layers.roadClass[at(5, 5)]).toBe(RoadClass.Avenue);
  });
});

describe('trafficLevel', () => {
  it('quantises 0..255 into TRAFFIC_LEVELS buckets', () => {
    expect(trafficLevel(0)).toBe(0);
    expect(trafficLevel(255)).toBe(TRAFFIC_LEVELS - 1);
    expect(trafficLevel(128)).toBe(Math.floor((128 / 256) * TRAFFIC_LEVELS));
  });
});

describe('updateTrafficLoad', () => {
  it('rises to 255 on a saturated lane and falls back to 0 when empty', () => {
    const state = roadState();
    const tile = at(3, 5);
    const full = new Map([[laneKey(tile, 1), BALANCE.vehicles.maxPerRoadTile]]);
    for (let i = 0; i < 400; i++) updateTrafficLoad(state, full);
    expect(state.layers.trafficLoad[tile]).toBe(255);
    for (let i = 0; i < 400; i++) updateTrafficLoad(state, new Map());
    expect(state.layers.trafficLoad[tile]).toBe(0);
  });

  it('uses the busiest lane over the tile capacity', () => {
    const state = roadState();
    const avenue = at(5, 5);
    const half = new Map([[laneKey(avenue, 1), BALANCE.vehicles.avenueMaxPerTile / 2]]);
    for (let i = 0; i < 400; i++) updateTrafficLoad(state, half);
    expect(state.layers.trafficLoad[avenue]).toBeGreaterThanOrEqual(126);
    expect(state.layers.trafficLoad[avenue]).toBeLessThanOrEqual(129);
  });

  it('marks a tile dirty only when its level changes and leaves non-roads at 0', () => {
    const state = roadState();
    const tile = at(3, 5);
    const full = new Map([[laneKey(tile, 1), 2]]);
    updateTrafficLoad(state, full); // first step: load 13 -> still level 0
    expect(state.dirty.has(tile)).toBe(false);
    for (let i = 0; i < 40; i++) updateTrafficLoad(state, full);
    expect(state.dirty.has(tile)).toBe(true);
    expect(state.layers.trafficLoad[at(9, 9)]).toBe(0);
    expect(state.dirty.has(at(9, 9))).toBe(false);
  });
});
