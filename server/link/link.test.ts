import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { fromB64u, toB64u } from "../../link/src/bytes.ts";
import { generateIdentity, LinkClient, pairDevice, type LinkCredentials } from "../../link/src/index.ts";
import { startRelay } from "../../link/relay/server.ts";
import { HTTP_CHANNEL, HTTP_CHUNK_BYTES, linkRequestRefusal, requestHeadersFor, responseHeadersFor, type HttpEvent } from "../../shared/link-http.ts";
import { parseLinkPairingFragment } from "../../shared/link.ts";
import { LinkService, type LinkSessions } from "./service.ts";

class FakeSessions implements LinkSessions {
  live = new Map<string, string>();
  scopes = new Map<string, string[]>();
  listeners = new Set<(id: string, why: "revoked" | "expired") => void>();
  n = 0;
  issue({ scopes }: { label: string; scopes: Array<"admin" | "client"> }) {
    const id = `s${++this.n}`;
    const token = `alca_sess_${id}`;
    this.live.set(token, id);
    this.scopes.set(token, scopes);
    return { token, session: { id } };
  }
  authenticate(token: string | undefined) {
    const id = token && this.live.get(token);
    return id ? { id } : null;
  }
  revoke(id: string) {
    return this.end(id, "revoked");
  }
  end(id: string, why: "revoked" | "expired") {
    for (const [token, sid] of this.live) {
      if (sid !== id) continue;
      this.live.delete(token);
      for (const listener of this.listeners) listener(id, why);
      return true;
    }
    return false;
  }
  onSessionRevoked(listener: (id: string, why: "revoked" | "expired") => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

const cleanups: Array<() => Promise<unknown> | unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const until = async (check: () => boolean, ms = 5000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

interface Seen { method: string; url: string; headers: IncomingMessage["headers"]; body: Buffer }

async function harness(big: Buffer) {
  const seen: Seen[] = [];
  const server: Server = createServer((req, res) => {
    const parts: Buffer[] = [];
    req.on("data", (part: Buffer) => parts.push(part));
    req.on("end", () => {
      const body = Buffer.concat(parts);
      seen.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body });
      if (req.url === "/api/big") {
        res.writeHead(200, { "content-type": "application/octet-stream", "set-cookie": "alca=1" });
        res.end(big);
      } else {
        res.writeHead(200, { "content-type": "application/json", "set-cookie": "alca=1" });
        res.end(JSON.stringify({ path: req.url, bytes: body.length }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise((resolve) => server.close(resolve)));
  cleanups.push(() => server.closeAllConnections());
  return { port: (server.address() as AddressInfo).port, seen };
}

async function setup(big = Buffer.alloc(0)) {
  const dataDir = mkdtempSync(join(tmpdir(), "alca-link-"));
  cleanups.push(() => rmSync(dataDir, { recursive: true, force: true }));
  const relay = await startRelay({ port: 0 });
  cleanups.push(() => relay.close());
  const { port, seen } = await harness(big);
  const sessions = new FakeSessions();
  const service = new LinkService({
    dataDir, port, sessions, computerName: () => "test computer", env: { ALCA_LINK_RELAY_URL: relay.url, ALCA_LINK_ALLOW_LOOPBACK: "1" },
  });
  cleanups.push(() => service.stop());
  return { dataDir, relay, seen, sessions, service };
}

async function connected(s: Awaited<ReturnType<typeof setup>>, access: "full" | "daily" = "full") {
  await s.service.update({ enabled: true, iceServers: [] });
  await until(() => s.service.status().status === "online");
  const pairing = await s.service.createPairing(access);
  const link = parseLinkPairingFragment(new URL(pairing.url).hash);
  const identity = await generateIdentity(true);
  const credentials: LinkCredentials = await pairDevice({
    relayUrl: s.relay.url, code: link!.code, identity, device: { name: "Test phone", kind: "phone", platform: "web" },
    ...(link!.fingerprint ? { expectFingerprint: link!.fingerprint } : {}),
  });
  const client = new LinkClient({ credentials, identity, backoff: { first: 50, max: 200 } });
  cleanups.push(() => client.stop());
  await client.start();
  await until(() => client.status === "online");
  const events = new Map<string, HttpEvent[]>();
  client.onEvent((channel, event) => {
    if (channel !== HTTP_CHANNEL) return;
    const e = event as HttpEvent;
    events.set(e.id, [...(events.get(e.id) ?? []), e]);
  });
  return { client, events, credentials };
}

describe("LinkService", () => {
  it("stays off until the owner turns it on", async () => {
    const s = await setup();
    await s.service.start();
    expect(s.service.status().status).toBe("off");
    await expect(s.service.createPairing("full")).rejects.toThrow(/Turn on/);
  });

  it("pairs a phone, keeps its files owner-only and carries a request under the phone's own session", async () => {
    const s = await setup();
    const { client, events } = await connected(s);
    expect(s.service.status().pairing?.state).toBe("paired");
    expect(s.service.status().devices).toEqual([expect.objectContaining({ name: "Test phone", access: "full", connection: "relay" })]);
    for (const file of ["devices.json", "identity.json", "settings.json"]) {
      if (file !== "settings.json") expect(statSync(join(s.dataDir, "link", file)).mode & 0o777).toBe(0o600);
    }

    await client.request("http.open", {
      id: "a1", method: "GET", path: "/api/state?x=1",
      headers: { authorization: "Bearer stolen", cookie: "alca=1", host: "evil", origin: "https://evil", "x-forwarded-for": "1.1.1.1", accept: "application/json" },
    });
    await until(() => events.get("a1")?.at(-1)?.t === "end");
    const [head, data] = events.get("a1")!;
    expect(head).toMatchObject({ t: "head", status: 200, headers: { "content-type": "application/json" } });
    expect((head as Extract<HttpEvent, { t: "head" }>).headers).not.toHaveProperty("set-cookie");
    expect(JSON.parse(new TextDecoder().decode(fromB64u((data as Extract<HttpEvent, { t: "data" }>).d)))).toMatchObject({ path: "/api/state?x=1" });

    const got = s.seen[0]!;
    expect(got.headers.authorization).toBe("Bearer alca_sess_s1");
    expect(got.headers.cookie).toBeUndefined();
    expect(got.headers.origin).toBeUndefined();
    expect(got.headers["x-forwarded-for"]).toBeUndefined();
    expect(got.headers.host).toMatch(/^127\.0\.0\.1:/);
    expect(got.headers.accept).toBe("application/json");
  });

  it("gives a daily phone a client-only session", async () => {
    const s = await setup();
    const { client, events } = await connected(s, "daily");
    await client.request("http.open", { id: "d", method: "GET", path: "/api/state", headers: {} });
    await until(() => events.get("d")?.at(-1)?.t === "end");
    expect(s.sessions.scopes.get("alca_sess_s1")).toEqual(["client"]);
  });

  it("delivers a large download intact across acknowledgements", async () => {
    const big = randomBytes(1_500_000);
    const s = await setup(big);
    const { client, events } = await connected(s);
    await client.request("http.open", { id: "big", method: "GET", path: "/api/big", headers: {} });
    let acked = 0;
    await until(() => {
      const all = events.get("big") ?? [];
      const received = all.reduce((n, e) => n + (e.t === "data" ? fromB64u(e.d).length : 0), 0);
      if (received > acked) {
        void client.request("http.ack", { id: "big", bytes: received - acked }).catch(() => {});
        acked = received;
      }
      return all.at(-1)?.t === "end";
    }, 20_000);
    const parts = (events.get("big") ?? []).flatMap((e) => e.t === "data" ? [Buffer.from(fromB64u(e.d))] : []);
    expect(Buffer.concat(parts).equals(big)).toBe(true);
    expect(Math.max(...parts.map((p) => p.length))).toBeLessThanOrEqual(HTTP_CHUNK_BYTES);
  }, 30_000);

  it("stops at the window until the phone acknowledges", async () => {
    const big = randomBytes(1_500_000);
    const s = await setup(big);
    const { client, events } = await connected(s);
    await client.request("http.open", { id: "w", method: "GET", path: "/api/big", headers: {} });
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const received = (events.get("w") ?? []).reduce((n, e) => n + (e.t === "data" ? fromB64u(e.d).length : 0), 0);
    expect(received).toBeGreaterThan(0);
    expect(received).toBeLessThan(big.length);
    await client.request("http.cancel", { id: "w" });
  }, 15_000);

  it("carries an upload", async () => {
    const s = await setup();
    const { client, events } = await connected(s);
    const part = randomBytes(1000);
    await client.request("http.open", { id: "u", method: "POST", path: "/api/up", headers: { "content-type": "text/plain" }, body: true });
    await client.request("http.body", { id: "u", d: toB64u(part) });
    await client.request("http.body", { id: "u", d: toB64u(part), end: true });
    await until(() => events.get("u")?.at(-1)?.t === "end");
    expect(s.seen[0]?.body.length).toBe(2000);
    expect(s.seen[0]?.headers["content-type"]).toBe("text/plain");
  });

  it("refuses what a phone may not reach before it touches the computer", async () => {
    const s = await setup();
    const { client } = await connected(s);
    for (const path of ["/", "/api/link", "/api/internal/x", "/api/testing/x", "/api/auth/pairing", "/api/pair", "/api/%2e%2e/secret", "/api/../x", "/api/a\\b"]) {
      await expect(client.request("http.open", { id: "r", method: "POST", path, headers: {} }), path).rejects.toThrow();
    }
    await expect(client.request("http.open", { id: "../x", method: "GET", path: "/api/x", headers: {} })).rejects.toThrow();
    await expect(client.request("nope", {})).rejects.toThrow();
    expect(s.seen).toEqual([]);
  });

  it("removing a phone ends its session, wipes its token and refuses it from then on", async () => {
    const s = await setup();
    const { client, credentials } = await connected(s);
    await client.request("http.open", { id: "x", method: "GET", path: "/api/x", headers: {} });
    await until(() => s.seen.length === 1);
    const id = s.service.status().devices[0]!.id;
    expect(s.service.revokeDevice(id)).toBe(true);
    expect(s.sessions.live.size).toBe(0);
    expect(s.service.devices.session(id)).toEqual({});
    expect(s.service.status().devices).toEqual([]);
    await until(() => client.status !== "online");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(client.status).not.toBe("online");
    expect(credentials.deviceId).toBe(id);
  });

  it("treats ending the session elsewhere as removing the phone, but an expired session only as a new sign-in", async () => {
    const s = await setup();
    const { client, events } = await connected(s);
    const id = s.service.status().devices[0]!.id;
    s.sessions.end("s1", "expired");
    await client.request("http.open", { id: "again", method: "GET", path: "/api/x", headers: {} });
    await until(() => events.get("again")?.at(-1)?.t === "end");
    expect(s.seen[0]?.headers.authorization).toBe("Bearer alca_sess_s2");
    expect(s.service.status().devices).toHaveLength(1);

    s.sessions.end("s2", "revoked");
    expect(s.service.status().devices).toEqual([]);
    expect(s.service.devices.get(id)?.revoked).toBe(true);
  });
});

describe("the bridge's rules", () => {
  it("closes phone management and traversal", () => {
    expect(linkRequestRefusal("GET", "/api/state?x=../y")).toBeNull();
    expect(linkRequestRefusal("GET", "/.well-known/alcabots/x")).toBeNull();
    expect(linkRequestRefusal("TRACE", "/api/state")?.code).toBe("bad_request");
    expect(linkRequestRefusal("GET", "/api/a%2Fb")?.code).toBe("bad_request");
    expect(linkRequestRefusal("GET", "/api/x y")?.code).toBe("bad_request");
    expect(linkRequestRefusal("POST", "/api/team/phone-pairing")?.code).toBe("forbidden");
    expect(linkRequestRefusal("GET", "/index.html")?.code).toBe("forbidden");
  });

  it("drops headers outside the lists", () => {
    expect(requestHeadersFor({ Authorization: "x", Accept: "y", "X-Evil": "z", Range: "bytes=0-1\r\nHost: evil" })).toEqual({ accept: "y" });
    expect(responseHeadersFor({ "set-cookie": ["a"], "content-type": "text/plain" })).toEqual({ "content-type": "text/plain" });
  });
});
