import { describe, expect, it } from 'vitest';
import { BALANCE } from '../shared/constants.ts';
import { Terrain } from '../shared/types.ts';
import { createSimState, type SimState } from './state.ts';
import { generateTerrain } from './terrain.ts';
import { generateWater } from './water.ts';

/** A generated map: elevation and water (river, lake, sea) but no zoning. */
function generatedState(seed: number, size: number): SimState {
  const state = createSimState(seed, size);
  generateTerrain(state);
  generateWater(state);
  return state;
}

/** Sea tiles of a state. */
function seaTiles(state: SimState): number[] {
  const out: number[] = [];
  for (let i = 0; i < state.layers.terrain.length; i++) {
    if (state.layers.terrain[i] === Terrain.Sea) out.push(i);
  }
  return out;
}

describe('sea generation', () => {
  it('puts sea on exactly one map edge', () => {
    for (const seed of [1, 2, 3, 7, 42]) {
      const state = generatedState(seed, 64);
      const { terrain } = state.layers;
      const size = state.size;
      const edges = [0, 1, 2, 3].map((edge) => {
        let count = 0;
        for (let i = 0; i < size; i++) {
          const index =
            edge === 0
              ? i // top row
              : edge === 1
                ? (size - 1) * size + i // bottom row
                : edge === 2
                  ? i * size // left column
                  : i * size + size - 1; // right column
          if (terrain[index] === Terrain.Sea) count++;
        }
        return count;
      });
      // Exactly one edge is fully sea; the two perpendicular edges are only
      // clipped at their ends, so they never reach a full row.
      expect(edges.filter((count) => count === size)).toHaveLength(1);
    }
  });

  it('keeps the sea within its depth range and size cap', () => {
    const cfg = BALANCE.sea;
    for (const seed of [1, 5, 9, 23]) {
      const state = generatedState(seed, 64);
      const tiles = seaTiles(state);
      expect(tiles.length).toBeGreaterThan(0);
      expect(tiles.length / (state.size * state.size)).toBeLessThanOrEqual(cfg.maxSeaFraction);
      // Every sea tile sits at sea level.
      for (const index of tiles) expect(state.layers.elevation[index]).toBe(0);
    }
  });

  it('lets the river reach the sea', () => {
    for (const seed of [1, 2, 3, 7, 42]) {
      const state = generatedState(seed, 64);
      const { terrain } = state.layers;
      const size = state.size;
      let touching = 0;
      for (let i = 0; i < terrain.length; i++) {
        if (terrain[i] !== Terrain.River) continue;
        const x = i % size;
        const y = Math.floor(i / size);
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          if (terrain[ny * size + nx] === Terrain.Sea) touching++;
        }
      }
      expect(touching).toBeGreaterThan(0);
    }
  });

  it('is deterministic per seed and varies across seeds', () => {
    const a = seaTiles(generatedState(11, 64));
    const b = seaTiles(generatedState(11, 64));
    const c = seaTiles(generatedState(12, 64));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
});
