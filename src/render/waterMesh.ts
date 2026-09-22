import * as THREE from 'three';
import type { TileDiff } from '../shared/types.ts';
import { Terrain } from '../shared/types.ts';
import { PALETTE } from './scene.ts';
import type { DiffLayer, RenderEnvironment } from './renderer.ts';

/** Just above the ground plane, below roads (0.05) and the build grid. */
const WATER_HEIGHT = 0.015;
const WOBBLE_AMPLITUDE = 0.06;
const WOBBLE_SPEED = 1.3;
const NIGHT_DIM = 0.55;

/**
 * One flat instanced quad per river or lake tile. Water never changes
 * after map generation, so the mesh only rebuilds when terrain diffs
 * arrive (new game / load). A slow brightness wobble keeps it alive.
 */
export class WaterMesh implements DiffLayer {
  private readonly mesh: THREE.InstancedMesh;
  private readonly material: THREE.MeshLambertMaterial;
  private readonly terrain: Uint8Array;
  private readonly gridSize: number;
  private readonly matrix = new THREE.Matrix4();
  private nightFactor = 0;
  private reducedMotion = false;

  constructor(scene: THREE.Scene, gridSize: number) {
    this.gridSize = gridSize;
    this.terrain = new Uint8Array(gridSize * gridSize);
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.rotateX(-Math.PI / 2);
    this.material = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.mesh = new THREE.InstancedMesh(geometry, this.material, gridSize * gridSize);
    // Instance transforms live across the whole grid; the base geometry's
    // bounds would wrongly cull the mesh, so culling is disabled.
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  applyDiffs(diffs: TileDiff[]): void {
    let changed = false;
    for (const diff of diffs) {
      if (this.terrain[diff.index] !== diff.terrain) {
        this.terrain[diff.index] = diff.terrain;
        changed = true;
      }
    }
    if (changed) this.rebuild();
  }

  setEnvironment(environment: RenderEnvironment): void {
    this.nightFactor = environment.nightFactor;
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
  }

  update(_deltaSeconds: number, nowSeconds: number): void {
    const wobble = this.reducedMotion ? 0 : WOBBLE_AMPLITUDE * Math.sin(nowSeconds * WOBBLE_SPEED);
    const brightness = (1 + wobble) * (1 - NIGHT_DIM * this.nightFactor);
    this.material.color.setScalar(brightness);
  }

  private rebuild(): void {
    const color = new THREE.Color();
    let count = 0;
    for (let index = 0; index < this.terrain.length; index++) {
      const terrain = this.terrain[index];
      if (terrain === Terrain.Land) continue;
      const x = (index % this.gridSize) + 0.5;
      const z = Math.floor(index / this.gridSize) + 0.5;
      this.matrix.identity();
      this.matrix.setPosition(x, WATER_HEIGHT, z);
      this.mesh.setMatrixAt(count, this.matrix);
      this.mesh.setColorAt(
        count,
        color.setHex(terrain === Terrain.River ? PALETTE.river : PALETTE.lake),
      );
      count++;
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
