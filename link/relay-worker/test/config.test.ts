// The Workers relay names an empty ALLOWED_ORIGINS, refuses browser sockets in production mode until the phone
// site's origin is set, and MAX_SOCKETS caps the one relay object.
import { describe, expect, it } from "vitest";
import type { DurableState, RelayEnv } from "../cf-types.ts";
import { DEFAULT_MAX_SOCKETS, RelayObject } from "../worker.ts";

const state: DurableState = { blockConcurrencyWhile: (f) => f() };
const health = async (env: Partial<RelayEnv>) =>
  (await (
    await new RelayObject(state, env as RelayEnv).fetch(new Request("https://relay.example/healthz"))
  ).json()) as {
    ok: boolean;
    mode: string;
    warnings?: string[];
  };

describe("Workers relay configuration checks", () => {
  it("empty ALLOWED_ORIGINS warns loudly; in production mode it is fatal and browsers are refused", async () => {
    const dev = await health({});
    expect(dev.ok).toBe(true);
    expect(dev.warnings?.[0]).toContain("any website can open relay sockets");
    const prod = await health({ RELAY_MODE: "production" });
    expect(prod.ok).toBe(false);
    expect(prod.warnings?.[0]).toContain("production mode");
    const obj = new RelayObject(state, { RELAY_MODE: "production" } as RelayEnv);
    const r = await obj.fetch(
      new Request("https://relay.example/v0/link", {
        headers: { upgrade: "websocket", origin: "https://evil.example" },
      }),
    );
    expect(r.status).toBe(403);
    expect(await r.text()).toContain("ALLOWED_ORIGINS");
  });

  it("MAX_SOCKETS caps the relay object (default 5000)", async () => {
    const limits = (env: Partial<RelayEnv>) =>
      (new RelayObject(state, env as RelayEnv) as unknown as { hub: { limits: { maxSockets: number } } }).hub
        .limits.maxSockets;
    expect(limits({})).toBe(DEFAULT_MAX_SOCKETS);
    expect(limits({ MAX_SOCKETS: "12" })).toBe(12);
    expect(limits({ MAX_SOCKETS: "lots" })).toBe(DEFAULT_MAX_SOCKETS);
  });

  it("handshake Origin: missing is allowed (non-browser clients), `null` and foreign origins are refused", async () => {
    /** The status a WebSocket handshake gets (101 = it reached the hub). */
    const handshake = async (env: Partial<RelayEnv>, origin?: string) => {
      const obj = new RelayObject(state, env as RelayEnv);
      let accepted = false;
      (obj as unknown as { accept: () => void }).accept = () => {
        accepted = true;
      };
      const g = globalThis as { WebSocketPair?: unknown };
      const prev = g.WebSocketPair;
      g.WebSocketPair = class {
        0 = {};
        1 = {};
      };
      const headers: Record<string, string> = { upgrade: "websocket", ...(origin ? { origin } : {}) };
      try {
        return (await obj.fetch(new Request("https://relay.example/v0/link", { headers }))).status;
      } catch (e) {
        // Node's Response refuses status 101; the Workers runtime allows it.
        if (accepted && e instanceof RangeError) return 101;
        throw e;
      } finally {
        g.WebSocketPair = prev;
      }
    };
    const site = { ALLOWED_ORIGINS: "https://alca.example.com" };
    const prod = { ...site, RELAY_MODE: "production" as const };
    // The desktop core, CLI and native phone sockets send no Origin: allowed, even in production.
    expect(await handshake(prod)).toBe(101);
    expect(await handshake({ RELAY_MODE: "production" })).toBe(101);
    expect(await handshake({})).toBe(101);
    // The phone site itself.
    expect(await handshake(prod, "https://alca.example.com")).toBe(101);
    // A foreign site, or `null` (sandboxed iframe, file://), is refused.
    expect(await handshake(prod, "https://evil.example")).toBe(403);
    expect(await handshake(prod, "null")).toBe(403);
    expect(await handshake(site, "null")).toBe(403);
    expect(await handshake({ RELAY_MODE: "production" }, "null")).toBe(403);
    // `null` is never an allowed origin, even when someone lists it.
    expect(await handshake({ ALLOWED_ORIGINS: "null, https://alca.example.com" }, "null")).toBe(403);
    expect(await handshake({ ALLOWED_ORIGINS: "null" }, "https://evil.example")).toBe(403);
  });
});
