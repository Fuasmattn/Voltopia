import type { TileDiff } from '../shared/types.ts';
import { PlantType, TileType, Zone } from '../shared/types.ts';
import type { DiffLayer } from './renderer.ts';

const COLORS = {
  ground: '#8fb573',
  road: '#5a6068',
  zoned: {
    [Zone.Residential]: '#a9d3ab',
    [Zone.Commercial]: '#a9c3e0',
    [Zone.Retail]: '#e0bfa9',
  } as Record<number, string>,
  building: {
    [Zone.Residential]: '#4c9a51',
    [Zone.Commercial]: '#3c6fb4',
    [Zone.Retail]: '#c07a45',
  } as Record<number, string>,
  plant: {
    [PlantType.SolarFarm]: '#2b3d66',
    [PlantType.WindTurbine]: '#e8eaec',
    [PlantType.Battery]: '#4d6b57',
    [PlantType.BiogasPlant]: '#93ab6d',
    [PlantType.ChargingHub]: '#58b7a4',
    [PlantType.Park]: '#3f7d46',
  } as Record<number, string>,
} as const;

/**
 * Keeps a one-pixel-per-tile canvas of the city in sync with the sim
 * diffs; the UI minimap draws from it.
 */
export class MinimapLayer implements DiffLayer {
  readonly canvas: HTMLCanvasElement;
  /** Incremented on every change so the UI knows when to redraw. */
  version = 0;
  private readonly context: CanvasRenderingContext2D;
  private readonly gridSize: number;

  constructor(gridSize: number) {
    this.gridSize = gridSize;
    this.canvas = document.createElement('canvas');
    this.canvas.width = gridSize;
    this.canvas.height = gridSize;
    this.context = this.canvas.getContext('2d')!;
    this.context.fillStyle = COLORS.ground;
    this.context.fillRect(0, 0, gridSize, gridSize);
  }

  applyDiffs(diffs: TileDiff[]): void {
    for (const diff of diffs) {
      this.context.fillStyle = this.tileColor(diff);
      this.context.fillRect(
        diff.index % this.gridSize,
        Math.floor(diff.index / this.gridSize),
        1,
        1,
      );
    }
    if (diffs.length > 0) this.version++;
  }

  private tileColor(diff: TileDiff): string {
    if (diff.tileType === TileType.Road) return COLORS.road;
    if (diff.tileType === TileType.Plant) {
      return COLORS.plant[diff.plantType] ?? COLORS.ground;
    }
    if (diff.density > 0) return COLORS.building[diff.zone] ?? COLORS.ground;
    if (diff.zone !== Zone.None) return COLORS.zoned[diff.zone] ?? COLORS.ground;
    return COLORS.ground;
  }
}
