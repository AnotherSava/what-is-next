import type { Metadata } from "next";
import Image from "next/image";

export const metadata: Metadata = { title: "Credits" };

// Credits — home of the mandatory TMDB attribution (TMDB's terms require the notice + logo within an "About or
// Credits" section, not on every page). TheTVDB attribution lives separately in the site footer (its terms only
// require a credit + direct link wherever TVDB metadata appears; the footer covers every page).
export default function CreditsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Credits</h1>

      <div className="space-y-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer" className="inline-block">
          <Image src="/tmdb.svg" alt="The Movie Database (TMDB)" width={423} height={35} className="h-4 w-auto" />
        </a>
        <p className="text-sm leading-relaxed text-[var(--color-muted)]">
          This product uses the TMDB API but is not endorsed or certified by TMDB.
        </p>
      </div>
    </div>
  );
}
