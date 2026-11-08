// The Cloudflare Workers variant with the runtime faked: a WebSocketPair of two linked sockets. The real LinkHost,
// pairing and session run through it.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  generateIdentity,
  LinkClient,
  LinkHost,
  pairDevice,
  type WebSocketLike,
} from "../../src/index.ts";
import { describe, expect, it, vi } from "vitest";
import { MemoryDevices, until } from "../../relay/test/helpers.ts";
import type { CfWebSocket, DurableState, RelayEnv } from "../cf-types.ts";
import worker, { RelayObject } from "../worker.ts";

// SPAKE2 point math in plain BigInt is slow on a loaded CI runner.
vi.setConfig({ testTimeout: 20_000 });

class FakeSocket implements CfWebSocket {
  peer!: FakeSocket;
  readyState = 1;
  private h: Record<string, Array<(e: { data: string }) => void>> = {};
  accept() {}
  addEventListener(type: string, f: (e: { data: string }) => void) {
    const list = this.h[type] ?? [];
    list.push(f);
    this.h[type] = list;
  }
  emit(type: string, data = "") {
    for (const f of this.h[type] ?? []) f({ data });
  }
  send(data: string) {
    if (this.readyState !== 1) return;
    queueMicrotask(() => this.peer.emit("message", data));
  }
  close() {
    if (this.readyState !== 1) return;
    this.readyState = 3;
    this.peer.readyState = 3;
    queueMicrotask(() => {
      this.emit("close");
      this.peer.emit("close");
    });
  }
}

function fakePair(): [FakeSocket, FakeSocket] {
  const a = new FakeSocket();
  const b = new FakeSocket();
  a.peer = b;
  b.peer = a;
  return [a, b];
}

/** A client socket joined to the object's server half, without the runtime's status-101 Response. */
function socketTo(obj: RelayObject): new (url: string) => WebSocketLike {
  return class implements WebSocketLike {
    private readonly client: FakeSocket;
    readyState = 1;
    bufferedAmount = 0;
    constructor(_url: string) {
      const [client, server] = fakePair();
      this.client = client;
      obj.accept(server, "198.51.100.7");
      queueMicrotask(() => client.emit("open"));
    }
    send(data: string) {
      this.client.send(data);
    }
    close() {
      this.client.close();
    }
    addEventListener(type: string, f: (e: { data: string; code: number; reason: string }) => void) {
      this.client.addEventListener(type, (e) => f({ data: e.data, code: 1000, reason: "" }));
    }
  } as unknown as new (url: string) => WebSocketLike;
}

const state: DurableState = { blockConcurrencyWhile: (f) => f() };

describe("relay on Cloudflare Workers (fake runtime)", () => {
  it("routes /healthz and /v0/link to one object and refuses other paths", async () => {
    const names: string[] = [];
    const env = {
      RELAY: {
        idFromName: (n: string) => {
          names.push(n);
          return n;
        },
        get: () => ({ fetch: async () => new Response("relay") }),
      },
    } as unknown as RelayEnv;
    const get = (path: string) => worker.fetch(new Request(`https://relay.example${path}`), env);
    expect(await (await get("/healthz")).text()).toBe("relay");
    expect(await (await get("/v0/link")).text()).toBe("relay");
    expect((await get("/v0/hooks/x")).status).toBe(404);
    expect(new Set(names)).toEqual(new Set(["relay"]));
  });

  it("pairs a phone and keeps a session through the object", async () => {
    const obj = new RelayObject(state, {} as RelayEnv);
    const WebSocketImpl = socketTo(obj);
    const devices = new MemoryDevices();
    const host = new LinkHost({
      relayUrl: "wss://relay.example",
      identity: await generateIdentity(),
      coreName: "Mac",
      devices,
      WebSocketImpl,
      selfCheckMs: 0,
      onSession: (s) => s.peer.handle((op) => (op === "ping.app" ? { pong: true } : undefined)),
    });
    await host.start();
    const pairing = await host.createPairing({ scopes: ["client"] });
    const identity = await generateIdentity();
    const credentials = await pairDevice({
      relayUrl: "wss://relay.example",
      code: pairing.code,
      identity,
      device: { name: "Phone", kind: "phone", platform: "ios" },
      WebSocketImpl,
    });
    const client = new LinkClient({ credentials, identity, WebSocketImpl });
    await client.start();
    await until(() => client.status === "online");
    expect(await client.request("ping.app", {})).toEqual({ pong: true });
    client.stop();
    await host.close();
  });
});

describe("the Worker build stays free of Node built-ins", () => {
  it("nothing it imports loads node:*", async () => {
    const seen = new Set<string>();
    const walk = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/^(?:import|export) (?!type )[^;]*? from "([^"]+)"/gm)) {
        const spec = m[1] as string;
        expect(spec.startsWith("node:"), `${file} imports ${spec}`).toBe(false);
        if (spec.startsWith(".")) walk(resolve(dirname(file), spec));
      }
    };
    walk(fileURLToPath(new URL("../worker.ts", import.meta.url)));
    expect(seen.size).toBeGreaterThan(3);
  });
});
