import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TICK_MS } from '../shared/constants.ts';
import type { VehicleState } from '../shared/types.ts';
import type { RenderEnvironment } from './renderer.ts';

const MAX_VEHICLES = 256;
const CAR_COLORS = [0xe8e6e0, 0x8fb3c9, 0xd9a066, 0x9aa88f, 0x707a86, 0xc9788f];

/** Simple low-poly car: body + cabin merged into one geometry. */
function createCarGeometry(): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(0.3, 0.07, 0.14);
  body.translate(0, 0.055, 0);
  const cabin = new THREE.BoxGeometry(0.16, 0.06, 0.12);
  cabin.translate(-0.015, 0.12, 0);
  return mergeGeometries([body, cabin]);
}

/**
 * Instanced electric vehicles. Positions arrive at tick rate from the
 * simulation; rendering interpolates between the last two updates for
 * smooth motion. Headlights fade in at night.
 */
export class VehiclesMesh {
  private readonly mesh: THREE.InstancedMesh;
  private readonly headlights: THREE.InstancedMesh;
  private readonly headlightMaterial: THREE.MeshBasicMaterial;
  private previous: VehicleState[] = [];
  private current: VehicleState[] = [];
  private lastUpdateSeconds = 0;
  /** Expected seconds between sim updates (changes with game speed). */
  private updateInterval = TICK_MS / 1000;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly unitScale = new THREE.Vector3(1, 1, 1);

  constructor(scene: THREE.Scene) {
    this.mesh = new THREE.InstancedMesh(
      createCarGeometry(),
      new THREE.MeshLambertMaterial(),
      MAX_VEHICLES,
    );
    this.mesh.castShadow = true;
    this.mesh.count = 0;
    const color = new THREE.Color();
    for (let i = 0; i < MAX_VEHICLES; i++) {
      this.mesh.setColorAt(i, color.setHex(CAR_COLORS[i % CAR_COLORS.length]));
    }
    scene.add(this.mesh);

    const lightGeometry = new THREE.BoxGeometry(0.02, 0.03, 0.12);
    lightGeometry.translate(0.16, 0.06, 0);
    this.headlightMaterial = new THREE.MeshBasicMaterial({
      color: 0xfff4c9,
      transparent: true,
      opacity: 0,
    });
    this.headlights = new THREE.InstancedMesh(
      lightGeometry,
      this.headlightMaterial,
      MAX_VEHICLES,
    );
    this.headlights.count = 0;
    scene.add(this.headlights);
  }

  /** New authoritative vehicle states from the simulation. */
  setVehicles(vehicles: VehicleState[], nowSeconds: number): void {
    this.previous = this.current;
    this.current = vehicles;
    if (this.lastUpdateSeconds > 0) {
      const measured = nowSeconds - this.lastUpdateSeconds;
      if (measured > 0.01 && measured < 2) {
        this.updateInterval = this.updateInterval * 0.8 + measured * 0.2;
      }
    }
    this.lastUpdateSeconds = nowSeconds;
  }

  setEnvironment(environment: RenderEnvironment): void {
    this.headlightMaterial.opacity = Math.max(
      0,
      (environment.nightFactor - 0.3) / 0.7,
    );
  }

  /** Interpolate between the last two sim updates. */
  update(nowSeconds: number): void {
    const count = Math.min(this.current.length, MAX_VEHICLES);
    const blend = THREE.MathUtils.clamp(
      (nowSeconds - this.lastUpdateSeconds) / this.updateInterval,
      0,
      1,
    );
    for (let i = 0; i < count; i++) {
      const target = this.current[i];
      const source = this.previous[i] ?? target;
      // Teleports (respawns) should not slide across the map.
      const jump = Math.hypot(target.x - source.x, target.y - source.y) > 2;
      const x = jump ? target.x : source.x + (target.x - source.x) * blend;
      const y = jump ? target.y : source.y + (target.y - source.y) * blend;
      const angle = jump ? target.angle : lerpAngle(source.angle, target.angle, blend);
      this.position.set(x, 0.03, y);
      this.quaternion.setFromAxisAngle(this.up, -angle);
      this.matrix.compose(this.position, this.quaternion, this.unitScale);
      this.mesh.setMatrixAt(i, this.matrix);
      this.headlights.setMatrixAt(i, this.matrix);
    }
    this.mesh.count = count;
    this.headlights.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.headlights.instanceMatrix.needsUpdate = true;
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  let delta = b - a;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  return a + delta * t;
}
