import { describe, expect, it } from 'vitest';
import { BALANCE } from '../shared/constants.ts';
import { tileIndex } from '../shared/grid.ts';
import { Terrain } from '../shared/types.ts';
import {
  BuildIntent,
  buildRejection,
  createSimState,
  deserializeState,
  isBuildable,
  isLakeShore,
  PlantType,
  serializeState,
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

  it('accepts power lines on land, roads, river and lake but not on plants or buildings', () => {
    const state = makeState();
    expect(buildRejection(state, at(1, 1), BuildIntent.PowerLine)).toBeNull();
    expect(buildRejection(state, at(5, 5), BuildIntent.PowerLine)).toBeNull(); // river
    expect(buildRejection(state, at(8, 8), BuildIntent.PowerLine)).toBeNull(); // lake
    state.layers.tileType[at(2, 2)] = TileType.Road;
    expect(buildRejection(state, at(2, 2), BuildIntent.PowerLine)).toBeNull();
    state.layers.tileType[at(3, 3)] = TileType.Plant;
    expect(buildRejection(state, at(3, 3), BuildIntent.PowerLine)).toBe('needsLineSite');
    state.layers.density[at(4, 4)] = 1;
    expect(buildRejection(state, at(4, 4), BuildIntent.PowerLine)).toBe('needsLineSite');
  });

  it('keeps zones and plants off line tiles while roads may share them', () => {
    const state = makeState();
    state.layers.powerLine[at(1, 1)] = 16;
    expect(buildRejection(state, at(1, 1), BuildIntent.Road)).toBeNull();
    expect(buildRejection(state, at(1, 1), BuildIntent.Zone)).toBe('tileOccupied');
    expect(buildRejection(state, at(1, 1), BuildIntent.Plant, PlantType.SolarFarm)).toBe(
      'tileOccupied',
    );
  });
});

describe('save round trip', () => {
  it('persists terrain, river flow and pumped storage', () => {
    const state = makeState();
    state.weather.riverFlow = 0.8;
    state.pumpedStorageEnergy = 1234;
    const save = serializeState(state);
    const restored = deserializeState(save);
    expect(restored.layers.terrain).toEqual(state.layers.terrain);
    expect(restored.weather.riverFlow).toBe(0.8);
    expect(restored.pumpedStorageEnergy).toBe(1234);
  });

  it('loads older saves without the new fields as dry land', () => {
    const state = makeState();
    const save = serializeState(state);
    delete save.layers.terrain;
    delete save.riverFlow;
    delete save.pumpedStorageEnergy;
    const restored = deserializeState(save);
    expect(restored.layers.terrain.every((t) => t === Terrain.Land)).toBe(true);
    expect(restored.weather.riverFlow).toBe(BALANCE.water.dryBaselineFlow);
    expect(restored.pumpedStorageEnergy).toBe(0);
  });
});
