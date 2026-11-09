// What the service worker decides and how it borrows the page's connection. Only the page holds the encrypted session,
// so a request the page's fetch can't see (an <img>, a <video>, a download) is answered by asking the page for it.

export const MEDIA_MESSAGE = "alca.media";
export const SKIP_WAITING_MESSAGE = "alca.skipWaiting";
export const OPEN_MESSAGE = "alca.open";
export const PENDING_OPEN_CACHE = "alca-open";
export const PENDING_OPEN_URL = "/__alca/pending-open";

const ROUTED = ["/api/", "/.well-known/alcabots/"];
const FORWARDED_HEADERS = ["range", "accept", "if-none-match", "if-modified-since", "if-range"];
const NULL_BODY = new Set([101, 204, 205, 304]);
const ANSWER_TIMEOUT_MS = 25_000;

export type MediaFromPage =
  | { t: "head"; status: number; headers: Array<[string, string]> }
  | { t: "chunk"; bytes: Uint8Array }
  | { t: "end" }
  | { t: "fail" };

export type MediaToPage = { t: "pull" } | { t: "cancel" };

export interface MediaRequest {
  type: typeof MEDIA_MESSAGE;
  url: string;
  method: string;
  headers: Array<[string, string]>;
}

export type Route = "page" | "shell" | "cached" | "network";

export function routeFor(request: { url: string; method: string; mode: string }, origin: string, precached: ReadonlySet<string>): Route {
  const url = new URL(request.url);
  if (url.origin !== origin || request.method !== "GET") return "network";
  if (ROUTED.some((prefix) => url.pathname.startsWith(prefix))) return "page";
  if (request.mode === "navigate") return "shell";
  return url.pathname.startsWith("/assets/") || precached.has(url.pathname) ? "cached" : "network";
}

export interface PageClient {
  postMessage(message: unknown, transfer: Transferable[]): void;
}

export interface PageClients {
  get(id: string): Promise<PageClient | undefined | null>;
  matchAll(options: { type: "window"; includeUncontrolled: true }): Promise<readonly PageClient[]>;
}

const plain = (status: number) => new Response(null, { status });

/** The Response the page's connection gives for this request, streamed one chunk per read so it never buffers. */
export async function answerFromPage(
  request: { url: string; method: string; headers: Headers },
  clientId: string,
  clients: PageClients,
  timeoutMs = ANSWER_TIMEOUT_MS,
): Promise<Response> {
  // A download link is a navigation, so nothing owns it yet and any open page can answer.
  const owner = clientId ? await clients.get(clientId) : null;
  const client = owner ?? (await clients.matchAll({ type: "window", includeUncontrolled: true }))[0];
  if (!client) return plain(503);

  const { port1, port2 } = new MessageChannel();
  const headers = FORWARDED_HEADERS.flatMap((name): Array<[string, string]> => {
    const value = request.headers.get(name);
    return value === null ? [] : [[name, value]];
  });
  const sent: MediaRequest = { type: MEDIA_MESSAGE, url: request.url, method: request.method, headers };
  const toPage = (message: MediaToPage) => port1.postMessage(message);

  return new Promise<Response>((resolve) => {
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
    let settlePull: (() => void) | null = null;
    let finished = false;
    const close = () => {
      finished = true;
      settlePull?.();
      settlePull = null;
      port1.close();
    };
    const timer = setTimeout(() => {
      toPage({ t: "cancel" });
      close();
      resolve(plain(504));
    }, timeoutMs);

    const body = new ReadableStream<Uint8Array>({
      start: (c) => { controller = c; },
      pull: () => new Promise<void>((done) => {
        if (finished) return done();
        settlePull = done;
        toPage({ t: "pull" });
      }),
      cancel: () => {
        toPage({ t: "cancel" });
        close();
      },
    }, { highWaterMark: 0 });

    port1.onmessage = ({ data }: MessageEvent<MediaFromPage>) => {
      if (data.t === "head") {
        clearTimeout(timer);
        const status = data.status >= 200 && data.status <= 599 ? data.status : 502;
        const hasBody = !NULL_BODY.has(status) && request.method !== "HEAD";
        resolve(new Response(hasBody ? body : null, { status, headers: data.headers }));
        if (!hasBody) {
          toPage({ t: "cancel" });
          close();
        }
      } else if (data.t === "chunk") {
        controller?.enqueue(data.bytes);
        settlePull?.();
        settlePull = null;
      } else if (data.t === "end") {
        controller?.close();
        close();
      } else {
        clearTimeout(timer);
        resolve(plain(502));
        controller?.error(new TypeError("Failed to fetch"));
        close();
      }
    };
    client.postMessage(sent, [port2]);
  });
}
