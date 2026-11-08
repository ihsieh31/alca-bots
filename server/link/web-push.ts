// Web Push as a browser's push service expects it: the body encrypted to the phone (RFC 8291, aes128gcm) and the
// request signed with this computer's key (VAPID, RFC 8292). The push service only ever carries ciphertext.
import { createCipheriv, createECDH, createPrivateKey, generateKeyPairSync, hkdfSync, randomBytes, sign } from "node:crypto";

export interface PushKeys {
  p256dh: string;
  auth: string;
}

export interface VapidKey {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
  d: string;
}

export type Delivery = "sent" | "gone" | "retry" | "rejected";

export interface DeliveryResult {
  outcome: Delivery;
  status: number;
  retryAfterSeconds?: number;
}

const RECORD_SIZE = 4096;
// A 4096-byte record, less the header (86), the delimiter (1) and the tag (16).
export const MAX_PLAINTEXT_BYTES = 3993;
const JWT_LIFETIME_S = 12 * 3600;
const JWT_REUSE_MARGIN_S = 3600;
const TTL_S = 24 * 3600;
const SEND_TIMEOUT_MS = 15_000;

const SERVICE_HOSTS = ["fcm.googleapis.com", "android.googleapis.com", "updates.push.services.mozilla.com"];
const SERVICE_SUFFIXES = [".push.apple.com", ".notify.windows.com"];

const b64u = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const unb64u = (text: string) => Buffer.from(text, "base64url");

/** The computer posts to this address on a phone's say-so, so only the browsers' own push services qualify. */
export function isPushService(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  return SERVICE_HOSTS.includes(host) || SERVICE_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

export function validPushKeys(keys: PushKeys): boolean {
  const point = unb64u(keys.p256dh);
  if (point.length !== 65 || point[0] !== 0x04 || unb64u(keys.auth).length !== 16) return false;
  try {
    const probe = createECDH("prime256v1");
    probe.generateKeys();
    probe.computeSecret(point);
    return true;
  } catch {
    return false;
  }
}

export function encryptPush(plaintext: Uint8Array, keys: PushKeys, fixed: { salt?: Uint8Array; privateKey?: Uint8Array } = {}): Buffer {
  if (plaintext.length > MAX_PLAINTEXT_BYTES) throw new Error("push payload too large");
  const phonePublic = unb64u(keys.p256dh);
  const ecdh = createECDH("prime256v1");
  if (fixed.privateKey) ecdh.setPrivateKey(Buffer.from(fixed.privateKey));
  else ecdh.generateKeys();
  const ownPublic = ecdh.getPublicKey();
  const salt = fixed.salt ? Buffer.from(fixed.salt) : randomBytes(16);
  const info = Buffer.concat([Buffer.from("WebPush: info\0"), phonePublic, ownPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", ecdh.computeSecret(phonePublic), unb64u(keys.auth), info, 32));
  const key = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const cipher = createCipheriv("aes-128-gcm", key, nonce);
  const sealed = Buffer.concat([cipher.update(plaintext), cipher.update(Uint8Array.of(0x02)), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(ownPublic.length, 20);
  return Buffer.concat([header, ownPublic, sealed]);
}

export function generateVapidKey(): VapidKey {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = privateKey.export({ format: "jwk" });
  return { kty: "EC", crv: "P-256", x: jwk.x!, y: jwk.y!, d: jwk.d! };
}

export const vapidPublicKey = (key: VapidKey): string => b64u(Buffer.concat([Uint8Array.of(0x04), unb64u(key.x), unb64u(key.y)]));

export function vapidAuthorization(key: VapidKey, audience: string, expires: number, contact: string): string {
  const part = (value: unknown) => b64u(Buffer.from(JSON.stringify(value)));
  const input = `${part({ typ: "JWT", alg: "ES256" })}.${part({ aud: audience, exp: expires, sub: contact })}`;
  const signature = sign("sha256", Buffer.from(input), { key: createPrivateKey({ key: { ...key }, format: "jwk" }), dsaEncoding: "ieee-p1363" });
  return `vapid t=${input}.${b64u(signature)}, k=${vapidPublicKey(key)}`;
}

export interface PushSenderOptions {
  key: VapidKey;
  contact: string;
  fetch?: typeof fetch;
  now?: () => number;
}

export class PushSender {
  private readonly tokens = new Map<string, { header: string; expires: number }>();
  private readonly o: PushSenderOptions;

  constructor(o: PushSenderOptions) {
    this.o = o;
  }

  private authorization(endpoint: string): string {
    const audience = new URL(endpoint).origin;
    const now = Math.floor((this.o.now?.() ?? Date.now()) / 1000);
    const held = this.tokens.get(audience);
    if (held && held.expires - JWT_REUSE_MARGIN_S > now) return held.header;
    const expires = now + JWT_LIFETIME_S;
    const header = vapidAuthorization(this.o.key, audience, expires, this.o.contact);
    this.tokens.set(audience, { header, expires });
    return header;
  }

  async send(target: { endpoint: string; keys: PushKeys }, payload: unknown): Promise<DeliveryResult> {
    if (!isPushService(target.endpoint)) return { outcome: "rejected", status: 0 };
    const body = encryptPush(Buffer.from(JSON.stringify(payload)), target.keys);
    let response: Response;
    try {
      response = await (this.o.fetch ?? fetch)(target.endpoint, {
        method: "POST",
        headers: {
          TTL: String(TTL_S),
          Urgency: "high",
          "Content-Type": "application/octet-stream",
          "Content-Encoding": "aes128gcm",
          Authorization: this.authorization(target.endpoint),
        },
        body,
        redirect: "error",
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
    } catch {
      return { outcome: "retry", status: 0 };
    }
    const { status } = response;
    void response.body?.cancel().catch(() => {});
    if (status >= 200 && status < 300) return { outcome: "sent", status };
    if (status === 404 || status === 410) return { outcome: "gone", status };
    if (status === 429 || status >= 500) {
      const after = Number(response.headers.get("retry-after"));
      return { outcome: "retry", status, ...(after > 0 ? { retryAfterSeconds: after } : {}) };
    }
    return { outcome: "rejected", status };
  }
}
