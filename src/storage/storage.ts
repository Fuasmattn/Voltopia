import type { SaveGame } from '../shared/types.ts';

export const AUTOSAVE_SLOT = 'autosave';

/**
 * Persistence backend for save games. IndexedDB is the default; the
 * interface keeps the door open for other backends (cloud, file, ...).
 * Slots address independent save games; the autosave slot is the one
 * loaded on boot.
 */
export interface SaveStorage {
  load(slot?: string): Promise<SaveGame | null>;
  save(game: SaveGame, slot?: string): Promise<void>;
  clear(slot?: string): Promise<void>;
}
