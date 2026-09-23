import { describe, expect, it } from 'vitest';
import { LINE_PRESENT } from '../shared/grid.ts';
import { buildRoads } from '../sim/roads.ts';
import { createSimState, serializeState } from '../sim/state.ts';
import { SAVE_VERSION } from '../shared/constants.ts';
import type { SaveGame } from '../shared/types.ts';
import { saveFromJson, saveToJson } from './serialization.ts';

/** Build a minimal, valid save game for size 4 to use as a test fixture. */
function makeSave(): SaveGame {
  const size = 4;
  const bytes = size * size;
  return {
    version: SAVE_VERSION,
    seed: 1,
    size,
    tick: 0,
    money: 0,
    taxRate: 0.1,
    smartCharging: false,
    storedEnergy: 0,
    layers: {
      tileType: new Uint8Array(bytes).buffer as ArrayBuffer,
      roadMask: new Uint8Array(bytes).buffer as ArrayBuffer,
      zone: new Uint8Array(bytes).buffer as ArrayBuffer,
      density: new Uint8Array(bytes).buffer as ArrayBuffer,
      variant: new Uint8Array(bytes).buffer as ArrayBuffer,
      supplied: new Uint8Array(bytes).buffer as ArrayBuffer,
      plantType: new Uint8Array(bytes).buffer as ArrayBuffer,
    },
  };
}

describe('save game JSON export/import', () => {
  it('round-trips a save game', () => {
    const state = createSimState(77, 16);
    buildRoads(state, [1, 2, 3]);
    state.goalsAchieved.add('firstPower');
    const save = serializeState(state);

    const restored = saveFromJson(saveToJson(save));
    expect(restored.seed).toBe(save.seed);
    expect(restored.tick).toBe(save.tick);
    expect(restored.money).toBe(save.money);
    expect(restored.goals).toEqual(['firstPower']);
    expect(new Uint8Array(restored.layers.tileType)).toEqual(new Uint8Array(save.layers.tileType));
  });

  it('rejects malformed input', () => {
    expect(() => saveFromJson('{}')).toThrow();
    expect(() => saveFromJson('not json')).toThrow();
  });

  it('rejects saves with truncated layers', () => {
    const state = createSimState(1, 8);
    const json = JSON.parse(saveToJson(serializeState(state)));
    json.layers.zone = 'AAAA';
    expect(() => saveFromJson(JSON.stringify(json))).toThrow(/wrong size/);
  });

  it('round-trips the optional terrain layer, river flow and pumped storage', () => {
    const save = makeSave();
    save.layers.terrain = new Uint8Array(save.size * save.size).fill(1).buffer as ArrayBuffer;
    save.riverFlow = 0.6;
    save.pumpedStorageEnergy = 42;
    const restored = saveFromJson(saveToJson(save));
    expect(new Uint8Array(restored.layers.terrain!)).toEqual(new Uint8Array(save.layers.terrain));
    expect(restored.riverFlow).toBe(0.6);
    expect(restored.pumpedStorageEnergy).toBe(42);
  });

  it('accepts exports without the terrain layer', () => {
    const save = makeSave();
    const restored = saveFromJson(saveToJson(save));
    expect(restored.layers.terrain).toBeUndefined();
  });

  it('round-trips the optional power line layer', () => {
    const save = makeSave();
    save.layers.powerLine = new Uint8Array(save.size * save.size).fill(LINE_PRESENT)
      .buffer as ArrayBuffer;
    const restored = saveFromJson(saveToJson(save));
    expect(new Uint8Array(restored.layers.powerLine!)).toEqual(
      new Uint8Array(save.layers.powerLine),
    );
  });

  it('accepts exports without the power line layer', () => {
    const restored = saveFromJson(saveToJson(makeSave()));
    expect(restored.layers.powerLine).toBeUndefined();
  });

  it('rejects a wrongly sized power line layer', () => {
    const save = makeSave();
    save.layers.powerLine = new Uint8Array(3).buffer as ArrayBuffer;
    expect(() => saveFromJson(saveToJson(save))).toThrow(/powerLine/);
  });

  it('round-trips season origin, snowpack and insulation', () => {
    const save = makeSave();
    save.seasonOriginDay = 9;
    save.snowpack = 0.25;
    save.insulation = true;
    const restored = saveFromJson(saveToJson(save));
    expect(restored.seasonOriginDay).toBe(9);
    expect(restored.snowpack).toBe(0.25);
    expect(restored.insulation).toBe(true);
  });

  it('accepts exports without season fields', () => {
    const restored = saveFromJson(saveToJson(makeSave()));
    expect(restored.seasonOriginDay).toBeUndefined();
    expect(restored.snowpack).toBeUndefined();
    expect(restored.insulation).toBeUndefined();
  });
});
