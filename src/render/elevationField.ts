import type { TileDiff } from '../shared/types.ts';
import type { DiffLayer } from './renderer.ts';

/** World height of one elevation level. */
export const LEVEL_HEIGHT = 0.35;

/**
 * Per-tile elevation tracked from sim diffs, shared by every render
 * layer. Registered as the FIRST diff layer so heights are current
 * before the other layers rebuild. Corner heights average the adjacent
 * tiles — that interpolation is what makes the slopes smooth.
 */
export class ElevationField implements DiffLayer {
  /** Incremented whenever any height changes; layers rebuild on change. */
  version = 0;
  private readonly levels: Uint8Array;
  private readonly size: number;

  constructor(gridSize: number) {
    this.size = gridSize;
    this.levels = new Uint8Array(gridSize * gridSize);
  }

  applyDiffs(diffs: TileDiff[]): void {
    let changed = false;
    for (const diff of diffs) {
      if (this.levels[diff.index] !== diff.elevation) {
        this.levels[diff.index] = diff.elevation;
        changed = true;
      }
    }
    if (changed) this.version++;
  }

  levelAt(index: number): number {
    return this.levels[index];
  }

  /** Largest level difference to a 4-neighbour (mirrors sim slopeAt). */
  slopeAt(index: number): number {
    const size = this.size;
    const x = index % size;
    const z = Math.floor(index / size);
    let slope = 0;
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
      slope = Math.max(slope, Math.abs(this.levels[index] - this.levels[nz * size + nx]));
    }
    return slope;
  }

  /** Tile centre height in world units (built tiles sit flat on this). */
  centerY(index: number): number {
    return this.levels[index] * LEVEL_HEIGHT;
  }

  /** Height of the ground-mesh vertex at integer corner (vx, vz). */
  cornerY(vx: number, vz: number): number {
    const size = this.size;
    let sum = 0;
    let count = 0;
    for (const [dx, dz] of [
      [-1, -1],
      [0, -1],
      [-1, 0],
      [0, 0],
    ] as const) {
      const x = vx + dx;
      const z = vz + dz;
      if (x < 0 || z < 0 || x >= size || z >= size) continue;
      sum += this.levels[z * size + x];
      count++;
    }
    return count > 0 ? (sum / count) * LEVEL_HEIGHT : 0;
  }

  /** Highest ground corner of a tile — flat decals sit here so the
   *  corner-averaged ground can never cover them. */
  maxCornerY(index: number): number {
    const size = this.size;
    const x = index % size;
    const z = Math.floor(index / size);
    return Math.max(
      this.cornerY(x, z),
      this.cornerY(x + 1, z),
      this.cornerY(x, z + 1),
      this.cornerY(x + 1, z + 1),
    );
  }

  /** Smooth ground height at a continuous tile-space position. */
  surfaceY(x: number, z: number): number {
    const size = this.size;
    const cx = Math.min(size - 1, Math.max(0, Math.floor(x)));
    const cz = Math.min(size - 1, Math.max(0, Math.floor(z)));
    const tx = Math.min(1, Math.max(0, x - cx));
    const tz = Math.min(1, Math.max(0, z - cz));
    const h00 = this.cornerY(cx, cz);
    const h10 = this.cornerY(cx + 1, cz);
    const h01 = this.cornerY(cx, cz + 1);
    const h11 = this.cornerY(cx + 1, cz + 1);
    const top = h00 + (h10 - h00) * tx;
    const bottom = h01 + (h11 - h01) * tx;
    return top + (bottom - top) * tz;
  }
}
