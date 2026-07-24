import type { PrismaClient } from "@/generated/prisma/client";
import { TmdbError, type TmdbClient, type TmdbPersonSummary } from "@/lib/tmdb";

// Backend for the redesigned Search page (design reference "Search" screen). One owner tool that, for a given
// scope, searches BOTH the user's tracked library and the wider TMDB catalog:
//   • movie / show → title results annotated with library status (favourite ♥ / in-library ✓ / add +); library
//     rows come first, external rows are deduped against them.
//   • person       → display-only people cards (photo, name, role) straight from TMDB /search/person.
// External catalog failures are non-fatal for movie/show: the library results still return, with `error` set so
// the page can surface the problem. Deps (prisma, tmdb) are injected, mirroring lib/catalog.ts, so it's unit-testable.

export type SearchScope = "movie" | "show" | "person";

// A movie/show hit for the redesigned search grid.
export interface TitleResult {
  key: string;
  tmdbId: number | null;
  mediaType: "tv" | "movie";
  title: string;
  posterPath: string | null;
  rating: number | null; // IMDb (library rows) or TMDB vote average (external rows); null → no chip
  year: string; // release / first-air year; "" when unknown
  overview: string | null; // synopsis — the movie card's one-line summary (full text on hover); null when unknown
  inLibrary: boolean;
  isFavorite: boolean;
  detailHref: string | null; // library rows link to their detail page; external rows aren't linkable until added
}

// A person hit — display only (people aren't tracked, so the card is inert).
export interface PersonResult {
  key: string;
  name: string;
  profilePath: string | null;
  role: string; // "Actor · Known for …"; "" when unknown
}

export type SearchOutcome =
  | { scope: "movie" | "show"; results: TitleResult[]; error: string | null }
  | { scope: "person"; people: PersonResult[]; error: string | null };

const LIBRARY_LIMIT = 24;
const EXTERNAL_LIMIT = 18;

const yearOf = (date: string | null | undefined) => (date ? date.slice(0, 4) : "");

// TMDB known_for_department → a friendlier singular role noun for the person card's sub-line.
const DEPARTMENT_LABEL: Record<string, string> = {
  Acting: "Actor",
  Directing: "Director",
  Writing: "Writer",
  Production: "Producer",
  Creator: "Creator",
};

function personRole(p: TmdbPersonSummary): string {
  const dept = DEPARTMENT_LABEL[p.known_for_department ?? ""] ?? p.known_for_department ?? "";
  const titles = (p.known_for ?? [])
    .map((k) => k.title || k.name)
    .filter((t): t is string => !!t)
    .slice(0, 2);
  const known = titles.length ? `Known for ${titles.join(", ")}` : "";
  return [dept, known].filter(Boolean).join(" · ");
}

// A user-facing message for a failed TMDB call — a missing/invalid token reads distinctly from a transient error.
export function tmdbErrorMessage(e: unknown): string {
  const authProblem =
    (e instanceof TmdbError && (e.status === 401 || e.status === 403)) ||
    (e instanceof Error && e.message.includes("TMDB_API_TOKEN"));
  return authProblem ? "TMDB API token is missing or invalid — set TMDB_API_TOKEN." : "Catalog search failed. Try again.";
}

export async function searchCatalog(
  prisma: PrismaClient,
  getTmdbClient: () => TmdbClient,
  { query, scope, userId }: { query: string; scope: SearchScope; userId: string },
): Promise<SearchOutcome> {
  const q = query.trim();
  if (!q) {
    if (scope === "person") return { scope, people: [], error: null };
    return { scope, results: [], error: null };
  }

  if (scope === "person") {
    try {
      const res = await getTmdbClient().searchPerson(q);
      const people: PersonResult[] = res.results.slice(0, EXTERNAL_LIMIT).map((p) => ({
        key: `person-${p.id}`,
        name: p.name,
        profilePath: p.profile_path ?? null,
        role: personRole(p),
      }));
      return { scope, people, error: null };
    } catch (e) {
      return { scope, people: [], error: tmdbErrorMessage(e) };
    }
  }

  const mediaType = scope === "movie" ? "movie" : "tv";
  const detailBase = scope === "movie" ? "/movies" : "/shows";
  const needle = q.toLowerCase();

  // 1) The user's tracked library, matched by a case-insensitive title substring. Filtered in memory (not via a
  //    Prisma `contains`/SQL LIKE) so `%`/`_` in the query stay literal and non-ASCII case-folds correctly — the
  //    library is the user's own tracked set, small enough to scan here. These rows come first in the grid.
  const tracked = await prisma.mediaItem.findMany({
    where: { mediaType, userState: { some: { userId } } },
    select: {
      id: true,
      slug: true,
      tmdbId: true,
      title: true,
      posterPath: true,
      imdbRating: true,
      overview: true,
      releaseDate: true,
      userState: { where: { userId }, select: { isFavorite: true } },
    },
    orderBy: { title: "asc" },
  });
  const rows = tracked.filter((r) => r.title.toLowerCase().includes(needle)).slice(0, LIBRARY_LIMIT);

  const libraryResults: TitleResult[] = rows.map((r) => ({
    key: `lib-${r.id}`,
    tmdbId: r.tmdbId,
    mediaType,
    title: r.title,
    posterPath: r.posterPath,
    rating: r.imdbRating,
    year: yearOf(r.releaseDate),
    overview: r.overview,
    inLibrary: true,
    isFavorite: r.userState[0]?.isFavorite ?? false,
    detailHref: `${detailBase}/${r.slug ?? r.id}`,
  }));

  // 2) The wider TMDB catalog, minus anything already in the library (deduped by tmdb id, then by title).
  const seenIds = new Set(rows.map((r) => r.tmdbId).filter((id): id is number => id != null));
  const seenTitles = new Set(rows.map((r) => r.title.toLowerCase()));

  let externalResults: TitleResult[] = [];
  let error: string | null = null;
  try {
    const tmdb = getTmdbClient();
    if (scope === "movie") {
      const res = await tmdb.searchMovie(q);
      externalResults = res.results
        .filter((r) => !seenIds.has(r.id) && !seenTitles.has(r.title.toLowerCase()))
        .slice(0, EXTERNAL_LIMIT)
        .map((r) => ({
          key: `ext-movie-${r.id}`,
          tmdbId: r.id,
          mediaType: "movie" as const,
          title: r.title,
          posterPath: r.poster_path ?? null,
          rating: r.vote_average || null,
          year: yearOf(r.release_date),
          overview: r.overview ?? null,
          inLibrary: false,
          isFavorite: false,
          detailHref: null,
        }));
    } else {
      const res = await tmdb.searchTv(q);
      externalResults = res.results
        .filter((r) => !seenIds.has(r.id) && !seenTitles.has(r.name.toLowerCase()))
        .slice(0, EXTERNAL_LIMIT)
        .map((r) => ({
          key: `ext-tv-${r.id}`,
          tmdbId: r.id,
          mediaType: "tv" as const,
          title: r.name,
          posterPath: r.poster_path ?? null,
          rating: r.vote_average || null,
          year: yearOf(r.first_air_date),
          overview: r.overview ?? null,
          inLibrary: false,
          isFavorite: false,
          detailHref: null,
        }));
    }
  } catch (e) {
    error = tmdbErrorMessage(e);
  }

  return { scope, results: [...libraryResults, ...externalResults], error };
}
