import { describe, expect, it } from 'vitest';
import { smoothStep } from './useSmoothedNumber.ts';

describe('smoothStep', () => {
  it('moves partway toward the target, never overshooting', () => {
    const next = smoothStep(0, 10, 8, 0.1);
    expect(next).toBeGreaterThan(0);
    expect(next).toBeLessThan(10);
  });

  it('converges to the target over repeated frames', () => {
    let value = 0;
    for (let i = 0; i < 200; i++) {
      value = smoothStep(value, 10, 8, 1 / 60);
    }
    expect(value).toBeCloseTo(10, 3);
  });

  it('snaps once within epsilon instead of crawling forever', () => {
    expect(smoothStep(9.9999, 10, 8, 1 / 60)).toBe(10);
  });

  it('handles a target moving every call, same as ticks arriving repeatedly', () => {
    let value = 0;
    value = smoothStep(value, 4, 8, 0.25);
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(4);
    value = smoothStep(value, 3, 8, 0.25);
    expect(value).toBeLessThan(4);
  });

  it('falls back to the target for a non-finite current or non-positive dt', () => {
    expect(smoothStep(NaN, 5, 8, 0.1)).toBe(5);
    expect(smoothStep(0, 5, 8, 0)).toBe(5);
  });
});
