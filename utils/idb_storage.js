// utils/idb_storage.js

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
export async function saveImage(id, dataUrl) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put({ id, data: dataUrl });

    request.onsuccess = () => resolve();
    request.onerror = (event) => reject(event.target.error);
  });
}

/**
 * Retrieves a base64 image string by ID.
 * @param {string} id 
 * @returns {Promise<string|null>}
 */
export async function getImage(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = (event) => {
      const result = event.target.result;
      resolve(result ? result.data : null);
    };
    request.onerror = (event) => reject(event.target.error);
  });
}

/**
 * Clears all screenshots from the store.
 */
export async function clearImages() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.clear();

    request.onsuccess = () => resolve();
    request.onerror = (event) => reject(event.target.error);
  });
}
