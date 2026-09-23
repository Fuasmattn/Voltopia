import { BALANCE } from '../shared/constants.ts';
import { inBounds, neighbors4, tileIndex } from '../shared/grid.ts';
import { Rng } from '../shared/rng.ts';
import { Terrain } from '../shared/types.ts';
import { markDirty, type SimState } from './state.ts';

/** Keeps map generation independent from the gameplay random stream. */
const WATER_SEED_SALT = 0x57a7e3;

/**
 * Weight of the meander target against elevation in the lateral step cost
 * (steepest descent with the meander line as a tie-breaker). Plan-mandated.
 */
const MEANDER_TIE_BREAK_WEIGHT = 0.01;

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
 *
 * Expects `state.layers.elevation` to already hold the map's relief (see
 * `generateTerrain`): the river routes downhill by steepest descent and
 * carves its bed monotonically non-increasing in the flow direction; the
 * lake sinks into a basin at its lowest tile's level; banks are relaxed so
 * land next to water never exceeds the buildable slope by more than one
 * level.
 */
export function generateWater(state: SimState): void {
  const rng = new Rng((state.seed ^ WATER_SEED_SALT) >>> 0);
  const { size } = state;
  const cfg = BALANCE.water;
  const terrain = state.layers.terrain;
  const { elevation } = state.layers;
  terrain.fill(Terrain.Land);

  const lateralMin = cfg.edgeMargin;
  const lateralMax = size - 1 - cfg.edgeMargin;
  const axis: RiverAxis = {
    vertical: rng.chance(0.5),
    entry: lateralMin + rng.nextInt(lateralMax - lateralMin + 1),
    exit: lateralMin + rng.nextInt(lateralMax - lateralMin + 1),
    phases: cfg.meanderPeriods.map(() => rng.next() * 2 * Math.PI),
  };

  // Flow direction: downhill from the higher edge to the lower one.
  const meanRow = (along: number): number => {
    let sum = 0;
    for (let lateral = 0; lateral < size; lateral++) {
      const x = axis.vertical ? lateral : along;
      const y = axis.vertical ? along : lateral;
      sum += elevation[tileIndex(x, y, size)];
    }
    return sum / size;
  };
  const reversed = meanRow(0) < meanRow(size - 1);

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

  const elevationAt = (along: number, lateral: number): number => {
    const x = axis.vertical ? lateral : along;
    const y = axis.vertical ? along : lateral;
    return inBounds(x, y, size) ? elevation[tileIndex(x, y, size)] : Number.POSITIVE_INFINITY;
  };
  /** River tiles painted per along-row, for the carving pass below. */
  const riverRows: number[][] = Array.from({ length: size }, () => []);

  const setTerrain = (along: number, lateral: number, value: Terrain): void => {
    const x = axis.vertical ? lateral : along;
    const y = axis.vertical ? along : lateral;
    if (!inBounds(x, y, size)) return;
    const index = tileIndex(x, y, size);
    terrain[index] = value;
    if (value === Terrain.River) riverRows[along].push(index);
  };

  // River: rasterise the centre line row by row, stepping the lateral
  // position by at most one tile per row (steepest descent, meander as
  // tie-breaker) so the channel stays one tile wide (plus the occasional
  // wide section below).
  let previous = centreLine(0);
  let wideRemaining = 0;
  const laterals: number[] = Array.from({ length: size }, () => 0);
  for (let along = 0; along < size; along++) {
    const target = centreLine(along / (size - 1));
    let lateral = previous;
    if (along > 0) {
      let best = Number.POSITIVE_INFINITY;
      for (const candidate of [previous - 1, previous, previous + 1]) {
        if (candidate < lateralMin || candidate > lateralMax) continue;
        // Lowest ground wins; the meander target breaks ties.
        const cost =
          elevationAt(along, candidate) + Math.abs(candidate - target) * MEANDER_TIE_BREAK_WEIGHT;
        if (cost < best) {
          best = cost;
          lateral = candidate;
        }
      }
    } else {
      lateral = target;
    }
    const lo = Math.min(previous, lateral);
    const hi = Math.max(previous, lateral);
    for (let l = lo; l <= hi; l++) setTerrain(along, l, Terrain.River);
    if (wideRemaining > 0) {
      setTerrain(along, lateral + 1, Terrain.River);
      wideRemaining--;
    } else if (rng.chance(cfg.wideSectionChance)) {
      wideRemaining = cfg.wideSectionLength;
    }
    laterals[along] = lateral;
    previous = lateral;
  }

  // The river carves: levels are monotonically non-increasing downstream.
  let level = Number.POSITIVE_INFINITY;
  for (let step = 0; step < size; step++) {
    const along = reversed ? size - 1 - step : step;
    for (const i of riverRows[along]) level = Math.min(level, elevation[i]);
    for (const i of riverRows[along]) elevation[i] = level;
  }

  // Lake: pick a position along the river that keeps the map centre dry.
  const [tMin, tMax] = cfg.lakePositionRange;
  const centre = size / 2;
  const minDistance = size / 4;
  const candidates: number[] = [];
  for (let i = 0; i < cfg.lakeCandidates; i++) {
    const t = tMin + ((tMax - tMin) * i) / (cfg.lakeCandidates - 1);
    const along = Math.round(t * (size - 1));
    const lateral = laterals[along];
    const distance = Math.max(Math.abs(along - centre), Math.abs(lateral - centre));
    if (distance >= minDistance) candidates.push(i);
  }
  // t = tMin and t = tMax are always far enough along the axis for
  // tMin <= 0.25, so candidates is never empty; guard anyway.
  const pick = candidates.length > 0 ? candidates[rng.nextInt(candidates.length)] : 0;
  const tLake = tMin + ((tMax - tMin) * pick) / (cfg.lakeCandidates - 1);
  const lakeAlong = Math.round(tLake * (size - 1));
  const lakeLateral = laterals[lakeAlong];
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

  // Lake basin: sink every lake tile to the lowest one's level, then keep
  // the river downstream of the lake flowing at or below that level.
  const lakeTiles: number[] = [];
  for (let i = 0; i < size * size; i++) {
    if (terrain[i] === Terrain.Lake) lakeTiles.push(i);
  }
  let lakeLevel = 0;
  if (lakeTiles.length > 0) {
    lakeLevel = Math.min(...lakeTiles.map((i) => elevation[i]));
    for (const i of lakeTiles) elevation[i] = lakeLevel;
    // Water leaving the lake keeps flowing downhill. Clamp from the lake's
    // UPSTREAM-most row onward: river tiles inside the lake's along-span
    // but outside its ellipse would otherwise keep their carved (higher)
    // level once the lake sinks. Clamping the inflow row too is harmless
    // — it just merges it with the lake surface.
    const alongOf = (i: number): number => (axis.vertical ? Math.floor(i / size) : i % size);
    const lakeAlongs = lakeTiles.map(alongOf);
    const firstAlong = reversed ? Math.max(...lakeAlongs) : Math.min(...lakeAlongs);
    for (let step = 0; step < size; step++) {
      const along = reversed ? size - 1 - step : step;
      const pastLake = reversed ? along <= firstAlong : along >= firstAlong;
      if (!pastLake) continue;
      for (const i of riverRows[along]) elevation[i] = Math.min(elevation[i], lakeLevel);
    }
  }
  state.lakeLevel = lakeLevel;

  // Bank relaxation: land next to water never towers more than one
  // buildable slope step above it, so shores stay reachable.
  const bankLimit = BALANCE.terrain.maxBuildSlope + 1;
  for (let i = 0; i < size * size; i++) {
    if (terrain[i] === Terrain.Land) continue;
    for (const n of neighbors4(i, size)) {
      if (terrain[n] !== Terrain.Land) continue;
      if (elevation[n] > elevation[i] + bankLimit) {
        elevation[n] = elevation[i] + bankLimit;
        markDirty(state, n);
      }
    }
  }

  for (let i = 0; i < size * size; i++) {
    if (terrain[i] !== Terrain.Land) markDirty(state, i);
  }
}
