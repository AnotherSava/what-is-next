import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Archivo_Narrow, Hanken_Grotesk, Instrument_Sans, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import { cookies } from "next/headers";
import { clampCols, COLS_COOKIE, DEFAULT_COLS } from "@/lib/gridDensity";
import { isMediaServerEnabled, lastSyncedAt, viewSyncTtlMs } from "@/lib/media";
import { getDisplayedUser, getSessionUser, permissionsFor } from "@/lib/session";
import { Footer } from "./_components/Footer";
import { GridDensityProvider } from "./_components/GridDensity";
import { MediaFreshener } from "./_components/MediaFreshener";
import { SiteHeader } from "./_components/SiteHeader";

// Type system from the design reference: Instrument Sans (body), Space Grotesk (titles/headings), Archivo Narrow
// (episode/director sub-lines), Hanken Grotesk (tabular meta/numbers), JetBrains Mono (compact monospace — file
// paths/code). Exposed as CSS variables that globals.css maps to the font-sans / -display / -narrow / -num / -mono
// utilities.
const instrument = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-instrument",
});
const space = Space_Grotesk({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-space" });
const archivo = Archivo_Narrow({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-archivo" });
const hanken = Hanken_Grotesk({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-hanken" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-jetbrains" });

export const metadata: Metadata = {
  title: { default: "What's next", template: "%s · What's next" },
  description: "A personal tracker for TV series and movies — what I've watched, what I'm behind on, what's next.",
  // Showcase for people given the link, not for search engines (brief §9). Trivially removable later.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#08080a",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Resolve identity once per request and hand permissions down (brief §5a): sessionUser = who's logged in,
  // displayedUser = whose data we render (v1: always the owner). isOwner drives every mutation affordance.
  const [sessionUser, displayedUser, cookieStore] = await Promise.all([
    getSessionUser(),
    getDisplayedUser(),
    cookies(),
  ]);
  const { isAdmin } = permissionsFor(sessionUser, displayedUser);

  // Freshness pill beside the gear (owner + a connected media server only): how current the page's synced watch
  // data is. With two servers connected it follows the one that's LAGGING (lastSyncedAt returns the oldest run),
  // so the pill can't read green while half the data is a day stale. Red once that is 3× the sync interval old.
  const mediaOn = isAdmin && (await isMediaServerEnabled());
  const syncedAt = mediaOn ? await lastSyncedAt() : null;
  const freshness = syncedAt ? { lastSyncAt: syncedAt, staleThresholdMs: 3 * viewSyncTtlMs() } : null;

  // Seed the poster-grid column count from the persisted cookie so the server renders the chosen density (no flash).
  const colsCookie = cookieStore.get(COLS_COOKIE)?.value;
  const initialCols = colsCookie ? clampCols(Number(colsCookie)) : DEFAULT_COLS;

  return (
    <html
      lang="en"
      className={`${instrument.variable} ${space.variable} ${archivo.variable} ${hanken.variable} ${mono.variable}`}
    >
      <body>
        <GridDensityProvider initialCols={initialCols}>
          <SiteHeader isOwner={isAdmin} freshness={freshness} />
          <main className="mx-auto w-full max-w-[1180px] flex-1 px-7 pt-[34px] pb-[120px]">{children}</main>
          <Footer isOwner={isAdmin} />
          {mediaOn && <MediaFreshener />}
        </GridDensityProvider>
      </body>
    </html>
  );
}
