import { BALANCE, TICKS_PER_DAY } from '../shared/constants.ts';
import { inBounds, neighbors4, tileIndex, tileX, tileY } from '../shared/grid.ts';
import { Rng } from '../shared/rng.ts';
import { Terrain, type TideState } from '../shared/types.ts';
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

const HOURS_PER_DAY = 24;

/** Angular phase of one tidal constituent at a tick. */
function tidePhase(tick: number, periodHours: number): number {
  const periodTicks = (periodHours / HOURS_PER_DAY) * TICKS_PER_DAY;
  return (2 * Math.PI * tick) / periodTicks;
}

/**
 * Water level, -1 (low water) .. 1 (high water). Two constituents — the
 * lunar (12.42 h) and the solar (12.00 h) semidiurnal tide — whose beat
 * produces spring and neap tides every ~7.4 in-game days without any
 * extra envelope. A pure function of the tick: deterministic, nothing to
 * persist.
 */
export function tideLevel(tick: number): number {
  const { lunarPeriodHours, solarPeriodHours, solarWeight } = BALANCE.sea.tide;
  const lunar = Math.cos(tidePhase(tick, lunarPeriodHours));
  const solar = Math.cos(tidePhase(tick, solarPeriodHours));
  return (lunar + solarWeight * solar) / (1 + solarWeight);
}

/**
 * Tidal current strength, 0..1 — what a tidal plant's output scales
 * with. The current runs a quarter period ahead of the level: slack at
 * high and low water, strongest at mid-tide, so there are four
 * generation peaks per day. (The exact derivative would weight the terms
 * by 1/period as well; the two periods differ by 3 %, which would only
 * rescale solarWeight.)
 */
export function tideFactor(tick: number): number {
  const { lunarPeriodHours, solarPeriodHours, solarWeight } = BALANCE.sea.tide;
  const lunar = Math.sin(tidePhase(tick, lunarPeriodHours));
  const solar = Math.sin(tidePhase(tick, solarPeriodHours));
  return Math.abs(lunar + solarWeight * solar) / (1 + solarWeight);
}

/** True on a sea tile that touches land — where a tidal plant may stand. */
export function isCoastalSea(state: SimState, index: number): boolean {
  const { terrain } = state.layers;
  if (terrain[index] !== Terrain.Sea) return false;
  return neighbors4(index, state.size).some((n) => terrain[n] === Terrain.Land);
}

/**
 * Wind turbine output factor for a tile: offshore, the wind is free and
 * unsheltered — a flat bonus, no height to gain and no woods to hide
 * behind. On land, elevation and shelter decide it instead, so the
 * caller passes in that already-computed factor and gets it back
 * unchanged when the tile is not at sea.
 */
export function windTurbineFactor(state: SimState, index: number, landFactor: number): number {
  return state.layers.terrain[index] === Terrain.Sea
    ? 1 + BALANCE.sea.offshoreWindBonus
    : landFactor;
}

/**
 * Output factor of a tidal plant on this tile. Narrow water runs fast:
 * the more of the eight neighbours are land, the stronger the current.
 * A river mouth within `estuaryRadius` adds its own bonus. Off-map
 * neighbours count as open water, so the map edge is never a narrows.
 * Water neighbours (river, lake, sea) never narrow the channel — only
 * actual land does — so a river or lake tile in the ring costs a
 * narrowness point same as open sea would; the estuary bonus below is
 * the river's own, separate reward.
 */
export function tidalSiteFactor(state: SimState, index: number): number {
  const cfg = BALANCE.sea.tidal;
  const { terrain } = state.layers;
  const { size } = state;
  const cx = tileX(index, size);
  const cy = tileY(index, size);

  let land = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const x = cx + dx;
      const y = cy + dy;
      if (!inBounds(x, y, size)) continue;
      if (terrain[tileIndex(x, y, size)] === Terrain.Land) land++;
    }
  }
  let factor = 1 + cfg.currentBonus * (land / 8);

  const r = cfg.estuaryRadius;
  for (let dy = -r; dy <= r && factor < cfg.maxSiteFactor; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (!inBounds(x, y, size)) continue;
      if (terrain[tileIndex(x, y, size)] === Terrain.River) {
        factor += cfg.estuaryBonus;
        dy = r + 1; // found one; stop both loops
        break;
      }
    }
  }
  return Math.min(cfg.maxSiteFactor, factor);
}

/** The tide at a tick, ready for the HUD. */
export function tideState(tick: number): TideState {
  const level = tideLevel(tick);
  return { level, factor: tideFactor(tick), rising: level > tideLevel(tick - 1) };
}
