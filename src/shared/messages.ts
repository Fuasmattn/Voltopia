import type {
  GlobalStats,
  LifetimeSample,
  PlantType,
  SaveGame,
  Speed,
  TileDiff,
  VehicleState,
  Zone,
} from './types.ts';

/** Commands sent from the main thread to the simulation worker. */
export type SimCommand =
  | {
      type: 'init';
      seed: number;
      size: number;
      save?: SaveGame;
      /** Difficulty: overrides the default starting funds (new games only). */
      startingMoney?: number;
    }
  | { type: 'setSpeed'; speed: Speed }
  | { type: 'buildRoad'; tiles: number[] }
  | { type: 'buildPowerLine'; tiles: number[] }
  | { type: 'paintZone'; tiles: number[]; zone: Zone }
  | { type: 'placePlant'; tile: number; plant: PlantType }
  | { type: 'bulldoze'; tiles: number[] }
  | { type: 'undo' }
  | { type: 'setTaxRate'; rate: number }
  | { type: 'setSmartCharging'; enabled: boolean }
  | { type: 'requestSave' }
  | { type: 'requestLifetime' };

/** Events sent from the simulation worker to the main thread. */
export type SimEvent =
  | { type: 'ready' }
  | {
      type: 'tick';
      diffs: TileDiff[];
      stats: GlobalStats;
      vehicles: VehicleState[];
    }
  | { type: 'saveData'; save: SaveGame }
  | { type: 'lifetimeData'; samples: LifetimeSample[] }
  | { type: 'rejected'; reason: string };
