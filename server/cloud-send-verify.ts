// What a move checks of the credentials it carried, without any secret coming back: each server answers a keyed
// fingerprint (HMAC-SHA256 under a nonce the desktop's main process chose) of each credential, by the same id on both
// sides. My Cloud answers POST /api/cloud-send/verify-secrets to its owner; this computer answers only over its private
// port (login-handoff.ts), so no local process can ask it.
import { createHmac } from "node:crypto";

import { canonicalJson } from "../shared/package-format.ts";

/** At least 32 random bytes, base64url. */
export const VERIFY_NONCE = /^[A-Za-z0-9_-]{43,128}$/u;

export const fingerprint = (nonce: string, value: unknown): string => createHmac("sha256", nonce).update(canonicalJson(value)).digest("hex");
