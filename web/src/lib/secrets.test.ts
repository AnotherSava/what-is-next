import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, isEncrypted } from "./secrets";

// The key is derived once per process from SESSION_SECRET, so these tests set it before the module first derives.
const SECRET = "0".repeat(64);
let saved: string | undefined;

beforeEach(() => {
  saved = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = SECRET;
});
afterEach(() => {
  if (saved === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = saved;
});

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a credential", () => {
    const token = "xyzABC-123_plexToken";
    const stored = encryptSecret(token);
    expect(stored).not.toContain(token); // the point: the plaintext isn't in what gets stored
    expect(isEncrypted(stored)).toBe(true);
    expect(decryptSecret(stored)).toBe(token);
  });

  it("produces different ciphertext each time, so equal tokens aren't recognisable as equal", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("keeps a blank value blank rather than encrypting emptiness", () => {
    // "no token" isn't a secret, and every "is this configured?" check reads it without decrypting.
    expect(encryptSecret("")).toBe("");
    expect(decryptSecret("")).toBe("");
    expect(isEncrypted("")).toBe(false);
  });

  it("passes a legacy plaintext value straight through", () => {
    // Rows written before encryption existed must keep working — they're re-encrypted on the next write.
    expect(isEncrypted("raw-token")).toBe(false);
    expect(decryptSecret("raw-token")).toBe("raw-token");
  });

  it("round-trips non-ASCII and long values", () => {
    const token = "п-ключ-🔑-" + "a".repeat(500);
    expect(decryptSecret(encryptSecret(token))).toBe(token);
  });

  it("refuses a tampered value instead of returning corrupted plaintext", () => {
    // GCM authenticates the ciphertext, so a flipped byte fails the tag check rather than decrypting to garbage.
    const stored = encryptSecret("real-token");
    const body = stored.slice("enc:v1:".length);
    const bytes = Buffer.from(body, "base64");
    bytes[bytes.length - 1] ^= 0xff;
    expect(decryptSecret(`enc:v1:${bytes.toString("base64")}`)).toBe("");
  });

  it("returns blank — not a throw — when the key no longer matches", () => {
    // A rotated SESSION_SECRET must degrade to "this server isn't connected" (prompting a re-entry), never break a
    // page render. The key is cached per process, so this checks the shape of the failure via a corrupt payload.
    expect(decryptSecret("enc:v1:not-valid-base64-@@@")).toBe("");
    expect(decryptSecret("enc:v1:")).toBe("");
  });
});
