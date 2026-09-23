import { BALANCE } from '../shared/constants.ts';
import { Rng } from '../shared/rng.ts';
import { markDirty, type SimState } from './state.ts';

/** Keeps relief generation independent of water gen and the gameplay RNG. */
const TERRAIN_SEED_SALT = 0x7e44a1;

/**
 * Generate the map's relief: seeded value noise plus a tilt toward one
 * seed-chosen edge, smoothed and quantised to levels 0..maxLevel. Extra
 * smoothing (and, as a last resort, flattening toward the mean) runs
 * until enough land is buildable. Deterministic per seed; elevation
 * never changes afterwards.
 */
export function generateTerrain(state: SimState): void {
  const rng = new Rng((state.seed ^ TERRAIN_SEED_SALT) >>> 0);
  const { size } = state;
  const cfg = BALANCE.terrain;

  // Octaves of value noise, combined and normalised to 0..1.
  const field = new Float32Array(size * size);
  let totalWeight = 0;
  for (let octave = 0; octave < cfg.octaveWeights.length; octave++) {
    const weight = cfg.octaveWeights[octave];
    const noise = valueNoise(rng, size, Math.max(2, cfg.noiseCellSize / 2 ** octave));
    for (let i = 0; i < field.length; i++) field[i] += weight * noise[i];
    totalWeight += weight;
  }
  // Shape the distribution toward low levels, then tilt toward one edge.
  const tiltEdge = rng.nextInt(4); // 0=+x, 1=-x, 2=+y, 3=-y rises
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const shaped = (field[i] / totalWeight) ** cfg.noiseExponent;
      const along =
        tiltEdge === 0 ? x : tiltEdge === 1 ? size - 1 - x : tiltEdge === 2 ? y : size - 1 - y;
      const tilt = (along / (size - 1)) * cfg.tiltLevels;
      field[i] = shaped * (cfg.maxLevel - cfg.tiltLevels) + tilt;
    }
  }

  for (let pass = 0; pass < cfg.smoothingPasses; pass++) boxBlur(field, size);
  const { elevation } = state.layers;
  quantize(field, elevation, cfg.maxLevel);

  // Buildable-land guarantee: blur more, then flatten toward the mean.
  let attempts = 0;
  while (buildableFraction(elevation, size, cfg.maxBuildSlope) < cfg.minBuildableFraction) {
    if (attempts < cfg.maxSmoothingAttempts) {
      boxBlur(field, size);
      quantize(field, elevation, cfg.maxLevel);
      attempts++;
    } else {
      // Deterministic fallback: converges to a constant field (fraction 1).
      const mean = field.reduce((sum, v) => sum + v, 0) / field.length;
      for (let i = 0; i < field.length; i++) field[i] = (field[i] + mean) / 2;
      quantize(field, elevation, cfg.maxLevel);
    }
  }

  for (let i = 0; i < elevation.length; i++) {
    if (elevation[i] > 0) markDirty(state, i);
  }
}

/** Seeded value noise: smooth bilinear interpolation over a random lattice. */
function valueNoise(rng: Rng, size: number, cellSize: number): Float32Array {
  const cells = Math.ceil(size / cellSize) + 2;
  const lattice = new Float32Array(cells * cells);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rng.next();
  const field = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = x / cellSize;
      const gy = y / cellSize;
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const tx = smoothstep(gx - x0);
      const ty = smoothstep(gy - y0);
      const v00 = lattice[y0 * cells + x0];
      const v10 = lattice[y0 * cells + x0 + 1];
      const v01 = lattice[(y0 + 1) * cells + x0];
      const v11 = lattice[(y0 + 1) * cells + x0 + 1];
      const top = v00 + (v10 - v00) * tx;
      const bottom = v01 + (v11 - v01) * tx;
      field[y * size + x] = top + (bottom - top) * ty;
    }
  }
  return field;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** In-place 3x3 box blur (edge tiles average their in-bounds window). */
function boxBlur(field: Float32Array, size: number): void {
  const source = field.slice();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          sum += source[ny * size + nx];
          count++;
        }
      }
      field[y * size + x] = sum / count;
    }
  }
}

function quantize(field: Float32Array, elevation: Uint8Array, maxLevel: number): void {
  for (let i = 0; i < field.length; i++) {
    elevation[i] = Math.min(maxLevel, Math.max(0, Math.round(field[i])));
  }
}

function buildableFraction(elevation: Uint8Array, size: number, maxSlope: number): number {
  let ok = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const level = elevation[y * size + x];
      let slope = 0;
      if (x > 0) slope = Math.max(slope, Math.abs(level - elevation[y * size + x - 1]));
      if (x < size - 1) slope = Math.max(slope, Math.abs(level - elevation[y * size + x + 1]));
      if (y > 0) slope = Math.max(slope, Math.abs(level - elevation[(y - 1) * size + x]));
      if (y < size - 1) slope = Math.max(slope, Math.abs(level - elevation[(y + 1) * size + x]));
      if (slope <= maxSlope) ok++;
    }
  }
  return ok / (size * size);
}
