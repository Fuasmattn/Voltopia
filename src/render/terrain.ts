import * as THREE from 'three';
import type { RenderEnvironment } from './renderer.ts';
import { PALETTE } from './scene.ts';

const SEASON_KEYS = [
  new THREE.Color(PALETTE.groundSpring),
  new THREE.Color(PALETTE.groundSummer),
  new THREE.Color(PALETTE.groundAutumn),
  new THREE.Color(PALETTE.groundWinter),
];
const SNOW = new THREE.Color(PALETTE.groundSnow);
/** Each key colour sits in the middle of its season. */
const KEY_OFFSET = 0.125;

/** Cyclic blend of the four seasonal ground colours, then toward snow. */
export function groundColor(target: THREE.Color, phase: number, snowCover: number): THREE.Color {
  const cyclic = (((phase - KEY_OFFSET) % 1) + 1) % 1;
  const x = cyclic * SEASON_KEYS.length;
  const i = Math.floor(x) % SEASON_KEYS.length;
  const next = (i + 1) % SEASON_KEYS.length;
  return target
    .copy(SEASON_KEYS[i])
    .lerp(SEASON_KEYS[next], x - Math.floor(x))
    .lerp(SNOW, THREE.MathUtils.clamp(snowCover, 0, 1));
}

/** Ground plane spanning [0, size] x [0, size] with a subtle grid overlay. */
export function createTerrain(size: number): {
  group: THREE.Group;
  setGridVisible: (visible: boolean) => void;
  setEnvironment: (environment: RenderEnvironment) => void;
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
    setEnvironment: (environment: RenderEnvironment) => {
      groundColor(groundMaterial.color, environment.phase, environment.snowCover);
    },
  };
}
