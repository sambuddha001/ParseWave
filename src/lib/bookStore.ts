/**
 * Local audiobook library, persisted in IndexedDB.
 * Everything stays on the user's device — no accounts, no uploads, no limits.
 */

export interface StoredBook {
  id: string;
  title: string;
  fileName: string;
  text: string;
  words: number;
  minutes: number;
  createdAt: number;
}

const DB_NAME = "audiobook-weaver";
const DB_VERSION = 1;
const STORE = "books";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(req.error ?? new Error("Could not open the local library."));
  });
}

function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = run(tx.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () =>
          reject(req.error ?? new Error("Local library request failed."));
        tx.oncomplete = () => db.close();
      }),
  );
}

/** Newest first. */
export async function listBooks(): Promise<StoredBook[]> {
  const books = await withStore(
    "readonly",
    (store) => store.getAll() as IDBRequest<StoredBook[]>,
  );
  return books.sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveBook(book: StoredBook): Promise<void> {
  await withStore(
    "readwrite",
    (store) => store.put(book) as IDBRequest<IDBValidKey>,
  );
}

export async function deleteBook(id: string): Promise<void> {
  await withStore(
    "readwrite",
    (store) => store.delete(id) as IDBRequest<undefined>,
  );
}
