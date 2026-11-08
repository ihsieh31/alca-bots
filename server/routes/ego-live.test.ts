import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { EgoLive } from "../ego-live.ts";
import { json, readBody } from "../harness/http.ts";
import type { RequestAuth } from "../request-auth.ts";
import { createEgoLiveRoutes, liveOwner } from "./ego-live.ts";
import { dispatchRoutes } from "./table.ts";

const servers: Server[] = [];
const lives: EgoLive[] = [];
afterEach(async () => {
  for (const live of lives.splice(0)) live.closeAll();
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => { server.closeAllConnections(); server.close(done); })));
});

async function serve(unavailable: string | null = null) {
  const live = new EgoLive({ run: async () => ({ code: 0, output: "@@EGO_LIVE@@{\"space\":null}", timedOut: false }), stateDir: "/nonexistent", pollMs: 60_000 });
  lives.push(live);
  const routes = [createEgoLiveRoutes({ live, unavailable: () => unavailable, visible: (_auth, botId) => botId !== "hidden" })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const auth = { kind: "loopback", scopes: ["admin"] } as unknown as RequestAuth;
    if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, { from: "inline routes" });
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("ego live routes", () => {
  it("opens the event stream for a visible bot", async () => {
    const base = await serve();
    const controller = new AbortController();
    const res = await fetch(`${base}/api/bots/bot/browser/live`, { signal: controller.signal });
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const reader = res.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toMatch(/^event: ready\ndata: \{"viewerId":"[\w-]+"\}/u);
    controller.abort();
  });

  it("hides other bots, refuses without ego lite and requires a viewer", async () => {
    const base = await serve();
    expect((await fetch(`${base}/api/bots/hidden/browser/live`)).status).toBe(404);
    expect((await fetch(`${base}/api/bots/bot/browser/action`)).status).toBe(405);
    const action = await fetch(`${base}/api/bots/bot/browser/action`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "take" }) });
    expect(action.status).toBe(400);
    const gone = await fetch(`${base}/api/bots/bot/browser/action`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ viewerId: "nope", type: "take" }) });
    expect(gone.status).toBe(404);
    const off = await serve("Install ego lite on this computer to watch the bot's browser.");
    expect((await fetch(`${off}/api/bots/bot/browser/live`)).status).toBe(503);
  });

  it("names the person without writing a session id down", () => {
    const session = { kind: "session", session: { id: "secret-session", userId: "portal:grant" } } as unknown as RequestAuth;
    expect(liveOwner(session)).toMatch(/^[0-9a-f]{24}$/u);
    expect(liveOwner(session)).not.toContain("secret");
    expect(liveOwner({ kind: "loopback", scopes: [], companionDevice: "p1" })).not.toBe(liveOwner({ kind: "loopback", scopes: [] }));
  });
});
