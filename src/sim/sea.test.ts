import { describe, expect, it } from 'vitest';
import { BALANCE, TICKS_PER_DAY } from '../shared/constants.ts';
import { Terrain, TileType, Zone } from '../shared/types.ts';
import { createSimState, type SimState } from './state.ts';
import { generateTerrain } from './terrain.ts';
import { generateWater } from './water.ts';
import { seaCoverage, tideFactor, tideLevel, tidalSiteFactor, windTurbineFactor } from './sea.ts';

/** A generated map: elevation and water (river, lake, sea) but no zoning. */
function generatedState(seed: number, size: number): SimState {
  const state = createSimState(seed, size);
  generateTerrain(state);
  generateWater(state);
  return state;
}

/** Sea tiles of a state. */
function seaTiles(state: SimState): number[] {
  const out: number[] = [];
  for (let i = 0; i < state.layers.terrain.length; i++) {
    if (state.layers.terrain[i] === Terrain.Sea) out.push(i);
  }
  return out;
}

describe('sea generation', () => {
  it('puts sea on exactly one map edge', () => {
    for (const seed of [1, 2, 3, 7, 42]) {
      const state = generatedState(seed, 64);
      const { terrain } = state.layers;
      const size = state.size;
      const edges = [0, 1, 2, 3].map((edge) => {
        let count = 0;
        for (let i = 0; i < size; i++) {
          const index =
            edge === 0
              ? i // top row
              : edge === 1
                ? (size - 1) * size + i // bottom row
                : edge === 2
                  ? i * size // left column
                  : i * size + size - 1; // right column
          if (terrain[index] === Terrain.Sea) count++;
        }
        return count;
      });
      // Exactly one edge is fully sea; the two perpendicular edges are only
      // clipped at their ends, so they never reach a full row.
      expect(edges.filter((count) => count === size)).toHaveLength(1);
    }
  });

  it('keeps the sea within its depth range and size cap', () => {
    const cfg = BALANCE.sea;
    for (const seed of [1, 5, 9, 23]) {
      const state = generatedState(seed, 64);
      const tiles = seaTiles(state);
      expect(tiles.length).toBeGreaterThan(0);
      expect(tiles.length / (state.size * state.size)).toBeLessThanOrEqual(cfg.maxSeaFraction);
      // Every sea tile sits at sea level.
      for (const index of tiles) expect(state.layers.elevation[index]).toBe(0);
    }
  });

  it('lets the river reach the sea', () => {
    for (const seed of [1, 2, 3, 7, 42]) {
      const state = generatedState(seed, 64);
      const { terrain } = state.layers;
      const size = state.size;
      let touching = 0;
      for (let i = 0; i < terrain.length; i++) {
        if (terrain[i] !== Terrain.River) continue;
        const x = i % size;
        const y = Math.floor(i / size);
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          if (terrain[ny * size + nx] === Terrain.Sea) touching++;
        }
      }
      expect(touching).toBeGreaterThan(0);
    }
  });

  it('is deterministic per seed and varies across seeds', () => {
    const a = seaTiles(generatedState(11, 64));
    const b = seaTiles(generatedState(11, 64));
    const c = seaTiles(generatedState(12, 64));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
});

describe('tide clock', () => {
  it('stays in range', () => {
    for (let tick = 0; tick < 20 * TICKS_PER_DAY; tick += 7) {
      expect(tideLevel(tick)).toBeGreaterThanOrEqual(-1);
      expect(tideLevel(tick)).toBeLessThanOrEqual(1);
      expect(tideFactor(tick)).toBeGreaterThanOrEqual(0);
      expect(tideFactor(tick)).toBeLessThanOrEqual(1);
    }
  });

  it('is slack at high water', () => {
    // Tick 0: both constituents peak — spring high water, no current.
    expect(tideLevel(0)).toBeCloseTo(1, 5);
    expect(tideFactor(0)).toBeCloseTo(0, 5);
  });

  it('peaks about four times a day', () => {
    let peaks = 0;
    const days = 10;
    for (let tick = 1; tick < days * TICKS_PER_DAY - 1; tick++) {
      const previous = tideFactor(tick - 1);
      const current = tideFactor(tick);
      const next = tideFactor(tick + 1);
      if (current > previous && current >= next) peaks++;
    }
    // Peaks come every ~6.21 in-game hours → ~3.9 per day.
    expect(peaks).toBeGreaterThanOrEqual(37);
    expect(peaks).toBeLessThanOrEqual(41);
  });

  it('runs through spring and neap tides', () => {
    const springMax = dailyMax(0);
    // Half a beat period later (~7.39 days) the constituents cancel.
    const neapMax = dailyMax(Math.round(7.39 * TICKS_PER_DAY));
    expect(springMax).toBeGreaterThan(0.98);
    expect(neapMax).toBeLessThan(0.62);
    expect(neapMax).toBeGreaterThan(0.5);
  });

  it('is a pure function of the tick', () => {
    expect(tideFactor(1234)).toBe(tideFactor(1234));
    expect(tideLevel(1234)).toBe(tideLevel(1234));
  });
});

/** Highest current factor over the in-game day starting at `startTick`. */
function dailyMax(startTick: number): number {
  let max = 0;
  for (let tick = startTick; tick < startTick + TICKS_PER_DAY; tick++) {
    max = Math.max(max, tideFactor(tick));
  }
  return max;
}

describe('tidal site factor', () => {
  /** A 16x16 all-land state with the terrain painted by hand. */
  function paintedState(paint: (terrain: Uint8Array, size: number) => void) {
    const state = createSimState(1, 16);
    state.layers.terrain.fill(Terrain.Land);
    paint(state.layers.terrain, state.size);
    return state;
  }

  it('rewards a narrow inlet over a straight coast', () => {
    const straight = paintedState((terrain, size) => {
      for (let y = 0; y < 2; y++) {
        for (let x = 0; x < size; x++) terrain[y * size + x] = Terrain.Sea;
      }
    });
    const inlet = paintedState((terrain, size) => {
      // A one-tile channel poking into the land: land on both sides.
      for (let y = 0; y < 4; y++) terrain[y * size + 8] = Terrain.Sea;
    });
    const straightTile = 1 * 16 + 8; // coastal row of the open coast
    const inletTile = 3 * 16 + 8; // deep in the channel
    expect(tidalSiteFactor(inlet, inletTile)).toBeGreaterThan(
      tidalSiteFactor(straight, straightTile),
    );
  });

  it('adds the estuary bonus near a river tile', () => {
    const cfg = BALANCE.sea.tidal;
    const plain = paintedState((terrain, size) => {
      for (let x = 0; x < size; x++) terrain[x] = Terrain.Sea;
    });
    const estuary = paintedState((terrain, size) => {
      for (let x = 0; x < size; x++) terrain[x] = Terrain.Sea;
      // Chebyshev distance 2 from tile 8: outside the 8-neighbour ring
      // (so the narrowness term is identical to `plain`) but inside
      // estuaryRadius (2), so only the estuary bonus itself shows up.
      terrain[2 * 16 + 8] = Terrain.River;
    });
    expect(tidalSiteFactor(estuary, 8) - tidalSiteFactor(plain, 8)).toBeCloseTo(
      cfg.estuaryBonus,
      5,
    );
  });

  it('never exceeds the cap', () => {
    const enclosed = paintedState((terrain) => {
      terrain[5 * 16 + 5] = Terrain.Sea; // a single sea tile ringed by land
      terrain[4 * 16 + 5] = Terrain.River;
    });
    expect(tidalSiteFactor(enclosed, 5 * 16 + 5)).toBeLessThanOrEqual(
      BALANCE.sea.tidal.maxSiteFactor,
    );
  });

  it('scores a water neighbour lower than a land one (water never narrows the current)', () => {
    // Same ring, one tile swapped for water with no estuary bonus in
    // play (a lake doesn't trigger it): only the land-vs-water swap can
    // explain the difference. Pins the rule so a future change that
    // treats river/lake neighbours as narrowing fails loudly.
    const allLand = paintedState((terrain) => {
      terrain[5 * 16 + 5] = Terrain.Sea;
    });
    const withLakeNeighbour = paintedState((terrain) => {
      terrain[5 * 16 + 5] = Terrain.Sea;
      terrain[4 * 16 + 5] = Terrain.Lake; // one ring neighbour is water, not land
    });
    expect(tidalSiteFactor(withLakeNeighbour, 5 * 16 + 5)).toBeLessThan(
      tidalSiteFactor(allLand, 5 * 16 + 5),
    );
  });
});

describe('wind turbine factor', () => {
  it('replaces the land factor with the flat offshore bonus at sea', () => {
    const state = createSimState(1, 16);
    state.layers.terrain.fill(Terrain.Sea);
    const tile = 5 * 16 + 5;
    // A deliberately unrelated land factor: at sea it must be ignored.
    expect(windTurbineFactor(state, tile, 999)).toBeCloseTo(1 + BALANCE.sea.offshoreWindBonus, 5);
  });

  it('passes the land factor through unchanged on land', () => {
    const state = createSimState(1, 16);
    state.layers.terrain.fill(Terrain.Land);
    const tile = 5 * 16 + 5;
    expect(windTurbineFactor(state, tile, 2.5)).toBe(2.5);
  });
});

describe('coastal happiness coverage', () => {
  it('counts only buildings with the sea within the coast radius', () => {
    const state = createSimState(1, 32);
    state.layers.terrain.fill(Terrain.Land);
    for (let x = 0; x < state.size; x++) state.layers.terrain[x] = Terrain.Sea;

    const radius = BALANCE.sea.coastRadius;
    // One building just inside the radius, one far inland.
    const near = radius * state.size + 5;
    const far = (radius + 6) * state.size + 5;
    for (const index of [near, far]) {
      state.layers.tileType[index] = TileType.Empty;
      state.layers.zone[index] = Zone.Residential;
      state.layers.density[index] = 1;
    }
    expect(seaCoverage(state)).toBeCloseTo(0.5, 5);
  });

  it('is zero without buildings', () => {
    const state = createSimState(1, 32);
    expect(seaCoverage(state)).toBe(0);
  });
});
