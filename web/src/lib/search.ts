import { getPrisma } from "@/lib/db";
import { getTmdb } from "@/lib/tmdb";

// TMDB search for the add-new flow (brief §8.5). Returns tv + movie hits, flagged with whether the given user
// already tracks each, so the UI can show "Add" vs "Tracked". This is an owner tool (search-to-add is a hidden
// mutation affordance), so it runs against the TMDB token on demand — the caller gates access.

export interface SearchResult {
  tmdbId: number;
  mediaType: "tv" | "movie";
  title: string;
  year: string | null;
  posterPath: string | null;
  overview: string | null;
  alreadyTracked: boolean;
}

const yearOf = (date: string | null | undefined) => (date ? date.slice(0, 4) : null);

export async function searchTitles(query: string, userId: string): Promise<SearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const tmdb = getTmdb();
  const [tv, movie] = await Promise.all([tmdb.searchTv(q), tmdb.searchMovie(q)]);

  const results: SearchResult[] = [
    ...tv.results.slice(0, 10).map((r) => ({
      tmdbId: r.id,
      mediaType: "tv" as const,
      title: r.name,
      year: yearOf(r.first_air_date),
      posterPath: r.poster_path ?? null,
      overview: r.overview ?? null,
      alreadyTracked: false,
    })),
    ...movie.results.slice(0, 10).map((r) => ({
      tmdbId: r.id,
      mediaType: "movie" as const,
      title: r.title,
      year: yearOf(r.release_date),
      posterPath: r.poster_path ?? null,
      overview: r.overview ?? null,
      alreadyTracked: false,
    })),
  ];

  // Flag the ones this user already tracks (a MediaItem with that tmdb id AND a UserMediaState row).
  const tracked = await getPrisma().userMediaState.findMany({
    where: { userId, mediaItem: { is: { tmdbId: { in: results.map((r) => r.tmdbId) } } } },
    select: { mediaItem: { select: { tmdbId: true, mediaType: true } } },
  });
  const trackedKeys = new Set(tracked.map((t) => `${t.mediaItem.mediaType}:${t.mediaItem.tmdbId}`));
  for (const r of results) r.alreadyTracked = trackedKeys.has(`${r.mediaType}:${r.tmdbId}`);

  return results;
}
