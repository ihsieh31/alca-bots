import { describe, expect, it, vi } from "vitest";

import { SealedStore, type RecordStore } from "./cache-crypto";
import { cacheKeyFor, OfflineCache, OfflineFetch } from "./offline-cache";

const ORIGIN = "https://phone.example";
const url = (path: string) => new URL(path, ORIGIN);

function memory(): RecordStore & { map: Map<string, unknown> } {
  const map = new Map<string, unknown>();
  return {
    map,
    get: async (key) => map.get(key),
    put: async (key, value) => void map.set(key, value),
    del: async (key) => void map.delete(key),
    clear: async () => map.clear(),
  };
}

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

describe("cacheKeyFor", () => {
  it("keeps the reads that draw the app, under a stable name", () => {
    expect(cacheKeyFor(url("/api/bots?messages=200"), "GET")).toBe("/api/bots?messages=200");
    expect(cacheKeyFor(url("/api/routines?since=123"), "GET")).toBe("/api/routines");
    expect(cacheKeyFor(url("/api/bots/abc-1/messages?threadId=t&before=2"), "GET")).toBe("/api/bots/abc-1/messages?before=2&threadId=t");
  });

  it("keeps nothing else", () => {
    for (const path of ["/api/events", "/api/link", "/api/auth/sessions", "/api/bots/a/browser/live", "/api/files/x", "/api/secrets", "/assets/a.js"]) {
      expect(cacheKeyFor(url(path), "GET"), path).toBeNull();
    }
    expect(cacheKeyFor(url("/api/bots"), "POST")).toBeNull();
  });
});

describe("SealedStore", () => {
  it("keeps only ciphertext at rest", async () => {
    const raw = memory();
    const store = await SealedStore.open(raw, "d1");
    await store.put("a", { secret: "hunter2" });
    expect(await store.get("a")).toEqual({ secret: "hunter2" });
    const sealed = raw.map.get("rec:a") as { data: ArrayBuffer };
    expect(new TextDecoder().decode(sealed.data)).not.toContain("hunter2");
    const kek = raw.map.get("key:kek") as CryptoKey;
    expect(kek.extractable).toBe(false);
  });

  it("opens the same records again for the same pairing", async () => {
    const raw = memory();
    await (await SealedStore.open(raw, "d1")).put("a", 1);
    expect(await (await SealedStore.open(raw, "d1")).get("a")).toBe(1);
  });

  it("starts empty for another pairing", async () => {
    const raw = memory();
    await (await SealedStore.open(raw, "d1")).put("a", 1);
    expect(await (await SealedStore.open(raw, "d2")).get("a")).toBeUndefined();
    expect(raw.map.has("rec:a")).toBe(false);
  });

  it("won't answer one name with another's record, and drops it", async () => {
    const raw = memory();
    const store = await SealedStore.open(raw, "d1");
    await store.put("a", 1);
    raw.map.set("rec:b", raw.map.get("rec:a"));
    expect(await store.get("b")).toBeUndefined();
    expect(raw.map.has("rec:b")).toBe(false);
  });

  it("destroys its keys along with its records", async () => {
    const raw = memory();
    const store = await SealedStore.open(raw, "d1");
    await store.put("a", 1);
    await store.destroy();
    expect(raw.map.size).toBe(0);
  });
});

describe("OfflineCache", () => {
  it("survives a reopen", async () => {
    const raw = memory();
    const cache = await OfflineCache.open("d1", raw);
    await cache.write("/api/bots?messages=1", { contentType: "application/json", body: "[1]" });
    const again = await OfflineCache.open("d1", raw);
    expect(again.hasPrefix("/api/bots?")).toBe(true);
    expect(await again.read("/api/bots?messages=1")).toEqual({ contentType: "application/json", body: "[1]" });
  });

  it("doesn't rewrite what hasn't changed", async () => {
    const raw = memory();
    const put = vi.spyOn(raw, "put");
    const cache = await OfflineCache.open("d1", raw);
    await cache.write("k", { contentType: "a", body: "same" });
    const records = () => put.mock.calls.filter(([key]) => key === "rec:r:k").length;
    expect(records()).toBe(1);
    await cache.write("k", { contentType: "a", body: "same" });
    expect(records()).toBe(1);
    await cache.write("k", { contentType: "a", body: "new" });
    expect(records()).toBe(2);
  });

  it("drops the least recently written when it outgrows its limit", async () => {
    const raw = memory();
    let clock = 0;
    const cache = await OfflineCache.open("d1", raw, () => ++clock);
    const big = "x".repeat(7 * 1024 * 1024);
    for (let i = 0; i < 10; i++) await cache.write(`k${i}`, { contentType: "a", body: big + i });
    expect(await cache.read("k0")).toBeUndefined();
    expect(await cache.read("k9")).toBeDefined();
  });

  it("refuses a record too large to be worth keeping", async () => {
    const cache = await OfflineCache.open("d1", memory());
    await cache.write("k", { contentType: "a", body: "x".repeat(8 * 1024 * 1024 + 1) });
    expect(await cache.read("k")).toBeUndefined();
  });
});

describe("OfflineFetch", () => {
  async function setup() {
    const cache = await OfflineCache.open("d1", memory());
    const state = { connected: true };
    const inner = vi.fn<typeof fetch>(async () => json({ fresh: true }));
    const offline = new OfflineFetch({ inner, connected: () => state.connected, origin: ORIGIN });
    offline.use(cache);
    return { cache, state, inner, offline };
  }
  const settled = () => new Promise((resolve) => setTimeout(resolve, 20));

  it("keeps a successful read and answers from it with no connection", async () => {
    const { offline, inner, state } = await setup();
    const first = await offline.fetch("/api/config");
    expect(await first.json()).toEqual({ fresh: true });
    await settled();
    state.connected = false;
    inner.mockClear();
    const held = await offline.fetch("/api/config");
    expect(await held.json()).toEqual({ fresh: true });
    expect(held.url).toBe(`${ORIGIN}/api/config`);
    expect(inner).not.toHaveBeenCalled();
    expect(offline.hasBootData()).toBe(false);
  });

  it("prefers the computer whenever it is reachable", async () => {
    const { offline, inner } = await setup();
    await offline.fetch("/api/config");
    await settled();
    inner.mockResolvedValueOnce(json({ newer: true }));
    expect(await (await offline.fetch("/api/config")).json()).toEqual({ newer: true });
  });

  it("falls back when the connection drops mid-request, but not when the caller aborted", async () => {
    const { offline, inner } = await setup();
    await offline.fetch("/api/config");
    await settled();
    inner.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await (await offline.fetch("/api/config")).json()).toEqual({ fresh: true });
    inner.mockRejectedValueOnce(new DOMException("aborted", "AbortError"));
    await expect(offline.fetch("/api/config")).rejects.toThrow("aborted");
  });

  it("waits for the computer when it holds no copy", async () => {
    const { offline, inner, state } = await setup();
    state.connected = false;
    await offline.fetch("/api/config");
    expect(inner).toHaveBeenCalledOnce();
  });

  it("keeps neither refusals, other kinds of answer, nor writes", async () => {
    const { offline, inner, state } = await setup();
    inner.mockResolvedValueOnce(json({ error: "no" }, 403));
    await offline.fetch("/api/config");
    inner.mockResolvedValueOnce(new Response("<html>", { headers: { "content-type": "text/html" } }));
    await offline.fetch("/api/inbox");
    await offline.fetch("/api/notifications", { method: "POST", body: "{}" });
    await settled();
    state.connected = false;
    inner.mockClear();
    for (const path of ["/api/config", "/api/inbox", "/api/notifications"]) await offline.fetch(path);
    expect(inner).toHaveBeenCalledTimes(3);
  });

  it("forgets everything when the pairing ends", async () => {
    const { offline, inner, state } = await setup();
    await offline.fetch("/api/config");
    await settled();
    await offline.forget();
    state.connected = false;
    inner.mockClear();
    await offline.fetch("/api/config");
    expect(inner).toHaveBeenCalledOnce();
  });

  it("knows when it can draw the app", async () => {
    const { offline } = await setup();
    await offline.fetch("/api/bots?messages=200");
    await settled();
    expect(offline.hasBootData()).toBe(true);
  });
});
