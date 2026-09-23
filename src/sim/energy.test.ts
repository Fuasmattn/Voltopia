import { describe, expect, it } from 'vitest';
import { BALANCE, TICKS_PER_DAY } from '../shared/constants.ts';
import { tileIndex } from '../shared/grid.ts';
import {
  buildingConsumption,
  censusPlants,
  coolingConsumption,
  energyStep,
  heatingConsumption,
  loadProfileFactor,
  placePlant,
} from './energy.ts';
import { buildPowerLines } from './powerLines.ts';
import { bulldozeTiles, undoLastAction } from './roads.ts';
import {
  createSimState,
  PlantType,
  SupplyStatus,
  Terrain,
  TileType,
  Zone,
  type SimState,
} from './state.ts';
import { timeOfDay } from './tick.ts';
import { SUNRISE, SUNSET } from './weather.ts';

const SIZE = 32;
const at = (x: number, y: number) => tileIndex(x, y, SIZE);

function makeState(): SimState {
  const state = createSimState(1, SIZE);
  // Neutral baseline so pre-season literal expectations pick up neither
  // heating nor cooling; the heating and cooling tests set their own
  // temperature.
  state.season = { ...state.season, temperature: 18 };
  return state;
}

/** Put a building on a tile directly (bypassing growth). */
function addBuilding(state: SimState, index: number, zone: Zone, density: number): void {
  state.layers.zone[index] = zone;
  state.layers.density[index] = density;
}

/**
 * Set the clock to noon with clear skies for predictable solar output.
 * Also neutralizes the season's day window and solar strength (this
 * state is otherwise created at day 0 midnight, i.e. mid-strength), so
 * pre-existing literal expectations keep their pre-season meaning.
 */
function setNoonClearSky(state: SimState): void {
  state.tick = TICKS_PER_DAY / 2;
  state.weather.cloudCover = 0;
  state.weather.windSpeed = 0;
  state.season = { ...state.season, sunrise: SUNRISE, sunset: SUNSET, solarStrength: 1 };
}

describe('placePlant', () => {
  it('places a plant and charges its cost', () => {
    const state = makeState();
    const before = state.money;
    const result = placePlant(state, at(5, 5), PlantType.SolarFarm);
    expect(result.rejected).toBeUndefined();
    expect(state.layers.tileType[at(5, 5)]).toBe(TileType.Plant);
    expect(state.layers.plantType[at(5, 5)]).toBe(PlantType.SolarFarm);
    expect(state.money).toBe(before - BALANCE.costs.plant[PlantType.SolarFarm]);
  });

  it('rejects occupied tiles and missing funds', () => {
    const state = makeState();
    placePlant(state, at(5, 5), PlantType.SolarFarm);
    expect(placePlant(state, at(5, 5), PlantType.WindTurbine).rejected).toBeTruthy();
    state.money = 0;
    expect(placePlant(state, at(6, 6), PlantType.WindTurbine).rejected).toBeTruthy();
  });

  it('can be undone', () => {
    const state = makeState();
    const before = state.money;
    placePlant(state, at(5, 5), PlantType.Battery);
    undoLastAction(state);
    expect(state.layers.tileType[at(5, 5)]).toBe(TileType.Empty);
    expect(state.money).toBe(before);
  });

  it('census counts each plant type', () => {
    const state = makeState();
    placePlant(state, at(1, 1), PlantType.SolarFarm);
    placePlant(state, at(2, 1), PlantType.WindTurbine);
    placePlant(state, at(3, 1), PlantType.Battery);
    placePlant(state, at(4, 1), PlantType.BiogasPlant);
    placePlant(state, at(5, 1), PlantType.ChargingHub);
    const census = censusPlants(state);
    expect(census.solarFarms).toBe(1);
    expect(census.windTurbines).toBe(1);
    expect(census.batteries).toBe(1);
    expect(census.biogasPlants).toBe(1);
    expect(census.chargingHubs).toBe(1);
  });

  it('places run-of-river only on river tiles', () => {
    const state = makeState();
    expect(placePlant(state, at(5, 5), PlantType.RunOfRiver).rejected).toBe('needsRiverTile');
    state.layers.terrain[at(5, 5)] = Terrain.River;
    expect(placePlant(state, at(5, 5), PlantType.RunOfRiver).rejected).toBeUndefined();
    expect(state.layers.plantType[at(5, 5)]).toBe(PlantType.RunOfRiver);
  });

  it('places pumped storage only on the lake shore and never on water', () => {
    const state = makeState();
    state.layers.terrain[at(8, 8)] = Terrain.Lake;
    expect(placePlant(state, at(2, 2), PlantType.PumpedStorage).rejected).toBe('needsLakeShore');
    expect(placePlant(state, at(8, 8), PlantType.PumpedStorage).rejected).toBe(
      'cannotBuildOnWater',
    );
    expect(placePlant(state, at(8, 7), PlantType.PumpedStorage).rejected).toBeUndefined();
    expect(placePlant(state, at(8, 8), PlantType.SolarFarm).rejected).toBe('cannotBuildOnWater');
  });

  it('census counts hydro plants as supply sources', () => {
    const state = makeState();
    state.layers.terrain[at(5, 5)] = Terrain.River;
    state.layers.terrain[at(8, 8)] = Terrain.Lake;
    placePlant(state, at(5, 5), PlantType.RunOfRiver);
    placePlant(state, at(8, 7), PlantType.PumpedStorage);
    const census = censusPlants(state);
    expect(census.runOfRiverPlants).toBe(1);
    expect(census.pumpedStoragePlants).toBe(1);
  });
});

describe('load profiles', () => {
  it('residential peaks in the evening, commercial during the day', () => {
    const evening = 19.5 / 24;
    const noon = 12 / 24;
    const night = 3 / 24;
    expect(loadProfileFactor(Zone.Residential, evening)).toBeGreaterThan(
      loadProfileFactor(Zone.Residential, noon),
    );
    expect(loadProfileFactor(Zone.Commercial, noon)).toBeGreaterThan(
      loadProfileFactor(Zone.Commercial, evening),
    );
    expect(loadProfileFactor(Zone.Residential, night)).toBeLessThan(0.4);
  });

  it('interpolates smoothly between hours', () => {
    const a = loadProfileFactor(Zone.Residential, 18 / 24);
    const b = loadProfileFactor(Zone.Residential, 18.5 / 24);
    const c = loadProfileFactor(Zone.Residential, 19 / 24);
    expect(b).toBeGreaterThan(Math.min(a, c) - 1e-9);
    expect(b).toBeLessThan(Math.max(a, c) + 1e-9);
  });

  it('building consumption scales with density', () => {
    const noon = 0.5;
    expect(buildingConsumption(Zone.Residential, 3, noon)).toBeGreaterThan(
      buildingConsumption(Zone.Residential, 1, noon),
    );
    expect(buildingConsumption(Zone.None, 1, noon)).toBe(0);
  });
});

describe('energyStep', () => {
  it('solar generates at noon, nothing at night', () => {
    const state = makeState();
    placePlant(state, at(5, 5), PlantType.SolarFarm);
    setNoonClearSky(state);
    energyStep(state, { chargingDemand: 0 });
    expect(state.lastEnergy.solar).toBeCloseTo(BALANCE.energy.solarPeakOutput, 3);
    state.tick = 0; // midnight
    energyStep(state, { chargingDemand: 0 });
    expect(state.lastEnergy.solar).toBe(0);
  });

  it('wind output follows wind speed', () => {
    const state = makeState();
    placePlant(state, at(5, 5), PlantType.WindTurbine);
    state.weather.windSpeed = 0;
    energyStep(state, { chargingDemand: 0 });
    expect(state.lastEnergy.wind).toBe(0);
    state.weather.windSpeed = 1;
    energyStep(state, { chargingDemand: 0 });
    expect(state.lastEnergy.wind).toBeCloseTo(BALANCE.energy.windPeakOutput, 3);
  });

  it('surplus charges the battery first, then curtails', () => {
    const state = makeState();
    placePlant(state, at(5, 5), PlantType.SolarFarm);
    placePlant(state, at(6, 5), PlantType.Battery);
    setNoonClearSky(state);
    energyStep(state, { chargingDemand: 0 });
    const expectedCharge =
      Math.min(BALANCE.energy.solarPeakOutput, BALANCE.energy.batteryPowerLimit) *
      BALANCE.energy.batteryChargeEfficiency;
    expect(state.storedEnergy).toBeCloseTo(expectedCharge, 3);
    // Charge rate is limited; the rest is exported, then curtailed.
    const leftover = BALANCE.energy.solarPeakOutput - BALANCE.energy.batteryPowerLimit;
    expect(state.lastEnergy.gridExport).toBeCloseTo(
      Math.min(leftover, BALANCE.market.exportCapacity),
      3,
    );
    expect(state.lastEnergy.curtailment).toBeCloseTo(
      Math.max(0, leftover - BALANCE.market.exportCapacity),
      3,
    );
  });

  it('with full storage, surplus is exported up to the link capacity', () => {
    const state = makeState();
    placePlant(state, at(5, 5), PlantType.SolarFarm);
    placePlant(state, at(6, 5), PlantType.Battery);
    setNoonClearSky(state);
    state.storedEnergy = BALANCE.energy.batteryCapacity;
    energyStep(state, { chargingDemand: 0 });
    expect(state.lastEnergy.gridExport).toBeCloseTo(
      Math.min(BALANCE.energy.solarPeakOutput, BALANCE.market.exportCapacity),
      3,
    );
    expect(state.lastEnergy.curtailment).toBeCloseTo(
      Math.max(0, BALANCE.energy.solarPeakOutput - BALANCE.market.exportCapacity),
      3,
    );
    expect(state.storedEnergy).toBe(BALANCE.energy.batteryCapacity);
  });

  it('deficit discharges the battery before dispatching biogas', () => {
    const state = makeState();
    placePlant(state, at(5, 5), PlantType.Battery);
    placePlant(state, at(6, 5), PlantType.BiogasPlant);
    addBuilding(state, at(7, 5), Zone.Commercial, 3);
    state.tick = TICKS_PER_DAY / 2; // noon: commercial peak
    state.weather.cloudCover = 1;
    state.weather.windSpeed = 0;
    state.storedEnergy = 100;
    energyStep(state, { chargingDemand: 0 });
    const demand = state.lastEnergy.buildingConsumption;
    const rooftop = state.lastEnergy.rooftop;
    expect(demand).toBeGreaterThan(0);
    expect(state.storedEnergy).toBeCloseTo(100 - (demand - rooftop), 3);
    expect(state.lastEnergy.biogas).toBe(0);
    expect(state.lastEnergy.deficit).toBe(0);
  });

  it('dispatches biogas when the battery is empty', () => {
    const state = makeState();
    placePlant(state, at(6, 5), PlantType.BiogasPlant);
    addBuilding(state, at(7, 5), Zone.Commercial, 3);
    state.tick = TICKS_PER_DAY / 2;
    state.weather.cloudCover = 1;
    state.weather.windSpeed = 0;
    energyStep(state, { chargingDemand: 0 });
    expect(state.lastEnergy.biogas).toBeCloseTo(
      state.lastEnergy.buildingConsumption - state.lastEnergy.rooftop,
      3,
    );
    expect(state.lastEnergy.deficit).toBe(0);
  });

  it('flags undersupply when even imports cannot cover the deficit', () => {
    const state = makeState();
    placePlant(state, at(6, 5), PlantType.WindTurbine); // provides connection
    state.weather.windSpeed = 0; // ...but no output
    const buildings = 20;
    // 7 columns x 3 rows, all strictly north of the plant's row so none
    // land on the plant tile itself, and all within lineSupplyRadius.
    for (let i = 0; i < buildings; i++) {
      addBuilding(state, at(3 + (i % 7), 2 + Math.floor(i / 7)), Zone.Commercial, 3);
    }
    state.tick = TICKS_PER_DAY / 2;
    state.weather.cloudCover = 1;
    energyStep(state, { chargingDemand: 0 });
    // The transmission link imports at its capacity; the rest is deficit.
    expect(state.lastEnergy.gridImport).toBeCloseTo(BALANCE.market.importCapacity, 3);
    expect(state.lastEnergy.deficit).toBeCloseTo(
      state.lastEnergy.buildingConsumption -
        state.lastEnergy.rooftop -
        BALANCE.market.importCapacity,
      3,
    );
    // A majority of connected buildings flicker into undersupply.
    let undersupplied = 0;
    for (let i = 0; i < buildings; i++) {
      const tile = at(3 + (i % 7), 2 + Math.floor(i / 7));
      if (state.layers.supplied[tile] === SupplyStatus.Undersupplied) {
        undersupplied++;
      }
    }
    expect(undersupplied).toBeGreaterThan(buildings / 3);
  });

  it('small deficits are fully covered by (expensive) imports', () => {
    const state = makeState();
    placePlant(state, at(6, 5), PlantType.WindTurbine);
    state.weather.windSpeed = 0;
    addBuilding(state, at(8, 5), Zone.Commercial, 3);
    state.tick = TICKS_PER_DAY / 2;
    state.weather.cloudCover = 1;
    energyStep(state, { chargingDemand: 0 });
    expect(state.lastEnergy.deficit).toBe(0);
    expect(state.lastEnergy.gridImport).toBeGreaterThan(0);
    expect(state.layers.supplied[at(8, 5)]).toBe(SupplyStatus.Supplied);
  });

  it('marks buildings beyond the connection radius of any plant as not connected', () => {
    const state = makeState();
    placePlant(state, at(0, 0), PlantType.WindTurbine);
    const inside = at(BALANCE.energy.lineSupplyRadius, 0);
    const outside = at(BALANCE.energy.lineSupplyRadius + 2, 0);
    addBuilding(state, inside, Zone.Residential, 1);
    addBuilding(state, outside, Zone.Residential, 1);
    state.weather.windSpeed = 1; // plenty of power
    energyStep(state, { chargingDemand: 0 });
    expect(state.layers.supplied[inside]).toBe(SupplyStatus.Supplied);
    expect(state.layers.supplied[outside]).toBe(SupplyStatus.NotConnected);
    // Unconnected buildings do not draw from the grid.
    expect(state.lastEnergy.buildingConsumption).toBeCloseTo(
      buildingConsumption(Zone.Residential, 1, 0),
      3,
    );
  });

  it('drops the supply when the plant is bulldozed', () => {
    const state = makeState();
    placePlant(state, at(5, 5), PlantType.WindTurbine);
    const building = at(6, 5);
    addBuilding(state, building, Zone.Residential, 1);
    state.weather.windSpeed = 1;
    energyStep(state, { chargingDemand: 0 });
    expect(state.layers.supplied[building]).toBe(SupplyStatus.Supplied);
    bulldozeTiles(state, [at(5, 5)]);
    energyStep(state, { chargingDemand: 0 });
    expect(state.layers.supplied[building]).toBe(SupplyStatus.NotConnected);
  });

  it('a power line from the plant connects a distant building', () => {
    const state = makeState();
    placePlant(state, at(0, 0), PlantType.WindTurbine);
    const far = at(12, 0);
    addBuilding(state, far, Zone.Residential, 1);
    state.weather.windSpeed = 1;
    energyStep(state, { chargingDemand: 0 });
    expect(state.layers.supplied[far]).toBe(SupplyStatus.NotConnected);
    state.money = 1e9;
    buildPowerLines(
      state,
      Array.from({ length: 9 }, (_, i) => at(1 + i, 0)),
    ); // x 1..9
    energyStep(state, { chargingDemand: 0 });
    expect(state.layers.supplied[far]).toBe(SupplyStatus.Supplied);
  });

  it('serves charging demand and accounts it separately', () => {
    const state = makeState();
    placePlant(state, at(5, 5), PlantType.WindTurbine);
    state.weather.windSpeed = 1;
    energyStep(state, { chargingDemand: 10 });
    expect(state.lastEnergy.chargingConsumption).toBe(10);
    const surplus = BALANCE.energy.windPeakOutput - 10;
    expect(state.lastEnergy.gridExport).toBeCloseTo(
      Math.min(surplus, BALANCE.market.exportCapacity),
      3,
    );
    expect(state.lastEnergy.curtailment).toBeCloseTo(
      Math.max(0, surplus - BALANCE.market.exportCapacity),
      3,
    );
  });

  it('rooftop PV feeds in from dense connected buildings at noon', () => {
    const state = makeState();
    placePlant(state, at(5, 5), PlantType.WindTurbine); // provides connection
    addBuilding(state, at(7, 5), Zone.Residential, 3);
    addBuilding(state, at(8, 5), Zone.Residential, 1); // no rooftop yet
    setNoonClearSky(state);
    energyStep(state, { chargingDemand: 0 });
    expect(state.lastEnergy.rooftop).toBeCloseTo(BALANCE.energy.rooftopSolarPeakByDensity[3], 3);
    // At night there is no rooftop feed-in.
    state.tick = 0;
    energyStep(state, { chargingDemand: 0 });
    expect(state.lastEnergy.rooftop).toBe(0);
  });

  it('unconnected buildings do not feed rooftop PV into the grid', () => {
    const state = makeState();
    placePlant(state, at(0, 0), PlantType.WindTurbine);
    const outside = at(BALANCE.energy.lineSupplyRadius + 3, 20);
    addBuilding(state, outside, Zone.Residential, 3);
    setNoonClearSky(state);
    energyStep(state, { chargingDemand: 0 });
    expect(state.lastEnergy.rooftop).toBe(0);
  });

  it('records energy history samples', () => {
    const state = makeState();
    placePlant(state, at(5, 5), PlantType.WindTurbine);
    for (let i = 0; i < 200; i++) {
      state.tick++;
      energyStep(state, { chargingDemand: 0 });
    }
    expect(state.energyHistory.length).toBeGreaterThan(0);
    for (const point of state.energyHistory) {
      expect(point.generation).toBeGreaterThanOrEqual(0);
      expect(point.stateOfCharge).toBeGreaterThanOrEqual(0);
      expect(point.stateOfCharge).toBeLessThanOrEqual(1);
    }
  });
});

describe('hydro and pumped storage', () => {
  function riverState(): SimState {
    const state = makeState();
    state.tick = 0; // midnight: no solar
    state.weather.cloudCover = 0;
    state.weather.windSpeed = 0;
    state.layers.terrain[at(5, 5)] = Terrain.River;
    state.layers.terrain[at(8, 8)] = Terrain.Lake;
    return state;
  }

  it('run-of-river generates day and night, scaled by river flow', () => {
    const state = riverState();
    placePlant(state, at(5, 5), PlantType.RunOfRiver);
    state.weather.riverFlow = 1;
    energyStep(state, { chargingDemand: 0 });
    expect(state.lastEnergy.hydro).toBeCloseTo(BALANCE.energy.hydroPeakOutput, 6);
    state.weather.riverFlow = 0;
    energyStep(state, { chargingDemand: 0 });
    expect(state.lastEnergy.hydro).toBeCloseTo(
      BALANCE.energy.hydroPeakOutput * BALANCE.water.minFlowFactor,
      6,
    );
  });

  it('charges batteries before pumped storage and exports the rest', () => {
    const state = riverState();
    placePlant(state, at(5, 5), PlantType.RunOfRiver);
    placePlant(state, at(8, 7), PlantType.PumpedStorage);
    placePlant(state, at(2, 2), PlantType.Battery);
    state.weather.riverFlow = 1;
    state.money = 1e9;
    // Batteries take up to their power limit first.
    energyStep(state, { chargingDemand: 0 });
    const hydro = BALANCE.energy.hydroPeakOutput;
    const batteryTake = Math.min(hydro, BALANCE.energy.batteryPowerLimit);
    expect(state.storedEnergy).toBeCloseTo(batteryTake * BALANCE.energy.batteryChargeEfficiency, 6);
    expect(state.pumpedStorageEnergy).toBeCloseTo(
      (hydro - batteryTake) * BALANCE.energy.pumpedStorageChargeEfficiency,
      6,
    );
    // Fill the battery; the pumped pool absorbs the whole surplus next.
    state.storedEnergy = BALANCE.energy.batteryCapacity;
    const pumpedBefore = state.pumpedStorageEnergy;
    energyStep(state, { chargingDemand: 0 });
    expect(state.pumpedStorageEnergy).toBeCloseTo(
      pumpedBefore + hydro * BALANCE.energy.pumpedStorageChargeEfficiency,
      6,
    );
    expect(state.lastEnergy.gridExport).toBe(0);
    expect(state.lastEnergy.curtailment).toBe(0);
  });

  it('discharges batteries before pumped storage before biogas', () => {
    const state = riverState();
    placePlant(state, at(8, 7), PlantType.PumpedStorage);
    placePlant(state, at(2, 2), PlantType.Battery);
    placePlant(state, at(3, 2), PlantType.BiogasPlant);
    addBuilding(state, at(4, 2), Zone.Commercial, 3);
    state.storedEnergy = 10;
    state.pumpedStorageEnergy = 1_000;
    energyStep(state, { chargingDemand: 300 });
    expect(state.storedEnergy).toBe(0);
    expect(state.pumpedStorageEnergy).toBeLessThan(1_000);
    expect(state.pumpedStorageEnergy).toBeGreaterThanOrEqual(
      1_000 - BALANCE.energy.pumpedStoragePowerLimit,
    );
    expect(state.lastEnergy.biogas).toBeGreaterThan(0);
  });

  it('clamps pumped storage to installed capacity', () => {
    const state = riverState();
    placePlant(state, at(8, 7), PlantType.PumpedStorage);
    state.pumpedStorageEnergy = 1e9;
    energyStep(state, { chargingDemand: 0 });
    expect(state.pumpedStorageEnergy).toBeLessThanOrEqual(BALANCE.energy.pumpedStorageCapacity);
    const noPlants = makeState();
    noPlants.pumpedStorageEnergy = 500;
    energyStep(noPlants, { chargingDemand: 0 });
    expect(noPlants.pumpedStorageEnergy).toBe(0);
  });

  it('history state of charge combines both pools', () => {
    const state = riverState();
    placePlant(state, at(8, 7), PlantType.PumpedStorage);
    placePlant(state, at(2, 2), PlantType.Battery);
    state.storedEnergy = BALANCE.energy.batteryCapacity;
    state.pumpedStorageEnergy = 0;
    state.tick = TICKS_PER_DAY; // multiple of the history sample interval, midnight
    energyStep(state, { chargingDemand: 0 });
    const last = state.energyHistory[state.energyHistory.length - 1];
    const combined =
      state.storedEnergy / (BALANCE.energy.batteryCapacity + BALANCE.energy.pumpedStorageCapacity);
    expect(last.stateOfCharge).toBeCloseTo(combined, 6);
  });
});

describe('heating load', () => {
  const { comfortTemperature, heatingRange, weightByZone, insulationFactor } =
    BALANCE.seasons.heating;
  const base = BALANCE.energy.consumptionByZoneAndDensity[Zone.Residential][2];

  it('is zero above the comfort temperature', () => {
    expect(heatingConsumption(Zone.Residential, 2, comfortTemperature + 1, false)).toBe(0);
  });

  it('reaches the full zone weight at the bottom of the range', () => {
    const cold = comfortTemperature - heatingRange;
    expect(heatingConsumption(Zone.Residential, 2, cold, false)).toBeCloseTo(
      base * weightByZone[Zone.Residential],
      9,
    );
    expect(heatingConsumption(Zone.Commercial, 2, cold, false)).toBeCloseTo(
      BALANCE.energy.consumptionByZoneAndDensity[Zone.Commercial][2] *
        weightByZone[Zone.Commercial],
      9,
    );
  });

  it('is halved by insulation', () => {
    const cold = comfortTemperature - heatingRange;
    const plain = heatingConsumption(Zone.Residential, 3, cold, false);
    expect(heatingConsumption(Zone.Residential, 3, cold, true)).toBeCloseTo(
      plain * insulationFactor,
      9,
    );
  });

  it('is reported separately and counts toward the balance', () => {
    const state = makeState();
    setNoonClearSky(state);
    state.season = { ...state.season, temperature: comfortTemperature - heatingRange };
    placePlant(state, at(5, 5), PlantType.WindTurbine);
    addBuilding(state, at(6, 5), Zone.Residential, 2);
    buildPowerLines(state, [at(6, 6)]);
    energyStep(state, { chargingDemand: 0 });
    const heating = state.lastEnergy.heatingConsumption;
    expect(heating).toBeCloseTo(base * weightByZone[Zone.Residential], 6);
    expect(state.lastEnergy.buildingConsumption).toBeCloseTo(
      buildingConsumption(Zone.Residential, 2, timeOfDay(state.tick)),
      6,
    );
    // The wind turbine produces nothing (windSpeed 0); only rooftop PV
    // generates. The shortfall (buildings + heating - rooftop) is small,
    // so it is fully covered by the (expensive) import link rather than
    // showing up as a deficit — see "small deficits are fully covered by
    // imports" above. This still proves heating counts toward the balance.
    expect(state.lastEnergy.gridImport).toBeCloseTo(
      state.lastEnergy.buildingConsumption + heating - state.lastEnergy.rooftop,
      6,
    );
    expect(state.lastEnergy.deficit).toBe(0);
  });

  it('winter noon PV is weaker than summer noon PV under a clear sky', () => {
    const summer = makeState();
    setNoonClearSky(summer);
    summer.season = { ...summer.season, sunrise: 0.2, sunset: 0.8, solarStrength: 1 };
    placePlant(summer, at(5, 5), PlantType.SolarFarm);
    energyStep(summer, { chargingDemand: 0 });
    const winter = makeState();
    setNoonClearSky(winter);
    winter.season = { ...winter.season, sunrise: 0.3, sunset: 0.7, solarStrength: 0.45 };
    placePlant(winter, at(5, 5), PlantType.SolarFarm);
    energyStep(winter, { chargingDemand: 0 });
    expect(winter.lastEnergy.solar).toBeLessThan(summer.lastEnergy.solar * 0.5);
  });
});

describe('cooling load', () => {
  const { comfortTemperature, coolingRange, weightByZone, insulationFactor } =
    BALANCE.seasons.cooling;
  const base = BALANCE.energy.consumptionByZoneAndDensity[Zone.Residential][2];

  it('is zero below the cooling comfort temperature', () => {
    expect(coolingConsumption(Zone.Residential, 2, comfortTemperature - 1, false)).toBe(0);
  });

  it('reaches the full zone weight at the top of the range', () => {
    const hot = comfortTemperature + coolingRange;
    expect(coolingConsumption(Zone.Residential, 2, hot, false)).toBeCloseTo(
      base * weightByZone[Zone.Residential],
      9,
    );
    expect(coolingConsumption(Zone.Commercial, 2, hot, false)).toBeCloseTo(
      BALANCE.energy.consumptionByZoneAndDensity[Zone.Commercial][2] *
        weightByZone[Zone.Commercial],
      9,
    );
  });

  it('is halved by insulation', () => {
    const hot = comfortTemperature + coolingRange;
    const plain = coolingConsumption(Zone.Residential, 3, hot, false);
    expect(coolingConsumption(Zone.Residential, 3, hot, true)).toBeCloseTo(
      plain * insulationFactor,
      9,
    );
  });

  it('is reported separately and counts toward the balance', () => {
    const state = makeState();
    setNoonClearSky(state);
    state.season = { ...state.season, temperature: comfortTemperature + coolingRange };
    placePlant(state, at(5, 5), PlantType.WindTurbine);
    addBuilding(state, at(6, 5), Zone.Residential, 2);
    buildPowerLines(state, [at(6, 6)]);
    energyStep(state, { chargingDemand: 0 });
    const cooling = state.lastEnergy.coolingConsumption;
    expect(cooling).toBeCloseTo(base * weightByZone[Zone.Residential], 6);
    expect(state.lastEnergy.heatingConsumption).toBe(0);
    // Wind is 0 at noon clear sky; rooftop PV covers part of the load and
    // the small shortfall is imported, so the import equals the unmet
    // (buildings + cooling - rooftop). That proves cooling is in the balance.
    expect(state.lastEnergy.gridImport).toBeCloseTo(
      state.lastEnergy.buildingConsumption + cooling - state.lastEnergy.rooftop,
      6,
    );
    expect(state.lastEnergy.deficit).toBe(0);
  });
});
