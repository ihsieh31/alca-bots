import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function stateKey(key: string): Buffer {
  return createHash("sha256").update(key).digest();
}

/** AES-256-GCM: a 12-byte nonce, the ciphertext, then the 16-byte tag. Files sealed before this module existed use the same layout. */
export function decryptSealedState(data: Buffer, key: string): string {
  if (data.length < 29) throw new Error("Sealed data is too short.");
  const decipher = createDecipheriv("aes-256-gcm", stateKey(key), data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(data.length - 16));
  return Buffer.concat([decipher.update(data.subarray(12, data.length - 16)), decipher.final()]).toString("utf8");
}

export function encryptSealedState(text: string, key: string): Buffer {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", stateKey(key), nonce);
  const body = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return Buffer.concat([nonce, body, cipher.getAuthTag()]);
}
