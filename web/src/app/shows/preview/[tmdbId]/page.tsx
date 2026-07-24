import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { BackLink } from "@/app/_components/BackLink";
import { HeroSpecRow } from "@/app/_components/HeroSpecRow";
import { PreviewAddMark } from "@/app/_components/PreviewAddMark";
import { PreviewHeroPoster } from "@/app/_components/PreviewHeroPoster";
import { getPrisma } from "@/lib/db";
import { plural } from "@/lib/format";
import { getShowPreview, type ShowPreviewSeason } from "@/lib/preview";
import { isEndedStatus } from "@/lib/progress";
import { getSessionUser } from "@/lib/session";
import { getTmdb } from "@/lib/tmdb";
import { CastColumn } from "../../_components/CastColumn";

// Read-only preview of a show that ISN'T in your library, reached from an external search hit. Mirrors the show
// detail hero + two-column (seasons / cast) layout, trimmed to what a single TMDB show-detail call gives us with no
// catalog row: season stubs (name / year / episode count), never per-episode data or Plex/watched state. The primary
// affordance is "Add to library", which materialises the catalog row (and its full episode hydration) and sends you
// to the real detail page. Owner-only, like Search. Namespaced under /shows since a movie and show can share a tmdb id.

// Deduped per request so generateMetadata + the page share one TMDB fetch (there's no response cache).
const load = cache((tmdbId: number) => getShowPreview(getPrisma(), getTmdb, tmdbId));

const parseId = (raw: string): number | null => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const seasonLabel = (s: ShowPreviewSeason): string => s.title || (s.isSpecials ? "Specials" : `Season ${s.seasonNumber}`);

export async function generateMetadata({ params }: { params: Promise<{ tmdbId: string }> }): Promise<Metadata> {
  const id = parseId((await params).tmdbId);
  if (id == null) return { title: "Show" };
  const result = await load(id);
  return { title: result.status === "preview" ? result.data.title : "Show" };
}

export default async function ShowPreviewPage({ params }: { params: Promise<{ tmdbId: string }> }) {
  // Preview is reached only from owner-only Search; gate the same way.
  const sessionUser = await getSessionUser();
  if (!sessionUser || sessionUser.role !== "owner") redirect("/");

  const id = parseId((await params).tmdbId);
  if (id == null) notFound();

  const result = await load(id);
  if (result.status === "existing") redirect(`/shows/${result.slug}`); // already catalogued → the real (richer) page
  if (result.status === "not-found") notFound();
  const show = result.data;

  const stars = show.cast.slice(0, 3).map((c) => c.name).join(" · ");

  // Year range: first air year → "present" (still running) or the last regular season's year (ended). Seasons/
  // episodes counts prefer TMDB's totals (which already exclude specials) over the stub count.
  const regular = show.seasons.filter((s) => !s.isSpecials);
  const firstYear = show.releaseDate?.slice(0, 4) ?? regular.find((s) => s.year != null)?.year?.toString() ?? null;
  const endYear = [...regular].reverse().find((s) => s.year != null)?.year ?? null;
  const ended = isEndedStatus(show.status);
  const yearTo = ended ? (endYear != null && String(endYear) !== firstYear ? String(endYear) : null) : "present";
  const seasonCount = show.numberOfSeasons ?? regular.length;
  const episodeCount = show.numberOfEpisodes ?? 0;

  return (
    <div>
      <BackLink
        fallbackHref="/search"
        className="mb-[18px] inline-flex items-center gap-1.5 text-[13px] text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)]"
      />

      <div className="flex flex-col gap-8 pt-2 md:min-h-[372px] md:flex-row md:items-start md:gap-[34px]">
        <PreviewHeroPoster title={show.title} posterPath={show.posterPath} rating={show.tmdbRating}>
          <PreviewAddMark tmdbId={show.tmdbId} mediaType="tv" title={show.title} posterPath={show.posterPath} />
        </PreviewHeroPoster>

        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="font-display text-[28px] leading-[1.03] font-bold tracking-[-0.02em] text-balance md:text-[40px]">{show.title}</h1>
          {show.originalTitle && show.originalTitle !== show.title && (
            <p className="font-narrow mt-1.5 text-[14px] text-[var(--color-muted)]">{show.originalTitle}</p>
          )}

          <div className="font-num mt-3.5 text-[14px] tabular-nums text-[var(--color-muted)]">
            {firstYear && (
              <>
                <span className="font-medium text-[#e6e6ea]">{firstYear}</span>
                {yearTo && <span className="text-[#4e4e57]"> – </span>}
                {yearTo && <span className="text-[#9a9aa4] italic">{yearTo}</span>}
                {" · "}
              </>
            )}
            <span className="text-[var(--color-bright)]">{seasonCount}</span> {seasonCount === 1 ? "season" : "seasons"}
            {" · "}
            <span className="text-[var(--color-bright)]">{episodeCount}</span> {episodeCount === 1 ? "episode" : "episodes"}
          </div>

          {(show.creator || stars) && (
            <div className="mt-[22px] flex max-w-[600px] flex-col gap-2">
              {show.creator && <HeroSpecRow label="Creator" value={show.creator} />}
              {stars && <HeroSpecRow label="Stars" value={stars} />}
            </div>
          )}

          {show.overview && <p className="mt-5 max-w-[600px] text-[14px] leading-[1.6] text-[var(--color-bright)] text-pretty">{show.overview}</p>}
        </div>
      </div>

      <div className="mt-[38px] flex flex-col gap-10 md:flex-row md:gap-[72px]">
        {show.seasons.length > 0 && (
          <section className="w-full md:flex-1">
            <h2 className="font-display mb-4 text-[18px] font-bold">Seasons</h2>
            <div className="flex flex-col">
              {show.seasons.map((s) => (
                <div key={s.seasonNumber} className="flex items-baseline justify-between gap-3 border-b border-[#1c1c22] py-[13px] last:border-b-0">
                  <div className="min-w-0">
                    <span className="font-display text-[15px] font-semibold">{seasonLabel(s)}</span>
                    {s.year != null && <span className="font-num ml-2 text-[12px] tabular-nums text-[var(--color-faint)]">{s.year}</span>}
                  </div>
                  {s.episodeCount != null && s.episodeCount > 0 && (
                    <span className="font-num shrink-0 text-[12px] tabular-nums text-[var(--color-muted)]">{plural(s.episodeCount, "episode")}</span>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
        <CastColumn cast={show.cast} />
      </div>
    </div>
  );
}
