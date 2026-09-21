/** Grid index math. Tiles are addressed by index = y * size + x. */

export function tileIndex(x: number, y: number, size: number): number {
  return y * size + x;
}

export function tileX(index: number, size: number): number {
  return index % size;
}

export function tileY(index: number, size: number): number {
  return Math.floor(index / size);
}

export function inBounds(x: number, y: number, size: number): boolean {
  return x >= 0 && y >= 0 && x < size && y < size;
}

/** Road connection bits. */
export const DIR_N = 1;
export const DIR_E = 2;
export const DIR_S = 4;
export const DIR_W = 8;

/** Neighbor offsets in bit order N, E, S, W (N = -y). */
export const DIRECTIONS: ReadonlyArray<{ dx: number; dy: number; bit: number }> = [
  { dx: 0, dy: -1, bit: DIR_N },
  { dx: 1, dy: 0, bit: DIR_E },
  { dx: 0, dy: 1, bit: DIR_S },
  { dx: -1, dy: 0, bit: DIR_W },
];

/** Indices of the 4-neighbors of a tile that are inside the grid. */
export function neighbors4(index: number, size: number): number[] {
  const x = tileX(index, size);
  const y = tileY(index, size);
  const result: number[] = [];
  for (const { dx, dy } of DIRECTIONS) {
    if (inBounds(x + dx, y + dy, size)) {
      result.push(tileIndex(x + dx, y + dy, size));
    }
  }
  return result;
}

/**
 * Tiles along an L-shaped path from a to b (horizontal leg first),
 * as used for drag-to-draw road building. Includes both endpoints.
 */
export function lShapedPath(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  size: number,
): number[] {
  const tiles: number[] = [];
  const push = (x: number, y: number): void => {
    if (inBounds(x, y, size)) tiles.push(tileIndex(x, y, size));
  };
  const stepX = Math.sign(bx - ax);
  for (let x = ax; ; x += stepX) {
    push(x, ay);
    if (x === bx) break;
  }
  const stepY = Math.sign(by - ay);
  for (let y = ay + stepY; stepY !== 0; y += stepY) {
    push(bx, y);
    if (y === by) break;
  }
  return tiles;
}

/** All tiles in the axis-aligned rectangle spanned by two corners. */
export function rectTiles(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  size: number,
): number[] {
  const tiles: number[] = [];
  const minX = Math.min(ax, bx);
  const maxX = Math.max(ax, bx);
  const minY = Math.min(ay, by);
  const maxY = Math.max(ay, by);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (inBounds(x, y, size)) tiles.push(tileIndex(x, y, size));
    }
  }
  return tiles;
}

/** Chebyshev (chessboard) distance between two tiles. */
export function chebyshevDistance(a: number, b: number, size: number): number {
  return Math.max(
    Math.abs(tileX(a, size) - tileX(b, size)),
    Math.abs(tileY(a, size) - tileY(b, size)),
  );
}
