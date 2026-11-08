// The Node relay's handshake Origin policy, the same as the Workers relay's:
// no Origin (a non-browser client) is allowed; with origins configured, a
// foreign origin and `null` (sandboxed iframe, file://) are refused — `null`
// even when it is listed.
import { request } from "node:http";
import { afterAll, describe, expect, it } from "vitest";
import { startRelay } from "../server.ts";

const relay = await startRelay({ port: 0, origins: ["https://alca.example.com", "null"] });
const open = await startRelay({ port: 0 });
afterAll(() => Promise.all([relay.close(), open.close()]));

/** The handshake's HTTP status (101 = upgraded). */
function handshake(base: string, origin?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(`${base.replace(/^ws/, "http")}/v0/link`, {
      headers: {
        connection: "Upgrade",
        upgrade: "websocket",
        "sec-websocket-version": "13",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        ...(origin ? { origin } : {}),
      },
    });
    req.on("upgrade", (res, socket) => {
      socket.destroy();
      resolve(res.statusCode ?? 0);
    });
    req.on("response", (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", reject);
    req.end();
  });
}

describe("relay handshake Origin", () => {
  it("missing → allowed; listed → allowed; foreign or null → 403", async () => {
    expect(await handshake(relay.url)).toBe(101);
    expect(await handshake(relay.url, "https://alca.example.com")).toBe(101);
    expect(await handshake(relay.url, "https://evil.example")).toBe(403);
    expect(await handshake(relay.url, "null")).toBe(403);
    // No origins configured: the payload is end-to-end encrypted, any origin may connect.
    expect(await handshake(open.url, "https://other.example")).toBe(101);
  });
});
