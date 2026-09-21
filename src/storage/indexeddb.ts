import { SAVE_VERSION } from '../shared/constants.ts';
import type { SaveGame } from '../shared/types.ts';
import { AUTOSAVE_SLOT, type SaveStorage } from './storage.ts';

const DB_NAME = 'voltopia';
const DB_VERSION = 1;
const STORE_NAME = 'saves';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

/** IndexedDB-backed save storage (ArrayBuffers persist natively). */
export class IndexedDbStorage implements SaveStorage {
  async load(slot: string = AUTOSAVE_SLOT): Promise<SaveGame | null> {
    try {
      const db = await openDatabase();
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const result = await requestToPromise(
        transaction.objectStore(STORE_NAME).get(slot) as IDBRequest<SaveGame | undefined>,
      );
      db.close();
      if (!result || result.version !== SAVE_VERSION) return null;
      return result;
    } catch (error) {
      console.warn('Loading the save game failed', error);
      return null;
    }
  }

  async save(game: SaveGame, slot: string = AUTOSAVE_SLOT): Promise<void> {
    const db = await openDatabase();
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(game, slot);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB write failed'));
    });
    db.close();
  }

  async clear(slot: string = AUTOSAVE_SLOT): Promise<void> {
    const db = await openDatabase();
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete(slot);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB delete failed'));
    });
    db.close();
  }
}
