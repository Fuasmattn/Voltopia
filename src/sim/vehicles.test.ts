import { describe, expect, it } from 'vitest';
import { BALANCE, TICKS_PER_DAY } from '../shared/constants.ts';
import { tileIndex } from '../shared/grid.ts';
import { PlantType, Zone } from '../shared/types.ts';
import { placePlant } from './energy.ts';
import { buildRoads } from './roads.ts';
import { createSimState, TileType, VehiclePhase, type SimState } from './state.ts';
import { chargingDemand, drivingVehicles, findRoadPath, vehiclesStep } from './vehicles.ts';

const SIZE = 24;
const at = (x: number, y: number) => tileIndex(x, y, SIZE);

/**
 * A commuter town: homes in the west, jobs in the east, one main road.
 * ~citizens residents plus enough commercial density for workplaces.
 */
function commuterTown(seed = 1, citizens = 150): SimState {
  const state = createSimState(seed, SIZE);
  const road = Array.from({ length: 16 }, (_, x) => at(x + 3, 10));
  buildRoads(state, road);
  const perBuilding = BALANCE.growth.populationByDensity[3];
  const homes = Math.ceil(citizens / perBuilding);
  for (let i = 0; i < homes; i++) {
    state.layers.zone[at(3 + i, 9)] = Zone.Residential;
    state.layers.density[at(3 + i, 9)] = 3;
  }
  for (let i = 0; i < 4; i++) {
    state.layers.zone[at(15 + i, 9)] = Zone.Commercial;
    state.layers.density[at(15 + i, 9)] = 3;
  }
  return state;
}

function setHour(state: SimState, hour: number): void {
  state.tick =
    Math.floor(state.tick / TICKS_PER_DAY) * TICKS_PER_DAY +
    Math.round((hour / 24) * TICKS_PER_DAY);
}

/** Run whole in-game hours of vehicle simulation. */
function runHours(state: SimState, hours: number): void {
  const ticks = Math.round((hours / 24) * TICKS_PER_DAY);
  for (let i = 0; i < ticks; i++) {
    vehiclesStep(state);
    state.tick++;
  }
}

describe('findRoadPath', () => {
  it('finds a connected path along roads', () => {
    const state = commuterTown();
    const path = findRoadPath(state, at(3, 10), at(18, 10));
    expect(path).not.toBeNull();
    expect(path![0]).toBe(at(3, 10));
    expect(path![path!.length - 1]).toBe(at(18, 10));
    for (const tile of path!) {
      expect(state.layers.tileType[tile]).toBe(TileType.Road);
    }
    // Straight road: the path is the direct line.
    expect(path!.length).toBe(16);
  });

  it('returns null for disconnected networks', () => {
    const state = createSimState(1, SIZE);
    buildRoads(state, [at(2, 2), at(3, 2)]);
    buildRoads(state, [at(10, 10), at(11, 10)]);
    expect(findRoadPath(state, at(2, 2), at(10, 10))).toBeNull();
  });

  it('handles from === to', () => {
    const state = commuterTown();
    expect(findRoadPath(state, at(5, 10), at(5, 10))).toEqual([at(5, 10)]);
  });
});

describe('vehiclesStep (commuting)', () => {
  it('fleet size scales with population', () => {
    const small = commuterTown(1, 60);
    const large = commuterTown(1, 250);
    vehiclesStep(small);
    vehiclesStep(large);
    expect(large.vehicles.length).toBeGreaterThan(small.vehicles.length);
  });

  it('no vehicles without residential buildings next to roads', () => {
    const state = createSimState(1, SIZE);
    buildRoads(state, [at(2, 2), at(3, 2)]);
    vehiclesStep(state);
    expect(state.vehicles).toHaveLength(0);
  });

  it('vehicles drive to work in the morning and are parked before dawn', () => {
    const state = commuterTown(7, 200);
    setHour(state, 5);
    vehiclesStep(state);
    expect(drivingVehicles(state)).toHaveLength(0);

    setHour(state, BALANCE.vehicles.commute.morningStartHour);
    runHours(state, BALANCE.vehicles.commute.departureWindowHours / 2);
    expect(drivingVehicles(state).length).toBeGreaterThan(0);
  });

  it('vehicles arrive at work and later return home', () => {
    const state = commuterTown(3, 200);
    setHour(state, BALANCE.vehicles.commute.morningStartHour);
    vehiclesStep(state); // spawn fleet
    runHours(state, 4); // morning window + travel time
    const atWork = state.vehicles.filter((v) => v.phase === VehiclePhase.ParkedWork);
    expect(atWork.length).toBe(state.vehicles.length);

    setHour(state, BALANCE.vehicles.commute.eveningStartHour);
    runHours(state, 4);
    const atHome = state.vehicles.filter((v) => v.phase === VehiclePhase.ParkedHome);
    expect(atHome.length).toBe(state.vehicles.length);
  });

  it('driving vehicles stay on road tiles', () => {
    const state = commuterTown(9, 200);
    setHour(state, BALANCE.vehicles.commute.morningStartHour);
    const ticks = Math.round((3 / 24) * TICKS_PER_DAY);
    for (let i = 0; i < ticks; i++) {
      vehiclesStep(state);
      state.tick++;
      for (const v of drivingVehicles(state)) {
        const tile = at(Math.floor(v.x), Math.floor(v.y));
        expect(state.layers.tileType[tile]).toBe(TileType.Road);
      }
    }
  });

  it('without workplaces, vehicles stay parked at home', () => {
    const state = createSimState(1, SIZE);
    buildRoads(
      state,
      Array.from({ length: 8 }, (_, x) => at(x + 3, 10)),
    );
    for (let i = 0; i < 4; i++) {
      state.layers.zone[at(3 + i, 9)] = Zone.Residential;
      state.layers.density[at(3 + i, 9)] = 3;
    }
    setHour(state, 8);
    runHours(state, 3);
    expect(state.vehicles.length).toBeGreaterThan(0);
    expect(drivingVehicles(state)).toHaveLength(0);
  });

  it('a disconnected workplace means no trip (and no crash)', () => {
    const state = createSimState(1, SIZE);
    buildRoads(
      state,
      Array.from({ length: 4 }, (_, x) => at(x + 2, 5)),
    );
    buildRoads(
      state,
      Array.from({ length: 4 }, (_, x) => at(x + 12, 15)),
    );
    state.layers.zone[at(2, 4)] = Zone.Residential;
    state.layers.density[at(2, 4)] = 3;
    state.layers.zone[at(12, 14)] = Zone.Commercial;
    state.layers.density[at(12, 14)] = 3;
    setHour(state, 8);
    runHours(state, 3);
    expect(drivingVehicles(state)).toHaveLength(0);
  });

  it('is deterministic', () => {
    const a = commuterTown(5, 200);
    const b = commuterTown(5, 200);
    setHour(a, 6);
    setHour(b, 6);
    for (let i = 0; i < 800; i++) {
      vehiclesStep(a);
      a.tick++;
      vehiclesStep(b);
      b.tick++;
    }
    expect(a.vehicles).toEqual(b.vehicles);
  });
});

describe('chargingDemand', () => {
  it('is zero without vehicles', () => {
    const state = createSimState(1, SIZE);
    expect(chargingDemand(state)).toBe(0);
  });

  it('peaks in the evening with home charging only', () => {
    const state = commuterTown(1, 250);
    vehiclesStep(state);
    setHour(state, 19);
    const evening = chargingDemand(state);
    setHour(state, 12);
    const noon = chargingDemand(state);
    setHour(state, 4);
    const night = chargingDemand(state);
    expect(evening).toBeGreaterThan(noon * 3);
    expect(evening).toBeGreaterThan(night);
  });

  it('charging hubs shift load into the daytime', () => {
    const state = commuterTown(1, 250);
    vehiclesStep(state);
    setHour(state, 12);
    const noonBefore = chargingDemand(state);
    setHour(state, 19);
    const eveningBefore = chargingDemand(state);
    placePlant(state, at(6, 12), PlantType.ChargingHub);
    placePlant(state, at(8, 12), PlantType.ChargingHub);
    setHour(state, 12);
    const noonAfter = chargingDemand(state);
    setHour(state, 19);
    const eveningAfter = chargingDemand(state);
    expect(noonAfter).toBeGreaterThan(noonBefore);
    expect(eveningAfter).toBeLessThan(eveningBefore);
  });

  it('smart charging follows the generation surplus', () => {
    const state = commuterTown(1, 250);
    vehiclesStep(state);
    state.smartCharging = true;
    setHour(state, 19);
    const fullLoad = state.vehicles.length * BALANCE.vehicles.chargingEnergyPerVehicle;

    state.lastEnergy.solar = 0;
    state.lastEnergy.wind = 0;
    state.lastEnergy.buildingConsumption = 50;
    expect(chargingDemand(state)).toBeCloseTo(fullLoad * BALANCE.vehicles.smartChargingBaseline, 5);

    state.lastEnergy.solar = 500;
    state.lastEnergy.buildingConsumption = 20;
    expect(chargingDemand(state)).toBeCloseTo(fullLoad, 5);
  });
});
