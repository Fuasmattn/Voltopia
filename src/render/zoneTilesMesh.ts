import * as THREE from 'three';
import type { TileDiff } from '../shared/types.ts';
import { TileType, Zone } from '../shared/types.ts';
import type { DiffLayer } from './renderer.ts';

const ZONE_TINTS: Record<number, THREE.Color> = {
  [Zone.Residential]: new THREE.Color(0x67c26b),
  [Zone.Commercial]: new THREE.Color(0x5b8fd6),
  [Zone.Retail]: new THREE.Color(0xd6815b),
};

/**
 * Translucent tint on zoned-but-unbuilt tiles so painted zones are
 * visible before buildings appear.
 */
export class ZoneTilesMesh implements DiffLayer {
  readonly mesh: THREE.InstancedMesh;
  private readonly gridSize: number;
  private readonly zones = new Map<number, Zone>();
  private readonly matrix = new THREE.Matrix4();

  constructor(scene: THREE.Scene, gridSize: number) {
    this.gridSize = gridSize;
    const geometry = new THREE.PlaneGeometry(0.92, 0.92).rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, gridSize * gridSize);
    // Instance transforms live across the whole grid; the base geometry's
    // bounds would wrongly cull the mesh, so culling is disabled.
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  applyDiffs(diffs: TileDiff[]): void {
    let changed = false;
    for (const diff of diffs) {
      const showTint =
        diff.tileType === TileType.Empty &&
        diff.zone !== Zone.None &&
        diff.density === 0;
      if (showTint) {
        if (this.zones.get(diff.index) !== diff.zone) {
          this.zones.set(diff.index, diff.zone);
          changed = true;
        }
      } else if (this.zones.has(diff.index)) {
        this.zones.delete(diff.index);
        changed = true;
      }
    }
    if (changed) this.rebuild();
  }

  private rebuild(): void {
    let slot = 0;
    for (const [index, zone] of this.zones) {
      this.matrix.setPosition(
        (index % this.gridSize) + 0.5,
        0.04,
        Math.floor(index / this.gridSize) + 0.5,
      );
      this.mesh.setMatrixAt(slot, this.matrix);
      this.mesh.setColorAt(slot, ZONE_TINTS[zone] ?? new THREE.Color(0xffffff));
      slot++;
    }
    this.mesh.count = slot;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
