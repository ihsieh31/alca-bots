// Encrypted records for the phone's offline copy. The keys can be used by this page but never read out of WebCrypto.
// Whoever holds the whole browser profile holds the key handle too, so this guards against scripts and stray copies of
// the records, not against someone with the unlocked phone's storage.

export interface RecordStore {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  clear(): Promise<void>;
}

const LABEL = "alca-offline/v1";
const KEK_KEY = "key:kek";
const DATA_KEY = "key:data";
const RECORD_PREFIX = "rec:";
const AES = { name: "AES-GCM", length: 256 } as const;

interface WrappedKey {
  deviceId: string;
  iv: Uint8Array<ArrayBuffer>;
  data: ArrayBuffer;
}

interface Sealed {
  iv: Uint8Array<ArrayBuffer>;
  data: ArrayBuffer;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const utf8 = (text: string) => new Uint8Array(encoder.encode(text));
const freshIv = () => crypto.getRandomValues(new Uint8Array(12));

const unwrap = (wrapped: WrappedKey, kek: CryptoKey, aad: Uint8Array<ArrayBuffer>) => crypto.subtle.unwrapKey(
  "raw", wrapped.data, kek, { name: "AES-GCM", iv: wrapped.iv, additionalData: aad }, AES, false, ["encrypt", "decrypt"],
);

export class SealedStore {
  private constructor(private readonly raw: RecordStore, private readonly deviceId: string, private readonly key: CryptoKey) {}

  /** Opens this pairing's records. A different pairing, or keys that no longer fit, start empty: it is only a copy. */
  static async open(raw: RecordStore, deviceId: string): Promise<SealedStore> {
    const aad = utf8(`${LABEL}|key|${deviceId}`);
    const heldKek = await raw.get(KEK_KEY) as CryptoKey | undefined;
    const held = await raw.get(DATA_KEY) as WrappedKey | undefined;
    if (heldKek && held?.deviceId === deviceId) {
      try {
        return new SealedStore(raw, deviceId, await unwrap(held, heldKek, aad));
      } catch {
        // Fall through and start over.
      }
    }
    await raw.clear();
    const kek = await crypto.subtle.generateKey(AES, false, ["wrapKey", "unwrapKey"]);
    const fresh = await crypto.subtle.generateKey(AES, true, ["encrypt", "decrypt"]);
    const iv = freshIv();
    const data = await crypto.subtle.wrapKey("raw", fresh, kek, { name: "AES-GCM", iv, additionalData: aad });
    const wrapped: WrappedKey = { deviceId, iv, data };
    await raw.put(KEK_KEY, kek);
    await raw.put(DATA_KEY, wrapped);
    return new SealedStore(raw, deviceId, await unwrap(wrapped, kek, aad));
  }

  // Binding the name stops a record being moved to answer for a different request.
  private aad = (name: string) => utf8(`${LABEL}|rec|${this.deviceId}|${name}`);

  async put(name: string, value: unknown): Promise<void> {
    const iv = freshIv();
    const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: this.aad(name) }, this.key, utf8(JSON.stringify(value)));
    await this.raw.put(RECORD_PREFIX + name, { iv, data } satisfies Sealed);
  }

  async get<T>(name: string): Promise<T | undefined> {
    const sealed = await this.raw.get(RECORD_PREFIX + name) as Sealed | undefined;
    if (!sealed) return undefined;
    try {
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: sealed.iv, additionalData: this.aad(name) }, this.key, sealed.data);
      return JSON.parse(decoder.decode(plain)) as T;
    } catch {
      await this.raw.del(RECORD_PREFIX + name);
      return undefined;
    }
  }

  del(name: string): Promise<void> {
    return this.raw.del(RECORD_PREFIX + name);
  }

  /** The keys go first, so an interruption still leaves nothing that can be opened. */
  async destroy(): Promise<void> {
    await this.raw.del(KEK_KEY);
    await this.raw.del(DATA_KEY);
    await this.raw.clear();
  }
}

const DB = "alca-phone-cache";
const STORE = "records";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function inDb<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
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

export const indexedDbRecords: RecordStore = {
  get: (key) => inDb("readonly", (store) => store.get(key)),
  put: async (key, value) => { await inDb("readwrite", (store) => store.put(value, key)); },
  del: async (key) => { await inDb("readwrite", (store) => store.delete(key)); },
  clear: async () => { await inDb("readwrite", (store) => store.clear()); },
};
