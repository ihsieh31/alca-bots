// What the phone shows while its computer can't be reached: the last answers to the requests that draw the app. Only
// reads on this list are kept; anything else still waits for the computer.
import { indexedDbRecords, SealedStore, type RecordStore } from "./cache-crypto";

const KEPT_EXACT = new Set([
  "/api/bots", "/api/instances", "/api/config", "/api/routines", "/api/notifications", "/api/inbox", "/api/brand",
  "/api/auth/session", "/api/webhooks", "/api/limit-resets",
]);
const KEPT_PATTERN = /^\/api\/(?:bots|groups)\/[\w-]+\/messages$/u;
// A time that changes on every load, which would otherwise give each load its own record.
const VOLATILE_PARAMS = ["since"];
const INDEX = "index";
const MAX_RECORD_CHARS = 8 * 1024 * 1024;
const MAX_TOTAL_CHARS = 64 * 1024 * 1024;

export const BOOT_KEY_PREFIX = "/api/bots?";

export function cacheKeyFor(url: URL, method: string): string | null {
  if (method !== "GET") return null;
  if (!KEPT_EXACT.has(url.pathname) && !KEPT_PATTERN.test(url.pathname)) return null;
  const query = new URLSearchParams(url.search);
  for (const name of VOLATILE_PARAMS) query.delete(name);
  query.sort();
  const rest = query.toString();
  return rest ? `${url.pathname}?${rest}` : url.pathname;
}

interface Entry {
  size: number;
  at: number;
  digest: string;
}

interface Saved {
  contentType: string;
  body: string;
}

async function digestOf(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class OfflineCache {
  // One write at a time: the index is read, changed and saved as a whole.
  private writes: Promise<unknown> = Promise.resolve();

  private constructor(private readonly store: SealedStore, private readonly entries: Map<string, Entry>, private readonly now: () => number) {}

  static async open(deviceId: string, raw: RecordStore = indexedDbRecords, now: () => number = Date.now): Promise<OfflineCache> {
    const store = await SealedStore.open(raw, deviceId);
    const saved = await store.get<Array<[string, Entry]>>(INDEX);
    return new OfflineCache(store, new Map(saved ?? []), now);
  }

  hasPrefix(prefix: string): boolean {
    for (const key of this.entries.keys()) if (key.startsWith(prefix)) return true;
    return false;
  }

  read(key: string): Promise<Saved | undefined> {
    return this.entries.has(key) ? this.store.get<Saved>(`r:${key}`) : Promise.resolve(undefined);
  }

  write(key: string, saved: Saved): Promise<void> {
    const next = this.writes.then(() => this.writeNow(key, saved));
    this.writes = next.catch(() => {});
    return next;
  }

  private async writeNow(key: string, saved: Saved): Promise<void> {
    if (saved.body.length > MAX_RECORD_CHARS) return;
    const digest = await digestOf(saved.body);
    const held = this.entries.get(key);
    const at = this.now();
    if (held?.digest === digest) {
      this.entries.set(key, { ...held, at });
    } else {
      await this.store.put(`r:${key}`, saved);
      this.entries.set(key, { size: saved.body.length, at, digest });
      let total = 0;
      for (const entry of this.entries.values()) total += entry.size;
      const oldestFirst = Array.from(this.entries).sort((a, b) => a[1].at - b[1].at);
      for (const [name, entry] of oldestFirst) {
        if (total <= MAX_TOTAL_CHARS || name === key) continue;
        await this.store.del(`r:${name}`);
        this.entries.delete(name);
        total -= entry.size;
      }
    }
    await this.store.put(INDEX, Array.from(this.entries));
  }

  async destroy(): Promise<void> {
    this.entries.clear();
    await this.writes;
    await this.store.destroy();
  }
}

export interface OfflineFetchOptions {
  inner: typeof fetch;
  connected(): boolean;
  origin: string;
}

const isAbort = (error: unknown) => error instanceof DOMException && error.name === "AbortError";

export class OfflineFetch {
  private cache: OfflineCache | null = null;
  private readonly o: OfflineFetchOptions;

  constructor(o: OfflineFetchOptions) {
    this.o = o;
  }

  use(cache: OfflineCache | null): void {
    this.cache = cache;
  }

  hasBootData(): boolean {
    return this.cache?.hasPrefix(BOOT_KEY_PREFIX) ?? false;
  }

  async forget(): Promise<void> {
    const cache = this.cache;
    this.cache = null;
    await cache?.destroy().catch(() => {});
  }

  private async fromCache(key: string, url: URL): Promise<Response | null> {
    const saved = await this.cache?.read(key).catch(() => undefined);
    if (!saved) return null;
    const response = new Response(saved.body, { status: 200, headers: { "content-type": saved.contentType } });
    Object.defineProperty(response, "url", { value: url.href });
    return response;
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request ? request.url : String(input), `${this.o.origin}/`);
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    const key = url.origin === this.o.origin && this.cache ? cacheKeyFor(url, method) : null;
    if (!key) return this.o.inner(input, init);

    if (!this.o.connected()) {
      const held = await this.fromCache(key, url);
      if (held) return held;
    }
    let response: Response;
    try {
      response = await this.o.inner(input, init);
    } catch (error) {
      const held = isAbort(error) ? null : await this.fromCache(key, url);
      if (held) return held;
      throw error;
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (response.status === 200 && contentType.includes("json") && this.cache) {
      const cache = this.cache;
      void response.clone().text().then((body) => cache.write(key, { contentType, body })).catch(() => {});
    }
    return response;
  };
}
