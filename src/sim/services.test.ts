import { describe, expect, it } from 'vitest';
import { BALANCE } from '../shared/constants.ts';
import { tileIndex } from '../shared/grid.ts';
import { placePlant } from './energy.ts';
import { buildPowerLines } from './powerLines.ts';
import { buildRoads } from './roads.ts';
import { recomputeServices, SERVICE_FIRE, SERVICE_POLICE, serviceCoverage } from './services.ts';
import { createSimState, PlantType, TileType, Zone, type SimState } from './state.ts';

const SIZE = 32;
const at = (x: number, y: number) => tileIndex(x, y, SIZE);

/** A powered station of the given type at (x, y): turbine ring + road. */
function poweredStation(state: SimState, x: number, y: number, plant: PlantType): void {
  buildRoads(state, [at(x, y + 1)]);
  placePlant(state, at(x, y), plant);
  placePlant(state, at(x + 1, y), PlantType.WindTurbine); // its ring energises the station
}

function building(state: SimState, x: number, y: number): void {
  state.layers.zone[at(x, y)] = Zone.Residential;
  state.layers.density[at(x, y)] = 1;
}

describe('recomputeServices', () => {
  it('stamps the fire radius as a Chebyshev square, clipped at the edge', () => {
    const state = createSimState(1, SIZE);
    poweredStation(state, 2, 2, PlantType.FireStation);
    recomputeServices(state);
    const r = BALANCE.services.fire.radius;
    expect(state.layers.services[at(2 + r, 2 + r)] & SERVICE_FIRE).toBe(SERVICE_FIRE);
    expect(state.layers.services[at(2 + r + 1, 2)] & SERVICE_FIRE).toBe(0);
    expect(state.layers.services[at(0, 0)] & SERVICE_FIRE).toBe(SERVICE_FIRE);
    expect(state.layers.services[at(2, 2)] & SERVICE_POLICE).toBe(0);
  });

  it('overlapping stations set both bits', () => {
    const state = createSimState(1, SIZE);
    poweredStation(state, 10, 10, PlantType.FireStation);
    poweredStation(state, 12, 12, PlantType.PoliceStation);
    recomputeServices(state);
    expect(state.layers.services[at(11, 11)]).toBe(SERVICE_FIRE | SERVICE_POLICE);
  });

  it('an unpowered station covers nothing', () => {
    const state = createSimState(1, SIZE);
    buildRoads(state, [at(10, 11)]);
    placePlant(state, at(10, 10), PlantType.PoliceStation);
    recomputeServices(state);
    expect(state.layers.services[at(10, 10)]).toBe(0);
    // Power it: a line from a turbine at (20,10) west to (13,10); the
    // line's supply radius (3) reaches the station at (10,10).
    placePlant(state, at(20, 10), PlantType.WindTurbine);
    buildPowerLines(
      state,
      Array.from({ length: 7 }, (_, i) => at(13 + i, 10)),
    );
    recomputeServices(state);
    expect(state.layers.services[at(10, 10)] & SERVICE_POLICE).toBe(SERVICE_POLICE);
  });

  it('clears coverage when a station is bulldozed and marks changed tiles dirty', () => {
    const state = createSimState(1, SIZE);
    poweredStation(state, 10, 10, PlantType.FireStation);
    recomputeServices(state);
    state.dirty.clear();
    recomputeServices(state);
    expect(state.dirty.size).toBe(0); // unchanged: nothing dirty
    state.layers.tileType[at(10, 10)] = TileType.Empty;
    state.layers.plantType[at(10, 10)] = PlantType.None;
    state.gridVersion++;
    recomputeServices(state);
    expect(state.layers.services[at(10, 10)]).toBe(0);
    expect(state.dirty.has(at(10, 10))).toBe(true);
  });
});

describe('serviceCoverage', () => {
  it('reports 1/1 for a city without buildings', () => {
    expect(serviceCoverage(createSimState(1, SIZE))).toEqual({ fire: 1, police: 1 });
  });

  it('counts the share of buildings inside each ring', () => {
    const state = createSimState(1, SIZE);
    poweredStation(state, 5, 5, PlantType.FireStation);
    building(state, 6, 7); // inside fire ring
    building(state, 30, 30); // outside everything
    recomputeServices(state);
    expect(serviceCoverage(state)).toEqual({ fire: 0.5, police: 0 });
  });
});
