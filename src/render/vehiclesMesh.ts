import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TICK_MS } from '../shared/constants.ts';
import type { VehicleState } from '../shared/types.ts';
import { VehicleKind } from '../shared/types.ts';
import type { RenderEnvironment } from './renderer.ts';
import type { ElevationField } from './elevationField.ts';

const MAX_VEHICLES = 256;
const MAX_VANS = 64;
const CAR_COLORS = [0xe8e6e0, 0x8fb3c9, 0xd9a066, 0x9aa88f, 0x707a86, 0xc9788f];
const VAN_COLOR = 0xf2f2ef;

/** Simple low-poly car: body + cabin merged into one geometry. */
function createCarGeometry(): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(0.3, 0.07, 0.14);
  body.translate(0, 0.055, 0);
  const cabin = new THREE.BoxGeometry(0.16, 0.06, 0.12);
  cabin.translate(-0.015, 0.12, 0);
  return mergeGeometries([body, cabin]);
}

/** Boxy delivery van: tall cargo body plus a short cab. */
function createVanGeometry(): THREE.BufferGeometry {
  const cargo = new THREE.BoxGeometry(0.24, 0.16, 0.15);
  cargo.translate(-0.05, 0.1, 0);
  const cab = new THREE.BoxGeometry(0.1, 0.11, 0.15);
  cab.translate(0.12, 0.075, 0);
  return mergeGeometries([cargo, cab]);
}

/**
 * Instanced electric vehicles. Positions arrive at tick rate from the
 * simulation; rendering interpolates between the last two updates for
 * smooth motion. Headlights fade in at night.
 */
export class VehiclesMesh {
  private readonly mesh: THREE.InstancedMesh;
  private readonly vans: THREE.InstancedMesh;
  private readonly headlights: THREE.InstancedMesh;
  private readonly headlightMaterial: THREE.MeshBasicMaterial;
  private previous = new Map<number, VehicleState>();
  private current: VehicleState[] = [];
  private lastUpdateSeconds = 0;
  /** Expected seconds between sim updates (changes with game speed). */
  private updateInterval = TICK_MS / 1000;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly unitScale = new THREE.Vector3(1, 1, 1);

  constructor(
    scene: THREE.Scene,
    private readonly elevation: ElevationField,
  ) {
    this.mesh = new THREE.InstancedMesh(
      createCarGeometry(),
      new THREE.MeshLambertMaterial(),
      MAX_VEHICLES,
    );
    // Instance transforms live across the whole grid; the base geometry's
    // bounds would wrongly cull the mesh, so culling is disabled.
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.count = 0;
    const color = new THREE.Color();
    for (let i = 0; i < MAX_VEHICLES; i++) {
      this.mesh.setColorAt(i, color.setHex(CAR_COLORS[i % CAR_COLORS.length]));
    }
    scene.add(this.mesh);

    this.vans = new THREE.InstancedMesh(
      createVanGeometry(),
      new THREE.MeshLambertMaterial({ color: VAN_COLOR }),
      MAX_VANS,
    );
    // Instance transforms live across the whole grid; the base geometry's
    // bounds would wrongly cull the mesh, so culling is disabled.
    this.vans.frustumCulled = false;
    this.vans.castShadow = true;
    this.vans.count = 0;
    scene.add(this.vans);

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
      MAX_VEHICLES + MAX_VANS,
    );
    // Instance transforms live across the whole grid; the base geometry's
    // bounds would wrongly cull the mesh, so culling is disabled.
    this.headlights.frustumCulled = false;
    this.headlights.count = 0;
    scene.add(this.headlights);
  }

  /** New authoritative vehicle states from the simulation. */
  setVehicles(vehicles: VehicleState[], nowSeconds: number): void {
    this.previous = new Map(this.current.map((v) => [v.id, v]));
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
    this.headlightMaterial.opacity = Math.max(0, (environment.nightFactor - 0.3) / 0.7);
  }

  /** Interpolate between the last two sim updates. */
  update(nowSeconds: number): void {
    const blend = THREE.MathUtils.clamp(
      (nowSeconds - this.lastUpdateSeconds) / this.updateInterval,
      0,
      1,
    );
    let cars = 0;
    let vans = 0;
    let lights = 0;
    for (const target of this.current) {
      const isVan = target.kind === VehicleKind.Van;
      if (isVan ? vans >= MAX_VANS : cars >= MAX_VEHICLES) continue;
      // Match by stable id: vehicles enter/leave the visible set when
      // they start or finish trips, so indices don't line up.
      const source = this.previous.get(target.id) ?? target;
      // Teleports (respawns) should not slide across the map.
      const jump = Math.hypot(target.x - source.x, target.y - source.y) > 2;
      const x = jump ? target.x : source.x + (target.x - source.x) * blend;
      const y = jump ? target.y : source.y + (target.y - source.y) * blend;
      const angle = jump ? target.angle : lerpAngle(source.angle, target.angle, blend);
      this.position.set(x, 0.03 + this.elevation.surfaceY(x, y), y);
      this.quaternion.setFromAxisAngle(this.up, -angle);
      this.matrix.compose(this.position, this.quaternion, this.unitScale);
      if (isVan) this.vans.setMatrixAt(vans++, this.matrix);
      else this.mesh.setMatrixAt(cars++, this.matrix);
      this.headlights.setMatrixAt(lights++, this.matrix);
    }
    this.mesh.count = cars;
    this.vans.count = vans;
    this.headlights.count = lights;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.vans.instanceMatrix.needsUpdate = true;
    this.headlights.instanceMatrix.needsUpdate = true;
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  let delta = b - a;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  return a + delta * t;
}
