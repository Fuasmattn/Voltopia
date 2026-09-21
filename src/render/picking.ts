import * as THREE from 'three';
import { inBounds, tileIndex } from '../shared/grid.ts';

const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();
const hitPoint = new THREE.Vector3();

/**
 * Convert a pointer event position to the tile index under the cursor,
 * or null if the pointer is outside the grid.
 */
export function pickTile(
  clientX: number,
  clientY: number,
  element: HTMLElement,
  camera: THREE.Camera,
  gridSize: number,
): { index: number; x: number; y: number } | null {
  const rect = element.getBoundingClientRect();
  pointerNdc.set(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(pointerNdc, camera);
  if (!raycaster.ray.intersectPlane(groundPlane, hitPoint)) return null;
  const x = Math.floor(hitPoint.x);
  const y = Math.floor(hitPoint.z);
  if (!inBounds(x, y, gridSize)) return null;
  return { index: tileIndex(x, y, gridSize), x, y };
}
