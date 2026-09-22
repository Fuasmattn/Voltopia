import { describe, expect, it } from 'vitest';
import { BALANCE } from '../shared/constants.ts';
import { tileIndex } from '../shared/grid.ts';
import { Terrain } from '../shared/types.ts';
import { buildRoads, undoLastAction } from './roads.ts';
import { createSimState, TileType, Zone } from './state.ts';
import { paintZones } from './zones.ts';

const SIZE = 16;
const at = (x: number, y: number) => tileIndex(x, y, SIZE);

describe('paintZones', () => {
  it('paints empty tiles and charges per tile', () => {
    const state = createSimState(1, SIZE);
    const before = state.money;
    paintZones(state, [at(1, 1), at(2, 1)], Zone.Residential);
    expect(state.layers.zone[at(1, 1)]).toBe(Zone.Residential);
    expect(state.layers.zone[at(2, 1)]).toBe(Zone.Residential);
    expect(state.money).toBe(before - 2 * BALANCE.costs.zonePerTile);
  });

  it('skips roads, plants and built tiles', () => {
    const state = createSimState(1, SIZE);
    buildRoads(state, [at(3, 3)]);
    state.layers.density[at(4, 4)] = 2;
    state.layers.zone[at(4, 4)] = Zone.Commercial;
    paintZones(state, [at(3, 3), at(4, 4)], Zone.Residential);
    expect(state.layers.tileType[at(3, 3)]).toBe(TileType.Road);
    expect(state.layers.zone[at(3, 3)]).toBe(Zone.None);
    expect(state.layers.zone[at(4, 4)]).toBe(Zone.Commercial);
  });

  it('repainting the same zone is free', () => {
    const state = createSimState(1, SIZE);
    paintZones(state, [at(1, 1)], Zone.Retail);
    const before = state.money;
    paintZones(state, [at(1, 1)], Zone.Retail);
    expect(state.money).toBe(before);
  });

  it('rejects when money is insufficient', () => {
    const state = createSimState(1, SIZE);
    state.money = 0;
    const result = paintZones(state, [at(1, 1)], Zone.Residential);
    expect(result.rejected).toBeTruthy();
    expect(state.layers.zone[at(1, 1)]).toBe(Zone.None);
  });

  it('can be undone including the cost', () => {
    const state = createSimState(1, SIZE);
    const before = state.money;
    paintZones(state, [at(5, 5)], Zone.Commercial);
    undoLastAction(state);
    expect(state.layers.zone[at(5, 5)]).toBe(Zone.None);
    expect(state.money).toBe(before);
  });

  it('skips water tiles', () => {
    const state = createSimState(1, SIZE);
    state.layers.terrain[at(3, 3)] = Terrain.River;
    state.layers.terrain[at(4, 4)] = Terrain.Lake;
    const before = state.money;
    paintZones(state, [at(3, 3), at(4, 4), at(5, 5)], Zone.Residential);
    expect(state.layers.zone[at(3, 3)]).toBe(Zone.None);
    expect(state.layers.zone[at(4, 4)]).toBe(Zone.None);
    expect(state.layers.zone[at(5, 5)]).toBe(Zone.Residential);
    expect(state.money).toBe(before - BALANCE.costs.zonePerTile);
  });
});
