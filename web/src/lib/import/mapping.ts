import type { TvtimeMovie, TvtimeSeries, TvtimeSeriesStatus } from "./schemas";

// Pure mapping from TV Time export shapes to our domain (brief §6.2). No I/O, no TMDB, no DB — exhaustively
// unit-tested. The orchestrator (importer.ts) composes these with TMDB resolution and DB writes.

export type Tracking = "planned" | "watching" | "stopped" | "finished";

// Series status → user INTENT. The up_to_date/continuing split is derived progress, not intent, so both
// collapse to "watching" (brief §6.2). Exhaustive over the 4 export statuses.
export function trackingForSeriesStatus(status: TvtimeSeriesStatus): Tracking {
  switch (status) {
    case "up_to_date":
    case "continuing":
      return "watching";
    case "not_started_yet":
      return "planned";
    case "stopped":
      return "stopped";
  }
}

// Movie intent: watched → finished, unwatched → planned (the watchlist). Brief §6.2.
export function trackingForMovie(movie: Pick<TvtimeMovie, "is_watched">): Tracking {
  return movie.is_watched ? "finished" : "planned";
}

// A flattened export episode, ready to match against the catalog. seasonNumber comes from the season, not the
// episode (the export nests episodes under seasons).
export interface ExportEpisodeRef {
  seasonNumber: number;
  episodeNumber: number;
  isWatched: boolean;
  watchedAt: string | null;
  tvdbId: number | null;
}

export function flattenSeriesEpisodes(series: Pick<TvtimeSeries, "seasons">): ExportEpisodeRef[] {
  return series.seasons.flatMap((season) =>
    season.episodes.map((ep) => ({
      seasonNumber: season.number,
      episodeNumber: ep.number,
      isWatched: ep.is_watched,
      watchedAt: ep.watched_at ?? null,
      tvdbId: ep.id.tvdb ?? null,
    })),
  );
}

export interface CatalogEpisodeRef {
  id: string;
  seasonNumber: number;
  episodeNumber: number;
}

export interface EpisodeMatch {
  ref: ExportEpisodeRef;
  catalogEpisodeId: string;
}

export interface EpisodeMatchResult {
  matched: EpisodeMatch[];
  unmatched: ExportEpisodeRef[];
}

export function episodeKey(seasonNumber: number, episodeNumber: number): string {
  return `${seasonNumber}:${episodeNumber}`;
}

// Match export episodes to catalog episodes by (seasonNumber, episodeNumber) — TVDB and TMDB numbering agree
// for the vast majority; the handful that don't go to `unmatched` for the reconciliation report (brief §6.3.4).
// We never guess. If the catalog somehow has duplicate keys, the first wins (upsert keeps them unique anyway).
export function matchEpisodes(exportEps: ExportEpisodeRef[], catalogEps: CatalogEpisodeRef[]): EpisodeMatchResult {
  const byKey = new Map<string, string>();
  for (const c of catalogEps) {
    const key = episodeKey(c.seasonNumber, c.episodeNumber);
    if (!byKey.has(key)) byKey.set(key, c.id);
  }
  const matched: EpisodeMatch[] = [];
  const unmatched: ExportEpisodeRef[] = [];
  for (const ref of exportEps) {
    const id = byKey.get(episodeKey(ref.seasonNumber, ref.episodeNumber));
    if (id) matched.push({ ref, catalogEpisodeId: id });
    else unmatched.push(ref);
  }
  return { matched, unmatched };
}

// Parse a TV Time watched_at into a Date (or null for "seen, date unknown"). Tolerant: an unparseable value
// becomes null rather than throwing, so one bad timestamp never fails the import.
export function parseWatchedAt(watchedAt: string | null | undefined): Date | null {
  if (!watchedAt) return null;
  const d = new Date(watchedAt);
  return Number.isNaN(d.getTime()) ? null : d;
}
