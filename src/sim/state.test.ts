import { describe, expect, it } from 'vitest';
import { tileIndex } from '../shared/grid.ts';
import { Terrain } from '../shared/types.ts';
import {
  BuildIntent,
  buildRejection,
  createSimState,
  isBuildable,
  isLakeShore,
  PlantType,
  TileType,
  type SimState,
} from './state.ts';

const SIZE = 16;
const at = (x: number, y: number) => tileIndex(x, y, SIZE);

function makeState(): SimState {
  const state = createSimState(1, SIZE);
  state.layers.terrain[at(5, 5)] = Terrain.River;
  state.layers.terrain[at(8, 8)] = Terrain.Lake;
  return state;
}

describe('buildRejection', () => {
  it('allows everything on empty land', () => {
    const state = makeState();
    expect(buildRejection(state, at(1, 1), BuildIntent.Road)).toBeNull();
    expect(buildRejection(state, at(1, 1), BuildIntent.Zone)).toBeNull();
    expect(buildRejection(state, at(1, 1), BuildIntent.Plant, PlantType.SolarFarm)).toBeNull();
  });

  it('rejects occupied tiles first', () => {
    const state = makeState();
    state.layers.tileType[at(1, 1)] = TileType.Road;
    expect(buildRejection(state, at(1, 1), BuildIntent.Road)).toBe('tileOccupied');
    state.layers.density[at(2, 2)] = 1;
    expect(buildRejection(state, at(2, 2), BuildIntent.Zone)).toBe('tileOccupied');
  });

  it('allows roads (bridges) and run-of-river plants on river tiles only', () => {
    const state = makeState();
    expect(buildRejection(state, at(5, 5), BuildIntent.Road)).toBeNull();
    expect(buildRejection(state, at(5, 5), BuildIntent.Zone)).toBe('cannotBuildOnWater');
    expect(buildRejection(state, at(5, 5), BuildIntent.Plant, PlantType.SolarFarm)).toBe(
      'cannotBuildOnWater',
    );
    expect(buildRejection(state, at(5, 5), BuildIntent.Plant, PlantType.RunOfRiver)).toBeNull();
    expect(buildRejection(state, at(1, 1), BuildIntent.Plant, PlantType.RunOfRiver)).toBe(
      'needsRiverTile',
    );
  });

  it('rejects everything on lake tiles', () => {
    const state = makeState();
    expect(buildRejection(state, at(8, 8), BuildIntent.Road)).toBe('cannotBuildOnWater');
    expect(buildRejection(state, at(8, 8), BuildIntent.Zone)).toBe('cannotBuildOnWater');
    expect(buildRejection(state, at(8, 8), BuildIntent.Plant, PlantType.RunOfRiver)).toBe(
      'cannotBuildOnWater',
    );
  });

  it('requires a lake shore for pumped storage', () => {
    const state = makeState();
    expect(isLakeShore(state, at(8, 7))).toBe(true);
    expect(isLakeShore(state, at(1, 1))).toBe(false);
    expect(buildRejection(state, at(8, 7), BuildIntent.Plant, PlantType.PumpedStorage)).toBeNull();
    expect(buildRejection(state, at(1, 1), BuildIntent.Plant, PlantType.PumpedStorage)).toBe(
      'needsLakeShore',
    );
    expect(isBuildable(state, at(8, 7), BuildIntent.Plant, PlantType.PumpedStorage)).toBe(true);
  });
});
