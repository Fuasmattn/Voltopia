import { describe, expect, it } from 'vitest';
import { MinHeap } from './heap.ts';

describe('MinHeap', () => {
  it('pops values in ascending key order', () => {
    const heap = new MinHeap();
    for (const [key, value] of [
      [5, 50],
      [1, 10],
      [3, 30],
      [2, 20],
      [4, 40],
    ]) {
      heap.push(key, value);
    }
    const out: number[] = [];
    while (heap.size > 0) out.push(heap.pop()!);
    expect(out).toEqual([10, 20, 30, 40, 50]);
  });

  it('breaks equal keys by the smaller value, deterministically', () => {
    const heap = new MinHeap();
    heap.push(1, 9);
    heap.push(1, 3);
    heap.push(1, 6);
    expect(heap.pop()).toBe(3);
    expect(heap.pop()).toBe(6);
    expect(heap.pop()).toBe(9);
    expect(heap.pop()).toBeUndefined();
  });
});
