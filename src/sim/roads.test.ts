import { describe, expect, it } from 'vitest';
import { BALANCE } from '../shared/constants.ts';
import { DIR_E, DIR_N, DIR_S, DIR_W, tileIndex } from '../shared/grid.ts';
import { Terrain } from '../shared/types.ts';
import { buildRoads, bulldozeTiles, undoLastAction } from './roads.ts';
import { createSimState, TileType, Zone } from './state.ts';

const SIZE = 16;

function makeState() {
  return createSimState(1, SIZE);
}

function at(x: number, y: number): number {
  return tileIndex(x, y, SIZE);
}

describe('buildRoads', () => {
  it('places a single road tile with no connections', () => {
    const state = makeState();
    buildRoads(state, [at(5, 5)]);
    expect(state.layers.tileType[at(5, 5)]).toBe(TileType.Road);
    expect(state.layers.roadMask[at(5, 5)]).toBe(0);
  });

  it('connects adjacent road tiles in both directions', () => {
    const state = makeState();
    buildRoads(state, [at(5, 5), at(6, 5)]);
    expect(state.layers.roadMask[at(5, 5)]).toBe(DIR_E);
    expect(state.layers.roadMask[at(6, 5)]).toBe(DIR_W);
  });

  it('builds a straight, a curve, a T and a cross correctly', () => {
    const state = makeState();
    // Cross centered at (5,5)
    buildRoads(state, [at(5, 4), at(5, 5), at(5, 6), at(4, 5), at(6, 5)]);
    expect(state.layers.roadMask[at(5, 5)]).toBe(DIR_N | DIR_E | DIR_S | DIR_W);
    // Vertical straight above the center
    expect(state.layers.roadMask[at(5, 4)]).toBe(DIR_S);
    // Add a curve: (7,5)-(7,6) with (6,5)-(7,5) makes (7,5) a curve W+S
    buildRoads(state, [at(7, 5), at(7, 6)]);
    expect(state.layers.roadMask[at(7, 5)]).toBe(DIR_W | DIR_S);
    // (6,5) is now a straight W+E; (5,5) unchanged cross
    expect(state.layers.roadMask[at(6, 5)]).toBe(DIR_W | DIR_E);
    // T-junction: add (6,6) below (6,5)
    buildRoads(state, [at(6, 6)]);
    expect(state.layers.roadMask[at(6, 5)]).toBe(DIR_W | DIR_E | DIR_S);
  });

  it('charges per newly paved tile and skips existing roads', () => {
    const state = makeState();
    const before = state.money;
    buildRoads(state, [at(1, 1), at(2, 1)]);
    expect(state.money).toBe(before - 2 * BALANCE.costs.roadPerTile);
    // Re-pave one existing + one new: only the new one is charged.
    buildRoads(state, [at(2, 1), at(3, 1)]);
    expect(state.money).toBe(before - 3 * BALANCE.costs.roadPerTile);
  });

  it('rejects when there is not enough money', () => {
    const state = makeState();
    state.money = BALANCE.costs.roadPerTile - 1;
    const result = buildRoads(state, [at(1, 1)]);
    expect(result.rejected).toBeTruthy();
    expect(state.layers.tileType[at(1, 1)]).toBe(TileType.Empty);
    expect(state.money).toBe(BALANCE.costs.roadPerTile - 1);
  });

  it('clears zoning under a new road', () => {
    const state = makeState();
    state.layers.zone[at(3, 3)] = Zone.Residential;
    buildRoads(state, [at(3, 3)]);
    expect(state.layers.zone[at(3, 3)]).toBe(Zone.None);
  });

  it('does not build over tiles with buildings', () => {
    const state = makeState();
    state.layers.zone[at(3, 3)] = Zone.Residential;
    state.layers.density[at(3, 3)] = 2;
    buildRoads(state, [at(3, 3)]);
    expect(state.layers.tileType[at(3, 3)]).toBe(TileType.Empty);
    expect(state.layers.density[at(3, 3)]).toBe(2);
  });

  it('marks changed tiles dirty for the renderer', () => {
    const state = makeState();
    state.dirty.clear();
    buildRoads(state, [at(5, 5), at(6, 5)]);
    expect(state.dirty.has(at(5, 5))).toBe(true);
    expect(state.dirty.has(at(6, 5))).toBe(true);
  });
});

describe('bulldozeTiles', () => {
  it('removes a road and updates neighbor masks', () => {
    const state = makeState();
    buildRoads(state, [at(4, 4), at(5, 4), at(6, 4)]);
    bulldozeTiles(state, [at(5, 4)]);
    expect(state.layers.tileType[at(5, 4)]).toBe(TileType.Empty);
    expect(state.layers.roadMask[at(4, 4)]).toBe(0);
    expect(state.layers.roadMask[at(6, 4)]).toBe(0);
  });

  it('clears zones and buildings', () => {
    const state = makeState();
    state.layers.zone[at(2, 2)] = Zone.Commercial;
    state.layers.density[at(2, 2)] = 3;
    bulldozeTiles(state, [at(2, 2)]);
    expect(state.layers.zone[at(2, 2)]).toBe(Zone.None);
    expect(state.layers.density[at(2, 2)]).toBe(0);
  });

  it('gives no refund', () => {
    const state = makeState();
    buildRoads(state, [at(1, 1)]);
    const before = state.money;
    bulldozeTiles(state, [at(1, 1)]);
    expect(state.money).toBe(before);
  });
});

describe('undoLastAction', () => {
  it('reverts the last road build including money', () => {
    const state = makeState();
    const before = state.money;
    buildRoads(state, [at(5, 5), at(6, 5)]);
    const result = undoLastAction(state);
    expect(result.rejected).toBeUndefined();
    expect(state.money).toBe(before);
    expect(state.layers.tileType[at(5, 5)]).toBe(TileType.Empty);
    expect(state.layers.roadMask[at(5, 5)]).toBe(0);
  });

  it('reverts a bulldoze, restoring roads and their masks', () => {
    const state = makeState();
    buildRoads(state, [at(4, 4), at(5, 4)]);
    bulldozeTiles(state, [at(5, 4)]);
    undoLastAction(state);
    expect(state.layers.tileType[at(5, 4)]).toBe(TileType.Road);
    expect(state.layers.roadMask[at(4, 4)]).toBe(DIR_E);
    expect(state.layers.roadMask[at(5, 4)]).toBe(DIR_W);
  });

  it('rejects when the undo stack is empty', () => {
    const state = makeState();
    expect(undoLastAction(state).rejected).toBeTruthy();
  });

  it('only reverts one action per call', () => {
    const state = makeState();
    buildRoads(state, [at(1, 1)]);
    buildRoads(state, [at(2, 2)]);
    undoLastAction(state);
    expect(state.layers.tileType[at(2, 2)]).toBe(TileType.Empty);
    expect(state.layers.tileType[at(1, 1)]).toBe(TileType.Road);
  });
});

describe('bridges', () => {
  it('charges the bridge price on river tiles and keeps the terrain', () => {
    const state = makeState();
    state.layers.terrain[at(5, 5)] = Terrain.River;
    const before = state.money;
    buildRoads(state, [at(4, 5), at(5, 5), at(6, 5)]);
    expect(state.layers.tileType[at(5, 5)]).toBe(TileType.Road);
    expect(state.money).toBe(before - 2 * BALANCE.costs.roadPerTile - BALANCE.costs.bridgePerTile);
    expect(state.layers.terrain[at(5, 5)]).toBe(Terrain.River);
  });

  it('never paves lake tiles', () => {
    const state = makeState();
    state.layers.terrain[at(5, 5)] = Terrain.Lake;
    buildRoads(state, [at(5, 5)]);
    expect(state.layers.tileType[at(5, 5)]).toBe(TileType.Empty);
  });

  it('bulldozing a bridge leaves a river tile', () => {
    const state = makeState();
    state.layers.terrain[at(5, 5)] = Terrain.River;
    buildRoads(state, [at(5, 5)]);
    bulldozeTiles(state, [at(5, 5)]);
    expect(state.layers.tileType[at(5, 5)]).toBe(TileType.Empty);
    expect(state.layers.terrain[at(5, 5)]).toBe(Terrain.River);
  });
});
