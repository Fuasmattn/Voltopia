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

const at = (x: number, z: number) => z * SIZE + x;

describe('ElevationField ground triangles', () => {
  it('is flat with zero slopes on level ground', () => {
    const f = field(() => 2);
    expect(f.trianglePlane(at(2, 2), false)).toEqual({ gx: 0, gz: 0 });
    expect(f.trianglePlane(at(2, 2), true)).toEqual({ gx: 0, gz: 0 });
    expect(f.surfaceY(2.5, 2.5)).toBeCloseTo(2 * LEVEL_HEIGHT, 9);
  });

  it('both triangles share the plane of a uniform ramp', () => {
    const f = field((x) => x);
    const low = f.trianglePlane(at(2, 2), false);
    const high = f.trianglePlane(at(2, 2), true);
    expect(low.gx).toBeCloseTo(LEVEL_HEIGHT, 9);
    expect(low.gz).toBeCloseTo(0, 9);
    expect(high).toEqual(low);
    expect(f.surfaceY(2.5, 2.5)).toBeCloseTo(2 * LEVEL_HEIGHT, 9);
  });

  it('surfaceY interpolates each triangle exactly through its three corners', () => {
    // A saddle: two diagonal neighbours are hills, so the tile between
    // them has one high corner and the two triangles are different planes.
    const f = field((x, z) => ((x === 2 && z === 2) || (x === 3 && z === 3) ? 3 : 0));
    const index = at(2, 2);
    const c00 = f.cornerY(2, 2);
    const c10 = f.cornerY(3, 2);
    const c01 = f.cornerY(2, 3);
    const c11 = f.cornerY(3, 3);
    expect(c00 + c11).not.toBeCloseTo(c10 + c01, 6); // genuinely non-planar
    expect(f.surfaceY(2, 2)).toBeCloseTo(c00, 9);
    expect(f.surfaceY(3 - 1e-9, 2)).toBeCloseTo(c10, 6);
    expect(f.surfaceY(2, 3 - 1e-9)).toBeCloseTo(c01, 6);
    expect(f.surfaceY(3 - 1e-9, 3 - 1e-9)).toBeCloseTo(c11, 6);
    // The crease from (2,3) to (3,2) is shared by both triangles.
    const low = f.trianglePlane(index, false);
    const high = f.trianglePlane(index, true);
    const onCreaseLow = c00 + low.gx * 0.5 + low.gz * 0.5;
    const onCreaseHigh = c11 - high.gx * 0.5 - high.gz * 0.5;
    expect(onCreaseLow).toBeCloseTo(onCreaseHigh, 9);
    expect(f.surfaceY(2.5, 2.5)).toBeCloseTo(onCreaseLow, 9);
  });

  it('a rectangle inside one triangle lies flush when fitted to that plane', () => {
    const f = field((x, z) => ((x === 2 && z === 2) || (x === 3 && z === 3) ? 3 : 0));
    const index = at(2, 2);
    // East road arm: x in [2.81, 3], z in [2.19, 2.81] — inside the high triangle.
    const { gx, gz } = f.trianglePlane(index, true);
    const cx = 2.905;
    const cz = 2.5;
    const centre = f.surfaceY(cx, cz);
    for (const [dx, dz] of [
      [-0.095, -0.31],
      [0.095, -0.31],
      [-0.095, 0.31],
      [0.095, 0.31],
    ]) {
      expect(centre + gx * dx + gz * dz).toBeCloseTo(f.surfaceY(cx + dx, cz + dz), 9);
    }
  });

  it('classifies points against the crease', () => {
    expect(ElevationField.inHighTriangle(0.2, 0.2)).toBe(false);
    expect(ElevationField.inHighTriangle(0.8, 0.8)).toBe(true);
    expect(ElevationField.inHighTriangle(0.5, 0.5)).toBe(false); // on the crease counts as low
  });
});
