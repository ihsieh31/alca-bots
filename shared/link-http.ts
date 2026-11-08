// The contract for HTTP over a Link session, used by the computer's bridge and the phone's fetch.
//
// Device → computer, as requests (the reply is the back-pressure for uploads):
//   http.open   {id, method, path, headers, body?}   http.body {id, d?, end?}
//   http.ack    {id, bytes}                          http.cancel {id}
// Computer → device, as events on channel `http`: HttpEvent.

export const HTTP_CHANNEL = "http";

/** The Workers relay caps one message at 1 MiB; every byte here is base64url inside a sealed base64url frame. */
export const HTTP_CHUNK_BYTES = 128 * 1024;
export const HTTP_WINDOW_BYTES = 512 * 1024;
export const HTTP_MAX_STREAMS = 64;
/** The relay closes a connection above 1 MiB/s of frames. Two rounds of base64 grow a byte by 16/9, and the same
 * connection also carries everything else, so raw data stays well under the 590 KiB/s that would reach the limit. */
export const HTTP_RELAY_BYTES_PER_SECOND = 400 * 1024;

export type HttpEvent =
  | { id: string; t: "head"; status: number; headers: Record<string, string> }
  | { id: string; t: "data"; d: string }
  | { id: string; t: "end" }
  | { id: string; t: "error"; message: string };

export interface LinkRefusal {
  code: "forbidden" | "bad_request";
  message: string;
}

const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);
const PREFIXES = ["/api/", "/.well-known/alcabots/"];

/** Security invariant: a paired phone cannot reach the routes that manage which phones may connect, mint a sign-in that
 * outlives its pairing, or call the harness's internal surface, whatever its session's scopes allow. */
const CLOSED_TO_PHONES = [
  /^\/api\/internal(\/|$)/,
  /^\/api\/testing(\/|$)/,
  /^\/api\/link(\/|$)/,
  /^\/api\/auth\/(pair|pairing|sessions)(\/|$)/,
  /^\/api\/pair(\/|$)/,
  /^\/api\/team\/phone-pairing(\/|$)/,
];

/** Why this request may not cross the bridge, or null. The path carries its query and arrives undecoded. */
export function linkRequestRefusal(method: string, path: string): LinkRefusal | null {
  if (!METHODS.has(method)) return { code: "bad_request", message: "method not allowed" };
  // eslint-disable-next-line no-control-regex
  if (typeof path !== "string" || path.length > 4096 || /[\u0000- \u007f\\#]/.test(path)) {
    return { code: "bad_request", message: "bad path" };
  }
  const [pathname = ""] = path.split("?");
  if (!PREFIXES.some((prefix) => pathname.startsWith(prefix))) return { code: "forbidden", message: "not an API path" };
  if (/%(2e|2f|5c)/i.test(pathname) || pathname.split("/").some((part) => part === "." || part === "..")) {
    return { code: "bad_request", message: "bad path" };
  }
  if (CLOSED_TO_PHONES.some((route) => route.test(pathname))) {
    return { code: "forbidden", message: "this is only available on the computer" };
  }
  return null;
}

const REQUEST_HEADERS = new Set([
  "accept", "accept-language", "content-type", "if-modified-since", "if-none-match", "last-event-id", "range",
  "x-alca-background",
]);
const RESPONSE_HEADERS = new Set([
  "accept-ranges", "cache-control", "content-disposition", "content-language", "content-length", "content-range",
  "content-type", "etag", "last-modified", "retry-after", "x-alca-cloud-power",
]);

function kept(headers: unknown, allowed: ReadonlySet<string>): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return out;
  for (const [name, value] of Object.entries(headers as Record<string, unknown>)) {
    const lower = name.toLowerCase();
    const text = Array.isArray(value) ? value.join(", ") : value;
    if (allowed.has(lower) && typeof text === "string" && !/[\r\n]/.test(text)) out[lower] = text;
  }
  return out;
}

/** Security invariant: identity comes from the bridge alone, so a device's own authorization, cookie, host, origin or
 * forwarding headers are dropped and it can never pass as the computer's owner on loopback. */
export const requestHeadersFor = (headers: unknown): Record<string, string> => kept(headers, REQUEST_HEADERS);

/** Security invariant: no set-cookie crosses: the phone's page has no session of its own to overwrite. */
export const responseHeadersFor = (headers: unknown): Record<string, string> => kept(headers, RESPONSE_HEADERS);
