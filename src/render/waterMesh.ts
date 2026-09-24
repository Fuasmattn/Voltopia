import * as THREE from 'three';
import type { TileDiff } from '../shared/types.ts';
import { Terrain } from '../shared/types.ts';
import { PALETTE } from './scene.ts';
import type { DiffLayer, RenderEnvironment } from './renderer.ts';
import type { ElevationField } from './elevationField.ts';
import { composePrismOnGround, createHalfTilePrism } from './decal.ts';

/** Just above the ground plane, below roads (0.05) and the build grid. */
const WATER_HEIGHT = 0.015;
/** Thickness of the water slab (it is a box so it can be sheared onto slopes). */
const WATER_THICKNESS = 0.01;
const WOBBLE_AMPLITUDE = 0.06;
const WOBBLE_SPEED = 1.3;
const NIGHT_DIM = 0.55;
/** Peak-to-peak tidal range of the rendered sea surface, in tile units. */
const TIDE_AMPLITUDE = 0.05;

/**
 * One thin instanced slab per river or lake tile. Water never changes
 * after map generation, so the mesh only rebuilds when terrain diffs
 * arrive (new game / load). A slow brightness wobble keeps it alive.
 */
export class WaterMesh implements DiffLayer {
  /** Lake tiles: flat unit boxes on the shared lake level. */
  private readonly mesh: THREE.InstancedMesh;
  /** River tiles: two prisms per tile, each flush with one ground triangle of the bed. */
  private readonly riverMesh: THREE.InstancedMesh;
  /** Sea tiles: flat boxes on the tide-driven sea level. */
  private readonly seaMesh: THREE.InstancedMesh;
  private readonly material: THREE.MeshLambertMaterial;
  private readonly terrain: Uint8Array;
  private readonly gridSize: number;
  private readonly matrix = new THREE.Matrix4();
  private nightFactor = 0;
  private reducedMotion = false;
  private tideLevel = 0;

  constructor(
    scene: THREE.Scene,
    gridSize: number,
    private readonly elevation: ElevationField,
  ) {
    this.gridSize = gridSize;
    this.terrain = new Uint8Array(gridSize * gridSize);
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    this.material = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.mesh = new THREE.InstancedMesh(geometry, this.material, gridSize * gridSize);
    // Instance transforms live across the whole grid; the base geometry's
    // bounds would wrongly cull the mesh, so culling is disabled.
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.count = 0;
    scene.add(this.mesh);

    this.riverMesh = new THREE.InstancedMesh(
      createHalfTilePrism(),
      this.material,
      gridSize * gridSize * 2,
    );
    // Instance transforms live across the whole grid; the base geometry's
    // bounds would wrongly cull the mesh, so culling is disabled.
    this.riverMesh.frustumCulled = false;
    this.riverMesh.receiveShadow = true;
    this.riverMesh.count = 0;
    scene.add(this.riverMesh);

    this.seaMesh = new THREE.InstancedMesh(geometry, this.material, gridSize * gridSize);
    // Instance transforms live across the whole grid; the base geometry's
    // bounds would wrongly cull the mesh, so culling is disabled.
    this.seaMesh.frustumCulled = false;
    this.seaMesh.receiveShadow = true;
    this.seaMesh.count = 0;
    this.seaMesh.position.y = WATER_HEIGHT;
    scene.add(this.seaMesh);
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
    this.tideLevel = environment.tideLevel;
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
  }

  update(_deltaSeconds: number, nowSeconds: number): void {
    const wobble = this.reducedMotion ? 0 : WOBBLE_AMPLITUDE * Math.sin(nowSeconds * WOBBLE_SPEED);
    const brightness = (1 + wobble) * (1 - NIGHT_DIM * this.nightFactor);
    this.material.color.setScalar(brightness);
    // The sea rises and falls with the tide; the range is deliberately
    // small so the shore reads as a shore, not as a flood.
    const tideOffset = this.reducedMotion ? 0 : this.tideLevel * TIDE_AMPLITUDE;
    this.seaMesh.position.y = WATER_HEIGHT + tideOffset;
  }

  private rebuild(): void {
    const color = new THREE.Color();
    let lakeCount = 0;
    let riverCount = 0;
    let seaCount = 0;
    for (let index = 0; index < this.terrain.length; index++) {
      const terrain = this.terrain[index];
      if (terrain === Terrain.Land) continue;
      if (terrain === Terrain.Lake) {
        // Every lake tile shares one level: one flat surface, banks rise around it.
        const x = (index % this.gridSize) + 0.5;
        const z = Math.floor(index / this.gridSize) + 0.5;
        this.matrix.makeScale(1, WATER_THICKNESS, 1);
        this.matrix.setPosition(
          x,
          this.elevation.centerY(index) + WATER_HEIGHT + WATER_THICKNESS / 2,
          z,
        );
        this.mesh.setMatrixAt(lakeCount, this.matrix);
        this.mesh.setColorAt(lakeCount, color.setHex(PALETTE.lake));
        lakeCount++;
        continue;
      }
      if (terrain === Terrain.Sea) {
        // Sea tiles sit at elevation 0; the whole mesh is offset by the
        // tide in update(), so the per-instance matrix only carries the
        // slab's own thickness.
        const x = (index % this.gridSize) + 0.5;
        const z = Math.floor(index / this.gridSize) + 0.5;
        this.matrix.makeScale(1, WATER_THICKNESS, 1);
        this.matrix.setPosition(x, this.elevation.centerY(index) + WATER_THICKNESS / 2, z);
        this.seaMesh.setMatrixAt(seaCount, this.matrix);
        this.seaMesh.setColorAt(seaCount, color.setHex(PALETTE.sea));
        seaCount++;
        continue;
      }
      // The river bed is carved into the ground; the water follows it downhill.
      for (const high of [false, true]) {
        composePrismOnGround(
          this.matrix,
          this.elevation,
          index,
          high,
          1,
          WATER_THICKNESS,
          WATER_HEIGHT,
        );
        this.riverMesh.setMatrixAt(riverCount, this.matrix);
        this.riverMesh.setColorAt(riverCount, color.setHex(PALETTE.river));
        riverCount++;
      }
    }
    this.mesh.count = lakeCount;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.riverMesh.count = riverCount;
    this.riverMesh.instanceMatrix.needsUpdate = true;
    if (this.riverMesh.instanceColor) this.riverMesh.instanceColor.needsUpdate = true;
    this.seaMesh.count = seaCount;
    this.seaMesh.instanceMatrix.needsUpdate = true;
    if (this.seaMesh.instanceColor) this.seaMesh.instanceColor.needsUpdate = true;
  }
}
