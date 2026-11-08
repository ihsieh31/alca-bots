// This phone's key and pairing. The private key is created non-extractable, so a script running in this page can use it
// but can never copy it elsewhere.
import type { LinkCredentials } from "../../link/src/client";
import { generateIdentity, type Identity } from "../../link/src/identity";

const DB = "alca-phone";
const STORE = "kv";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = work(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function phoneIdentity(): Promise<Identity> {
  const saved = await run<Identity | undefined>("readonly", (store) => store.get("identity"));
  if (saved) return saved;
  const made = await generateIdentity(false);
  await run("readwrite", (store) => store.put(made, "identity"));
  return made;
}

export const readCredentials = (): Promise<LinkCredentials | undefined> => run("readonly", (store) => store.get("credentials"));

export const saveCredentials = async (credentials: LinkCredentials): Promise<void> => {
  await run("readwrite", (store) => store.put(credentials, "credentials"));
};

export const forgetCredentials = async (): Promise<void> => {
  await run("readwrite", (store) => store.delete("credentials"));
};
