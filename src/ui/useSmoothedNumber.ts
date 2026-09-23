/**
 * Eases a fast-changing number toward its latest value for display, so
 * per-tick sim noise (weather-driven generation, budget swings) doesn't
 * make HUD digits flicker. Driven by requestAnimationFrame, independent
 * of the sim's own 4/s tick — purely a display-layer smoothing, the sim
 * state itself is never delayed or altered.
 */
import { useEffect, useRef, useState } from 'react';

/** Fraction of the remaining gap closed per second. Higher = snappier. */
const DEFAULT_RATE = 8;

/** Below this we snap to the target instead of chasing it forever. */
const EPSILON = 1e-3;

/**
 * One frame's worth of exponential easing from `current` toward `target`.
 * Pulled out as a pure function so it's unit-testable without mounting a
 * component or driving requestAnimationFrame.
 */
export function smoothStep(current: number, target: number, rate: number, dt: number): number {
  if (!Number.isFinite(current) || dt <= 0) return target;
  const diff = target - current;
  if (Math.abs(diff) < EPSILON) return target;
  const factor = 1 - Math.exp(-rate * dt);
  return current + diff * factor;
}

export function useSmoothedNumber(target: number, rate: number = DEFAULT_RATE): number {
  const [display, setDisplay] = useState(target);
  const displayRef = useRef(target);

  useEffect(() => {
    if (Math.abs(target - displayRef.current) < EPSILON) {
      displayRef.current = target;
      setDisplay(target);
      return;
    }

    let frame: number;
    let last = performance.now();

    const step = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const next = smoothStep(displayRef.current, target, rate, dt);
      displayRef.current = next;
      setDisplay(next);
      if (Math.abs(target - next) >= EPSILON) {
        frame = requestAnimationFrame(step);
      }
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, rate]);

  return display;
}
