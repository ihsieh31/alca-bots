// G1 at the protocol level: message order against an active attacker, what a
// wrong code costs, tampering in transit, and — since PAKE v1 was removed — that
// every v1-shaped pairing is refused (upgrade_required, nothing stored).
import { describe, expect, it, vi } from "vitest";
import { fromB64u, toB64u } from "../src/bytes.ts";
import { deriveChannelKeys, SecureChannel } from "../src/channel.ts";
import { LinkError } from "../src/errors.ts";
import {
  LINK_VERSION,
  type PairingCode,
  pairAsCore,
  pairAsDevice,
} from "../src/handshake.ts";
import { generateIdentity } from "../src/identity.ts";
import { pakeAad, passwordScalarV2, spake2Finish, spake2Start } from "../src/spake2.ts";
import { type QueueWire, type WireMessage, wirePair } from "../src/wire.ts";

vi.setConfig({ testTimeout: 30_000 });

const CODE: PairingCode = { nameplate: "381", secret: "204957" };
const DEVICE = { name: "iPhone", kind: "phone" as const, platform: "t" };
/** A sample of codes an offline attacker would try, the real one included. */
const CANDIDATES = [CODE.secret, ...Array.from({ length: 150 }, (_, i) => String(100000 + i * 5333))];

const settle = async (p: Promise<unknown>) => {
  try {
    return { ok: true as const, v: await p };
  } catch (e) {
    return { ok: false as const, code: e instanceof LinkError ? e.code : String(e) };
  }
};

async function honestCore(wire: QueueWire) {
  const id = await generateIdentity(true);
  return pairAsCore(wire, {
    code: CODE,
    identity: id,
    coreName: "Mac",
    accept: async () => ({ deviceId: "dev_1", scopes: ["chat"], mailbox: "mb" }),
  });
}

describe("v2: nothing keyed by the PAKE leaves before the peer proved the code", () => {
  it("a fake phone (or relay) without the code gets only pB, then fail — no sealed frame", async () => {
    const [atk, core] = wirePair();
    const done = settle(honestCore(core));
    const guess = "000000";
    const st = spake2Start("A", await passwordScalarV2(guess, `pair|${CODE.nameplate}`));
    atk.send({ t: "pair1", v: LINK_VERSION, pk: [2], share2: toB64u(st.share) });
    const got: WireMessage[] = [await atk.recv()];
    expect(got[0]).toMatchObject({ t: "pair2", pk: 2 });
    expect(Object.keys(got[0] as object).sort()).toEqual(["pk", "share", "t"]);
    expect(fromB64u(String(got[0]?.share))).toHaveLength(65); // a public point only
    // The attacker must commit to cA without the code: it can only use its own guess.
    const r = await spake2Finish(
      st,
      fromB64u(String(got[0]?.share)),
      pakeAad({ purpose: "pair", context: CODE.nameplate, offered: [2], chosen: 2 }),
    );
    atk.send({ t: "pair3", c: toB64u(r.confirm) });
    got.push(await atk.recv());
    expect(got[1]).toMatchObject({ t: "fail", code: "wrong_code" });
    expect(got.some((m) => m.t === "f")).toBe(false);
    expect(await done).toMatchObject({ ok: false, code: "wrong_code" });
  });

  it("a fake computer playing B gets cA, but cA confirms only the one guess it committed to (no offline test)", async () => {
    const [dev, atk] = wirePair();
    const phone = settle(
      pairAsDevice(dev, {
        code: CODE,
        identity: await generateIdentity(),
        device: DEVICE,
      }),
    );
    const p1 = await atk.recv();
    expect(p1).toMatchObject({ t: "pair1", pk: [2] });
    expect(p1.share).toBeUndefined(); // v2 only: no v1 share at all
    const ctx = `pair|${CODE.nameplate}`;
    const st = spake2Start("B", await passwordScalarV2("999999", ctx)); // committed guess
    atk.send({ t: "pair2", pk: 2, share: toB64u(st.share) });
    const p3 = await atk.recv();
    expect(p3.t).toBe("pair3");
    const cA = fromB64u(String(p3.c));
    const aad = pakeAad({ purpose: "pair", context: CODE.nameplate, offered: [2], chosen: 2 });
    // Offline: for each candidate code, recompute everything B could and check cA.
    let hits = 0;
    for (const c of CANDIDATES) {
      const r = await spake2Finish(
        { ...st, w: await passwordScalarV2(c, ctx) },
        fromB64u(String(p1.share2)),
        aad,
      );
      if (await r.verifyPeer(cA)) hits++;
    }
    expect(hits).toBe(0); // not even the real code (CANDIDATES[0]) verifies
    atk.close("bye");
    expect((await phone).ok).toBe(false);
  });

  it("control: when the committed guess is the real code, cA verifies — that is the single online guess", async () => {
    const [dev, atk] = wirePair();
    const phone = settle(
      pairAsDevice(dev, {
        code: CODE,
        identity: await generateIdentity(),
        device: DEVICE,
      }),
    );
    const p1 = await atk.recv();
    const ctx = `pair|${CODE.nameplate}`;
    const st = spake2Start("B", await passwordScalarV2(CODE.secret, ctx));
    atk.send({ t: "pair2", pk: 2, share: toB64u(st.share) });
    const p3 = await atk.recv();
    const aad = pakeAad({ purpose: "pair", context: CODE.nameplate, offered: [2], chosen: 2 });
    const r = await spake2Finish(st, fromB64u(String(p1.share2)), aad);
    expect(await r.verifyPeer(fromB64u(String(p3.c)))).toBe(true);
    atk.close("bye");
    await phone;
  });


});

describe("the phone checks the computer's confirmation itself", () => {
  it("a sealed pair.core that opens but carries a wrong cB is refused before the phone sends its key", async () => {
    // Only a peer that knows the code can seal under Ke; this checks cB is verified, not just the AEAD tag.
    const [dev, atk] = wirePair();
    const phone = settle(
      pairAsDevice(dev, {
        code: CODE,
        identity: await generateIdentity(),
        device: DEVICE,
      }),
    );
    const p1 = await atk.recv();
    const ctx = `pair|${CODE.nameplate}`;
    const st = spake2Start("B", await passwordScalarV2(CODE.secret, ctx));
    atk.send({ t: "pair2", pk: 2, share: toB64u(st.share) });
    await atk.recv(); // pair3
    const r = await spake2Finish(
      st,
      fromB64u(String(p1.share2)),
      pakeAad({ purpose: "pair", context: CODE.nameplate, offered: [2], chosen: 2 }),
    );
    const ch = await SecureChannel.create(
      await deriveChannelKeys(r.ke, new Uint8Array(0), "alca-link/v2 pair keys", "core"),
    );
    const id = await generateIdentity(true);
    const bad = new Uint8Array(r.confirm);
    bad[0] = (bad[0] as number) ^ 1;
    atk.send({
      t: "f",
      d: await ch.seal({ k: "pair.core", pub: toB64u(id.publicRaw), sig: "AA", name: "x", c: toB64u(bad) }),
    });
    const next = await settle(atk.recv());
    if (next.ok) expect((next.v as WireMessage).t).toBe("fail");
    expect(await phone).toMatchObject({ ok: false, code: "wrong_code" });
  });
});

describe("tampering in transit fails confirmation", () => {
  /** Phone ↔ relay ↔ core, the relay rewriting messages with `edit`. */
  async function viaRelay(edit: (m: WireMessage, toCore: boolean) => WireMessage) {
    const [d, rd] = wirePair();
    const [rc, c] = wirePair();
    void (async () => {
      for (;;) rc.send(edit(await rd.recv(10_000), true));
    })().catch(() => rc.close());
    void (async () => {
      for (;;) rd.send(edit(await rc.recv(10_000), false));
    })().catch(() => rd.close());
    const [phone, core] = await Promise.all([
      settle(pairAsDevice(d, { code: CODE, identity: await generateIdentity(), device: DEVICE })),
      settle(honestCore(c)),
    ]);
    return { phone, core };
  }
  const other = async (role: "A" | "B") =>
    toB64u(spake2Start(role, await passwordScalarV2(CODE.secret, `pair|${CODE.nameplate}`)).share);

  it("untouched: v2 pairs", async () => {
    const r = await viaRelay((m) => m);
    expect(r.phone).toMatchObject({ ok: true, v: { pake: 2 } });
  });

  it("the offered version list (pk) rewritten → wrong_code, nothing stored", async () => {
    const r = await viaRelay((m, toCore) => (toCore && m.t === "pair1" ? { ...m, pk: [2, 1, 3] } : m));
    expect(r.core).toMatchObject({ ok: false, code: "wrong_code" });
    expect(r.phone.ok).toBe(false);
  });

  it("pA (share2) or pB swapped for another valid point → wrong_code", async () => {
    const a = await other("A");
    const b = await other("B");
    const r1 = await viaRelay((m, toCore) => (toCore && m.t === "pair1" ? { ...m, share2: a } : m));
    expect(r1.core).toMatchObject({ ok: false, code: "wrong_code" });
    const r2 = await viaRelay((m, toCore) => (!toCore && m.t === "pair2" ? { ...m, share: b } : m));
    expect(r2.core).toMatchObject({ ok: false, code: "wrong_code" });
  });

  it("cA bit-flipped → wrong_code; the sealed frame carrying cB altered → the phone stops before sending its key", async () => {
    const flip = (s: unknown) => {
      const b = fromB64u(String(s));
      b[0] = (b[0] as number) ^ 1;
      return toB64u(b);
    };
    const r1 = await viaRelay((m, toCore) => (toCore && m.t === "pair3" ? { ...m, c: flip(m.c) } : m));
    expect(r1.core).toMatchObject({ ok: false, code: "wrong_code" });
    const r2 = await viaRelay((m, toCore) => (!toCore && m.t === "f" ? { ...m, d: flip(m.d) } : m));
    expect(r2.phone.ok).toBe(false);
    expect(r2.core.ok).toBe(false);
  });

  it("stripping v2 in transit (pk and share2 removed) → the core refuses upgrade_required; nothing runs v1", async () => {
    const [d, rd] = wirePair();
    const [rc, c] = wirePair();
    void (async () => {
      for (;;) {
        const m = await rd.recv(10_000);
        const { pk: _pk, share2: _s, ...rest } = m;
        rc.send(rest);
      }
    })().catch(() => rc.close());
    void (async () => {
      for (;;) rd.send(await rc.recv(10_000));
    })().catch(() => rd.close());
    const [phone, core] = await Promise.all([
      settle(pairAsDevice(d, { code: CODE, identity: await generateIdentity(), device: DEVICE })),
      settle(honestCore(c)),
    ]);
    expect(phone.ok).toBe(false);
    expect(core).toMatchObject({ ok: false, code: "upgrade_required" });
  });
});

describe("PAKE v1 is removed: every v1-shaped first message is refused before any PAKE", () => {
  const v1Share = async () => toB64u(spake2Start("A", 7n).share); // any valid point: the core never looks at it
  const pair1Shapes = async () => {
    const share = await v1Share();
    const share2 = toB64u(
      spake2Start("A", await passwordScalarV2(CODE.secret, `pair|${CODE.nameplate}`)).share,
    );
    return [
      { name: "pre-G1 page: share only, no pk", m: { t: "pair1", v: LINK_VERSION, share } },
      { name: "pk [1]", m: { t: "pair1", v: LINK_VERSION, pk: [1], share } },
      { name: "pk [1] with a v2 share", m: { t: "pair1", v: LINK_VERSION, pk: [1], share, share2 } },
      { name: "pk as a string", m: { t: "pair1", v: LINK_VERSION, pk: "2", share, share2 } },
      { name: "pk empty", m: { t: "pair1", v: LINK_VERSION, pk: [], share2 } },
    ];
  };

  it("pairing: the core answers fail upgrade_required (with the update message), sends no pair2, stores nothing", async () => {
    for (const { name, m } of await pair1Shapes()) {
      const [atk, core] = wirePair();
      const accepted: string[] = [];
      const pakes: number[] = [];
      const done = settle(
        pairAsCore(core, {
          code: CODE,
          identity: await generateIdentity(true),
          coreName: "Mac",
          onPake: (v) => pakes.push(v),
          accept: async (dev) => {
            accepted.push(dev.name);
            return { deviceId: "d", scopes: [], mailbox: "m" };
          },
        }),
      );
      atk.send(m as WireMessage);
      const first = await atk.recv();
      expect(first, name).toMatchObject({ t: "fail", code: "upgrade_required" });
      expect(String(first.message), name).toMatch(/update .*pair again/);
      expect(await done, name).toMatchObject({ ok: false, code: "upgrade_required" });
      expect(accepted, name).toEqual([]);
      expect(pakes, name).toEqual([]); // no PAKE version was ever chosen
    }
  });




});

