import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// Owner auth (brief §3.1). Two access levels: anonymous VIEWER (read-only showcase) and the single
// password-configured OWNER. Stateless HMAC-signed session cookie carrying the owner's userId — no user
// registration, no per-capability tokens. This module is intentionally PURE crypto: no `next/headers`, no
// DB. That keeps it importable from `proxy.ts` (middleware) and trivially unit-testable. The request-scoped
// user/session resolution (getOwner, getSessionUser, requireOwner) lives in `src/lib/session.ts`.
//
// Token format: "<userId>.<expiresEpochSeconds>.<hmacHex>". userId is a cuid (no dots), so the 3-way split
// is unambiguous.

export const SESSION_COOKIE = "wn_session";
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days — single owner on his own devices

export type PublicAccessMode = "readonly" | "off";

// "readonly" (default): anonymous visitors browse read-only. "off": whole site is owner-only (middleware
// redirects viewers to /login) — for when the showcase mood passes.
export function publicAccessMode(): PublicAccessMode {
  return process.env.PUBLIC_ACCESS === "off" ? "off" : "readonly";
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function sign(payload: string): string {
  return createHmac("sha256", requireEnv("SESSION_SECRET")).update(payload).digest("hex");
}

// Comparison via digests: constant-time and length-independent.
function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

export function verifyPassword(input: string): boolean {
  return safeEqual(input, requireEnv("ADMIN_PASSWORD"));
}

export function createSessionToken(userId: string, nowMs: number = Date.now()): string {
  const expires = Math.floor(nowMs / 1000) + SESSION_TTL_SECONDS;
  const payload = `${userId}.${expires}`;
  return `${payload}.${sign(payload)}`;
}

// Returns the carried userId if the token is well-formed, unexpired, and correctly signed; null otherwise.
// Signature verification is the security boundary — a valid token proves the holder logged in with the
// owner password. Role ("owner") is re-checked against the DB in requireOwner(), never trusted from the token.
export function readSessionToken(token: string | undefined, nowMs: number = Date.now()): { userId: string } | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, expiresStr, signature] = parts;
  if (!userId || !expiresStr || !signature) return null;
  if (!/^\d+$/.test(expiresStr) || Number(expiresStr) * 1000 <= nowMs) return null;
  if (!safeEqual(signature, sign(`${userId}.${expiresStr}`))) return null;
  return { userId };
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}
