import type { Metadata } from "next";
import Image from "next/image";
import { PageTitle } from "@/app/_components/cardUi";

export const metadata: Metadata = { title: "Credits" };

// Credits — home of the mandatory TMDB attribution (TMDB's terms require the notice + logo within an "About or
// Credits" section, not on every page). TheTVDB attribution lives separately in the site footer (its terms only
// require a credit + direct link wherever TVDB metadata appears; the footer covers every page).
export default function CreditsPage() {
  return (
    <div className="max-w-[640px]">
      <div className="mb-5">
        <PageTitle>Credits</PageTitle>
      </div>

      <div className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer" className="inline-flex">
          <Image src="/tmdb.svg" alt="The Movie Database (TMDB)" width={423} height={35} className="block h-[18px] w-auto" />
        </a>
        <p className="mt-3 text-[13px] leading-relaxed text-[var(--color-muted)]">
          This product uses the TMDB API but is not endorsed or certified by TMDB.
        </p>
      </div>
    </div>
  );
}
