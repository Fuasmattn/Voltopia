import * as THREE from 'three';
import { DIRECTIONS } from '../shared/grid.ts';
import type { TileDiff } from '../shared/types.ts';
import { TileType } from '../shared/types.ts';
import { PALETTE } from './scene.ts';
import type { DiffLayer, RenderEnvironment } from './renderer.ts';

const ROAD_HEIGHT = 0.05;
const CENTER_SIZE = 0.62;
const ARM_LENGTH = (1 - CENTER_SIZE) / 2;
/** Instances per road tile: 1 center + up to 4 arms. */
const INSTANCES_PER_TILE = 5;

/**
 * Instanced road tiles. Each road tile is composed of a center pad plus an
 * arm toward every connected neighbor, so straights, curves, T-junctions,
 * crossings and dead ends emerge automatically from the connection mask.
 */
export class RoadsMesh implements DiffLayer {
  readonly mesh: THREE.InstancedMesh;
  private readonly lampPoles: THREE.InstancedMesh;
  private readonly lampHeads: THREE.InstancedMesh;
  private readonly lampHeadMaterial: THREE.MeshBasicMaterial;
  private readonly gridSize: number;
  private readonly roadMasks: Int16Array; // -1 = no road, else mask 0..15
  private readonly matrix = new THREE.Matrix4();

  constructor(scene: THREE.Scene, gridSize: number) {
    this.gridSize = gridSize;
    this.roadMasks = new Int16Array(gridSize * gridSize).fill(-1);
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshLambertMaterial({ color: PALETTE.road });
    this.mesh = new THREE.InstancedMesh(
      geometry,
      material,
      gridSize * gridSize * INSTANCES_PER_TILE,
    );
    this.mesh.receiveShadow = true;
    this.mesh.count = 0;
    scene.add(this.mesh);

    const poleGeometry = new THREE.BoxGeometry(0.035, 0.3, 0.035);
    poleGeometry.translate(0, 0.15, 0);
    const poleMaterial = new THREE.MeshLambertMaterial({ color: 0x3a4048 });
    this.lampPoles = new THREE.InstancedMesh(
      poleGeometry,
      poleMaterial,
      gridSize * gridSize,
    );
    this.lampPoles.count = 0;
    scene.add(this.lampPoles);

    const headGeometry = new THREE.SphereGeometry(0.045, 6, 4);
    this.lampHeadMaterial = new THREE.MeshBasicMaterial({
      color: 0xffe3a1,
      transparent: true,
      opacity: 0.25,
    });
    this.lampHeads = new THREE.InstancedMesh(
      headGeometry,
      this.lampHeadMaterial,
      gridSize * gridSize,
    );
    this.lampHeads.count = 0;
    scene.add(this.lampHeads);
  }

  /** Streetlamps glow warmly at night. */
  setEnvironment(environment: RenderEnvironment): void {
    this.lampHeadMaterial.opacity = 0.25 + 0.75 * environment.nightFactor;
    this.lampHeadMaterial.color.setHex(
      environment.nightFactor > 0.4 ? 0xffcf6e : 0xffe3a1,
    );
  }

  applyDiffs(diffs: TileDiff[]): void {
    let changed = false;
    for (const diff of diffs) {
      const mask = diff.tileType === TileType.Road ? diff.roadMask : -1;
      if (this.roadMasks[diff.index] !== mask) {
        this.roadMasks[diff.index] = mask;
        changed = true;
      }
    }
    if (changed) this.rebuild();
  }

  private rebuild(): void {
    let count = 0;
    for (let index = 0; index < this.roadMasks.length; index++) {
      const mask = this.roadMasks[index];
      if (mask < 0) continue;
      const x = (index % this.gridSize) + 0.5;
      const z = Math.floor(index / this.gridSize) + 0.5;

      this.setInstance(count++, x, z, CENTER_SIZE, CENTER_SIZE);
      for (const { dx, dy, bit } of DIRECTIONS) {
        if ((mask & bit) === 0) continue;
        const offset = CENTER_SIZE / 2 + ARM_LENGTH / 2;
        this.setInstance(
          count++,
          x + dx * offset,
          z + dy * offset,
          dx !== 0 ? ARM_LENGTH : CENTER_SIZE,
          dy !== 0 ? ARM_LENGTH : CENTER_SIZE,
        );
      }
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.rebuildLamps();
  }

  /** One streetlamp on every other road tile, at a fixed corner. */
  private rebuildLamps(): void {
    let count = 0;
    for (let index = 0; index < this.roadMasks.length; index++) {
      if (this.roadMasks[index] < 0) continue;
      const x = index % this.gridSize;
      const y = Math.floor(index / this.gridSize);
      if ((x + y) % 2 !== 0) continue;
      const px = x + 0.88;
      const pz = y + 0.88;
      this.matrix.identity();
      this.matrix.setPosition(px, 0, pz);
      this.lampPoles.setMatrixAt(count, this.matrix);
      this.matrix.setPosition(px, 0.33, pz);
      this.lampHeads.setMatrixAt(count, this.matrix);
      count++;
    }
    this.lampPoles.count = count;
    this.lampHeads.count = count;
    this.lampPoles.instanceMatrix.needsUpdate = true;
    this.lampHeads.instanceMatrix.needsUpdate = true;
  }

  private setInstance(
    slot: number,
    x: number,
    z: number,
    sizeX: number,
    sizeZ: number,
  ): void {
    this.matrix.makeScale(sizeX, ROAD_HEIGHT, sizeZ);
    this.matrix.setPosition(x, ROAD_HEIGHT / 2, z);
    this.mesh.setMatrixAt(slot, this.matrix);
  }
}
