// A move to the person's own Cloud: the desktop app's main process asks this server for one connection's secrets, to
// send them to that Cloud. The ask and the answer travel only over Electron's private utility-process port, which no
// page, bot, browser or other local process can reach (a plain Node server has no such port, so this never answers
// there). Nothing here is an HTTP answer, a log line or a chat message, and nothing is kept.
import { VERIFY_NONCE } from "./cloud-send-verify.ts";

export const LOGIN_HANDOFF_REQUEST = "alcabots:login-handoff";
export const LOGIN_HANDOFF_RESULT = "alcabots:login-handoff-result";

/** One connection's secrets, a code for that Cloud to act as this computer's connected-apps account, or letting go of
 * a sign-in that moved there (cloud-connections.ts). */
export type ConnectionHandoffWhat =
  | { kind: "connection"; id: string }
  | { kind: "composio-share"; for: string }
  | { kind: "connection-release"; id: string; digest: string }
  | { kind: "connection-fingerprints"; nonce: string };
export type ConnectionHandoffAnswer =
  | { ok: true; connection: object; digest?: string }
  | { ok: true; share: { code: string } }
  | { ok: true; release: { released: true } | { changed: true } }
  | { ok: true; secrets: Record<string, string> }
  | { ok: false; error: string };
export type LoginHandoffResult = { type: typeof LOGIN_HANDOFF_RESULT; requestId: string } & ConnectionHandoffAnswer;

const REQUEST_ID = /^[\w-]{8,64}$/u;
const CONNECTION_ID = /^(?:mcp:[a-z][a-z0-9_-]{0,31}|key:\w{1,40}|composio|email)$/u;
const INSTALLATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;

/** What main may ask: a connection's fingerprints are asked only on its behalf, by a check of the credentials. */
type Ask = Exclude<ConnectionHandoffWhat, { kind: "connection-fingerprints" }> | { kind: "verify-secrets"; nonce: string };

function parse(raw: unknown): { requestId: string; what: Ask } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const message = raw as Record<string, unknown>;
  if (message.type !== LOGIN_HANDOFF_REQUEST || typeof message.requestId !== "string" || !REQUEST_ID.test(message.requestId)) return null;
  const what = message.what as Record<string, unknown> | null;
  if (what?.kind === "connection" && typeof what.id === "string" && CONNECTION_ID.test(what.id)) return { requestId: message.requestId, what: { kind: "connection", id: what.id } };
  if (what?.kind === "composio-share" && typeof what.for === "string" && INSTALLATION_ID.test(what.for)) return { requestId: message.requestId, what: { kind: "composio-share", for: what.for } };
  if (what?.kind === "connection-release" && typeof what.id === "string" && CONNECTION_ID.test(what.id) && typeof what.digest === "string" && DIGEST.test(what.digest)) {
    return { requestId: message.requestId, what: { kind: "connection-release", id: what.id, digest: what.digest } };
  }
  if (what?.kind === "verify-secrets" && typeof what.nonce === "string" && VERIFY_NONCE.test(what.nonce)) return { requestId: message.requestId, what: { kind: "verify-secrets", nonce: what.nonce } };
  return null;
}

/** True when the message was a handoff ask, answered or refused; anything else is left for the next handler. Each ask
 * is answered by `connections`, once its answer is ready. */
export function receiveLoginHandoff(raw: unknown, post: (message: LoginHandoffResult) => boolean,
  connections?: (what: ConnectionHandoffWhat) => Promise<ConnectionHandoffAnswer>): boolean {
  if ((raw as { type?: unknown } | null)?.type !== LOGIN_HANDOFF_REQUEST) return false;
  const ask = parse(raw);
  if (!ask) return true;
  const { requestId, what } = ask;
  if (what.kind === "verify-secrets") {
    const theirs = connections ? connections({ kind: "connection-fingerprints", nonce: what.nonce }).catch(() => null) : Promise.resolve(null);
    void theirs.then((answered) => post(answered?.ok && "secrets" in answered ? { type: LOGIN_HANDOFF_RESULT, requestId, ok: true, secrets: answered.secrets }
      : { type: LOGIN_HANDOFF_RESULT, requestId, ok: false, error: "This computer's apps and keys could not be checked." }));
    return true;
  }
  const refused: ConnectionHandoffAnswer = { ok: false, error: "This connection could not be read on this computer." };
  const answer = connections ? connections(what).catch((): ConnectionHandoffAnswer => refused) : Promise.resolve(refused);
  void answer.then((answered) => post({ type: LOGIN_HANDOFF_RESULT, requestId, ...answered }));
  return true;
}
