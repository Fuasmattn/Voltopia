import { BALANCE } from '../shared/constants.ts';
import { neighbors4, tileIndex, tileX, tileY } from '../shared/grid.ts';
import { PlantType, TileType } from '../shared/types.ts';
import type { SimState } from './state.ts';

/** Plants that feed the grid and seed the line network (hubs and parks do not). */
const SUPPLY_SOURCES: ReadonlySet<PlantType> = new Set<PlantType>([
  PlantType.SolarFarm,
  PlantType.WindTurbine,
  PlantType.Battery,
  PlantType.BiogasPlant,
  PlantType.RunOfRiver,
  PlantType.PumpedStorage,
]);

export function isSupplySource(plant: PlantType): boolean {
  return SUPPLY_SOURCES.has(plant);
}

/** Mark every tile within a Chebyshev radius of `index`, clipped to the map. */
function stampRadius(target: Uint8Array, index: number, size: number, radius: number): void {
  const cx = tileX(index, size);
  const cy = tileY(index, size);
  const x0 = Math.max(0, cx - radius);
  const x1 = Math.min(size - 1, cx + radius);
  const y0 = Math.max(0, cy - radius);
  const y1 = Math.min(size - 1, cy + radius);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) target[tileIndex(x, y, size)] = 1;
  }
}

/**
 * Rebuild the energized layer when plants or lines changed: flood-fill
 * from every supply plant over 4-connected line tiles, then stamp the
 * connection radius around every energised line tile and every supply
 * plant. Line tiles the fill never reaches are dead.
 */
export function recomputeGrid(state: SimState): void {
  if (state.gridComputedVersion === state.gridVersion) return;
  const { layers } = state;
  const size = state.size;
  const { powerLine, energized, tileType, plantType } = layers;
  const radius = BALANCE.energy.lineSupplyRadius;

  const reached = new Uint8Array(size * size);
  const queue: number[] = [];
  const sources: number[] = [];
  for (let i = 0; i < tileType.length; i++) {
    if (tileType[i] !== TileType.Plant || !isSupplySource(plantType[i] as PlantType)) continue;
    sources.push(i);
    for (const n of neighbors4(i, size)) {
      if (powerLine[n] !== 0 && reached[n] === 0) {
        reached[n] = 1;
        queue.push(n);
      }
    }
  }
  while (queue.length > 0) {
    const index = queue.pop()!;
    for (const n of neighbors4(index, size)) {
      if (powerLine[n] !== 0 && reached[n] === 0) {
        reached[n] = 1;
        queue.push(n);
      }
    }
  }

  energized.fill(0);
  for (const source of sources) stampRadius(energized, source, size, radius);
  for (let i = 0; i < reached.length; i++) {
    if (reached[i] === 1) stampRadius(energized, i, size, radius);
  }
  state.gridComputedVersion = state.gridVersion;
}
