import "./globals.css";
import type { Metadata, Viewport } from "next";
import { getDisplayedUser, getSessionUser, permissionsFor } from "@/lib/session";
import { isTvdbConfigured } from "@/lib/tvdb";
import { Footer } from "./_components/Footer";
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

  return (
    <html lang="en">
      <body className="min-h-dvh">
        <SiteHeader isOwner={isAdmin} />
        <main className="mx-auto w-full max-w-4xl px-4 py-6">{children}</main>
        <Footer showTvdb={isTvdbConfigured()} />
      </body>
    </html>
  );
}
