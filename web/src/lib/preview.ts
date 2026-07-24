import type { PrismaClient } from "@/generated/prisma/client";
import { type CastMember, parseCast } from "@/lib/cast";
import { movieDetailToMediaData, tvDetailToMediaData } from "@/lib/catalog";
import type { TmdbClient, TmdbMovieDetail, TmdbTvDetail } from "@/lib/tmdb";

// Read-side data layer for the NON-LIBRARY preview pages (/movies/preview/[tmdbId], /shows/preview/[tmdbId]). A
// search hit that isn't in the catalog has no MediaItem row, so the normal DB-backed detail pages 404 for it. These
// functions assemble a read-only view model straight from a TMDB detail (keyed by tmdb id) with NO DB write, reusing
// the same TMDB→catalog transforms the hydration path uses (single source of logic for cast/director/creator). If
// the item already exists in the catalog, the caller is told to redirect to its real detail page instead (that page
// is strictly richer — Plex/watched/IMDb/episodes). Deps are injected (prisma, a tmdb-client factory) mirroring
// lib/search.ts, so it's unit-testable without the app singletons. Note: there is no TMDB response cache, so each
// render fetches live (bounded only by the client's rate limiter + in-flight de-dupe) — acceptable for an owner-only,
// low-traffic surface; wrap the fetch in a cache if this ever gets busier.

export interface MoviePreview {
  tmdbId: number;
  title: string;
  originalTitle: string | null;
  overview: string | null;
  posterPath: string | null;
  releaseDate: string | null;
  runtime: number | null;
  genres: string[];
  tmdbRating: number | null; // TMDB community score (0–10); the only rating available without a catalog row (no OMDb/IMDb here)
  director: string | null;
  cast: CastMember[];
}

export interface ShowPreviewSeason {
  seasonNumber: number;
  isSpecials: boolean;
  title: string | null; // TMDB season name ("Season 1", "Specials", or a named season)
  year: number | null; // from the season's air_date
  episodeCount: number | null;
}

export interface ShowPreview {
  tmdbId: number;
  title: string;
  originalTitle: string | null;
  overview: string | null;
  posterPath: string | null;
  releaseDate: string | null;
  status: string | null;
  genres: string[];
  tmdbRating: number | null;
  creator: string | null;
  cast: CastMember[];
  numberOfSeasons: number | null;
  numberOfEpisodes: number | null;
  seasons: ShowPreviewSeason[]; // season stubs from the show detail (name/year/episode count) — NOT per-episode (that's a call per season)
}

// The outcome of a preview lookup: the item is already catalogued (redirect to its detail page), a fresh TMDB
// preview to render, or nothing (bad id / TMDB failure → the route 404s).
export type PreviewResult<T> =
  | { status: "existing"; slug: string }
  | { status: "preview"; data: T }
  | { status: "not-found" };

const genreNames = (genres: { name: string }[] | null | undefined): string[] => (genres ?? []).map((g) => g.name);

// If a catalog row already exists for this tmdb id + type, return its detail-page path segment so the caller
// redirects there (the library-backed page is strictly richer). Slug falls back to the id, which the detail route
// also resolves.
async function existingSlug(prisma: PrismaClient, tmdbId: number, mediaType: "movie" | "tv"): Promise<string | null> {
  const row = await prisma.mediaItem.findUnique({
    where: { tmdbId_mediaType: { tmdbId, mediaType } },
    select: { id: true, slug: true },
  });
  return row ? (row.slug ?? row.id) : null;
}

export async function getMoviePreview(
  prisma: PrismaClient,
  getTmdbClient: () => TmdbClient,
  tmdbId: number,
): Promise<PreviewResult<MoviePreview>> {
  const slug = await existingSlug(prisma, tmdbId, "movie");
  if (slug) return { status: "existing", slug };

  let detail: TmdbMovieDetail;
  try {
    detail = await getTmdbClient().getMovieDetail(tmdbId);
  } catch {
    return { status: "not-found" };
  }
  const md = movieDetailToMediaData(detail);
  return {
    status: "preview",
    data: {
      tmdbId: md.tmdbId,
      title: md.title,
      originalTitle: md.originalTitle,
      overview: md.overview,
      posterPath: md.posterPath,
      releaseDate: md.releaseDate,
      runtime: md.runtime,
      genres: genreNames(detail.genres),
      tmdbRating: md.tmdbRating,
      director: md.director,
      cast: parseCast(md.cast),
    },
  };
}

export async function getShowPreview(
  prisma: PrismaClient,
  getTmdbClient: () => TmdbClient,
  tmdbId: number,
): Promise<PreviewResult<ShowPreview>> {
  const slug = await existingSlug(prisma, tmdbId, "tv");
  if (slug) return { status: "existing", slug };

  let detail: TmdbTvDetail;
  try {
    detail = await getTmdbClient().getTvDetail(tmdbId);
  } catch {
    return { status: "not-found" };
  }
  const md = tvDetailToMediaData(detail);
  const seasons: ShowPreviewSeason[] = (detail.seasons ?? [])
    .map((s) => ({
      seasonNumber: s.season_number,
      isSpecials: s.season_number === 0,
      title: s.name ?? null,
      year: s.air_date ? Number(s.air_date.slice(0, 4)) : null,
      episodeCount: s.episode_count ?? null,
    }))
    // Specials (season 0) after the regular seasons, numeric order within each group — matches the detail page.
    .sort((a, b) => Number(a.isSpecials) - Number(b.isSpecials) || a.seasonNumber - b.seasonNumber);
  return {
    status: "preview",
    data: {
      tmdbId: md.tmdbId,
      title: md.title,
      originalTitle: md.originalTitle,
      overview: md.overview,
      posterPath: md.posterPath,
      releaseDate: md.releaseDate,
      status: md.status,
      genres: genreNames(detail.genres),
      tmdbRating: md.tmdbRating,
      creator: md.creator,
      cast: parseCast(md.cast),
      numberOfSeasons: md.numberOfSeasons,
      numberOfEpisodes: md.numberOfEpisodes,
      seasons,
    },
  };
}
