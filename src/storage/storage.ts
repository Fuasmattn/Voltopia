import type { SaveGame } from '../shared/types.ts';

/**
 * Persistence backend for save games. IndexedDB is the default; the
 * interface keeps the door open for other backends (cloud, file, ...).
 */
export interface SaveStorage {
  load(): Promise<SaveGame | null>;
  save(game: SaveGame): Promise<void>;
  clear(): Promise<void>;
}
