import type { PrismaClient } from "@/generated/prisma/client";
import { TmdbError, type TmdbClient, type TmdbPersonSummary } from "@/lib/tmdb";

// Backend for the redesigned Search page (design reference "Search" screen). One owner tool that, for a given
// scope, searches BOTH the user's tracked library and the wider TMDB catalog:
//   • movie / show → the TMDB hits in relevance order, each annotated with its library status IN PLACE (favourite ♥
//     / in-library ✓ / add +), preceded by any tracked items TMDB didn't surface. A hit isn't deduped out or floated
//     to a separate section when it's in the library, so adding it just flips its + → ✓ where it sits.
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
  detailHref: string | null; // library rows → their detail page; external rows → a read-only /…/preview/<tmdbId> card
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

  // The user's tracked library for this media type, matched by a case-insensitive title substring. Filtered in
  // memory (not via a Prisma `contains`/SQL LIKE) so `%`/`_` in the query stay literal and non-ASCII case-folds
  // correctly — the library is the user's own tracked set, small enough to scan here.
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

  // Index the tracked rows so a TMDB hit can be annotated with its library status — and linked to its real detail
  // page — IN PLACE, rather than deduped out and floated to a separate "library" section. Keeping an added item in
  // its search-result position (just flipping + → ✓) is what lets its card stay put across an add and a round-trip
  // to its detail page, instead of jumping to the front. A row WITH a tmdb id is matched by id ALONE; title matching
  // is a fallback ONLY for rows that lack a tmdb id (e.g. TVDB-sourced) — otherwise a different movie that merely
  // shares a title would be mistaken for a tracked one (the "Odyssey" bug: adding one flagged every same-titled hit).
  const trackedByTmdbId = new Map<number, (typeof rows)[number]>();
  const trackedByTitleNoId = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    if (r.tmdbId != null) trackedByTmdbId.set(r.tmdbId, r);
    else trackedByTitleNoId.set(r.title.toLowerCase(), r);
  }

  const toLibraryResult = (r: (typeof rows)[number]): TitleResult => ({
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
  });

  // Fetch the wider TMDB catalog and normalise the movie/tv result shapes into one. A TMDB failure is non-fatal:
  // the tracked-library rows still return below, with `error` set for the page to surface.
  type Hit = { id: number; title: string; date: string | null; poster: string | null; vote: number | null; overview: string | null };
  let error: string | null = null;
  let hits: Hit[] = [];
  try {
    const tmdb = getTmdbClient();
    if (scope === "movie") {
      const res = await tmdb.searchMovie(q);
      hits = res.results.map((r) => ({ id: r.id, title: r.title, date: r.release_date ?? null, poster: r.poster_path ?? null, vote: r.vote_average ?? null, overview: r.overview ?? null }));
    } else {
      const res = await tmdb.searchTv(q);
      hits = res.results.map((r) => ({ id: r.id, title: r.name, date: r.first_air_date ?? null, poster: r.poster_path ?? null, vote: r.vote_average ?? null, overview: r.overview ?? null }));
    }
  } catch (e) {
    error = tmdbErrorMessage(e);
  }

  // Each TMDB hit, annotated with its library status in place. A tracked hit shows ✓/♥ and links to its real detail
  // page; an untracked one shows + and links to the read-only preview. Tracked rows surfaced here are recorded so
  // they aren't listed again below.
  const surfaced = new Set<string>();
  const externalResults: TitleResult[] = hits.slice(0, EXTERNAL_LIMIT).map((h) => {
    const lib = trackedByTmdbId.get(h.id) ?? trackedByTitleNoId.get(h.title.toLowerCase());
    if (lib) surfaced.add(lib.id);
    return {
      key: `ext-${mediaType}-${h.id}`,
      tmdbId: h.id,
      mediaType,
      title: h.title,
      posterPath: h.poster,
      // Library rows prefer the IMDb score (like the /movies|/shows cards), falling back to TMDB's while it hydrates.
      rating: lib ? (lib.imdbRating ?? (h.vote || null)) : (h.vote || null),
      year: yearOf(h.date),
      overview: h.overview ?? lib?.overview ?? null,
      inLibrary: lib != null,
      isFavorite: lib?.userState[0]?.isFavorite ?? false,
      detailHref: lib ? `${detailBase}/${lib.slug ?? lib.id}` : `${detailBase}/preview/${h.id}`,
    };
  });

  // Tracked matches TMDB search didn't surface (a TVDB-sourced item, or a title ranked out of the top hits). Shown
  // first so your own library still leads; anything already shown inline above is excluded so nothing repeats.
  const libraryOnly = rows.filter((r) => !surfaced.has(r.id)).map(toLibraryResult);

  return { scope, results: [...libraryOnly, ...externalResults], error };
}
