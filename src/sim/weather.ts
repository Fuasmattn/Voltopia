import { BALANCE } from '../shared/constants.ts';
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
 * Advance cloud cover and wind speed by one tick: a seeded random walk
 * with mean reversion, so weather varies smoothly and reproducibly.
 */
export function updateWeather(state: SimState): void {
  const { cloudDrift, windDrift } = BALANCE.weather;
  const w = state.weather;
  w.cloudCover = drift(w.cloudCover, state.rng.next(), cloudDrift, 0.45);
  w.windSpeed = drift(w.windSpeed, state.rng.next(), windDrift, 0.5);
}

function drift(
  value: number,
  random: number,
  step: number,
  mean: number,
): number {
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
