import "./globals.css";
import type { Metadata, Viewport } from "next";
import { isPlexConfigured, viewSyncTtlMs } from "@/lib/plex";
import { getDisplayedUser, getSessionUser, permissionsFor } from "@/lib/session";
import { getSetting } from "@/lib/settings";
import { Footer } from "./_components/Footer";
import { PlexFreshener } from "./_components/PlexFreshener";
import { SiteHeader } from "./_components/SiteHeader";

export const metadata: Metadata = {
  title: { default: "What's next", template: "%s · What's next" },
  description: "A personal tracker for TV series and movies — what I've watched, what I'm behind on, what's next.",
  // Showcase for people given the link, not for search engines (brief §9). Trivially removable later.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0b",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Resolve identity once per request and hand permissions down (brief §5a): sessionUser = who's logged in,
  // displayedUser = whose data we render (v1: always the owner). isOwner drives every mutation affordance.
  const [sessionUser, displayedUser] = await Promise.all([getSessionUser(), getDisplayedUser()]);
  const { isAdmin } = permissionsFor(sessionUser, displayedUser);

  // Freshness dot beside Admin (owner + Plex configured only): how current the page's Plex-synced watch data is.
  // Red once the last sync is 3× the sync interval old — genuinely behind.
  const plexLastSync = isAdmin && isPlexConfigured() ? await getSetting("plex:lastSync") : null;
  const freshness = plexLastSync ? { lastSyncAt: plexLastSync.at, staleThresholdMs: 3 * viewSyncTtlMs() } : null;

  return (
    <html lang="en">
      <body className="flex min-h-dvh flex-col">
        <SiteHeader isOwner={isAdmin} freshness={freshness} />
        <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">{children}</main>
        <Footer isOwner={isAdmin} />
        {isAdmin && isPlexConfigured() && <PlexFreshener />}
      </body>
    </html>
  );
}
