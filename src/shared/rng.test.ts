import { describe, expect, it } from 'vitest';
import { Rng } from './rng.ts';

describe('Rng', () => {
  it('is deterministic for the same seed', () => {
    const a = new Rng(1234);
    const b = new Rng(1234);
    for (let i = 0; i < 100; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it('produces different sequences for different seeds', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    const sequenceA = Array.from({ length: 10 }, () => a.next());
    const sequenceB = Array.from({ length: 10 }, () => b.next());
    expect(sequenceA).not.toEqual(sequenceB);
  });

  it('stays within [0, 1)', () => {
    const rng = new Rng(42);
    for (let i = 0; i < 1000; i++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('nextInt stays within range', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 1000; i++) {
      const value = rng.nextInt(5);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(5);
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it('nextRange stays within range', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 100; i++) {
      const value = rng.nextRange(2, 3);
      expect(value).toBeGreaterThanOrEqual(2);
      expect(value).toBeLessThan(3);
    }
  });

  it('chance(0) is never true and chance(1) is always true', () => {
    const rng = new Rng(9);
    for (let i = 0; i < 100; i++) {
      expect(rng.chance(0)).toBe(false);
      expect(rng.chance(1)).toBe(true);
    }
  });

  it('can save and restore its state', () => {
    const rng = new Rng(1000);
    rng.next();
    const saved = rng.getState();
    const a = rng.next();
    rng.setState(saved);
    expect(rng.next()).toBe(a);
  });
});
