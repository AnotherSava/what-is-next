import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { BackLink } from "@/app/_components/BackLink";
import { HeroSpecRow } from "@/app/_components/HeroSpecRow";
import { PreviewAddMark } from "@/app/_components/PreviewAddMark";
import { PreviewHeroPoster } from "@/app/_components/PreviewHeroPoster";
import { TopCast } from "@/app/_components/TopCast";
import { getPrisma } from "@/lib/db";
import { formatRuntime } from "@/lib/format";
import { getMoviePreview } from "@/lib/preview";
import { getSessionUser } from "@/lib/session";
import { getTmdb } from "@/lib/tmdb";

// Read-only preview of a movie that ISN'T in your library, reached from an external search hit. Mirrors the movie
// detail hero, trimmed to what TMDB gives us with no catalog row (no Plex / watched / IMDb-★ machinery). The primary
// affordance is "Add to library", which materialises the catalog row and sends you to the real detail page. Owner-
// only, like Search itself. A movie and a show can share a numeric tmdb id, so the route is namespaced under /movies.

// Deduped per request so generateMetadata + the page share one TMDB fetch (there's no response cache).
const load = cache((tmdbId: number) => getMoviePreview(getPrisma(), getTmdb, tmdbId));

const parseId = (raw: string): number | null => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export async function generateMetadata({ params }: { params: Promise<{ tmdbId: string }> }): Promise<Metadata> {
  const id = parseId((await params).tmdbId);
  if (id == null) return { title: "Movie" };
  const result = await load(id);
  return { title: result.status === "preview" ? result.data.title : "Movie" };
}

export default async function MoviePreviewPage({ params }: { params: Promise<{ tmdbId: string }> }) {
  // Preview is reached only from owner-only Search; gate the same way.
  const sessionUser = await getSessionUser();
  if (!sessionUser || sessionUser.role !== "owner") redirect("/");

  const id = parseId((await params).tmdbId);
  if (id == null) notFound();

  const result = await load(id);
  if (result.status === "existing") redirect(`/movies/${result.slug}`); // already catalogued → the real (richer) page
  if (result.status === "not-found") notFound();
  const movie = result.data;

  const year = movie.releaseDate ? movie.releaseDate.slice(0, 4) : "";
  const meta = [year, formatRuntime(movie.runtime), movie.genres.join(" · ")].filter(Boolean).join(" · ");
  const stars = movie.cast.slice(0, 3).map((c) => c.name).join(" · ");

  return (
    <div>
      <BackLink
        fallbackHref="/search"
        className="mb-[18px] inline-flex items-center gap-1.5 text-[13px] text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)]"
      />

      <div className="flex flex-col gap-8 pt-2 md:min-h-[372px] md:flex-row md:items-start md:gap-[34px]">
        <PreviewHeroPoster title={movie.title} posterPath={movie.posterPath} rating={movie.tmdbRating}>
          <PreviewAddMark tmdbId={movie.tmdbId} mediaType="movie" title={movie.title} posterPath={movie.posterPath} />
        </PreviewHeroPoster>

        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="font-display text-[28px] leading-[1.03] font-bold tracking-[-0.02em] text-balance md:text-[40px]">{movie.title}</h1>
          {movie.originalTitle && movie.originalTitle !== movie.title && (
            <p className="font-narrow mt-1.5 text-[14px] text-[var(--color-muted)]">{movie.originalTitle}</p>
          )}
          {meta && <div className="font-num mt-3.5 text-[14px] tabular-nums text-[var(--color-muted)]">{meta}</div>}

          {(movie.director || stars) && (
            <div className="mt-[22px] flex max-w-[600px] flex-col gap-2">
              {movie.director && <HeroSpecRow label="Director" value={movie.director} />}
              {stars && <HeroSpecRow label="Stars" value={stars} />}
            </div>
          )}

          {movie.overview && <p className="mt-5 max-w-[600px] text-[14px] leading-[1.6] text-[var(--color-bright)] text-pretty">{movie.overview}</p>}
        </div>
      </div>

      <TopCast cast={movie.cast} limit={8} />
    </div>
  );
}
