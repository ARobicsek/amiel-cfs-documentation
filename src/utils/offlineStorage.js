/**
 * Offline storage utilities using IndexedDB
 *
 * When offline, entries are saved locally and synced when back online.
 * Uses the 'idb' library for a promise-based IndexedDB API.
 */

import { openDB } from 'idb';

const DB_NAME = 'cfs-tracker';
const DB_VERSION = 1;
const STORE_NAME = 'pending-entries';

/**
 * Initialize the database
 */
async function getDB() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // Create store for pending entries
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, {
          keyPath: 'id',
          autoIncrement: true
        });
      }
    },
  });
}

/**
 * Save an entry to offline storage
 */
export async function saveOfflineEntry(entry) {
  const db = await getDB();
  const entryWithTimestamp = {
    ...entry,
    savedAt: new Date().toISOString(),
  };
  await db.add(STORE_NAME, entryWithTimestamp);
  return entryWithTimestamp;
}

/**
 * Get all pending offline entries
 */
export async function getPendingEntries() {
  const db = await getDB();
  return db.getAll(STORE_NAME);
}

/**
 * Delete a pending entry after successful sync
 */
export async function deletePendingEntry(id) {
  const db = await getDB();
  await db.delete(STORE_NAME, id);
}

/**
 * Clear all pending entries
 */
export async function clearPendingEntries() {
  const db = await getDB();
  await db.clear(STORE_NAME);
}

/**
 * Check if there are pending entries to sync
 */
export async function hasPendingEntries() {
  const entries = await getPendingEntries();
  return entries.length > 0;
}

/**
 * Sync all pending entries to the server
 * Returns { synced: number, failed: number }
 */
export async function syncPendingEntries(submitFn) {
  const entries = await getPendingEntries();
  let synced = 0;
  let failed = 0;

  for (const entry of entries) {
    try {
      await submitFn(entry);
      await deletePendingEntry(entry.id);
      synced++;
    } catch (error) {
      console.error('Failed to sync entry:', error);
      failed++;
    }
  }

  return { synced, failed };
}

/**
 * Listen for online status and trigger sync
 */
export function setupOfflineSync(submitFn, onSyncComplete) {
  const handleOnline = async () => {
    if (await hasPendingEntries()) {
      const result = await syncPendingEntries(submitFn);
      if (onSyncComplete) {
        onSyncComplete(result);
      }
    }
  };

  window.addEventListener('online', handleOnline);

  // Return cleanup function
  return () => {
    window.removeEventListener('online', handleOnline);
  };
}
