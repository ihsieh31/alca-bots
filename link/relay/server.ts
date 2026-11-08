// HTTP(S) front of the relay: `GET /healthz`, the WebSocket endpoint `/v0/link`, and optionally the phone site as
// static files. No request is logged with its content and nothing is written to disk.
import { readFileSync, statSync } from "node:fs";
import {
  createServer as createHttp,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { createServer as createHttps } from "node:https";
import type { AddressInfo } from "node:net";
import { extname, join, normalize, resolve } from "node:path";
import type { Duplex } from "node:stream";
import { acceptWebSocket } from "../src/node/ws.ts";
import { RELAY_PATH } from "../src/relay-protocol.ts";
import { RelayHub, type RelayHubOptions, type RelayLimits } from "./relay.ts";

export interface RelayOptions {
  host?: string;
  port?: number;
  /** PEM files: serve HTTPS / WSS directly (otherwise put a TLS proxy in front). */
  tlsCert?: string;
  tlsKey?: string;
  /** Directory of the built phone site; unset = relay only. */
  siteDir?: string;
  /**
   * Take the client address from X-Forwarded-For (only behind your own proxy). The number is how
   * many proxies of yours append to it (`true` = 1): the address is that many entries from the
   * right, the rightmost one your outermost proxy did not write. The leftmost entries are whatever
   * the client sent and are never used.
   */
  trustProxy?: boolean | number;
  /** Allowed Origin headers for browser WebSockets; empty = any (the payload is end-to-end encrypted). */
  origins?: string[];
  maxMessageBytes?: number;
  limits?: Partial<RelayLimits>;
  tap?: RelayHubOptions["tap"];
  log?: (msg: string) => void;
}

export interface Relay {
  server: Server;
  hub: RelayHub;
  url: string;
  port: number;
  close(): Promise<void>;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".webp": "image/webp",
};

/** The site reaches relays over any secure socket, because a pairing link can name a self-hosted one; STUN needs no
 * entry. Scripts only ever come from the site itself: whoever can add one has every power the paired phone has. */
export const SITE_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ws: wss:; font-src 'self' data:; manifest-src 'self'; worker-src 'self' blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export const SITE_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(self), microphone=(self), geolocation=()",
};

/**
 * The client address behind `hops` trusted proxies: each proxy appends the address it saw, so the client is the
 * `hops`-th entry from the right. With fewer entries than hops, the leftmost one; none → the socket's own address.
 */
export function clientAddress(xff: string | string[] | undefined, hops: number, remote: string): string {
  if (hops < 1) return remote;
  const list = (Array.isArray(xff) ? xff.join(",") : (xff ?? ""))
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (!list.length) return remote;
  return list[Math.max(0, list.length - hops)] ?? remote;
}

function sitePath(url: string | undefined): string | undefined {
  try {
    const rel = normalize(decodeURIComponent(new URL(url ?? "/", "http://x").pathname)).replace(/^\/+/, "");
    return rel.startsWith("..") || rel.includes("\0") ? undefined : rel;
  } catch {
    return undefined;
  }
}

function serveStatic(dir: string, req: IncomingMessage, res: ServerResponse): void {
  let rel = sitePath(req.url);
  if (rel === undefined) return void res.writeHead(404, SITE_HEADERS).end();
  if (rel === "" || rel.endsWith("/")) rel += "index.html";
  let file = join(dir, rel);
  let type = TYPES[extname(file)];
  try {
    if (!type || !statSync(file).isFile()) throw new Error();
  } catch {
    // App routes fall back to the shell.
    if (extname(rel)) return void res.writeHead(404, SITE_HEADERS).end();
    rel = "index.html";
    file = join(dir, rel);
    type = TYPES[".html"];
  }
  const worker = rel === "sw.js";
  res.writeHead(200, {
    ...SITE_HEADERS,
    "content-type": type as string,
    "content-security-policy": SITE_CSP,
    "cache-control": worker || rel === "index.html" ? "no-cache" : "public, max-age=300",
    ...(worker ? { "service-worker-allowed": "/" } : {}),
  });
  res.end(readFileSync(file));
}

export async function startRelay(o: RelayOptions = {}): Promise<Relay> {
  const hub = new RelayHub({
    ...(o.limits ? { limits: o.limits } : {}),
    ...(o.tap ? { tap: o.tap } : {}),
    ...(o.log ? { log: o.log } : {}),
  });
  const siteDir = o.siteDir ? resolve(o.siteDir) : undefined;
  const handler = (req: IncomingMessage, res: ServerResponse) => {
    const path = (req.url ?? "/").split("?")[0];
    if (req.method === "GET" && path === "/healthz") {
      res.writeHead(200, { ...SITE_HEADERS, "content-type": "application/json" });
      return void res.end(JSON.stringify({ ok: true, ...hub.stats() }));
    }
    if (siteDir && (req.method === "GET" || req.method === "HEAD")) return serveStatic(siteDir, req, res);
    res.writeHead(404, SITE_HEADERS).end();
  };
  const tls = o.tlsCert && o.tlsKey;
  const server = tls
    ? createHttps({ cert: readFileSync(o.tlsCert as string), key: readFileSync(o.tlsKey as string) }, handler)
    : createHttp(handler);
  // Upgraded sockets leave the server's bookkeeping: track them so close() ends them.
  const sockets = new Set<Duplex>();
  server.on("upgrade", (req, socket, head) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    const path = (req.url ?? "/").split("?")[0];
    const origin = req.headers.origin;
    // No Origin = a non-browser client (browsers always send one): allowed. With
    // origins set, anything else unlisted — and `null` always — is refused.
    const refused = !!origin && !!o.origins?.length && (origin === "null" || !o.origins.includes(origin));
    if (path !== RELAY_PATH || refused) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    const ws = acceptWebSocket(req, socket, head, { maxMessageBytes: o.maxMessageBytes ?? 4 * 1024 * 1024 });
    if (!ws) return;
    const hops = o.trustProxy === true ? 1 : typeof o.trustProxy === "number" ? Math.floor(o.trustProxy) : 0;
    hub.accept(ws, clientAddress(req.headers["x-forwarded-for"], hops, ws.remoteAddress));
  });
  await new Promise<void>((res, rej) => {
    server.once("error", rej);
    server.listen(o.port ?? 8787, o.host ?? "127.0.0.1", () => res());
  });
  const port = (server.address() as AddressInfo).port;
  const host = o.host && o.host !== "0.0.0.0" && o.host !== "::" ? o.host : "127.0.0.1";
  return {
    server,
    hub,
    port,
    url: `${tls ? "https" : "http"}://${host.includes(":") ? `[${host}]` : host}:${port}`,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        for (const s of sockets) s.destroy();
        server.close(() => r());
      }),
  };
}
