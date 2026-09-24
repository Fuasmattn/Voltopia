import * as THREE from 'three';
import { ElevationField } from './elevationField.ts';

/**
 * Flat decals (road pads, water, zone paint) laid on the ground.
 *
 * The ground mesh is piecewise planar: two triangles per tile, split
 * along the diagonal from (x, z+1) to (x+1, z). A decal only lies flush
 * when every part of it is fitted to the plane of the ground triangle it
 * sits in. Rectangles that stay inside one triangle (road arms, centre
 * lines) become sheared boxes; a square centred on the tile (road pad,
 * water, zone tint) straddles the crease along its own diagonal, so it
 * is drawn as two right-angled prisms, one per ground triangle.
 */

const xAxis = new THREE.Vector3();
const yAxis = new THREE.Vector3();
const zAxis = new THREE.Vector3();
const thickness = new THREE.Vector3();

/**
 * Right-angled triangular prism: legs along +x and +z of length 1 from
 * the origin, thickness along +y from 0 to 1. Instanced twice per tile
 * square: once as the low triangle, once rotated onto the high one.
 */
export function createHalfTilePrism(): THREE.BufferGeometry {
  // Every face is wound counter-clockwise seen from OUTSIDE the prism
  // (three.js front faces), so the top is what the camera sees and the
  // thin walls stay hidden under it. decal.test.ts checks each face's
  // normal against the centre of mass; an inside-out prism shows its
  // walls as dark seams along every tile diagonal.
  // prettier-ignore
  const positions = new Float32Array([
    // bottom (y = 0), facing down
    0, 0, 0,  1, 0, 0,  0, 0, 1,
    // top (y = 1), facing up
    0, 1, 0,  0, 1, 1,  1, 1, 0,
    // side along x (z = 0), facing -z
    0, 0, 0,  1, 1, 0,  1, 0, 0,   0, 0, 0,  0, 1, 0,  1, 1, 0,
    // side along z (x = 0), facing -x
    0, 0, 0,  0, 1, 1,  0, 1, 0,   0, 0, 0,  0, 0, 1,  0, 1, 1,
    // hypotenuse side, facing +x+z
    1, 0, 0,  0, 1, 1,  0, 0, 1,   1, 0, 0,  1, 1, 0,  0, 1, 1,
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function setBasis(
  matrix: THREE.Matrix4,
  gx: number,
  gz: number,
  normal: { x: number; y: number; z: number },
  scaleX: number,
  scaleY: number,
  scaleZ: number,
  flip: boolean,
): void {
  // Edges follow the plane of the ground triangle, so the decal lies flush.
  // The thickness follows the ground's SMOOTH normal instead of the facet's:
  // three.js lights instances with the instance matrix applied to the
  // geometry normals, so this axis is what the decal is shaded by, and the
  // ground itself is shaded with interpolated vertex normals. Using the
  // facet normal made every saddle tile show a light/dark triangle pair
  // that the ground beneath it hides. The tilt between the two normals is
  // a few degrees at most, invisible on a slab a few hundredths thick.
  const sign = flip ? -1 : 1;
  xAxis.set(sign, sign * gx, 0).multiplyScalar(scaleX);
  zAxis.set(0, sign * gz, sign).multiplyScalar(scaleZ);
  yAxis.set(normal.x, normal.y, normal.z);
  thickness.copy(yAxis).multiplyScalar(scaleY);
  matrix.makeBasis(xAxis, thickness, zAxis);
}

/**
 * A unit box (centred on its origin) laid on the ground triangle that
 * contains the rectangle's centre (cx, cz). Only valid for rectangles
 * that do not cross the tile's crease.
 */
export function composeBoxOnGround(
  matrix: THREE.Matrix4,
  elevation: ElevationField,
  index: number,
  cx: number,
  cz: number,
  sizeX: number,
  sizeY: number,
  sizeZ: number,
  lift: number,
): void {
  const size = elevation.gridSize;
  const fx = cx - (index % size);
  const fz = cz - Math.floor(index / size);
  const { gx, gz } = elevation.trianglePlane(index, ElevationField.inHighTriangle(fx, fz));
  setBasis(matrix, gx, gz, elevation.smoothNormal(cx, cz), sizeX, sizeY, sizeZ, false);
  const along = lift + sizeY / 2;
  matrix.setPosition(
    cx + yAxis.x * along,
    elevation.surfaceY(cx, cz) + yAxis.y * along,
    cz + yAxis.z * along,
  );
}

/**
 * One half of a square decal centred on the tile: the low prism starts
 * at the square's (x0, z0) corner, the high prism at its (x1, z1) corner
 * with its legs pointing back toward the centre. `size` is the square's
 * edge in tiles, `lift` the gap to the ground along the normal.
 */
export function composePrismOnGround(
  matrix: THREE.Matrix4,
  elevation: ElevationField,
  index: number,
  high: boolean,
  size: number,
  sizeY: number,
  lift: number,
): void {
  const grid = elevation.gridSize;
  const tx = index % grid;
  const tz = Math.floor(index / grid);
  const margin = (1 - size) / 2;
  const { gx, gz } = elevation.trianglePlane(index, high);
  const ox = high ? tx + 1 - margin : tx + margin;
  const oz = high ? tz + 1 - margin : tz + margin;
  // Lit like the ground at the prism's centroid (a third of the way along
  // both legs from the right-angle corner).
  const inward = (high ? -1 : 1) * (size / 3);
  const normal = elevation.smoothNormal(ox + inward, oz + inward);
  setBasis(matrix, gx, gz, normal, size, sizeY, size, high);
  matrix.setPosition(
    ox + yAxis.x * lift,
    elevation.surfaceY(ox, oz) + yAxis.y * lift,
    oz + yAxis.z * lift,
  );
}
