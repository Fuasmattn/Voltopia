import { describe, expect, it } from 'vitest';
import { buildRoads } from '../sim/roads.ts';
import { createSimState, serializeState } from '../sim/state.ts';
import { saveFromJson, saveToJson } from './serialization.ts';

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
    expect(new Uint8Array(restored.layers.tileType)).toEqual(
      new Uint8Array(save.layers.tileType),
    );
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
});
