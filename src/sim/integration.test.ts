import { describe, expect, it } from 'vitest';
import { TICKS_PER_DAY } from '../shared/constants.ts';
import { tileIndex } from '../shared/grid.ts';
import { PlantType, SupplyStatus, Zone } from '../shared/types.ts';
import { SimEngine } from './engine.ts';

const SIZE = 32;
const at = (x: number, y: number) => tileIndex(x, y, SIZE);

/**
 * Plays a small city for several in-game days: roads, zones, solar +
 * wind + battery + biogas. Verifies the systems work together.
 */
describe('full gameplay integration', () => {
  it('grows a powered city and balances energy over days', () => {
    const engine = new SimEngine(1234, SIZE);
    const state = engine.state;

    // Main street with residential north, commercial/retail south.
    const road = Array.from({ length: 16 }, (_, x) => at(x + 4, 10));
    engine.applyCommand({ type: 'buildRoad', tiles: road });
    const residential: number[] = [];
    const commercial: number[] = [];
    const retail: number[] = [];
    for (let x = 4; x < 20; x++) {
      residential.push(at(x, 9), at(x, 8));
      if (x < 12) commercial.push(at(x, 11));
      else retail.push(at(x, 11));
    }
    engine.applyCommand({ type: 'paintZone', tiles: residential, zone: Zone.Residential });
    engine.applyCommand({ type: 'paintZone', tiles: commercial, zone: Zone.Commercial });
    engine.applyCommand({ type: 'paintZone', tiles: retail, zone: Zone.Retail });

    // Renewable park nearby: everything within the supply radius.
    engine.applyCommand({ type: 'placePlant', tile: at(10, 13), plant: PlantType.SolarFarm });
    engine.applyCommand({ type: 'placePlant', tile: at(12, 13), plant: PlantType.SolarFarm });
    engine.applyCommand({ type: 'placePlant', tile: at(14, 13), plant: PlantType.WindTurbine });
    engine.applyCommand({ type: 'placePlant', tile: at(16, 13), plant: PlantType.Battery });
    engine.applyCommand({ type: 'placePlant', tile: at(18, 13), plant: PlantType.BiogasPlant });

    let sawStorageCharge = false;
    let sawSolar = false;
    for (let i = 0; i < TICKS_PER_DAY * 4; i++) {
      engine.tick();
      if (state.storedEnergy > 1) sawStorageCharge = true;
      if (state.lastEnergy.solar > 0) sawSolar = true;
    }

    // The city grew a real population and jobs.
    const stats = engine.tick();
    if (stats.type !== 'tick') throw new Error('expected tick event');
    expect(stats.stats.population).toBeGreaterThan(50);
    expect(stats.stats.jobs).toBeGreaterThan(20);

    // Energy systems were exercised.
    expect(sawSolar).toBe(true);
    expect(sawStorageCharge).toBe(true);
    expect(stats.stats.energy.history.length).toBeGreaterThan(10);

    // Buildings are connected and (mostly) supplied.
    let supplied = 0;
    let buildings = 0;
    for (let i = 0; i < SIZE * SIZE; i++) {
      if (state.layers.density[i] > 0) {
        buildings++;
        if (state.layers.supplied[i] === SupplyStatus.Supplied) supplied++;
      }
    }
    expect(buildings).toBeGreaterThan(10);
    expect(supplied / buildings).toBeGreaterThan(0.6);

    // Happiness stays livable in a powered city.
    expect(stats.stats.happiness).toBeGreaterThan(0.5);
  });

  it('an unpowered city stalls: unhappy, no densification', () => {
    const engine = new SimEngine(99, SIZE);
    engine.applyCommand({
      type: 'buildRoad',
      tiles: Array.from({ length: 10 }, (_, x) => at(x + 4, 10)),
    });
    engine.applyCommand({
      type: 'paintZone',
      tiles: Array.from({ length: 10 }, (_, x) => at(x + 4, 9)),
      zone: Zone.Residential,
    });
    for (let i = 0; i < TICKS_PER_DAY * 2; i++) engine.tick();
    const event = engine.tick();
    if (event.type !== 'tick') throw new Error('expected tick event');
    // Some pioneers may settle, but the city cannot become happy.
    expect(event.stats.happiness).toBeLessThan(0.5);
  });
});

describe('lifetime statistics', () => {
  it('records one sample per day and survives save/load', () => {
    const engine = new SimEngine(7, SIZE);
    engine.applyCommand({
      type: 'buildRoad',
      tiles: Array.from({ length: 10 }, (_, x) => at(x + 4, 10)),
    });
    engine.applyCommand({
      type: 'paintZone',
      tiles: Array.from({ length: 10 }, (_, x) => at(x + 4, 9)),
      zone: Zone.Residential,
    });
    engine.applyCommand({ type: 'placePlant', tile: at(8, 12), plant: PlantType.WindTurbine });
    for (let i = 0; i < TICKS_PER_DAY * 3; i++) engine.tick();

    const samples = engine.state.lifetime.samples;
    expect(samples.length).toBe(3);
    expect(samples[0].day).toBe(0);
    expect(samples[2].population).toBeGreaterThan(0);
    expect(samples[2].avgGeneration).toBeGreaterThan(0);

    // Round trip through a save keeps the history.
    const events = engine.applyCommand({ type: 'requestSave' });
    const save = events[0].type === 'saveData' ? events[0].save : null;
    expect(save?.lifetime?.length).toBe(3);
    const restored = new SimEngine(0, 4);
    restored.applyCommand({ type: 'init', seed: 7, size: SIZE, save: save! });
    expect(restored.state.lifetime.samples.length).toBe(3);

    // The lifetime request returns the samples.
    const lifetimeEvents = restored.applyCommand({ type: 'requestLifetime' });
    expect(lifetimeEvents[0].type).toBe('lifetimeData');
    if (lifetimeEvents[0].type === 'lifetimeData') {
      expect(lifetimeEvents[0].samples.length).toBe(3);
    }
  });
});
