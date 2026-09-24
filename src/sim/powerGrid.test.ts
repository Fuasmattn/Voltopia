import { describe, expect, it } from 'vitest';
import { BALANCE } from '../shared/constants.ts';
import { chebyshevDistance, LINE_PRESENT, tileIndex } from '../shared/grid.ts';
import { PlantType } from '../shared/types.ts';
import { placePlant } from './energy.ts';
import { isSupplySource, recomputeGrid } from './powerGrid.ts';
import { buildPowerLines } from './powerLines.ts';
import { bumpGridVersion, createSimState, type SimState } from './state.ts';

const SIZE = 24;
const at = (x: number, y: number) => tileIndex(x, y, SIZE);
const R = BALANCE.energy.lineSupplyRadius;

function makeState(): SimState {
  const state = createSimState(1, SIZE);
  state.money = 1e9;
  return state;
}

describe('isSupplySource', () => {
  it('counts generators and storage, not hubs or parks', () => {
    expect(isSupplySource(PlantType.SolarFarm)).toBe(true);
    expect(isSupplySource(PlantType.Battery)).toBe(true);
    expect(isSupplySource(PlantType.PumpedStorage)).toBe(true);
    expect(isSupplySource(PlantType.TidalPlant)).toBe(true);
    expect(isSupplySource(PlantType.ChargingHub)).toBe(false);
    expect(isSupplySource(PlantType.Park)).toBe(false);
    expect(isSupplySource(PlantType.None)).toBe(false);
  });
});

describe('recomputeGrid', () => {
  it('a supply plant energises its own neighbourhood only', () => {
    const state = makeState();
    placePlant(state, at(10, 10), PlantType.WindTurbine);
    recomputeGrid(state);
    expect(state.layers.energized[at(10 + R, 10 + R)]).toBe(1);
    expect(state.layers.energized[at(10 + R + 1, 10)]).toBe(0);
  });

  it('lines connected to a plant extend the energised area', () => {
    const state = makeState();
    placePlant(state, at(2, 10), PlantType.SolarFarm);
    const line = Array.from({ length: 10 }, (_, i) => at(3 + i, 10)); // x 3..12
    buildPowerLines(state, line);
    recomputeGrid(state);
    expect(state.layers.energized[at(12 + R, 10)]).toBe(1);
    expect(state.layers.energized[at(12 + R + 1, 10)]).toBe(0);
  });

  it('two plants joined by a line share one energised set', () => {
    const state = makeState();
    placePlant(state, at(2, 10), PlantType.SolarFarm); // plant A
    placePlant(state, at(12, 10), PlantType.WindTurbine); // plant B
    buildPowerLines(
      state,
      Array.from({ length: 9 }, (_, i) => at(3 + i, 10)), // x 3..11
    );
    const far = at(8, 12); // beyond either plant's own radius, next to the line
    expect(chebyshevDistance(far, at(2, 10), SIZE)).toBeGreaterThan(R);
    expect(chebyshevDistance(far, at(12, 10), SIZE)).toBeGreaterThan(R);
    recomputeGrid(state);
    expect(state.layers.energized[far]).toBe(1);
    // Plant B only shares the network; removing it changes nothing here.
    state.layers.tileType[at(12, 10)] = 0;
    state.layers.plantType[at(12, 10)] = PlantType.None;
    bumpGridVersion(state);
    recomputeGrid(state);
    expect(state.layers.energized[far]).toBe(1);
  });

  it('a line that touches no supply plant stays dead', () => {
    const state = makeState();
    placePlant(state, at(2, 2), PlantType.SolarFarm);
    buildPowerLines(state, [at(15, 15), at(16, 15), at(17, 15)]);
    recomputeGrid(state);
    expect(state.layers.energized[at(17 + R, 15)]).toBe(0);
  });

  it('charging hubs and parks neither energise nor seed the fill', () => {
    const state = makeState();
    placePlant(state, at(10, 10), PlantType.ChargingHub);
    placePlant(state, at(10, 14), PlantType.Park);
    buildPowerLines(state, [at(11, 10), at(12, 10)]);
    recomputeGrid(state);
    expect(state.layers.energized[at(10, 10)]).toBe(0);
    expect(state.layers.energized[at(12, 10)]).toBe(0);
  });

  it('clips the radius stamp at the map edge', () => {
    const state = makeState();
    placePlant(state, at(0, 0), PlantType.WindTurbine);
    expect(() => recomputeGrid(state)).not.toThrow();
    expect(state.layers.energized[at(R, R)]).toBe(1);
    expect(state.layers.energized[at(R + 1, 0)]).toBe(0);
    expect(state.layers.energized[at(SIZE - 1, SIZE - 1)]).toBe(0);
  });

  it('is a no-op until the grid version changes', () => {
    const state = makeState();
    placePlant(state, at(2, 10), PlantType.SolarFarm);
    recomputeGrid(state);
    expect(state.gridComputedVersion).toBe(state.gridVersion);
    // Poke the layer behind the version's back: nothing happens…
    state.layers.powerLine[at(3, 10)] = LINE_PRESENT;
    recomputeGrid(state);
    expect(state.layers.energized[at(3 + R, 10)]).toBe(0);
    // …until the version is bumped.
    bumpGridVersion(state);
    recomputeGrid(state);
    expect(state.layers.energized[at(3 + R, 10)]).toBe(1);
  });

  it('forgets energised tiles when their plant is gone', () => {
    const state = makeState();
    placePlant(state, at(10, 10), PlantType.WindTurbine);
    recomputeGrid(state);
    expect(state.layers.energized[at(10, 10)]).toBe(1);
    state.layers.tileType[at(10, 10)] = 0;
    state.layers.plantType[at(10, 10)] = PlantType.None;
    bumpGridVersion(state);
    recomputeGrid(state);
    expect(state.layers.energized[at(10, 10)]).toBe(0);
  });
});
