import { createDecipheriv, createECDH, createPublicKey, hkdfSync, verify } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Notification } from "../../shared/notification.ts";
import { LinkPush, pushMessageFor, PushRefused } from "./push.ts";
import { encryptPush, generateVapidKey, isPushService, MAX_PLAINTEXT_BYTES, PushSender, vapidAuthorization, vapidPublicKey } from "./web-push.ts";

const b64u = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const bytes = (text: string) => Buffer.from(text, "base64url");

function phone() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = Buffer.alloc(16, 7);
  return { ecdh, auth, keys: { p256dh: b64u(ecdh.getPublicKey()), auth: b64u(auth) } };
}

function decrypt(body: Buffer, ecdh: ReturnType<typeof createECDH>, auth: Buffer): string {
  const salt = body.subarray(0, 16);
  const idLength = body.readUInt8(20);
  const senderPublic = body.subarray(21, 21 + idLength);
  const record = body.subarray(21 + idLength);
  const info = Buffer.concat([Buffer.from("WebPush: info\0"), ecdh.getPublicKey(), senderPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", ecdh.computeSecret(senderPublic), auth, info, 32));
  const key = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const decipher = createDecipheriv("aes-128-gcm", key, nonce);
  decipher.setAuthTag(record.subarray(record.length - 16));
  const plain = Buffer.concat([decipher.update(record.subarray(0, record.length - 16)), decipher.final()]);
  expect(plain[plain.length - 1]).toBe(0x02);
  return plain.subarray(0, plain.length - 1).toString();
}

describe("encryptPush", () => {
  it("matches the worked example in RFC 8291", () => {
    const keys = { p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4", auth: "BTBZMqHH6r4Tts7J_aSIgg" };
    const out = encryptPush(Buffer.from("When I grow up, I want to be a watermelon"), keys, {
      salt: bytes("DGv6ra1nlYgDCS1FRnbzlw"),
      privateKey: bytes("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"),
    });
    expect(b64u(out)).toBe("DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN");
  });

  it("refuses more than one record holds", () => {
    const { keys } = phone();
    expect(() => encryptPush(new Uint8Array(MAX_PLAINTEXT_BYTES + 1), keys)).toThrow();
    expect(encryptPush(new Uint8Array(MAX_PLAINTEXT_BYTES), keys).length).toBe(4096);
  });
});

describe("vapid", () => {
  it("signs a token the push service can verify with the public key", () => {
    const key = generateVapidKey();
    const header = vapidAuthorization(key, "https://fcm.googleapis.com", 2_000_000_000, "https://example.com");
    const [, token, publicKey] = /^vapid t=([^,]+), k=(.+)$/.exec(header)!;
    expect(publicKey).toBe(vapidPublicKey(key));
    const [head, claims, signature] = token!.split(".") as [string, string, string];
    const point = bytes(publicKey!);
    const pub = createPublicKey({ key: { kty: "EC", crv: "P-256", x: b64u(point.subarray(1, 33)), y: b64u(point.subarray(33)) }, format: "jwk" });
    expect(verify("sha256", Buffer.from(`${head}.${claims}`), { key: pub, dsaEncoding: "ieee-p1363" }, bytes(signature))).toBe(true);
    expect(JSON.parse(bytes(claims).toString())).toEqual({ aud: "https://fcm.googleapis.com", exp: 2_000_000_000, sub: "https://example.com" });
  });
});

describe("isPushService", () => {
  it.each([
    ["https://fcm.googleapis.com/fcm/send/x", true],
    ["https://web.push.apple.com/abc", true],
    ["https://updates.push.services.mozilla.com/wpush/v2/x", true],
    ["https://wns2-par02p.notify.windows.com/w/?token=x", true],
    ["http://fcm.googleapis.com/x", false],
    ["https://169.254.169.254/latest", false],
    ["https://192.168.1.20/steal", false],
    ["https://push.apple.com.evil.example/x", false],
    ["https://evilpush.apple.com/x", false],
    ["https://fcm.googleapis.com:8443/x", false],
    ["https://user:pw@fcm.googleapis.com/x", false],
    ["not a url", false],
  ])("%s → %s", (endpoint, expected) => {
    expect(isPushService(endpoint)).toBe(expected);
  });
});

describe("PushSender", () => {
  const target = () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/a", keys: phone().keys });
  const answering = (status: number, headers: Record<string, string> = {}) => vi.fn<typeof fetch>(async () => new Response(null, { status, headers }));

  it("classifies what the push service answers", async () => {
    for (const [status, outcome] of [[201, "sent"], [404, "gone"], [410, "gone"], [429, "retry"], [503, "retry"], [400, "rejected"], [403, "rejected"]] as const) {
      const sender = new PushSender({ key: generateVapidKey(), contact: "https://example.com", fetch: answering(status) });
      expect((await sender.send(target(), {})).outcome).toBe(outcome);
    }
  });

  it("treats a network failure as worth retrying", async () => {
    const sender = new PushSender({ key: generateVapidKey(), contact: "https://example.com", fetch: async () => { throw new TypeError("down"); } });
    expect((await sender.send(target(), {})).outcome).toBe("retry");
  });

  it("never posts to anything but a push service, and refuses redirects", async () => {
    const send = answering(201);
    const sender = new PushSender({ key: generateVapidKey(), contact: "https://example.com", fetch: send });
    expect((await sender.send({ endpoint: "https://192.168.1.20/x", keys: phone().keys }, {})).outcome).toBe("rejected");
    expect(send).not.toHaveBeenCalled();
    await sender.send(target(), {});
    expect(send.mock.calls[0]![1]!.redirect).toBe("error");
  });

  it("reuses its signed token per service until it nears expiry", async () => {
    const send = answering(201);
    let now = 1_000_000_000_000;
    const sender = new PushSender({ key: generateVapidKey(), contact: "https://example.com", fetch: send, now: () => now });
    const auth = (call: number) => (send.mock.calls[call]![1]!.headers as Record<string, string>).Authorization;
    await sender.send(target(), {});
    await sender.send(target(), {});
    expect(auth(1)).toBe(auth(0));
    now += 11.5 * 3600 * 1000;
    await sender.send(target(), {});
    expect(auth(2)).not.toBe(auth(0));
  });
});

describe("pushMessageFor", () => {
  it("shortens long text and carries where to open", () => {
    const message = pushMessageFor({ kind: "approval", botId: "b", botName: "Ledger", threadId: "t", title: "Ledger", body: "字".repeat(2000) } as Notification);
    expect(Array.from(message.body)).toHaveLength(600);
    expect(message).toMatchObject({ title: "Ledger", tag: "approval:t", botId: "b", threadId: "t" });
    expect(Buffer.byteLength(JSON.stringify(message))).toBeLessThan(MAX_PLAINTEXT_BYTES);
  });
});

describe("LinkPush", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  const dir = () => {
    const made = mkdtempSync(join(tmpdir(), "link-push-"));
    dirs.push(made);
    return made;
  };
  const NOTE = { kind: "approval", botId: "b", botName: "Ledger", threadId: "t", title: "Ledger", body: "Needs you" } as Notification;
  const ENDPOINT = "https://web.push.apple.com/a";

  it("delivers the notification encrypted to the phone", async () => {
    const send = vi.fn<typeof fetch>(async () => new Response(null, { status: 201 }));
    const push = new LinkPush({ dir: dir(), fetch: send });
    const device = phone();
    push.subscribe("d1", { endpoint: ENDPOINT, keys: device.keys });
    push.notify(NOTE);
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    const body = send.mock.calls[0]![1]!.body as Buffer;
    expect(body.toString("latin1")).not.toContain("Needs you");
    expect(JSON.parse(decrypt(body, device.ecdh, device.auth))).toMatchObject({ title: "Ledger", body: "Needs you", threadId: "t" });
  });

  it("stays quiet for a phone showing the app, and speaks once it is hidden or gone", async () => {
    const send = vi.fn<typeof fetch>(async () => new Response(null, { status: 201 }));
    const push = new LinkPush({ dir: dir(), fetch: send });
    push.subscribe("d1", { endpoint: ENDPOINT, keys: phone().keys });
    push.sessionOpened("d1");
    push.notify(NOTE);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(send).not.toHaveBeenCalled();
    push.setVisible("d1", false);
    push.notify(NOTE);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    push.setVisible("d1", true);
    push.sessionOpened("d1");
    push.sessionClosed("d1");
    push.notify(NOTE);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(send).toHaveBeenCalledTimes(1);
    push.sessionClosed("d1");
    push.notify(NOTE);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  });

  it("forgets a subscription the service says is gone", async () => {
    const send = vi.fn<typeof fetch>(async () => new Response(null, { status: 410 }));
    const push = new LinkPush({ dir: dir(), fetch: send });
    push.subscribe("d1", { endpoint: ENDPOINT, keys: phone().keys });
    push.notify(NOTE);
    await vi.waitFor(() => expect(push.config("d1").subscribed).toBe(false));
  });

  it("retries a busy service a bounded number of times", async () => {
    const send = vi.fn<typeof fetch>(async () => new Response(null, { status: 503, headers: { "retry-after": "9999" } }));
    const sleep = vi.fn(async () => {});
    const push = new LinkPush({ dir: dir(), fetch: send, sleep });
    push.subscribe("d1", { endpoint: ENDPOINT, keys: phone().keys });
    push.notify(NOTE);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(3));
    expect(sleep.mock.calls.map((call) => (call as unknown[])[0])).toEqual([60_000, 60_000]);
    expect(push.config("d1").subscribed).toBe(true);
  });

  it("refuses an address that isn't a push service, and keys that aren't real", () => {
    const push = new LinkPush({ dir: dir() });
    expect(() => push.subscribe("d1", { endpoint: "https://192.168.1.20/steal", keys: phone().keys })).toThrow(PushRefused);
    expect(() => push.subscribe("d1", { endpoint: ENDPOINT, keys: { p256dh: "AAAA", auth: "AAAA" } })).toThrow(PushRefused);
    expect(() => push.subscribe("d1", "nonsense")).toThrow(PushRefused);
    expect(push.config("d1").subscribed).toBe(false);
  });

  it("keeps its key and subscriptions across restarts, readable only by the owner, until removed", () => {
    const place = dir();
    const first = new LinkPush({ dir: place });
    const { publicKey } = first.config("d1");
    first.subscribe("d1", { endpoint: ENDPOINT, keys: phone().keys });
    const second = new LinkPush({ dir: place });
    expect(second.config("d1")).toEqual({ publicKey, subscribed: true });
    if (process.platform !== "win32") {
      expect(statSync(join(place, "push-vapid.json")).mode & 0o777).toBe(0o600);
      expect(statSync(join(place, "push-subscriptions.json")).mode & 0o777).toBe(0o600);
    }
    second.remove("d1");
    expect(new LinkPush({ dir: place }).config("d1").subscribed).toBe(false);
    expect(readFileSync(join(place, "push-subscriptions.json"), "utf8")).not.toContain("apple");
  });
});
