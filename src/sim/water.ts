import { BALANCE } from '../shared/constants.ts';
import { inBounds, tileIndex } from '../shared/grid.ts';
import { Rng } from '../shared/rng.ts';
import { Terrain } from '../shared/types.ts';
import { markDirty, type SimState } from './state.ts';

/** Keeps map generation independent from the gameplay random stream. */
const WATER_SEED_SALT = 0x57a7e3;

interface RiverAxis {
  /** True: the river runs north→south (along = y, lateral = x). */
  vertical: boolean;
  entry: number;
  exit: number;
  phases: number[];
}

/**
 * Generate the map's water: one meandering river from one edge to the
 * opposite edge and one lake on the river. Deterministic per seed and
 * independent of the gameplay RNG. Terrain never changes afterwards.
 */
export function generateWater(state: SimState): void {
  const rng = new Rng((state.seed ^ WATER_SEED_SALT) >>> 0);
  const { size } = state;
  const cfg = BALANCE.water;
  const terrain = state.layers.terrain;
  terrain.fill(Terrain.Land);

  const lateralMin = cfg.edgeMargin;
  const lateralMax = size - 1 - cfg.edgeMargin;
  const axis: RiverAxis = {
    vertical: rng.chance(0.5),
    entry: lateralMin + rng.nextInt(lateralMax - lateralMin + 1),
    exit: lateralMin + rng.nextInt(lateralMax - lateralMin + 1),
    phases: cfg.meanderPeriods.map(() => rng.next() * 2 * Math.PI),
  };

  /** Smooth centre line: linear entry→exit plus two seeded sine meanders. */
  const centreLine = (t: number): number => {
    let lateral = axis.entry + (axis.exit - axis.entry) * t;
    for (let i = 0; i < cfg.meanderPeriods.length; i++) {
      lateral +=
        cfg.meanderAmplitudes[i] *
        size *
        Math.sin(2 * Math.PI * cfg.meanderPeriods[i] * t + axis.phases[i]);
    }
    return Math.min(lateralMax, Math.max(lateralMin, Math.round(lateral)));
  };

  const setTerrain = (along: number, lateral: number, value: Terrain): void => {
    const x = axis.vertical ? lateral : along;
    const y = axis.vertical ? along : lateral;
    if (inBounds(x, y, size)) terrain[tileIndex(x, y, size)] = value;
  };

  // River: rasterise the centre line row by row, filling the lateral span
  // between consecutive rows so the channel stays 4-connected.
  let previous = centreLine(0);
  let wideRemaining = 0;
  for (let along = 0; along < size; along++) {
    const lateral = centreLine(along / (size - 1));
    const lo = Math.min(previous, lateral);
    const hi = Math.max(previous, lateral);
    for (let l = lo; l <= hi; l++) setTerrain(along, l, Terrain.River);
    if (wideRemaining > 0) {
      setTerrain(along, lateral + 1, Terrain.River);
      wideRemaining--;
    } else if (rng.chance(cfg.wideSectionChance)) {
      wideRemaining = cfg.wideSectionLength;
    }
    previous = lateral;
  }

  // Lake: pick a position along the river that keeps the map centre dry.
  const [tMin, tMax] = cfg.lakePositionRange;
  const centre = size / 2;
  const minDistance = size / 4;
  const candidates: number[] = [];
  for (let i = 0; i < cfg.lakeCandidates; i++) {
    const t = tMin + ((tMax - tMin) * i) / (cfg.lakeCandidates - 1);
    const along = Math.round(t * (size - 1));
    const lateral = centreLine(t);
    const distance = Math.max(Math.abs(along - centre), Math.abs(lateral - centre));
    if (distance >= minDistance) candidates.push(i);
  }
  // t = tMin and t = tMax are always far enough along the axis for
  // tMin <= 0.25, so candidates is never empty; guard anyway.
  const pick = candidates.length > 0 ? candidates[rng.nextInt(candidates.length)] : 0;
  const tLake = tMin + ((tMax - tMin) * pick) / (cfg.lakeCandidates - 1);
  const lakeAlong = Math.round(tLake * (size - 1));
  const lakeLateral = centreLine(tLake);
  const [dMin, dMax] = cfg.lakeDiameter;
  const radiusAlong = rng.nextRange(dMin, dMax) / 2;
  const radiusLateral = rng.nextRange(dMin, dMax) / 2;
  const reach = Math.ceil(Math.max(radiusAlong, radiusLateral)) + 1;
  for (let da = -reach; da <= reach; da++) {
    for (let dl = -reach; dl <= reach; dl++) {
      const ellipse =
        (da * da) / (radiusAlong * radiusAlong) + (dl * dl) / (radiusLateral * radiusLateral);
      const noise = (rng.next() - 0.5) * cfg.lakeEdgeNoise;
      if (ellipse <= 1 + noise) setTerrain(lakeAlong + da, lakeLateral + dl, Terrain.Lake);
    }
  }

  for (let i = 0; i < size * size; i++) {
    if (terrain[i] !== Terrain.Land) markDirty(state, i);
  }
}
