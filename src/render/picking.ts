import * as THREE from 'three';
import { inBounds, tileIndex } from '../shared/grid.ts';
import { ElevationField, LEVEL_HEIGHT } from './elevationField.ts';

const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();
const hitPoint = new THREE.Vector3();
const gridBox = new THREE.Box3();
const entryPoint = new THREE.Vector3();

/** Tolerance for hits exactly on tile edges or the triangle crease. */
const EDGE_EPSILON = 1e-7;

/**
 * Where a normalised device coordinate (-1..1 on both axes) hits the
 * ground plane, in world/tile units; null when the ray misses it.
 */
export function groundPointAtNdc(
  ndcX: number,
  ndcY: number,
  camera: THREE.Camera,
): { x: number; z: number } | null {
  pointerNdc.set(ndcX, ndcY);
  raycaster.setFromCamera(pointerNdc, camera);
  if (!raycaster.ray.intersectPlane(groundPlane, hitPoint)) return null;
  return { x: hitPoint.x, z: hitPoint.z };
}

/**
 * Intersect a ray with the terrain height field analytically: walk the
 * tiles the ray passes over (2D DDA) and test the two ground-triangle
 * planes of each. O(grid side) per ray instead of raycasting the ground
 * mesh's 2·size² triangles, and exact for the piecewise-planar surface
 * the mesh renders (see ElevationField.trianglePlane). Returns the hit
 * point or null when the ray leaves the grid without touching ground.
 */
export function raycastGround(ray: THREE.Ray, field: ElevationField): THREE.Vector3 | null {
  const size = field.gridSize;
  // Generous top: levels are a Uint8, so no terrain can poke above this.
  gridBox.min.set(0, 0, 0);
  gridBox.max.set(size, 256 * LEVEL_HEIGHT, size);
  let tEnter = 0;
  if (!gridBox.containsPoint(ray.origin)) {
    if (!ray.intersectBox(gridBox, entryPoint)) return null;
    tEnter = entryPoint.distanceTo(ray.origin);
  }
  // Nudge past the boundary so the start tile is unambiguous.
  ray.at(tEnter + EDGE_EPSILON, entryPoint);
  const { direction } = ray;
  let tx = Math.min(size - 1, Math.max(0, Math.floor(entryPoint.x)));
  let tz = Math.min(size - 1, Math.max(0, Math.floor(entryPoint.z)));
  const stepX = direction.x > 0 ? 1 : -1;
  const stepZ = direction.z > 0 ? 1 : -1;
  const tDeltaX = direction.x !== 0 ? Math.abs(1 / direction.x) : Infinity;
  const tDeltaZ = direction.z !== 0 ? Math.abs(1 / direction.z) : Infinity;
  let tMaxX =
    direction.x !== 0 ? (tx + (stepX > 0 ? 1 : 0) - ray.origin.x) / direction.x : Infinity;
  let tMaxZ =
    direction.z !== 0 ? (tz + (stepZ > 0 ? 1 : 0) - ray.origin.z) / direction.z : Infinity;
  // A ray crosses at most one row and one column of cells per tile side.
  for (let step = 0; step < 2 * size + 2; step++) {
    const t = intersectTileGround(ray, field, tx, tz);
    if (t !== null) return ray.at(t, new THREE.Vector3());
    if (tMaxX < tMaxZ) {
      tx += stepX;
      tMaxX += tDeltaX;
    } else {
      tz += stepZ;
      tMaxZ += tDeltaZ;
    }
    if (tx < 0 || tz < 0 || tx >= size || tz >= size) return null;
  }
  return null;
}

/**
 * Smallest non-negative ray parameter where the ray meets one of the two
 * ground triangles of tile (tx, tz), or null. Each triangle is tested as
 * a plane through its reference corner; a plane hit only counts when it
 * lies inside the tile and on that triangle's side of the crease.
 */
function intersectTileGround(
  ray: THREE.Ray,
  field: ElevationField,
  tx: number,
  tz: number,
): number | null {
  const index = tz * field.gridSize + tx;
  const { origin, direction } = ray;
  let best: number | null = null;
  for (const high of [false, true]) {
    const { gx, gz } = field.trianglePlane(index, high);
    const refX = high ? tx + 1 : tx;
    const refZ = high ? tz + 1 : tz;
    const refY = field.cornerY(refX, refZ);
    const denominator = direction.y - gx * direction.x - gz * direction.z;
    if (Math.abs(denominator) < 1e-12) continue;
    const t = (refY + gx * (origin.x - refX) + gz * (origin.z - refZ) - origin.y) / denominator;
    if (t < 0 || (best !== null && t >= best)) continue;
    const fx = origin.x + t * direction.x - tx;
    const fz = origin.z + t * direction.z - tz;
    if (fx < -EDGE_EPSILON || fx > 1 + EDGE_EPSILON) continue;
    if (fz < -EDGE_EPSILON || fz > 1 + EDGE_EPSILON) continue;
    if (high ? fx + fz < 1 - EDGE_EPSILON : fx + fz > 1 + EDGE_EPSILON) continue;
    best = t;
  }
  return best;
}

/**
 * Convert a pointer event position to the tile index under the cursor, or
 * null if the pointer is outside the grid. Raycasts the terrain height
 * field first (so hills pick correctly); falls back to the flat y=0 plane
 * when no field is given or the ray leaves the grid untouched.
 */
export function pickTile(
  clientX: number,
  clientY: number,
  element: HTMLElement,
  camera: THREE.Camera,
  gridSize: number,
  field?: ElevationField,
): { index: number; x: number; y: number } | null {
  const rect = element.getBoundingClientRect();
  pointerNdc.set(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(pointerNdc, camera);
  let point: THREE.Vector3 | null = null;
  if (field) point = raycastGround(raycaster.ray, field);
  if (!point) {
    if (!raycaster.ray.intersectPlane(groundPlane, hitPoint)) return null;
    point = hitPoint;
  }
  const x = Math.floor(point.x);
  const y = Math.floor(point.z);
  if (!inBounds(x, y, gridSize)) return null;
  return { index: tileIndex(x, y, gridSize), x, y };
}
