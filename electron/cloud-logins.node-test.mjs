import assert from "node:assert/strict";
import test from "node:test";

import { createLoginHandoffClient } from "./cloud-logins.mjs";

const KEY = "sk-fake-node-test-key";

test("the private ask takes its answer only from the process it asked, and gives up in words", async () => {
  const sent = [];
  const proc = { postMessage: (message) => sent.push(message) };
  const other = { postMessage() {} };
  const client = createLoginHandoffClient({ timeoutMs: 50, randomId: () => "request-0001" });
  const asked = client.request(proc, { kind: "connection", id: "key:openai" });
  assert.deepEqual(sent, [{ type: "alcabots:login-handoff", requestId: "request-0001", what: { kind: "connection", id: "key:openai" } }]);
  assert.equal(client.receive(other, { type: "alcabots:login-handoff-result", requestId: "request-0001", ok: true, connection: { config: { openai: { key: "impostor" } } } }), true);
  assert.equal(client.receive(proc, { type: "something-else" }), false);
  client.receive(proc, { type: "alcabots:login-handoff-result", requestId: "request-0001", ok: true, connection: { config: { openai: { key: KEY } } } });
  assert.equal((await asked).connection.config.openai.key, KEY);

  const refused = createLoginHandoffClient({ timeoutMs: 50, randomId: () => "request-0002" });
  const gone = refused.request(proc, { kind: "connection", id: "key:x" });
  refused.receive(proc, { type: "alcabots:login-handoff-result", requestId: "request-0002", ok: false, error: "This key is no longer saved on this computer." });
  await assert.rejects(gone, /no longer saved on this computer/);
  await assert.rejects(createLoginHandoffClient({ timeoutMs: 20 }).request(proc, { kind: "connection", id: "key:openai" }), /did not answer/);
  await assert.rejects(createLoginHandoffClient().request(null, { kind: "connection", id: "key:openai" }), /not running/);
});
