// The relay on Cloudflare Workers. Every relay socket goes to one Durable Object, which runs the same RelayHub as the
// Node relay: pairing nameplates, mailboxes, ciphertext forwarding.
//
//   GET /healthz        counts, configuration warnings (ok:false when misconfigured)
//   GET /v0/link        WebSocket (relay protocol v0)
//
// Pairing codes must meet in one place, so one object holds every socket. It caps itself at MAX_SOCKETS and each
// address at 32 sockets, with the hub's hello deadline, idle timeout and byte budget.
import { RelayHub } from "../relay/relay.ts";
import { RELAY_PATH } from "../src/relay-protocol.ts";
import type { CfWebSocket, DurableState, RelayEnv } from "./cf-types.ts";
import { adaptSocket } from "./socket.ts";

/** Sockets one relay object accepts unless MAX_SOCKETS says otherwise. */
export const DEFAULT_MAX_SOCKETS = 5000;

/** What is wrong with this deployment's settings, worst first. `fatal` ones make /healthz say ok:false. */
export function configProblems(env: RelayEnv): Array<{ fatal: boolean; message: string }> {
  if (list(env.ALLOWED_ORIGINS).length) return [];
  const production = env.RELAY_MODE === "production";
  return [
    {
      fatal: production,
      message: production
        ? "ALLOWED_ORIGINS is empty in production mode: browser sockets are refused until it names the phone site"
        : "ALLOWED_ORIGINS is empty: any website can open relay sockets (set it to the phone site's origin)",
    },
  ];
}

const list = (s: string | undefined) =>
  (s ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

const HEADERS = { "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };

/** The runtime's WebSocketPair (a global on Workers; tests put a fake there). */
type Pair = new () => { 0: CfWebSocket; 1: CfWebSocket };
const pair = (): Pair => (globalThis as unknown as { WebSocketPair: Pair }).WebSocketPair;

export class RelayObject {
  private hub: RelayHub;
  private readonly env: RelayEnv;

  constructor(_state: DurableState, env: RelayEnv) {
    this.env = env;
    const max = Number(env.MAX_SOCKETS);
    this.hub = new RelayHub({ limits: { maxSockets: Number.isInteger(max) && max > 0 ? max : DEFAULT_MAX_SOCKETS } });
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/healthz") {
      const problems = configProblems(this.env);
      return Response.json(
        {
          ok: !problems.some((p) => p.fatal),
          mode: this.env.RELAY_MODE === "production" ? "production" : "default",
          ...(problems.length ? { warnings: problems.map((p) => p.message) } : {}),
          ...this.hub.stats(),
        },
        { headers: HEADERS },
      );
    }
    if (url.pathname !== RELAY_PATH || req.headers.get("upgrade")?.toLowerCase() !== "websocket")
      return new Response("not found", { status: 404, headers: HEADERS });
    // Browsers always send Origin on a WebSocket handshake, so its absence means a non-browser client (a computer's
    // host), which authenticates inside the relay protocol and which a website cannot imitate. `Origin: null`
    // (sandboxed iframe, file://, data: URL) never matches, even if listed.
    const listed = list(this.env.ALLOWED_ORIGINS);
    const origins = listed.filter((o) => o !== "null");
    const origin = req.headers.get("origin");
    if (origin && listed.length && !origins.includes(origin))
      return new Response("forbidden", { status: 403, headers: HEADERS });
    if (origin && !listed.length && this.env.RELAY_MODE === "production")
      return new Response("forbidden: ALLOWED_ORIGINS is not set", { status: 403, headers: HEADERS });
    const P = pair();
    const p = new P();
    this.accept(p[1], req.headers.get("cf-connecting-ip") ?? "unknown");
    return new Response(null, { status: 101, webSocket: p[0] } as ResponseInit);
  }

  /** Hand the server half of a socket to the hub (the client address keys the rate limits). */
  accept(server: CfWebSocket, ip: string): void {
    server.accept();
    this.hub.accept(adaptSocket(server, ip), ip);
  }

  stats() {
    return this.hub.stats();
  }
}

export default {
  async fetch(req: Request, env: RelayEnv): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname !== "/healthz" && url.pathname !== RELAY_PATH)
      return new Response("not found", { status: 404, headers: HEADERS });
    return env.RELAY.get(env.RELAY.idFromName("relay")).fetch(req);
  },
};
