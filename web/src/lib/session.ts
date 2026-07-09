import { cookies } from "next/headers";
import type { User } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/db";
import { readSessionToken, SESSION_COOKIE } from "@/lib/auth";
import { getOwner } from "@/lib/owner";

// Request-scoped identity resolution (brief §5a — multi-user readiness rules, binding).
//
// TWO identities per request, never conflated:
//   • sessionUser   — who is logged in (null for anonymous viewers)
//   • displayedUser — whose data the page shows (v1: always the owner)
// Pages fetch data for displayedUser and compute permissions from sessionUser. The read-only showcase is
// therefore already the multi-user render path with sessionUser = null; per-user pages later just vary
// displayedUser and reuse every component unchanged.
//
// getOwner (the single §5a seam) lives in @/lib/owner so CLI scripts can use it without pulling next/headers.
export { getOwner };

// The logged-in user, or null for anonymous viewers. Role is re-read from the DB here, never trusted from
// the cookie (§5a rule 5: admin ≠ merely logged-in).
export async function getSessionUser(): Promise<User | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const parsed = readSessionToken(token);
  if (!parsed) return null;
  return getPrisma().user.findUnique({ where: { id: parsed.userId } });
}

// Whose data the current page renders. v1: always the owner. Multi-user later: derive from the route
// (/u/[handle]) — the only change needed to make every page per-user.
export async function getDisplayedUser(): Promise<User> {
  return getOwner();
}

export type Permissions = {
  // May the viewer mutate the displayed user's data? True only when they ARE that user (§5a rule 2).
  canEdit: boolean;
  // May the viewer reach /admin, refresh, import, backups? Requires role "owner", not mere session presence.
  isAdmin: boolean;
};

export function permissionsFor(sessionUser: User | null, displayedUser: User): Permissions {
  return {
    canEdit: sessionUser?.id === displayedUser.id,
    isAdmin: sessionUser?.role === "owner",
  };
}

// Guard for every owner-only Server Action and admin surface (brief §3.1: enforcement is server-side,
// always — hiding buttons is UX, not security). Throws unless a valid session maps to an owner.
export async function requireOwner(): Promise<User> {
  const user = await getSessionUser();
  if (!user || user.role !== "owner") throw new Error("Forbidden: owner session required.");
  return user;
}
