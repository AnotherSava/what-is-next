import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

// Encryption at rest for the credentials the app stores in its own database (currently the media-server tokens).
// The point is that a copy of the database — a nightly backup, a downloaded snapshot, a lifted volume — carries no
// usable secret without the environment it came from.
//
// The key is DERIVED from SESSION_SECRET rather than being a new secret to store: it's already required, already a
// high-entropy random value, and isn't something rotated casually. HKDF (not scrypt) is the right primitive here
// precisely because the input is already high-entropy — it's a fast one-shot expansion, so decrypting on read
// costs nothing, where a deliberately-slow KDF would tax every request that reads the config.
//
// Rotating SESSION_SECRET makes stored ciphertext unreadable. That is a deliberately cheap failure: the only thing
// encrypted here is credentials the owner can re-paste in seconds — never anything irreplaceable like watch
// history — so a lost key never costs data.

const PREFIX = "enc:v1:";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // 96-bit nonce, the size GCM is specified for
const TAG_BYTES = 16;

let cachedKey: Buffer | undefined;

function key(): Buffer {
  if (!cachedKey) {
    const secret = process.env.SESSION_SECRET;
    if (!secret) throw new Error("SESSION_SECRET is not set");
    // Salt and info are fixed labels, not secrets: they domain-separate this key from the session-signing use of
    // the same input, so the two can never collide.
    cachedKey = Buffer.from(hkdfSync("sha256", secret, "whats-next/secrets", "media-server-tokens", 32));
  }
  return cachedKey;
}

// Whether a stored value is already ciphertext. Anything else is a legacy plaintext value written before this
// existed, and is returned as-is by decryptSecret so an upgrade doesn't lock the owner out of their own config.
export function isEncrypted(stored: string): boolean {
  return stored.startsWith(PREFIX);
}

// Encrypt a secret for storage. A blank value stays blank — "no token" isn't a secret, and keeping it recognisably
// empty means every "is this configured?" check keeps working without decrypting first.
export function encryptSecret(plain: string): string {
  if (!plain) return "";
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

// Decrypt a stored secret. Returns "" when the value can't be read — a wrong/rotated SESSION_SECRET, or a tampered
// row — rather than throwing: the config is read on ordinary page renders, so an unreadable token must degrade to
// "this server isn't connected" (and prompt the owner to re-enter it), not break the site.
export function decryptSecret(stored: string): string {
  if (!stored) return "";
  if (!isEncrypted(stored)) return stored; // legacy plaintext, re-encrypted on the next write
  try {
    const raw = Buffer.from(stored.slice(PREFIX.length), "base64");
    const iv = raw.subarray(0, IV_BYTES);
    const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const body = raw.subarray(IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv(ALGORITHM, key(), iv);
    decipher.setAuthTag(tag);
    return decipher.update(body, undefined, "utf8") + decipher.final("utf8");
  } catch {
    console.warn("[secrets] a stored credential could not be decrypted — re-enter it in Settings");
    return "";
  }
}
