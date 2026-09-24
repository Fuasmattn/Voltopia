import { BALANCE } from '../shared/constants.ts';
import { tileIndex } from '../shared/grid.ts';
import { Rng } from '../shared/rng.ts';
import { Terrain } from '../shared/types.ts';
import { markDirty, type SimState } from './state.ts';

/** Keeps the coastline independent of terrain, river and gameplay RNG. */
const SEA_SEED_SALT = 0x5ea1c3;

/**
 * Carve the sea: a band along the map edge the river flows toward, so
 * the river always ends in an estuary. Called from `generateWater` after
 * the river axis is known and before the channel is rasterised — the
 * rasteriser then stops where the sea begins.
 *
 * `vertical` and `reversed` are the river axis and flow direction;
 * `mouthLateral` is the centre line's lateral position at the downstream
 * edge, around which the band widens into a bay.
 *
 * Sea tiles sit at elevation 0 (sea level). The band is capped at
 * `maxSeaFraction` of the map so the coast never eats the city's room.
 */
export function carveSea(
  state: SimState,
  vertical: boolean,
  reversed: boolean,
  mouthLateral: number,
): void {
  const rng = new Rng((state.seed ^ SEA_SEED_SALT) >>> 0);
  const { size } = state;
  const cfg = BALANCE.sea;
  const { terrain, elevation } = state.layers;

  // The river flows toward along = 0 when reversed, else toward size-1.
  const fromEnd = !reversed;
  const [minDepth, maxDepth] = cfg.depthRange;
  const depths = depthProfile(rng, size, minDepth, maxDepth, cfg.depthCellSize);

  // Widen into a bay at the mouth: the enclosed water is what the tidal
  // site factor rewards, and it guarantees a strong first site.
  for (let lateral = 0; lateral < size; lateral++) {
    const distance = Math.abs(lateral - mouthLateral);
    if (distance > cfg.estuaryTaper) continue;
    depths[lateral] += Math.round(cfg.estuaryWidening * (1 - distance / cfg.estuaryTaper));
  }

  // Size cap: shave the deepest column (lowest lateral wins ties) until
  // the band fits. Bounded — every pass removes one tile.
  const maxTiles = Math.floor(size * size * cfg.maxSeaFraction);
  let total = depths.reduce((sum, depth) => sum + depth, 0);
  while (total > maxTiles) {
    let deepest = 0;
    for (let lateral = 1; lateral < size; lateral++) {
      if (depths[lateral] > depths[deepest]) deepest = lateral;
    }
    if (depths[deepest] <= cfg.minDepth) break;
    depths[deepest]--;
    total--;
  }

  for (let lateral = 0; lateral < size; lateral++) {
    for (let d = 0; d < depths[lateral]; d++) {
      const along = fromEnd ? size - 1 - d : d;
      const x = vertical ? lateral : along;
      const y = vertical ? along : lateral;
      const index = tileIndex(x, y, size);
      terrain[index] = Terrain.Sea;
      elevation[index] = 0;
      markDirty(state, index);
    }
  }
}

/** Smooth seeded depth per column along the coast. */
function depthProfile(
  rng: Rng,
  size: number,
  minDepth: number,
  maxDepth: number,
  cellSize: number,
): number[] {
  const cells = Math.ceil(size / cellSize) + 2;
  const lattice = Array.from({ length: cells }, () => rng.next());
  const depths: number[] = [];
  for (let lateral = 0; lateral < size; lateral++) {
    const g = lateral / cellSize;
    const i0 = Math.floor(g);
    const t = smoothstep(g - i0);
    const value = lattice[i0] + (lattice[i0 + 1] - lattice[i0]) * t;
    depths.push(Math.round(minDepth + value * (maxDepth - minDepth)));
  }
  return depths;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}
