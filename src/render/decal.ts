import * as THREE from 'three';
import type { ElevationField } from './elevationField.ts';

const xAxis = new THREE.Vector3();
const yAxis = new THREE.Vector3();
const zAxis = new THREE.Vector3();
const thickness = new THREE.Vector3();

/**
 * Lay a flat box decal on the ground plane of a tile: the box is sheared
 * so its x and z edges follow the tile's slope while staying aligned
 * with the tile grid, its thickness points along the plane normal, and
 * its footprint stays exactly sizeX by sizeZ tiles when seen from above.
 * `lift` raises the box's base along the normal (0 = resting on the
 * ground). Only the matrix is written; the caller stores it.
 */
export function composeGroundDecal(
  matrix: THREE.Matrix4,
  elevation: ElevationField,
  index: number,
  x: number,
  z: number,
  sizeX: number,
  sizeY: number,
  sizeZ: number,
  lift: number,
): void {
  const { gx, gz } = elevation.tileSlope(index);
  xAxis.set(1, gx, 0).multiplyScalar(sizeX);
  zAxis.set(0, gz, 1).multiplyScalar(sizeZ);
  yAxis.set(-gx, 1, -gz).normalize();
  const baseY = elevation.surfaceY(x, z);
  // The box is centred on its origin: shift half a thickness up the normal.
  const centreLift = lift + sizeY / 2;
  thickness.copy(yAxis).multiplyScalar(sizeY);
  matrix.makeBasis(xAxis, thickness, zAxis);
  matrix.setPosition(
    x + yAxis.x * centreLift,
    baseY + yAxis.y * centreLift,
    z + yAxis.z * centreLift,
  );
}
