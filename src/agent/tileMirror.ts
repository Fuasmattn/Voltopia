/**
 * Main-thread copy of the tile layers, rebuilt from the diffs the worker
 * already streams to the renderer. The first tick after `init` carries
 * the full grid, so the mirror is complete as soon as the game is up.
 * Used by the agent tools to read the map without asking the worker.
 */
import { tileIndex } from '../shared/grid.ts';
import type {
  PlantType,
  SupplyStatus,
  Terrain,
  TileDiff,
  TileType,
  Zone,
} from '../shared/types.ts';

export interface MirroredTile {
  index: number;
  x: number;
  y: number;
  tileType: TileType;
  terrain: Terrain;
  zone: Zone;
  density: number;
  supplied: SupplyStatus;
  plantType: PlantType;
  roadMask: number;
  powerLine: number;
}

export class TileMirror {
  readonly size: number;
  readonly tileType: Uint8Array;
  readonly terrain: Uint8Array;
  readonly zone: Uint8Array;
  readonly density: Uint8Array;
  readonly supplied: Uint8Array;
  readonly plantType: Uint8Array;
  readonly roadMask: Uint8Array;
  readonly powerLine: Uint8Array;
  /** Number of diffs applied so far (0 = nothing received yet). */
  updates = 0;

  constructor(size: number) {
    this.size = size;
    const count = size * size;
    this.tileType = new Uint8Array(count);
    this.terrain = new Uint8Array(count);
    this.zone = new Uint8Array(count);
    this.density = new Uint8Array(count);
    this.supplied = new Uint8Array(count);
    this.plantType = new Uint8Array(count);
    this.roadMask = new Uint8Array(count);
    this.powerLine = new Uint8Array(count);
  }

  applyDiffs(diffs: TileDiff[]): void {
    for (const diff of diffs) {
      const i = diff.index;
      if (i < 0 || i >= this.tileType.length) continue;
      this.tileType[i] = diff.tileType;
      this.terrain[i] = diff.terrain;
      this.zone[i] = diff.zone;
      this.density[i] = diff.density;
      this.supplied[i] = diff.supplied;
      this.plantType[i] = diff.plantType;
      this.roadMask[i] = diff.roadMask;
      this.powerLine[i] = diff.powerLine;
    }
    this.updates += diffs.length;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.size && y < this.size;
  }

  at(x: number, y: number): MirroredTile {
    const index = tileIndex(x, y, this.size);
    return {
      index,
      x,
      y,
      tileType: this.tileType[index] as TileType,
      terrain: this.terrain[index] as Terrain,
      zone: this.zone[index] as Zone,
      density: this.density[index],
      supplied: this.supplied[index] as SupplyStatus,
      plantType: this.plantType[index] as PlantType,
      roadMask: this.roadMask[index],
      powerLine: this.powerLine[index],
    };
  }
}
