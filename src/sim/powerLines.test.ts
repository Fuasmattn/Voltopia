import { describe, expect, it } from 'vitest';
import { BALANCE } from '../shared/constants.ts';
import { DIR_E, DIR_W, LINE_PRESENT, tileIndex } from '../shared/grid.ts';
import { PlantType, Terrain } from '../shared/types.ts';
import { placePlant } from './energy.ts';
import { buildPowerLines, countPowerLineTiles, hasPowerLines } from './powerLines.ts';
import { buildRoads, bulldozeTiles, undoLastAction } from './roads.ts';
import { collectDiffs, createSimState, TileType, type SimState } from './state.ts';

const SIZE = 16;
const at = (x: number, y: number) => tileIndex(x, y, SIZE);

function makeState(): SimState {
  const state = createSimState(1, SIZE);
  state.layers.terrain[at(8, 5)] = Terrain.River;
  return state;
}

describe('buildPowerLines', () => {
  it('places an isolated line tile with the presence bit and no connections', () => {
    const state = makeState();
    expect(buildPowerLines(state, [at(5, 5)]).rejected).toBeUndefined();
    expect(state.layers.powerLine[at(5, 5)]).toBe(LINE_PRESENT);
    expect(hasPowerLines(state)).toBe(true);
    expect(countPowerLineTiles(state)).toBe(1);
  });

  it('connects adjacent line tiles in both directions', () => {
    const state = makeState();
    buildPowerLines(state, [at(5, 5), at(6, 5)]);
    expect(state.layers.powerLine[at(5, 5)]).toBe(LINE_PRESENT | DIR_E);
    expect(state.layers.powerLine[at(6, 5)]).toBe(LINE_PRESENT | DIR_W);
  });

  it('charges the land price on land and the water price over the river', () => {
    const state = makeState();
    const before = state.money;
    buildPowerLines(state, [at(7, 5), at(8, 5)]);
    expect(state.money).toBe(
      before - BALANCE.costs.powerLinePerTile - BALANCE.costs.powerLineWaterPerTile,
    );
  });

  it('never charges twice for a tile that already carries a line', () => {
    const state = makeState();
    buildPowerLines(state, [at(5, 5)]);
    const before = state.money;
    buildPowerLines(state, [at(5, 5), at(6, 5)]);
    expect(state.money).toBe(before - BALANCE.costs.powerLinePerTile);
  });

  it('rejects the whole drag when money is short', () => {
    const state = makeState();
    state.money = BALANCE.costs.powerLinePerTile - 1;
    expect(buildPowerLines(state, [at(5, 5)]).rejected).toBe('notEnoughMoney');
    expect(state.layers.powerLine[at(5, 5)]).toBe(0);
  });

  it('runs over road tiles but not over plants', () => {
    const state = makeState();
    buildRoads(state, [at(5, 5)]);
    placePlant(state, at(6, 6), PlantType.SolarFarm);
    buildPowerLines(state, [at(5, 5), at(6, 6)]);
    expect(state.layers.powerLine[at(5, 5)]).toBe(LINE_PRESENT);
    expect(state.layers.powerLine[at(6, 6)]).toBe(0);
    expect(state.layers.tileType[at(5, 5)]).toBe(TileType.Road);
  });

  it('explains a drag that is blocked on every tile', () => {
    const state = makeState();
    placePlant(state, at(6, 6), PlantType.SolarFarm);
    state.layers.density[at(7, 6)] = 1; // a building
    expect(buildPowerLines(state, [at(6, 6), at(7, 6)]).rejected).toBe('needsLineSite');
  });

  it('stays silent when the drag only retraces existing lines', () => {
    const state = makeState();
    buildPowerLines(state, [at(5, 5), at(6, 5)]);
    expect(buildPowerLines(state, [at(5, 5), at(6, 5)]).rejected).toBeUndefined();
  });

  it('bumps the grid version so connectivity is recomputed', () => {
    const state = makeState();
    const before = state.gridVersion;
    buildPowerLines(state, [at(5, 5)]);
    expect(state.gridVersion).toBe(before + 1);
  });

  it('reports the line mask in tile diffs', () => {
    const state = makeState();
    collectDiffs(state);
    buildPowerLines(state, [at(5, 5)]);
    const diff = collectDiffs(state).find((d) => d.index === at(5, 5));
    expect(diff?.powerLine).toBe(LINE_PRESENT);
  });
});

describe('bulldozer and undo with lines', () => {
  it('clears only the line on a road tile; a second pass clears the road', () => {
    const state = makeState();
    buildRoads(state, [at(5, 5)]);
    buildPowerLines(state, [at(5, 5)]);
    bulldozeTiles(state, [at(5, 5)]);
    expect(state.layers.powerLine[at(5, 5)]).toBe(0);
    expect(state.layers.tileType[at(5, 5)]).toBe(TileType.Road);
    bulldozeTiles(state, [at(5, 5)]);
    expect(state.layers.tileType[at(5, 5)]).toBe(TileType.Empty);
  });

  it('clearing a line updates the neighbours connection bits', () => {
    const state = makeState();
    buildPowerLines(state, [at(5, 5), at(6, 5), at(7, 5)]);
    bulldozeTiles(state, [at(6, 5)]);
    expect(state.layers.powerLine[at(5, 5)]).toBe(LINE_PRESENT);
    expect(state.layers.powerLine[at(7, 5)]).toBe(LINE_PRESENT);
  });

  it('bulldozing a line bumps the grid version', () => {
    const state = makeState();
    buildPowerLines(state, [at(5, 5)]);
    const before = state.gridVersion;
    bulldozeTiles(state, [at(5, 5)]);
    expect(state.gridVersion).toBe(before + 1);
  });

  it('undo restores the line, its neighbours and the money', () => {
    const state = makeState();
    buildPowerLines(state, [at(5, 5)]);
    const money = state.money;
    buildPowerLines(state, [at(6, 5)]);
    expect(undoLastAction(state).rejected).toBeUndefined();
    expect(state.money).toBe(money);
    expect(state.layers.powerLine[at(6, 5)]).toBe(0);
    expect(state.layers.powerLine[at(5, 5)]).toBe(LINE_PRESENT);
  });

  it('undo bumps the grid version', () => {
    const state = makeState();
    buildPowerLines(state, [at(5, 5)]);
    const before = state.gridVersion;
    undoLastAction(state);
    expect(state.gridVersion).toBe(before + 1);
  });
});
