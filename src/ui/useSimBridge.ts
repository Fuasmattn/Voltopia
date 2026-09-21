import { useCallback, useEffect, useRef, useState } from 'react';
import { GRID_SIZE } from '../shared/constants.ts';
import type { SimCommand, SimEvent } from '../shared/messages.ts';
import type {
  GlobalStats,
  LifetimeSample,
  SaveGame,
  TileDiff,
  VehicleState,
} from '../shared/types.ts';

export interface SimBridge {
  /** Latest global stats from the worker (null until the first tick). */
  stats: GlobalStats | null;
  /** Send a command to the simulation worker. */
  send: (command: SimCommand) => void;
  /** Subscribe to tile diffs (used by the renderer). */
  onDiffs: (listener: (diffs: TileDiff[]) => void) => () => void;
  onVehicles: (listener: (vehicles: VehicleState[]) => void) => () => void;
  onSaveData: (listener: (save: SaveGame) => void) => () => void;
  onLifetime: (listener: (samples: LifetimeSample[]) => void) => () => void;
  /** Most recent rejection reason (e.g. not enough money), transient. */
  rejection: string | null;
}

export interface SimBridgeOptions {
  seed: number;
  size?: number;
  save?: SaveGame;
  /** Starting funds for a brand-new city (difficulty setting). */
  startingMoney?: number;
}

const REJECTION_DISPLAY_MS = 2500;

/**
 * Owns the simulation Web Worker: boots it, forwards commands, and fans
 * incoming events out to React state (stats) and imperative listeners
 * (diffs and vehicles go straight to the renderer, bypassing React).
 */
export function useSimBridge(options: SimBridgeOptions): SimBridge {
  const workerRef = useRef<Worker | null>(null);
  const diffListeners = useRef(new Set<(diffs: TileDiff[]) => void>());
  const vehicleListeners = useRef(new Set<(vehicles: VehicleState[]) => void>());
  const saveListeners = useRef(new Set<(save: SaveGame) => void>());
  const lifetimeListeners = useRef(new Set<(samples: LifetimeSample[]) => void>());
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [rejection, setRejection] = useState<string | null>(null);
  const rejectionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const worker = new Worker(new URL('../sim/worker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = worker;

    worker.onmessage = (message: MessageEvent<SimEvent>) => {
      const event = message.data;
      switch (event.type) {
        case 'tick':
          if (event.diffs.length > 0) {
            for (const listener of diffListeners.current) listener(event.diffs);
          }
          for (const listener of vehicleListeners.current) listener(event.vehicles);
          setStats(event.stats);
          break;
        case 'saveData':
          for (const listener of saveListeners.current) listener(event.save);
          break;
        case 'lifetimeData':
          for (const listener of lifetimeListeners.current) listener(event.samples);
          break;
        case 'rejected':
          setRejection(event.reason);
          if (rejectionTimer.current) clearTimeout(rejectionTimer.current);
          rejectionTimer.current = setTimeout(() => setRejection(null), REJECTION_DISPLAY_MS);
          break;
        case 'ready':
          break;
      }
    };

    const init: SimCommand = {
      type: 'init',
      seed: options.seed,
      size: options.size ?? GRID_SIZE,
      ...(options.startingMoney !== undefined ? { startingMoney: options.startingMoney } : {}),
      ...(options.save ? { save: options.save } : {}),
    };
    worker.postMessage(init);

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
    // The worker lives for the lifetime of the app; options are read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = useCallback((command: SimCommand) => {
    workerRef.current?.postMessage(command);
  }, []);

  const onDiffs = useCallback((listener: (diffs: TileDiff[]) => void) => {
    diffListeners.current.add(listener);
    return () => diffListeners.current.delete(listener);
  }, []);

  const onVehicles = useCallback((listener: (vehicles: VehicleState[]) => void) => {
    vehicleListeners.current.add(listener);
    return () => vehicleListeners.current.delete(listener);
  }, []);

  const onSaveData = useCallback((listener: (save: SaveGame) => void) => {
    saveListeners.current.add(listener);
    return () => saveListeners.current.delete(listener);
  }, []);

  const onLifetime = useCallback((listener: (samples: LifetimeSample[]) => void) => {
    lifetimeListeners.current.add(listener);
    return () => lifetimeListeners.current.delete(listener);
  }, []);

  return { stats, send, onDiffs, onVehicles, onSaveData, onLifetime, rejection };
}
