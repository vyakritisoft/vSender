const DB_NAME = 'vsender_db';
const DB_VERSION = 1;
const STORE_NAME = 'datasets';

let dbInstance = null;

export async function initDB() {
    if (dbInstance) return dbInstance;

    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = (e) => reject(`IndexedDB error: ${e.target.error}`);

        request.onsuccess = (e) => {
            dbInstance = e.target.result;
            resolve(dbInstance);
        };

        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
    });
}

export async function saveDataset(dataset) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(dataset);

        request.onsuccess = () => resolve(dataset.id);
        request.onerror = (e) => reject(`Save failed: ${e.target.error}`);
    });
}

export async function getDatasets() {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = (e) => {
            // Sort by timestamp descending
            const results = e.target.result || [];
            results.sort((a, b) => b.timestamp - a.timestamp);
            resolve(results);
        };
        request.onerror = (e) => reject(`Load failed: ${e.target.error}`);
    });
}

export async function getDatasetById(id) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(id);

        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(`Load by ID failed: ${e.target.error}`);
    });
}

export async function deleteDataset(id) {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(id);

        request.onsuccess = () => resolve(true);
        request.onerror = (e) => reject(`Delete failed: ${e.target.error}`);
    });
}
