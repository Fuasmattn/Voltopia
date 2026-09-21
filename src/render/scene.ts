import * as THREE from 'three';

export interface SceneLights {
  sun: THREE.DirectionalLight;
  ambient: THREE.HemisphereLight;
}

export const PALETTE = {
  skyDay: 0xbfe0e8,
  skyNight: 0x101a2a,
  ground: 0x9fc37e,
  grid: 0x7fa863,
  road: 0x5a6068,
  roadMarking: 0xd8d8d0,
} as const;

export function createScene(): { scene: THREE.Scene; lights: SceneLights } {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.skyDay);

  const ambient = new THREE.HemisphereLight(0xdfeef5, 0x8a9a6a, 0.9);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
  sun.position.set(40, 80, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -60;
  sun.shadow.camera.right = 60;
  sun.shadow.camera.top = 60;
  sun.shadow.camera.bottom = -60;
  sun.shadow.camera.far = 300;
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  scene.add(sun.target);

  return { scene, lights: { sun, ambient } };
}
