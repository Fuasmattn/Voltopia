import { describe, expect, it } from 'vitest';
import { BALANCE, TICKS_PER_DAY } from '../shared/constants.ts';
import { LINE_PRESENT, tileIndex } from '../shared/grid.ts';
import { Terrain } from '../shared/types.ts';
import { recomputeGrid } from './powerGrid.ts';
import { buildRoads } from './roads.ts';
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
  Zone,
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
    state.layers.powerLine[at(1, 1)] = LINE_PRESENT;
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

  it('persists the power line layer', () => {
    const state = makeState();
    state.layers.powerLine[at(1, 1)] = LINE_PRESENT;
    const restored = deserializeState(serializeState(state));
    expect(restored.layers.powerLine[at(1, 1)]).toBe(LINE_PRESENT);
    expect(restored.gridComputedVersion).toBe(-1);
  });

  it('grants lines along plant-connected roads to saves without the layer', () => {
    const state = makeState();
    state.money = 1e9;
    buildRoads(state, [at(1, 2), at(2, 2), at(3, 2)]);
    state.layers.tileType[at(1, 1)] = TileType.Plant;
    state.layers.plantType[at(1, 1)] = PlantType.WindTurbine; // touches road (1,2)
    buildRoads(state, [at(10, 10), at(11, 10)]); // no plant nearby
    const save = serializeState(state);
    delete save.layers.powerLine;
    const restored = deserializeState(save);
    expect(restored.layers.powerLine[at(1, 2)]).not.toBe(0);
    expect(restored.layers.powerLine[at(3, 2)]).not.toBe(0);
    expect(restored.layers.powerLine[at(10, 10)]).toBe(0);
  });

  it('connects a plant that stands off the street to the road network', () => {
    const state = makeState();
    state.money = 1e9;
    buildRoads(state, [at(1, 5), at(2, 5), at(3, 5)]);
    state.layers.tileType[at(1, 3)] = TileType.Plant; // two tiles off the road
    state.layers.plantType[at(1, 3)] = PlantType.WindTurbine;
    state.layers.tileType[at(5, 3)] = TileType.Plant; // a second plant on the same network
    state.layers.plantType[at(5, 3)] = PlantType.SolarFarm;
    const save = serializeState(state);
    delete save.layers.powerLine;
    const restored = deserializeState(save);
    // Connector from the plant down to the nearest road tile…
    expect(restored.layers.powerLine[at(1, 4)]).not.toBe(0);
    expect(restored.layers.powerLine[at(1, 3)]).toBe(0); // never on the plant itself
    expect(restored.layers.powerLine[at(3, 4)]).not.toBe(0); // the second plant too
    // …and lines along every road reachable from there.
    expect(restored.layers.powerLine[at(1, 5)]).not.toBe(0);
    expect(restored.layers.powerLine[at(3, 5)]).not.toBe(0);
    // A building next to that road is energised again.
    restored.layers.zone[at(3, 7)] = Zone.Residential;
    restored.layers.density[at(3, 7)] = 1;
    recomputeGrid(restored);
    expect(restored.layers.energized[at(3, 7)]).toBe(1);
  });

  it('grants nothing for a plant with no road in reach', () => {
    const state = makeState();
    state.layers.tileType[at(8, 2)] = TileType.Plant;
    state.layers.plantType[at(8, 2)] = PlantType.WindTurbine;
    const save = serializeState(state);
    delete save.layers.powerLine;
    const restored = deserializeState(save);
    expect(restored.layers.powerLine.some((mask) => mask !== 0)).toBe(false);
  });

  it('leaves a save that has an all-zero line layer alone', () => {
    const state = makeState();
    state.money = 1e9;
    buildRoads(state, [at(1, 2)]);
    state.layers.tileType[at(1, 1)] = TileType.Plant;
    state.layers.plantType[at(1, 1)] = PlantType.WindTurbine;
    const restored = deserializeState(serializeState(state));
    expect(restored.layers.powerLine[at(1, 2)]).toBe(0);
  });

  it('persists season origin, snowpack and insulation', () => {
    const state = makeState();
    state.seasonOriginDay = 12;
    state.weather.snowpack = 0.4;
    state.insulation = true;
    const restored = deserializeState(serializeState(state));
    expect(restored.seasonOriginDay).toBe(12);
    expect(restored.weather.snowpack).toBe(0.4);
    expect(restored.insulation).toBe(true);
  });

  it('starts a save without season data on the first spring day', () => {
    const state = makeState();
    state.tick = TICKS_PER_DAY * 37 + 100;
    const save = serializeState(state);
    delete save.seasonOriginDay;
    delete save.snowpack;
    delete save.insulation;
    const restored = deserializeState(save);
    expect(restored.seasonOriginDay).toBe(37);
    expect(restored.season.season).toBe('spring');
    expect(restored.season.dayOfSeason).toBe(1);
    expect(restored.weather.snowpack).toBe(0);
    expect(restored.insulation).toBe(false);
  });

  it('recomputes the season for the loaded tick', () => {
    const state = makeState();
    state.tick = TICKS_PER_DAY * 7;
    const restored = deserializeState(serializeState(state));
    expect(restored.season.season).toBe('summer');
    expect(restored.season.dayOfSeason).toBe(3);
  });
});
