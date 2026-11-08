// fetch over a Link session. Requests stay on the session they started on, so a move from the relay to a direct path
// doesn't lose what is still arriving; a read the old session never answered is retried on the new one.
import { fromB64u, toB64u } from "../../link/src/bytes.ts";
import {
  HTTP_CHANNEL,
  HTTP_CHUNK_BYTES,
  HTTP_RELAY_BYTES_PER_SECOND,
  HTTP_WINDOW_BYTES,
  type HttpEvent,
} from "../../shared/link-http.ts";

export interface HttpPeer {
  request(op: string, args: Record<string, unknown>, timeoutMs?: number): Promise<unknown>;
  onEvent(handler: (channel: string, event: unknown) => void): () => void;
  onClose(handler: (reason: string) => void): void;
}

export interface LinkHttpOptions {
  nativeFetch: typeof fetch;
  origin: string;
  /** How long a request waits for a connection before failing as a network error would. */
  waitForPeerMs?: number;
}

const ACK_EVERY_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const ROUTED = ["/api/", "/.well-known/alcabots/"];
const NULL_BODY = new Set([101, 204, 205, 304]);
const STATUS_FOR_REFUSAL: Record<string, number> = { forbidden: 403, bad_request: 400, busy: 503, revoked: 401 };

interface Bound {
  peer: HttpPeer;
  overRelay: boolean;
  streams: Map<string, (event: HttpEvent) => void>;
  losses: Set<() => void>;
}

const abortError = () => new DOMException("The operation was aborted.", "AbortError");
const networkError = () => new TypeError("Failed to fetch");

export class LinkHttp {
  private readonly o: LinkHttpOptions;
  private current: Bound | null = null;
  private waiters = new Set<() => void>();
  private serial = 0;
  private readonly salt = Math.random().toString(36).slice(2, 10);
  private paceFreeAt = 0;

  constructor(o: LinkHttpOptions) {
    this.o = o;
  }

  /** Each session that comes up. Null means no session is usable now. */
  setPeer(peer: HttpPeer | null, via?: string): void {
    if (!peer) {
      this.current = null;
      return;
    }
    const bound: Bound = { peer, overRelay: via === "relay", streams: new Map(), losses: new Set() };
    peer.onEvent((channel, event) => {
      if (channel !== HTTP_CHANNEL) return;
      const e = event as HttpEvent;
      bound.streams.get(e.id)?.(e);
    });
    peer.onClose(() => {
      if (this.current === bound) this.current = null;
      for (const lost of [...bound.losses]) lost();
    });
    this.current = bound;
    for (const wake of [...this.waiters]) wake();
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), `${this.o.origin}/`);
    const routed = url.origin === this.o.origin && ROUTED.some((prefix) => url.pathname.startsWith(prefix));
    if (!routed) return this.o.nativeFetch(input, init);
    const request = input instanceof Request ? new Request(input, init) : new Request(url, init);
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined) ?? undefined;
    // Read whole because Safari can't stream a Request's body; the window below still keeps the wire to one chunk at a time.
    const body = request.method === "GET" || request.method === "HEAD" ? null : new Uint8Array(await request.arrayBuffer());
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) throw abortError();
      const bound = await this.peer(signal);
      const outcome = await this.send(bound, request, url, body, signal);
      if (outcome !== "lost") return outcome;
      if (body || attempt >= 1) throw networkError();
    }
  };

  private peer(signal: AbortSignal | undefined): Promise<Bound> {
    if (this.current) return Promise.resolve(this.current);
    return new Promise((resolve, reject) => {
      const finish = (settle: () => void) => {
        clearTimeout(timer);
        this.waiters.delete(wake);
        signal?.removeEventListener("abort", aborted);
        settle();
      };
      const wake = () => {
        const bound = this.current;
        if (bound) finish(() => resolve(bound));
      };
      const aborted = () => finish(() => reject(abortError()));
      const timer = setTimeout(() => finish(() => reject(networkError())), this.o.waitForPeerMs ?? 15_000);
      this.waiters.add(wake);
      signal?.addEventListener("abort", aborted, { once: true });
    });
  }

  /** The Response, or "lost" when the session ended before the computer answered. */
  private send(bound: Bound, request: Request, url: URL, upload: Uint8Array | null, signal: AbortSignal | undefined): Promise<Response | "lost"> {
    const id = `${this.salt}-${++this.serial}`;
    const { peer, streams, losses } = bound;

    return new Promise<Response | "lost">((resolve, reject) => {
      let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
      let answered = false;
      let unacked = 0;
      const flushAck = () => {
        if (!unacked) return;
        const bytes = unacked;
        unacked = 0;
        peer.request("http.ack", { id, bytes }).catch(() => {});
      };
      const cleanup = () => {
        streams.delete(id);
        losses.delete(lost);
        signal?.removeEventListener("abort", aborted);
      };
      const fail = (error: Error) => {
        cleanup();
        if (answered) controller?.error(error);
        else reject(error);
      };
      const lost = () => {
        cleanup();
        if (answered) controller?.error(networkError());
        else resolve("lost");
      };
      const aborted = () => {
        peer.request("http.cancel", { id }).catch(() => {});
        fail(abortError());
      };
      const body = new ReadableStream<Uint8Array>({
        start: (c) => { controller = c; },
        pull: () => flushAck(),
        cancel: () => {
          cleanup();
          peer.request("http.cancel", { id }).catch(() => {});
        },
      }, new ByteLengthQueuingStrategy({ highWaterMark: HTTP_WINDOW_BYTES }));

      streams.set(id, (event) => {
        if (event.t === "head") {
          answered = true;
          const status = event.status >= 200 && event.status <= 599 ? event.status : 502;
          const response = new Response(NULL_BODY.has(status) || request.method === "HEAD" ? null : body, { status, headers: event.headers });
          Object.defineProperty(response, "url", { value: url.href });
          resolve(response);
        } else if (event.t === "data") {
          const bytes = fromB64u(event.d);
          controller?.enqueue(bytes);
          unacked += bytes.length;
          if (unacked >= ACK_EVERY_BYTES && (controller?.desiredSize ?? 0) > 0) flushAck();
        } else if (event.t === "end") {
          cleanup();
          controller?.close();
        } else {
          fail(networkError());
        }
      });
      losses.add(lost);
      signal?.addEventListener("abort", aborted, { once: true });

      const headers = Object.fromEntries(request.headers.entries());
      const hasBody = Boolean(upload?.length);
      peer.request("http.open", { id, method: request.method, path: url.pathname + url.search, headers, body: hasBody }, REQUEST_TIMEOUT_MS).then(
        () => (hasBody ? this.upload(bound, id, upload!) : undefined),
      ).catch((error: { code?: string; message?: string }) => {
        const status = error?.code ? STATUS_FOR_REFUSAL[error.code] : undefined;
        if (status && !answered) {
          cleanup();
          resolve(new Response(JSON.stringify({ error: error.message ?? "refused" }), { status, headers: { "content-type": "application/json" } }));
        } else if (streams.has(id)) {
          if (error?.code === "closed" || error?.code === "timeout") lost();
          else fail(networkError());
        }
      });
    });
  }

  private async upload(bound: Bound, id: string, bytes: Uint8Array): Promise<void> {
    for (let at = 0; at < bytes.length; at += HTTP_CHUNK_BYTES) {
      const piece = bytes.subarray(at, at + HTTP_CHUNK_BYTES);
      await this.pace(bound, piece.length);
      await bound.peer.request("http.body", { id, d: toB64u(piece) }, REQUEST_TIMEOUT_MS);
    }
    await bound.peer.request("http.body", { id, end: true }, REQUEST_TIMEOUT_MS);
  }

  private async pace(bound: Bound, bytes: number): Promise<void> {
    if (!bound.overRelay) return;
    const now = Date.now();
    const start = Math.max(now, this.paceFreeAt);
    this.paceFreeAt = start + (bytes / HTTP_RELAY_BYTES_PER_SECOND) * 1000;
    if (start > now) await new Promise((resolve) => setTimeout(resolve, start - now));
  }
}
