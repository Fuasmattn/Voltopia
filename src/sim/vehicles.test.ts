import { describe, expect, it } from 'vitest';
import { BALANCE, TICKS_PER_DAY } from '../shared/constants.ts';
import { tileIndex } from '../shared/grid.ts';
import { PlantType, Zone } from '../shared/types.ts';
import { placePlant } from './energy.ts';
import { buildRoads } from './roads.ts';
import { createSimState, TileType, type SimState } from './state.ts';
import { chargingDemand, vehiclesStep } from './vehicles.ts';

const SIZE = 24;
const at = (x: number, y: number) => tileIndex(x, y, SIZE);

/** State with a ring road and enough citizens for a few vehicles. */
function cityWithVehicles(seed = 1, citizens = 90): SimState {
  const state = createSimState(seed, SIZE);
  const ring: number[] = [];
  for (let i = 4; i <= 12; i++) {
    ring.push(at(i, 4), at(i, 12), at(4, i), at(12, i));
  }
  buildRoads(state, ring);
  // Fake population via residential buildings.
  const perBuilding = BALANCE.growth.populationByDensity[3];
  const needed = Math.ceil(citizens / perBuilding);
  for (let i = 0; i < needed; i++) {
    state.layers.zone[at(5 + i, 5)] = Zone.Residential;
    state.layers.density[at(5 + i, 5)] = 3;
  }
  return state;
}

function setHour(state: SimState, hour: number): void {
  state.tick = Math.round((hour / 24) * TICKS_PER_DAY);
}

describe('vehiclesStep', () => {
  it('fleet size scales with population', () => {
    const small = cityWithVehicles(1, 40);
    const large = cityWithVehicles(1, 200);
    vehiclesStep(small);
    vehiclesStep(large);
    expect(large.vehicles.length).toBeGreaterThan(small.vehicles.length);
    expect(small.vehicles.length).toBe(Math.floor(40 / BALANCE.vehicles.citizensPerVehicle));
  });

  it('no vehicles without roads', () => {
    const state = createSimState(1, SIZE);
    state.layers.zone[at(5, 5)] = Zone.Residential;
    state.layers.density[at(5, 5)] = 3;
    vehiclesStep(state);
    expect(state.vehicles).toHaveLength(0);
  });

  it('vehicles stay on road tiles while driving', () => {
    const state = cityWithVehicles(7, 150);
    for (let i = 0; i < 500; i++) {
      vehiclesStep(state);
      for (const v of state.vehicles) {
        const tile = at(Math.floor(v.x), Math.floor(v.y));
        expect(state.layers.tileType[tile]).toBe(TileType.Road);
      }
    }
  });

  it('vehicles actually move', () => {
    const state = cityWithVehicles(3, 150);
    vehiclesStep(state);
    const before = state.vehicles.map((v) => ({ x: v.x, y: v.y }));
    for (let i = 0; i < 50; i++) vehiclesStep(state);
    const moved = state.vehicles.some(
      (v, i) => Math.hypot(v.x - before[i].x, v.y - before[i].y) > 1,
    );
    expect(moved).toBe(true);
  });

  it('is deterministic', () => {
    const a = cityWithVehicles(5, 150);
    const b = cityWithVehicles(5, 150);
    for (let i = 0; i < 200; i++) {
      vehiclesStep(a);
      vehiclesStep(b);
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
    const state = cityWithVehicles(1, 200);
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
    const state = cityWithVehicles(1, 200);
    vehiclesStep(state);
    setHour(state, 12);
    const noonBefore = chargingDemand(state);
    setHour(state, 19);
    const eveningBefore = chargingDemand(state);
    // Enough hubs for the whole fleet.
    placePlant(state, at(6, 6), PlantType.ChargingHub);
    placePlant(state, at(7, 6), PlantType.ChargingHub);
    setHour(state, 12);
    const noonAfter = chargingDemand(state);
    setHour(state, 19);
    const eveningAfter = chargingDemand(state);
    expect(noonAfter).toBeGreaterThan(noonBefore);
    expect(eveningAfter).toBeLessThan(eveningBefore);
  });

  it('smart charging follows the generation surplus', () => {
    const state = cityWithVehicles(1, 200);
    vehiclesStep(state);
    state.smartCharging = true;
    setHour(state, 19);
    const fullLoad = state.vehicles.length * BALANCE.vehicles.chargingEnergyPerVehicle;

    // No surplus: only the baseline remains.
    state.lastEnergy.solar = 0;
    state.lastEnergy.wind = 0;
    state.lastEnergy.buildingConsumption = 50;
    expect(chargingDemand(state)).toBeCloseTo(fullLoad * BALANCE.vehicles.smartChargingBaseline, 5);

    // Large surplus: charging ramps up, capped at the full load.
    state.lastEnergy.solar = 500;
    state.lastEnergy.buildingConsumption = 20;
    expect(chargingDemand(state)).toBeCloseTo(fullLoad, 5);
  });
});
