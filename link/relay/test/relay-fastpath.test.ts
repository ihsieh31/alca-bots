// P15 review: sealed Link frames are forwarded without re-parsing the
// ciphertext; the bytes that reach the other side are exactly what the full
// parse + serialize produces, and any other shape still takes the full path.
import { fromB64u, randomBytes, toB64u } from "../../src/bytes.ts";
import { generateIdentity, sign } from "../../src/identity.ts";
import { coreAuthPayload, RELAY_VERSION } from "../../src/relay-protocol.ts";
import type { WsConnection } from "../../src/node/ws.ts";
import { describe, expect, it } from "vitest";
import { RelayHub } from "../relay.ts";

class Sock implements WsConnection {
  open = true;
  bufferedAmount = 0;
  remoteAddress = "127.0.0.1";
  sent: string[] = [];
  private h: (t: string) => void = () => {};
  private waiters: Array<(m: Record<string, unknown>) => void> = [];
  send(t: string) {
    this.sent.push(t);
    this.waiters.shift()?.(JSON.parse(t));
  }
  close() {
    this.open = false;
  }
  onMessage(h: (t: string) => void) {
    this.h = h;
  }
  onClose() {}
  push(t: string) {
    this.h(t);
  }
  next(): Promise<Record<string, unknown>> {
    return new Promise((r) => this.waiters.push(r));
  }
}

async function paired(tap?: (dir: string, d: unknown) => void) {
  const hub = new RelayHub(tap ? { tap } : {});
  const id = await generateIdentity();
  const core = new Sock();
  hub.accept(core, "core-addr");
  let w = core.next();
  core.push(JSON.stringify({ v: RELAY_VERSION, op: "core.hello", pub: toB64u(id.publicRaw) }));
  const ch = await w;
  w = core.next();
  core.push(
    JSON.stringify({
      op: "core.auth",
      sig: toB64u(await sign(id, coreAuthPayload(fromB64u(String(ch.nonce))))),
    }),
  );
  await w;
  w = core.next();
  core.push(JSON.stringify({ op: "nameplate.open", req: 1 }));
  const np = await w;
  const dev = new Sock();
  hub.accept(dev, "dev-addr");
  w = core.next();
  dev.push(JSON.stringify({ v: RELAY_VERSION, op: "claim", nameplate: np.nameplate }));
  const open = await w;
  return { core, dev, ch: String(open.ch) };
}

describe("relay fast path for sealed frames", () => {
  it("forwards exactly what the full parse would, both ways", async () => {
    const taps: Array<[string, unknown]> = [];
    const { core, dev, ch } = await paired((dir, d) => taps.push([dir, d]));
    const d = { t: "f", d: toB64u(randomBytes(300)) };
    const fast = JSON.stringify({ op: "msg", d });
    const slow = JSON.stringify({ op: "msg", d }, null, 1); // same frame, other whitespace: full parse
    dev.push(fast);
    dev.push(slow);
    const [a, b] = core.sent.slice(-2);
    expect(a).toBe(JSON.stringify({ op: "ch.msg", ch, d }));
    expect(a).toBe(b);
    core.push(JSON.stringify({ op: "ch.msg", ch, d }));
    core.push(JSON.stringify({ op: "ch.msg", ch, d }, null, 1));
    await new Promise((r) => setImmediate(r));
    const [c, e] = dev.sent.slice(-2);
    expect(c).toBe(JSON.stringify({ op: "msg", d }));
    expect(c).toBe(e);
    expect(taps).toEqual([
      ["to_core", d],
      ["to_core", d],
      ["to_device", d],
      ["to_device", d],
    ]);
  });

  it("other shapes take the full path; an unknown channel answers ch.closed", async () => {
    const { core, dev, ch } = await paired();
    // A payload with characters outside base64 (escaped quote) still arrives intact.
    const odd = { t: "f", d: 'a"b\\c' };
    dev.push(JSON.stringify({ op: "msg", d: odd }));
    expect(JSON.parse(core.sent.at(-1) ?? "")).toEqual({ op: "ch.msg", ch, d: odd });
    const n = core.sent.length;
    core.push(JSON.stringify({ op: "ch.msg", ch: "c999", d: { t: "f", d: "AAAA" } }));
    await new Promise((r) => setImmediate(r));
    expect(JSON.parse(core.sent[n] ?? "")).toEqual({ op: "ch.closed", ch: "c999" });
  });
});
