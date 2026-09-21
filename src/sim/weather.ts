import { BALANCE, TICKS_PER_DAY } from '../shared/constants.ts';
import { timeOfDay } from './tick.ts';
import type { SimState } from './state.ts';

import { SUNRISE, SUNSET, sunIntensity } from '../shared/daylight.ts';

export { SUNRISE, SUNSET, sunIntensity };

/**
 * Photovoltaic output factor 0..1: sun position attenuated by clouds.
 * Overcast skies still deliver some diffuse irradiance.
 */
export function solarFactor(time: number, cloudCover: number): number {
  return sunIntensity(time) * (1 - 0.85 * cloudCover);
}

/**
 * Wind turbine output factor 0..1. Below the cut-in speed the rotor
 * stands still; above it output rises with the cube of wind speed,
 * as with real turbines.
 */
export function windFactor(windSpeed: number): number {
  if (windSpeed < BALANCE.energy.windCutInSpeed) return 0;
  return Math.min(1, windSpeed ** 3 / 0.6 ** 3);
}

/**
 * Multi-day pressure systems: slowly moving fronts shift the mean that
 * the short-term weather noise reverts to. Stateless in (seed, tick), so
 * save games reproduce the same fronts. When a high-cloud front meets a
 * low-wind front, the city faces a genuine Dunkelflaute.
 */
export function frontMeans(seed: number, tick: number): { cloudMean: number; windMean: number } {
  const { cloud, wind } = BALANCE.weather.fronts;
  return {
    cloudMean: frontValue(seed, tick, cloud, 0),
    windMean: frontValue(seed, tick, wind, 1),
  };
}

function frontValue(
  seed: number,
  tick: number,
  config: {
    periodsDays: readonly number[];
    amplitudes: readonly number[];
    base: number;
  },
  channel: number,
): number {
  let value = config.base;
  for (let i = 0; i < config.periodsDays.length; i++) {
    // Seed-derived phase per wave so every city gets its own fronts.
    const phase = (((seed >>> (channel * 8 + i * 4)) & 0xff) / 255) * 2 * Math.PI;
    const period = config.periodsDays[i] * TICKS_PER_DAY;
    value += config.amplitudes[i] * Math.sin((2 * Math.PI * tick) / period + phase);
  }
  return Math.min(0.95, Math.max(0.05, value));
}

/**
 * Advance cloud cover and wind speed by one tick: a seeded random walk
 * with mean reversion toward the current front means, so weather varies
 * smoothly, reproducibly, and with multi-day character.
 */
export function updateWeather(state: SimState): void {
  const { cloudDrift, windDrift } = BALANCE.weather;
  const { cloudMean, windMean } = frontMeans(state.seed, state.tick);
  const w = state.weather;
  w.cloudCover = drift(w.cloudCover, state.rng.next(), cloudDrift, cloudMean);
  w.windSpeed = drift(w.windSpeed, state.rng.next(), windDrift, windMean);
}

function drift(value: number, random: number, step: number, mean: number): number {
  const reversion = (mean - value) * step * 2;
  const noise = (random - 0.5) * 2 * step * 8;
  return Math.min(1, Math.max(0, value + reversion + noise));
}

/** Convenience: current solar factor of the simulation state. */
export function currentSolarFactor(state: SimState): number {
  return solarFactor(timeOfDay(state.tick), state.weather.cloudCover);
}

/** Convenience: current wind factor of the simulation state. */
export function currentWindFactor(state: SimState): number {
  return windFactor(state.weather.windSpeed);
}
