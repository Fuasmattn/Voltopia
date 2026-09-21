import { describe, expect, it } from 'vitest';
import {
  chebyshevDistance,
  DIR_E,
  DIR_N,
  DIR_S,
  DIR_W,
  inBounds,
  lShapedPath,
  neighbors4,
  tileIndex,
  tileX,
  tileY,
} from './grid.ts';

describe('grid math', () => {
  it('converts between index and coordinates', () => {
    const size = 64;
    expect(tileIndex(0, 0, size)).toBe(0);
    expect(tileIndex(3, 2, size)).toBe(131);
    expect(tileX(131, size)).toBe(3);
    expect(tileY(131, size)).toBe(2);
  });

  it('checks bounds', () => {
    expect(inBounds(0, 0, 4)).toBe(true);
    expect(inBounds(3, 3, 4)).toBe(true);
    expect(inBounds(4, 0, 4)).toBe(false);
    expect(inBounds(0, -1, 4)).toBe(false);
  });

  it('direction bits are distinct powers of two', () => {
    expect(new Set([DIR_N, DIR_E, DIR_S, DIR_W]).size).toBe(4);
    expect(DIR_N | DIR_E | DIR_S | DIR_W).toBe(15);
  });

  it('finds 4-neighbors inside the grid', () => {
    const size = 4;
    // corner tile (0,0): only east and south neighbors
    expect(neighbors4(tileIndex(0, 0, size), size).sort((a, b) => a - b)).toEqual([
      tileIndex(1, 0, size),
      tileIndex(0, 1, size),
    ].sort((a, b) => a - b));
    // center tile: all four
    expect(neighbors4(tileIndex(1, 1, size), size)).toHaveLength(4);
  });

  describe('lShapedPath', () => {
    const size = 16;

    it('draws a horizontal line', () => {
      expect(lShapedPath(2, 5, 5, 5, size)).toEqual([
        tileIndex(2, 5, size),
        tileIndex(3, 5, size),
        tileIndex(4, 5, size),
        tileIndex(5, 5, size),
      ]);
    });

    it('draws a vertical line', () => {
      expect(lShapedPath(3, 2, 3, 4, size)).toEqual([
        tileIndex(3, 2, size),
        tileIndex(3, 3, size),
        tileIndex(3, 4, size),
      ]);
    });

    it('draws an L with the horizontal leg first', () => {
      expect(lShapedPath(0, 0, 2, 2, size)).toEqual([
        tileIndex(0, 0, size),
        tileIndex(1, 0, size),
        tileIndex(2, 0, size),
        tileIndex(2, 1, size),
        tileIndex(2, 2, size),
      ]);
    });

    it('handles negative directions', () => {
      expect(lShapedPath(2, 2, 0, 0, size)).toEqual([
        tileIndex(2, 2, size),
        tileIndex(1, 2, size),
        tileIndex(0, 2, size),
        tileIndex(0, 1, size),
        tileIndex(0, 0, size),
      ]);
    });

    it('returns a single tile when start equals end', () => {
      expect(lShapedPath(4, 4, 4, 4, size)).toEqual([tileIndex(4, 4, size)]);
    });
  });

  it('computes Chebyshev distance', () => {
    const size = 16;
    const a = tileIndex(2, 3, size);
    expect(chebyshevDistance(a, tileIndex(2, 3, size), size)).toBe(0);
    expect(chebyshevDistance(a, tileIndex(5, 4, size), size)).toBe(3);
    expect(chebyshevDistance(a, tileIndex(1, 8, size), size)).toBe(5);
  });
});
