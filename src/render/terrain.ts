import * as THREE from 'three';
import { PALETTE } from './scene.ts';

/** Ground plane spanning [0, size] x [0, size] with a subtle grid overlay. */
export function createTerrain(size: number): {
  group: THREE.Group;
  setGridVisible: (visible: boolean) => void;
} {
  const group = new THREE.Group();

  const groundGeometry = new THREE.PlaneGeometry(size, size);
  const groundMaterial = new THREE.MeshLambertMaterial({ color: PALETTE.ground });
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(size / 2, 0, size / 2);
  ground.receiveShadow = true;
  group.add(ground);

  const grid = new THREE.GridHelper(size, size, PALETTE.grid, PALETTE.grid);
  grid.position.set(size / 2, 0.02, size / 2);
  const gridMaterial = grid.material as THREE.LineBasicMaterial;
  gridMaterial.transparent = true;
  gridMaterial.opacity = 0.18;
  gridMaterial.depthWrite = false;
  group.add(grid);

  return {
    group,
    setGridVisible: (visible: boolean) => {
      grid.visible = visible;
    },
  };
}
