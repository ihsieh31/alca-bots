import { describe, expect, it, vi } from "vitest";

import { LOGIN_HANDOFF_REQUEST, LOGIN_HANDOFF_RESULT, receiveLoginHandoff, type ConnectionHandoffAnswer, type ConnectionHandoffWhat, type LoginHandoffResult } from "./login-handoff.ts";

function setup(connections?: (what: ConnectionHandoffWhat) => Promise<ConnectionHandoffAnswer>) {
  const posted: LoginHandoffResult[] = [];
  const ask = (message: unknown) => receiveLoginHandoff(message, (reply) => { posted.push(reply); return true; }, connections);
  return { posted, ask };
}

describe("the private connection handoff to the desktop's main process", () => {
  it("hands each connection ask to the connections, and refuses when they could not answer", async () => {
    const asked: ConnectionHandoffWhat[] = [];
    const { posted, ask } = setup(async (what) => {
      asked.push(what);
      if (what.kind === "connection" && what.id === "key:openrouter") return { ok: true, connection: { key: "fake" } };
      throw new Error("no");
    });
    expect(ask({ type: LOGIN_HANDOFF_REQUEST, requestId: "request-0001", what: { kind: "connection", id: "key:openrouter" } })).toBe(true);
    expect(ask({ type: LOGIN_HANDOFF_REQUEST, requestId: "request-0002", what: { kind: "connection", id: "mcp:docs" } })).toBe(true);
    await vi.waitFor(() => expect(posted).toHaveLength(2));
    expect(asked).toEqual([{ kind: "connection", id: "key:openrouter" }, { kind: "connection", id: "mcp:docs" }]);
    expect(posted).toEqual([
      { type: LOGIN_HANDOFF_RESULT, requestId: "request-0001", ok: true, connection: { key: "fake" } },
      { type: LOGIN_HANDOFF_RESULT, requestId: "request-0002", ok: false, error: "This connection could not be read on this computer." },
    ]);
  });

  it("answers nothing to a malformed or retired ask, and leaves every other private message to its own handler", async () => {
    const { posted, ask } = setup(async () => ({ ok: true, connection: {} }));
    for (const malformed of [
      { type: LOGIN_HANDOFF_REQUEST, requestId: "x", what: { kind: "connection", id: "key:openrouter" } },
      { type: LOGIN_HANDOFF_REQUEST, requestId: "request-0005", what: { kind: "everything" } },
      { type: LOGIN_HANDOFF_REQUEST, requestId: "request-0006", what: { kind: "login", id: "abc" } },
      { type: LOGIN_HANDOFF_REQUEST, requestId: "request-0007", what: { kind: "secrets" } },
      { type: LOGIN_HANDOFF_REQUEST, requestId: "request-0008", what: { kind: "connection", id: "../../etc" } },
      { type: LOGIN_HANDOFF_REQUEST, requestId: "request-0009" },
    ]) expect(ask(malformed)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(posted).toEqual([]);
    for (const other of [null, "text", [], { type: "alcabots:phone-secret-save-result" }, { type: LOGIN_HANDOFF_RESULT, requestId: "request-0010" }]) expect(ask(other)).toBe(false);
  });
});

describe("the private ask for credential fingerprints, which checks what a move carried", () => {
  it("answers every connection's fingerprint under main's nonce, and refuses when the connections could not be read", async () => {
    const nonce = "z".repeat(43);
    let connections: (what: ConnectionHandoffWhat) => Promise<ConnectionHandoffAnswer> = async () => ({ ok: true, secrets: { "key:openrouter": "k".repeat(64) } });
    const { posted, ask } = setup((what) => connections(what));
    ask({ type: LOGIN_HANDOFF_REQUEST, requestId: "request-0201", what: { kind: "verify-secrets", nonce } });
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({ type: LOGIN_HANDOFF_RESULT, requestId: "request-0201", ok: true, secrets: { "key:openrouter": "k".repeat(64) } });
    connections = async () => { throw new Error("no"); };
    ask({ type: LOGIN_HANDOFF_REQUEST, requestId: "request-0202", what: { kind: "verify-secrets", nonce } });
    await vi.waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[1]).toEqual({ type: LOGIN_HANDOFF_RESULT, requestId: "request-0202", ok: false, error: "This computer's apps and keys could not be checked." });
    ask({ type: LOGIN_HANDOFF_REQUEST, requestId: "request-0203", what: { kind: "verify-secrets", nonce: "short" } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(posted, "a nonce too short to keep fingerprints apart is not answered").toHaveLength(2);
  });
});
