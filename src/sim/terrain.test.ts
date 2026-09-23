import { describe, expect, it } from 'vitest';
import { BALANCE } from '../shared/constants.ts';
import { createSimState } from './state.ts';
import { generateTerrain } from './terrain.ts';

const SIZES = [48, 64, 96];

function buildableFraction(elevation: Uint8Array, size: number): number {
  let ok = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const level = elevation[y * size + x];
      let slope = 0;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        slope = Math.max(slope, Math.abs(level - elevation[ny * size + nx]));
      }
      if (slope <= BALANCE.terrain.maxBuildSlope) ok++;
    }
  }
  return ok / (size * size);
}

describe('generateTerrain', () => {
  it('is deterministic per seed and differs between seeds', () => {
    const a = createSimState(42, 64);
    const b = createSimState(42, 64);
    const c = createSimState(43, 64);
    generateTerrain(a);
    generateTerrain(b);
    generateTerrain(c);
    expect([...a.layers.elevation]).toEqual([...b.layers.elevation]);
    expect([...a.layers.elevation]).not.toEqual([...c.layers.elevation]);
  });

  it('stays within 0..maxLevel and uses more than one level', () => {
    for (const seed of [1, 7, 99]) {
      const state = createSimState(seed, 64);
      generateTerrain(state);
      const levels = new Set(state.layers.elevation);
      expect(Math.max(...levels)).toBeLessThanOrEqual(BALANCE.terrain.maxLevel);
      expect(levels.size).toBeGreaterThan(2);
    }
  });

  it('keeps enough buildable land on every map size', () => {
    for (const size of SIZES) {
      for (const seed of [1, 2, 3]) {
        const state = createSimState(seed, size);
        generateTerrain(state);
        expect(buildableFraction(state.layers.elevation, size)).toBeGreaterThanOrEqual(
          BALANCE.terrain.minBuildableFraction,
        );
      }
    }
  });

  it('marks raised tiles dirty', () => {
    const state = createSimState(5, 48);
    generateTerrain(state);
    for (let i = 0; i < state.layers.elevation.length; i++) {
      if (state.layers.elevation[i] > 0) expect(state.dirty.has(i)).toBe(true);
    }
  });
});
