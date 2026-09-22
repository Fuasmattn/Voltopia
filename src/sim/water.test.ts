import { describe, expect, it } from 'vitest';
import { neighbors4, tileIndex, tileX, tileY } from '../shared/grid.ts';
import { Terrain } from '../shared/types.ts';
import { MAP_SIZES } from '../ui/newGame.ts';
import { createSimState, type SimState } from './state.ts';
import { generateWater } from './water.ts';

function isWater(state: SimState, index: number): boolean {
  return state.layers.terrain[index] !== Terrain.Land;
}

/** Tiles reachable from `start` through water tiles (4-connectivity). */
function floodWater(state: SimState, start: number): Set<number> {
  const seen = new Set<number>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const index = queue.pop()!;
    for (const n of neighbors4(index, state.size)) {
      if (!seen.has(n) && isWater(state, n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return seen;
}

function edgeWaterTiles(state: SimState): { a: number[]; b: number[] } {
  const { size } = state;
  const north: number[] = [];
  const south: number[] = [];
  const west: number[] = [];
  const east: number[] = [];
  for (let i = 0; i < size; i++) {
    if (isWater(state, tileIndex(i, 0, size))) north.push(tileIndex(i, 0, size));
    if (isWater(state, tileIndex(i, size - 1, size))) south.push(tileIndex(i, size - 1, size));
    if (isWater(state, tileIndex(0, i, size))) west.push(tileIndex(0, i, size));
    if (isWater(state, tileIndex(size - 1, i, size))) east.push(tileIndex(size - 1, i, size));
  }
  return north.length > 0 ? { a: north, b: south } : { a: west, b: east };
}

const SEEDS = Array.from({ length: 25 }, (_, i) => i * 7919 + 1);

describe('generateWater', () => {
  for (const size of MAP_SIZES) {
    describe(`size ${size}`, () => {
      it('river connects two opposite edges', () => {
        for (const seed of SEEDS) {
          const state = createSimState(seed, size);
          generateWater(state);
          const { a, b } = edgeWaterTiles(state);
          expect(a.length, `seed ${seed} entry`).toBeGreaterThan(0);
          expect(b.length, `seed ${seed} exit`).toBeGreaterThan(0);
          const reachable = floodWater(state, a[0]);
          expect(
            b.some((tile) => reachable.has(tile)),
            `seed ${seed} connected`,
          ).toBe(true);
        }
      });

      it('has one lake that touches the river and stays away from the centre', () => {
        for (const seed of SEEDS) {
          const state = createSimState(seed, size);
          generateWater(state);
          const lake: number[] = [];
          for (let i = 0; i < size * size; i++) {
            if (state.layers.terrain[i] === Terrain.Lake) lake.push(i);
          }
          expect(lake.length, `seed ${seed} lake size`).toBeGreaterThan(12);
          const touchesRiver = lake.some((tile) =>
            neighbors4(tile, size).some((n) => state.layers.terrain[n] === Terrain.River),
          );
          expect(touchesRiver, `seed ${seed} lake on river`).toBe(true);
          const centre = size / 2;
          const clearance = size / 4 - 5;
          for (const tile of lake) {
            const d = Math.max(
              Math.abs(tileX(tile, size) - centre),
              Math.abs(tileY(tile, size) - centre),
            );
            expect(d, `seed ${seed} lake near centre`).toBeGreaterThanOrEqual(clearance);
          }
        }
      });

      it('is deterministic per seed and differs between seeds', () => {
        const a = createSimState(11, size);
        const b = createSimState(11, size);
        const c = createSimState(12, size);
        generateWater(a);
        generateWater(b);
        generateWater(c);
        expect(a.layers.terrain).toEqual(b.layers.terrain);
        expect(a.layers.terrain).not.toEqual(c.layers.terrain);
      });

      it('marks every water tile dirty and leaves the main rng untouched', () => {
        const state = createSimState(3, size);
        const rngBefore = state.rng.getState();
        generateWater(state);
        expect(state.rng.getState()).toBe(rngBefore);
        for (let i = 0; i < size * size; i++) {
          if (isWater(state, i)) expect(state.dirty.has(i)).toBe(true);
        }
      });
    });
  }
});
