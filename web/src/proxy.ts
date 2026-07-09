import { NextResponse, type NextRequest } from "next/server";
import { publicAccessMode, readSessionToken, SESSION_COOKIE } from "@/lib/auth";

// Edge gate (brief §3.1). Two jobs:
//   1. /admin always requires a valid session (role "owner" is re-verified server-side in the page/actions —
//      the cookie only proves someone logged in with the owner password).
//   2. PUBLIC_ACCESS=off flips the whole site owner-only: viewers without a session are bounced to /login.
// In the default "readonly" mode, everything except /admin is public. This is UX-level gating; every mutation
// is independently guarded by requireOwner() in its Server Action.
export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  if (pathname === "/login") return NextResponse.next();

  const hasSession = readSessionToken(request.cookies.get(SESSION_COOKIE)?.value) !== null;

  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    return hasSession ? NextResponse.next() : redirectToLogin(request);
  }

  if (publicAccessMode() === "off" && !hasSession) return redirectToLogin(request);

  return NextResponse.next();
}

function redirectToLogin(request: NextRequest): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except Next internals and static image assets (PUBLIC_ACCESS=off needs site-wide coverage).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp)$).*)"],
};
