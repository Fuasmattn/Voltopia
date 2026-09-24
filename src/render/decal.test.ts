import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { TileDiff } from '../shared/types.ts';
import { composeBoxOnGround, composePrismOnGround } from './decal.ts';
import { ElevationField } from './elevationField.ts';

const SIZE = 6;
const at = (x: number, z: number) => z * SIZE + x;

/** A saddle: two diagonal hills make tile (2,2) genuinely non-planar. */
function saddle(): ElevationField {
  const f = new ElevationField(SIZE);
  const diffs: TileDiff[] = [];
  for (let z = 0; z < SIZE; z++) {
    for (let x = 0; x < SIZE; x++) {
      const level = (x === 2 && z === 2) || (x === 3 && z === 3) ? 3 : 0;
      diffs.push({ index: z * SIZE + x, elevation: level } as TileDiff);
    }
  }
  f.applyDiffs(diffs);
  return f;
}

const thicknessAxis = (m: THREE.Matrix4) =>
  new THREE.Vector3().setFromMatrixColumn(m, 1).normalize();

describe('decals on the ground', () => {
  it('prism bottoms lie exactly on their ground triangle', () => {
    const f = saddle();
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    for (const high of [false, true]) {
      composePrismOnGround(m, f, at(2, 2), high, 0.62, 0.05, 0);
      for (const [lx, lz] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [0.3, 0.3],
      ]) {
        p.set(lx, 0, lz).applyMatrix4(m);
        expect(p.y).toBeCloseTo(f.surfaceY(p.x, p.z), 9);
      }
    }
  });

  it('both prisms of a saddle tile are lit by the smooth ground normal, not their own facet', () => {
    const f = saddle();
    const m = new THREE.Matrix4();
    const low = f.trianglePlane(at(2, 2), false);
    const high = f.trianglePlane(at(2, 2), true);
    const facetLow = new THREE.Vector3(-low.gx, 1, -low.gz).normalize();
    const facetHigh = new THREE.Vector3(-high.gx, 1, -high.gz).normalize();
    expect(facetLow.angleTo(facetHigh)).toBeGreaterThan(0.05); // a real saddle
    composePrismOnGround(m, f, at(2, 2), false, 0.62, 0.05, 0);
    const nLow = thicknessAxis(m);
    composePrismOnGround(m, f, at(2, 2), true, 0.62, 0.05, 0);
    const nHigh = thicknessAxis(m);
    // Much closer to each other than the facets are.
    expect(nLow.angleTo(nHigh)).toBeLessThan(facetLow.angleTo(facetHigh) / 2);
    // And each equals the smooth normal at its own centroid.
    const margin = (1 - 0.62) / 2;
    const cLow = f.smoothNormal(2 + margin + 0.62 / 3, 2 + margin + 0.62 / 3);
    expect(nLow.x).toBeCloseTo(cLow.x, 9);
    expect(nLow.y).toBeCloseTo(cLow.y, 9);
    expect(nLow.z).toBeCloseTo(cLow.z, 9);
  });

  it('a box on the ground uses the smooth normal at its centre and stays on the surface', () => {
    const f = saddle();
    const m = new THREE.Matrix4();
    composeBoxOnGround(m, f, at(2, 2), 2.5, 2.15, 0.62, 0.05, 0.19, 0);
    const n = thicknessAxis(m);
    const s = f.smoothNormal(2.5, 2.15);
    expect(n.x).toBeCloseTo(s.x, 9);
    expect(n.y).toBeCloseTo(s.y, 9);
    expect(n.z).toBeCloseTo(s.z, 9);
    // The box bottom centre sits on the ground (unit box is centred on its origin).
    const p = new THREE.Vector3(0, -0.5, 0).applyMatrix4(m);
    expect(p.y).toBeCloseTo(f.surfaceY(p.x, p.z), 6);
  });
});
