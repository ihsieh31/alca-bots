import { describe, expect, it } from "vitest";
import { generateIdentity, LinkClient, LinkHost, type WebSocketCtor } from "../src/index.ts";

// Design B §5.2: kick() after a wake or network change — offline means "try now", not "wait out the backoff".
function failing(at: number[]): WebSocketCtor {
  return class {
    constructor() {
      at.push(Date.now());
      throw new Error("relay down");
    }
  } as unknown as WebSocketCtor;
}

describe("kick (design B §5.2)", () => {
  it("an offline host forgets a long backoff and registers again at once", async () => {
    const at: number[] = [];
    const host = new LinkHost({
      relayUrl: "ws://127.0.0.1:9",
      identity: await generateIdentity(),
      coreName: "test",
      devices: { get: () => undefined, add: () => ({}) as never, seen: () => undefined },
      onSession: () => undefined,
      WebSocketImpl: failing(at),
      selfCheckMs: 0,
      backoff: { first: 60_000, max: 60_000 },
    });
    await host.start(0);
    expect(at).toHaveLength(1); // the next try would be a minute away
    expect(await host.kick()).toBe("reconnect");
    expect(at).toHaveLength(2);
    await host.close();
    expect(await host.kick()).toBe("closed");
  });

  it("an offline phone client tries now on kick", async () => {
    const at: number[] = [];
    const client = new LinkClient({
      credentials: {
        relayUrl: "ws://127.0.0.1:9",
        mailbox: "m",
        corePublicKey: "AA",
        coreFingerprint: "f",
        coreName: "test",
        deviceId: "dev_x",
        scopes: [],
      },
      identity: await generateIdentity(),
      WebSocketImpl: failing(at),
      pingSec: 0,
      backoff: { first: 60_000, max: 60_000 },
    });
    client.start();
    await new Promise((r) => setTimeout(r, 50));
    const before = at.length;
    expect(await client.kick()).toBe(false);
    await new Promise((r) => setTimeout(r, 50));
    expect(at.length).toBeGreaterThan(before);
    client.stop();
  });
});
