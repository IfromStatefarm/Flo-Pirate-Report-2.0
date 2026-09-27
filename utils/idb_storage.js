import { imageStorageKey, evidenceScope, belongsToScope } from './evidence_scope.js';

const DB_NAME = 'PirateReportDB';
const STORE_NAME = 'screenshots';
const DB_VERSION = 1;

/**
 * Opens (and upgrades if necessary) the IndexedDB database.
 * @returns {Promise<IDBDatabase>}
 */
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });
}

/**
 * Saves a base64 image string to IndexedDB.
 * @param {string} id - Unique identifier (UUID).
 * @param {string} dataUrl - The base64 image string.
 */
export async function saveImage(id, dataUrl, profile) {
  const key = imageStorageKey(id, profile);
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put({ id: key, ...evidenceScope(profile), data: dataUrl, expiresAt: Date.now() + 86400000 });

    request.onsuccess = () => resolve();
    request.onerror = (event) => reject(event.target.error);
  });
}

/**
 * Retrieves a base64 image string by ID.
 * @param {string} id 
 * @returns {Promise<string|null>}
 */
export async function getImage(id, profile) {
  const key = imageStorageKey(id, profile);
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(key);

    request.onsuccess = (event) => {
      const result = event.target.result;
      resolve(belongsToScope(result, profile) && result.expiresAt > Date.now() ? result.data : null);
    };
    request.onerror = (event) => reject(event.target.error);
  });
}

/**
 * Deletes only the specified screenshots in a verified account scope.
 */
export async function deleteImages(ids, profile) {
  const keys = [...new Set(ids.filter(Boolean))].map(id => imageStorageKey(id, profile));
  if (!keys.length) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    for (const key of keys) store.delete(key);
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
    transaction.onabort = () => { db.close(); reject(transaction.error); };
  });
}

/**
 * Clears all screenshots from the store.
 */
export async function clearImages(profile = null) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    if (!profile) store.clear();
    else {
      const cursor = store.openCursor();
      cursor.onsuccess = () => {
        const entry = cursor.result;
        if (!entry) return;
        if (belongsToScope(entry.value, profile)) entry.delete();
        entry.continue();
      };
    }
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
    transaction.onabort = () => { db.close(); reject(transaction.error); };
  });
}
