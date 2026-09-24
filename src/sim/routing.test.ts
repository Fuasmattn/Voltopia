import { describe, expect, it } from 'vitest';
import { tileIndex } from '../shared/grid.ts';
import { findRoadPath, roadDistances } from './routing.ts';
import { buildRoads } from './roads.ts';
import { createSimState } from './state.ts';

const SIZE = 24;
const at = (x: number, y: number) => tileIndex(x, y, SIZE);

/** One straight street from (2,10) to (20,10) plus a stub going south at x=10. */
function town() {
  const state = createSimState(1, SIZE);
  buildRoads(
    state,
    Array.from({ length: 19 }, (_, i) => at(i + 2, 10)),
  );
  buildRoads(state, [at(10, 11), at(10, 12), at(10, 13)]);
  return state;
}

describe('roadDistances', () => {
  it('matches path lengths on an unloaded street map', () => {
    const state = town();
    const distances = roadDistances(state, at(2, 10));
    expect(distances.get(at(2, 10))).toBe(0);
    expect(distances.get(at(20, 10))).toBe(18);
    expect(distances.get(at(10, 13))).toBe(findRoadPath(state, at(2, 10), at(10, 13))!.length - 1);
  });

  it('omits tiles beyond maxCost and non-road tiles', () => {
    const state = town();
    const distances = roadDistances(state, at(2, 10), 5);
    expect(distances.has(at(7, 10))).toBe(true);
    expect(distances.has(at(8, 10))).toBe(false);
    expect(distances.has(at(2, 9))).toBe(false);
  });

  it('is empty from a non-road tile', () => {
    const state = town();
    expect(roadDistances(state, at(0, 0)).size).toBe(0);
  });

  it('is deterministic', () => {
    const a = [...roadDistances(town(), at(2, 10)).entries()];
    const b = [...roadDistances(town(), at(2, 10)).entries()];
    expect(a).toEqual(b);
  });
});
