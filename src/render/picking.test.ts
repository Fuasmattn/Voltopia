import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { TileDiff } from '../shared/types.ts';
import { ElevationField, LEVEL_HEIGHT } from './elevationField.ts';
import { groundPointAtNdc, pickTile, raycastGround } from './picking.ts';

const SIZE = 8;

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

const down = new THREE.Vector3(0, -1, 0);

describe('raycastGround', () => {
  it('hits flat ground exactly under a vertical ray', () => {
    const f = field(() => 0);
    const ray = new THREE.Ray(new THREE.Vector3(2.3, 5, 2.4), down);
    const hit = raycastGround(ray, f);
    expect(hit).not.toBeNull();
    expect(hit!.x).toBeCloseTo(2.3, 9);
    expect(hit!.y).toBeCloseTo(0, 9);
    expect(hit!.z).toBeCloseTo(2.4, 9);
  });

  it('lands on the ground surface of a hill tile', () => {
    const f = field((x, z) => (x >= 4 && z >= 4 ? 4 : 0));
    const ray = new THREE.Ray(new THREE.Vector3(5.5, 10, 5.5), down);
    const hit = raycastGround(ray, f);
    expect(hit).not.toBeNull();
    expect(hit!.y).toBeCloseTo(f.surfaceY(hit!.x, hit!.z), 9);
    expect(hit!.y).toBeCloseTo(4 * LEVEL_HEIGHT, 9);
  });

  it('a shallow ray hits the hillside before the flat-plane point', () => {
    // Flat land, then a plateau from x=5 on. A shallow ray toward +x
    // would only reach y=0 at x=10 (outside the grid — flat-plane picking
    // finds nothing), but the hill face between x=4 and x=5 stops it.
    const f = field((x) => (x >= 5 ? 5 : 0));
    const direction = new THREE.Vector3(1, -0.1, 0).normalize();
    const ray = new THREE.Ray(new THREE.Vector3(0, 1, 3.5), direction);
    const hit = raycastGround(ray, f);
    expect(hit).not.toBeNull();
    expect(hit!.x).toBeGreaterThan(4);
    expect(hit!.x).toBeLessThan(5);
    expect(hit!.y).toBeCloseTo(f.surfaceY(hit!.x, hit!.z), 9);
  });

  it('walks through a valley without sticking to the first tile', () => {
    // Peaks at both ends, flat valley between: a shallow ray entering over
    // the near peak must land in the valley, not on the entry tile.
    const f = field((x) => (x <= 1 || x >= 7 ? 2 : 0));
    const direction = new THREE.Vector3(1, -0.2, 0).normalize();
    const ray = new THREE.Ray(new THREE.Vector3(-1, 1.5, 3.5), direction);
    const hit = raycastGround(ray, f);
    expect(hit).not.toBeNull();
    expect(hit!.x).toBeGreaterThan(2);
    expect(hit!.x).toBeLessThan(7);
    expect(hit!.y).toBeCloseTo(f.surfaceY(hit!.x, hit!.z), 9);
  });

  it('returns null for a ray that misses the grid entirely', () => {
    const f = field(() => 1);
    const ray = new THREE.Ray(new THREE.Vector3(20, 5, 20), down);
    expect(raycastGround(ray, f)).toBeNull();
  });

  it('picks the saddle tile surface, matching surfaceY on both triangles', () => {
    const f = field((x, z) => ((x === 3 && z === 3) || (x === 4 && z === 4) ? 3 : 0));
    for (const [px, pz] of [
      [3.2, 3.3], // low triangle
      [3.8, 3.7], // high triangle
    ] as const) {
      const ray = new THREE.Ray(new THREE.Vector3(px, 5, pz), down);
      const hit = raycastGround(ray, f);
      expect(hit).not.toBeNull();
      expect(hit!.y).toBeCloseTo(f.surfaceY(px, pz), 9);
    }
  });
});

describe('pickTile with an elevation field', () => {
  const element = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
  } as HTMLElement;

  /** Ortho camera looking straight down on the whole grid. */
  function topCamera(): THREE.OrthographicCamera {
    const half = SIZE / 2;
    const camera = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, 100);
    camera.position.set(half, 50, half);
    camera.up.set(0, 0, -1);
    camera.lookAt(half, 0, half);
    camera.updateMatrixWorld();
    return camera;
  }

  it('picks the same tile the flat ground plane implies when the map is flat', () => {
    const camera = topCamera();
    const f = field(() => 0);
    // Pointer at 40%,40% → ndc (-0.2, 0.2); deriving the expectation from
    // the flat-plane helper keeps this independent of camera axes.
    const expected = groundPointAtNdc(-0.2, 0.2, camera);
    expect(expected).not.toBeNull();
    const tile = pickTile(40, 40, element, camera, SIZE, f);
    expect(tile).not.toBeNull();
    expect(tile!.x).toBe(Math.floor(expected!.x));
    expect(tile!.y).toBe(Math.floor(expected!.z));
  });

  it('still picks correctly with raised terrain under a vertical ray', () => {
    const camera = topCamera();
    const flat = pickTile(
      40,
      40,
      element,
      camera,
      SIZE,
      field(() => 0),
    );
    const raised = pickTile(
      40,
      40,
      element,
      camera,
      SIZE,
      field(() => 5),
    );
    // Straight-down rays keep their x/z whatever the height.
    expect(raised).toEqual(flat);
  });

  it('returns null outside the grid', () => {
    const f = field(() => 0);
    const camera = new THREE.OrthographicCamera(-20, -10, 5, -5, 0.1, 100);
    camera.position.set(0, 50, 0);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    expect(pickTile(50, 50, element, camera, SIZE, f)).toBeNull();
  });
});
