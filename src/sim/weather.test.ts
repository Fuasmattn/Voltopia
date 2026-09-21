import { describe, expect, it } from 'vitest';
import { createSimState } from './state.ts';
import {
  solarFactor,
  sunIntensity,
  SUNRISE,
  SUNSET,
  updateWeather,
  windFactor,
} from './weather.ts';

describe('sunIntensity', () => {
  it('is zero at night and before sunrise', () => {
    expect(sunIntensity(0)).toBe(0);
    expect(sunIntensity(SUNRISE)).toBe(0);
    expect(sunIntensity(0.9)).toBe(0);
  });

  it('peaks at noon', () => {
    expect(sunIntensity(0.5)).toBeCloseTo(1, 5);
    expect(sunIntensity(0.35)).toBeGreaterThan(0);
    expect(sunIntensity(0.35)).toBeLessThan(1);
  });

  it('is symmetric around noon', () => {
    expect(sunIntensity(0.35)).toBeCloseTo(sunIntensity(0.65), 5);
  });

  it('is zero at sunset', () => {
    expect(sunIntensity(SUNSET)).toBeCloseTo(0, 5);
  });
});

describe('solarFactor', () => {
  it('full sun with clear sky gives full output', () => {
    expect(solarFactor(0.5, 0)).toBeCloseTo(1, 5);
  });

  it('overcast sky strongly reduces output but keeps diffuse share', () => {
    const overcast = solarFactor(0.5, 1);
    expect(overcast).toBeGreaterThan(0);
    expect(overcast).toBeLessThan(0.2);
  });

  it('no output at night regardless of clouds', () => {
    expect(solarFactor(0, 0)).toBe(0);
  });
});

describe('windFactor', () => {
  it('is zero below the cut-in speed', () => {
    expect(windFactor(0)).toBe(0);
    expect(windFactor(0.05)).toBe(0);
  });

  it('rises with the cube of wind speed and caps at 1', () => {
    expect(windFactor(0.3)).toBeGreaterThan(0);
    expect(windFactor(0.3)).toBeLessThan(windFactor(0.5));
    expect(windFactor(1)).toBe(1);
  });
});

describe('updateWeather', () => {
  it('keeps values within 0..1 over a long run', () => {
    const state = createSimState(99, 8);
    for (let i = 0; i < 20_000; i++) {
      updateWeather(state);
      expect(state.weather.cloudCover).toBeGreaterThanOrEqual(0);
      expect(state.weather.cloudCover).toBeLessThanOrEqual(1);
      expect(state.weather.windSpeed).toBeGreaterThanOrEqual(0);
      expect(state.weather.windSpeed).toBeLessThanOrEqual(1);
    }
  });

  it('changes smoothly from tick to tick', () => {
    const state = createSimState(7, 8);
    for (let i = 0; i < 5_000; i++) {
      const before = { ...state.weather };
      updateWeather(state);
      expect(Math.abs(state.weather.cloudCover - before.cloudCover)).toBeLessThan(0.05);
      expect(Math.abs(state.weather.windSpeed - before.windSpeed)).toBeLessThan(0.05);
    }
  });

  it('actually varies over time', () => {
    const state = createSimState(3, 8);
    const values = new Set<number>();
    for (let i = 0; i < 2_000; i++) {
      updateWeather(state);
      values.add(Math.round(state.weather.cloudCover * 20));
    }
    expect(values.size).toBeGreaterThan(3);
  });

  it('is deterministic for the same seed', () => {
    const a = createSimState(5, 8);
    const b = createSimState(5, 8);
    for (let i = 0; i < 1_000; i++) {
      updateWeather(a);
      updateWeather(b);
    }
    expect(a.weather).toEqual(b.weather);
  });
});
