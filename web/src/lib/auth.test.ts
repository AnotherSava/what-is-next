import { beforeAll, describe, expect, it } from "vitest";
import { createSessionToken, publicAccessMode, readSessionToken, SESSION_TTL_SECONDS, verifyPassword } from "./auth";

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-do-not-use-in-prod";
  process.env.ADMIN_PASSWORD = "hunter2";
});

const NOW = 1_800_000_000_000; // fixed epoch ms for deterministic expiry math

describe("session token", () => {
  it("round-trips the userId for a fresh token", () => {
    const token = createSessionToken("user_abc123", NOW);
    expect(readSessionToken(token, NOW)).toEqual({ userId: "user_abc123" });
  });

  it("rejects an expired token", () => {
    const token = createSessionToken("user_abc123", NOW);
    const afterExpiry = NOW + (SESSION_TTL_SECONDS + 1) * 1000;
    expect(readSessionToken(token, afterExpiry)).toBeNull();
  });

  it("rejects a tampered signature", () => {
    const token = createSessionToken("user_abc123", NOW);
    const tampered = token.slice(0, -1) + (token.endsWith("0") ? "1" : "0");
    expect(readSessionToken(tampered, NOW)).toBeNull();
  });

  it("rejects a tampered userId (signature no longer matches)", () => {
    const token = createSessionToken("user_abc123", NOW);
    const [, expires, sig] = token.split(".");
    expect(readSessionToken(`user_evil.${expires}.${sig}`, NOW)).toBeNull();
  });

  it("rejects malformed tokens", () => {
    expect(readSessionToken(undefined, NOW)).toBeNull();
    expect(readSessionToken("", NOW)).toBeNull();
    expect(readSessionToken("only.two", NOW)).toBeNull();
    expect(readSessionToken("a.b.c.d", NOW)).toBeNull();
    expect(readSessionToken("user.notanumber.sig", NOW)).toBeNull();
  });
});

describe("verifyPassword", () => {
  it("accepts the exact configured password", () => {
    expect(verifyPassword("hunter2")).toBe(true);
  });
  it("rejects a wrong password", () => {
    expect(verifyPassword("hunter3")).toBe(false);
    expect(verifyPassword("")).toBe(false);
  });
});

describe("publicAccessMode", () => {
  it("defaults to readonly", () => {
    delete process.env.PUBLIC_ACCESS;
    expect(publicAccessMode()).toBe("readonly");
    process.env.PUBLIC_ACCESS = "readonly";
    expect(publicAccessMode()).toBe("readonly");
  });
  it("returns off only for the exact value", () => {
    process.env.PUBLIC_ACCESS = "off";
    expect(publicAccessMode()).toBe("off");
    process.env.PUBLIC_ACCESS = "readonly";
  });
});
