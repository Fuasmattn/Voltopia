import { describe, expect, it } from 'vitest';
import type { TileDiff } from '../shared/types.ts';
import { ElevationField, LEVEL_HEIGHT } from './elevationField.ts';

const SIZE = 6;

/** A field where every tile's level comes from `levelOf(x, z)`. */
function field(levelOf: (x: number, z: number) => number): ElevationField {
  const f = new ElevationField(SIZE);
  const diffs: TileDiff[] = [];
  for (let z = 0; z < SIZE; z++) {
    for (let x = 0; x < SIZE; x++) {
      diffs.push({ index: z * SIZE + x, elevation: levelOf(x, z) } as TileDiff);
    }
  }
  f.applyDiffs(diffs);
  return f;
}

describe('ElevationField.tileSlope', () => {
  it('is zero on flat ground', () => {
    const f = field(() => 2);
    expect(f.tileSlope(2 * SIZE + 2)).toEqual({ gx: 0, gz: 0 });
    expect(f.surfaceY(2.5, 2.5)).toBeCloseTo(2 * LEVEL_HEIGHT, 9);
  });

  it('follows a ramp along x with one level per tile', () => {
    const f = field((x) => x);
    const { gx, gz } = f.tileSlope(2 * SIZE + 2); // interior tile
    expect(gx).toBeCloseTo(LEVEL_HEIGHT, 9);
    expect(gz).toBeCloseTo(0, 9);
    // The plane through the corners passes through the tile centre height.
    expect(f.surfaceY(2.5, 2.5)).toBeCloseTo(2 * LEVEL_HEIGHT, 9);
  });

  it('follows a ramp along z and reports both components on a diagonal', () => {
    const alongZ = field((_x, z) => z);
    expect(alongZ.tileSlope(2 * SIZE + 2).gz).toBeCloseTo(LEVEL_HEIGHT, 9);
    expect(alongZ.tileSlope(2 * SIZE + 2).gx).toBeCloseTo(0, 9);
    const diagonal = field((x, z) => x + z);
    const { gx, gz } = diagonal.tileSlope(2 * SIZE + 2);
    expect(gx).toBeCloseTo(LEVEL_HEIGHT, 9);
    expect(gz).toBeCloseTo(LEVEL_HEIGHT, 9);
  });

  it('a decal on the slope plane meets the ground at every corner of a uniform ramp', () => {
    const f = field((x) => x);
    const index = 2 * SIZE + 2;
    const { gx, gz } = f.tileSlope(index);
    const centre = f.surfaceY(2.5, 2.5);
    for (const [dx, dz] of [
      [-0.5, -0.5],
      [0.5, -0.5],
      [-0.5, 0.5],
      [0.5, 0.5],
    ]) {
      const onPlane = centre + gx * dx + gz * dz;
      expect(onPlane).toBeCloseTo(f.surfaceY(2.5 + dx, 2.5 + dz), 9);
    }
  });
});
