/** Tests for the tile inspector data. */
import { describe, expect, it } from 'vitest';
import { BALANCE, TICKS_PER_DAY } from '../shared/constants.ts';
import { tileIndex } from '../shared/grid.ts';
import { economyStep } from './economy.ts';
import { buildingConsumption, placePlant } from './energy.ts';
import { inspectTile } from './inspect.ts';
import { buildPowerLines } from './powerLines.ts';
import { buildRoads, bulldozeTiles } from './roads.ts';
import { createSimState, PlantType, SupplyStatus, Terrain, Zone } from './state.ts';
import { paintZones } from './zones.ts';

const SIZE = 32;
const at = (x: number, y: number) => tileIndex(x, y, SIZE);

/** A residential building of the given density next to a road. */
function cityWithBuilding(density: number) {
  const state = createSimState(7, SIZE);
  buildRoads(state, [at(4, 5), at(5, 5), at(6, 5)]);
  paintZones(state, [at(5, 6)], Zone.Residential);
  state.layers.density[at(5, 6)] = density;
  state.layers.supplied[at(5, 6)] = SupplyStatus.Supplied;
  return state;
}

describe('inspectTile', () => {
  it('returns null outside the grid', () => {
    const state = createSimState(1, SIZE);
    expect(inspectTile(state, -1)).toBeNull();
    expect(inspectTile(state, SIZE * SIZE)).toBeNull();
  });

  it('reports road upkeep per tile', () => {
    const state = createSimState(1, SIZE);
    buildRoads(state, [at(2, 2)]);
    const info = inspectTile(state, at(2, 2))!;
    expect(info.upkeepPerTick).toBeCloseTo(BALANCE.upkeepPerTick.roadPerTile, 9);
    expect(info.consumption).toBe(0);
  });

  it('reports plant upkeep and generation', () => {
    const state = createSimState(1, SIZE);
    placePlant(state, at(10, 10), PlantType.WindTurbine);
    state.weather.windSpeed = 1;
    const info = inspectTile(state, at(10, 10))!;
    expect(info.upkeepPerTick).toBeCloseTo(BALANCE.upkeepPerTick.plant[PlantType.WindTurbine], 9);
    expect(info.generation).toBeGreaterThan(0);
    expect(info.peakGeneration).toBe(BALANCE.energy.windPeakOutput);
  });

  it('a supply plant counts as grid-connected only once a line is attached', () => {
    const state = createSimState(1, SIZE);
    state.money = 1e9;
    placePlant(state, at(10, 10), PlantType.Battery);
    // Standalone: the plant energises its own ring, but nothing ties it
    // to the network, so the inspector must not claim a connection.
    expect(inspectTile(state, at(10, 10))!.connected).toBe(false);

    buildPowerLines(state, [at(11, 10), at(12, 10)]);
    expect(inspectTile(state, at(10, 10))!.connected).toBe(true);

    bulldozeTiles(state, [at(11, 10)]);
    expect(inspectTile(state, at(10, 10))!.connected).toBe(false);
  });

  it('reports the ring a tile projects: plants, hubs, parks and live lines', () => {
    const state = createSimState(1, SIZE);
    state.money = 1e9;
    placePlant(state, at(10, 10), PlantType.WindTurbine);
    placePlant(state, at(20, 10), PlantType.Park);
    placePlant(state, at(20, 20), PlantType.ChargingHub);
    expect(inspectTile(state, at(10, 10))!.ringRadius).toBe(BALANCE.energy.lineSupplyRadius);
    expect(inspectTile(state, at(20, 10))!.ringRadius).toBe(BALANCE.happiness.parkRadius);
    expect(inspectTile(state, at(20, 20))!.ringRadius).toBe(BALANCE.vehicles.hubRadius);
    expect(inspectTile(state, at(5, 5))!.ringRadius).toBe(0);

    // A line fed by the turbine projects the supply ring; a stray one does not.
    buildPowerLines(state, [at(11, 10), at(12, 10)]);
    buildPowerLines(state, [at(25, 25), at(26, 25)]);
    expect(inspectTile(state, at(12, 10))!.ringRadius).toBe(BALANCE.energy.lineSupplyRadius);
    expect(inspectTile(state, at(26, 25))!.ringRadius).toBe(0);
  });

  it('a lot beyond a plant ring connects through an energised line and drops when it is cut', () => {
    const state = createSimState(7, SIZE);
    state.money = 1e9;
    placePlant(state, at(2, 10), PlantType.WindTurbine);
    const road = Array.from({ length: 13 }, (_, i) => at(3 + i, 12));
    buildRoads(state, road);
    paintZones(state, [at(14, 11)], Zone.Residential);
    const lot = at(14, 11);
    state.layers.density[lot] = 1;
    expect(inspectTile(state, lot)!.connected).toBe(false);
    expect(inspectTile(state, lot)!.growthBlockers).toContain('notConnected');

    buildPowerLines(state, [at(3, 10), at(3, 11), ...road]);
    expect(inspectTile(state, lot)!.connected).toBe(true);
    expect(inspectTile(state, lot)!.growthBlockers).not.toContain('notConnected');

    // Cut next to the plant: the rest of the line is dead.
    bulldozeTiles(state, [at(3, 11)]);
    expect(inspectTile(state, lot)!.connected).toBe(false);
  });

  it('splits stored energy across battery tiles', () => {
    const state = createSimState(1, SIZE);
    placePlant(state, at(8, 8), PlantType.Battery);
    placePlant(state, at(9, 9), PlantType.Battery);
    state.storedEnergy = 2_000;
    const info = inspectTile(state, at(8, 8))!;
    expect(info.storedEnergy).toBeCloseTo(1_000, 6);
    expect(info.storageCapacity).toBe(BALANCE.energy.batteryCapacity);
  });

  it('charges biogas fuel cost on the plant tile it is generated by', () => {
    const state = createSimState(1, SIZE);
    placePlant(state, at(12, 12), PlantType.BiogasPlant);
    state.lastEnergy.biogas = 60;
    const info = inspectTile(state, at(12, 12))!;
    expect(info.generation).toBeCloseTo(60, 6);
    expect(info.fuelCostPerTick).toBeCloseTo(
      60 * BALANCE.upkeepPerTick.biogasFuelCostPerEnergyUnit,
      6,
    );
  });

  it('reports building consumption following the load profile', () => {
    const state = cityWithBuilding(2);
    state.tick = TICKS_PER_DAY / 2; // noon
    const info = inspectTile(state, at(5, 6))!;
    expect(info.consumption).toBeCloseTo(buildingConsumption(Zone.Residential, 2, 0.5), 9);
    expect(info.peakConsumption).toBe(
      BALANCE.energy.consumptionByZoneAndDensity[Zone.Residential][2],
    );
    expect(info.loadFactor).toBeGreaterThan(0);
    expect(info.population).toBe(BALANCE.growth.populationByDensity[2]);
    expect(info.upkeepPerTick).toBe(0); // buildings cost no money upkeep
  });

  it('reports the tax a building contributes at the current rate', () => {
    const state = cityWithBuilding(1);
    state.taxRate = 0.2;
    const info = inspectTile(state, at(5, 6))!;
    expect(info.taxPerTick).toBeCloseTo(
      0.2 * BALANCE.growth.populationByDensity[1] * BALANCE.tax.incomePerResident,
      9,
    );
  });

  it('lists why a zoned tile is not growing', () => {
    const state = createSimState(3, SIZE);
    paintZones(state, [at(20, 20)], Zone.Commercial);
    state.lastDemand = { residential: 0, commercial: -0.5, retail: 0 };
    const info = inspectTile(state, at(20, 20))!;
    expect(info.growthBlockers).toContain('noRoad');
    expect(info.growthBlockers).toContain('lowDemand');
    expect(info.demand).toBeCloseTo(-0.5, 6);
  });

  it('reports no blockers for a ready lot and maxDensity at level 3', () => {
    const ready = cityWithBuilding(0);
    ready.lastDemand = { residential: 1, commercial: 1, retail: 1 };
    expect(inspectTile(ready, at(5, 6))!.growthBlockers).toEqual([]);

    const full = cityWithBuilding(3);
    full.lastDemand = { residential: 1, commercial: 1, retail: 1 };
    expect(inspectTile(full, at(5, 6))!.growthBlockers).toContain('maxDensity');
  });

  it('flags water tiles as unbuildable', () => {
    const state = createSimState(1, SIZE);
    state.layers.terrain[at(3, 3)] = Terrain.Lake;
    state.layers.zone[at(3, 3)] = Zone.Retail;
    expect(inspectTile(state, at(3, 3))!.growthBlockers).toContain('notLand');
  });
});

describe('economyStep breakdown by plant type', () => {
  it('splits upkeep and counts per plant type', () => {
    const state = createSimState(1, SIZE);
    placePlant(state, at(4, 4), PlantType.SolarFarm);
    placePlant(state, at(6, 4), PlantType.SolarFarm);
    placePlant(state, at(8, 4), PlantType.WindTurbine);
    buildRoads(state, [at(1, 1), at(2, 1)]);

    const breakdown = economyStep(state, 0, 0);
    expect(breakdown.plantCountByType[PlantType.SolarFarm]).toBe(2);
    expect(breakdown.plantCountByType[PlantType.WindTurbine]).toBe(1);
    expect(breakdown.plantUpkeepByType[PlantType.SolarFarm]).toBeCloseTo(
      2 * BALANCE.upkeepPerTick.plant[PlantType.SolarFarm],
      9,
    );
    expect(breakdown.roadTiles).toBe(2);
    // The split must add up to the total upkeep.
    const summed = Object.values(breakdown.plantUpkeepByType).reduce((a, b) => a + b, 0);
    expect(summed).toBeCloseTo(breakdown.plantUpkeep, 9);
    expect(state.lastEconomy).toBe(breakdown);
  });
});
