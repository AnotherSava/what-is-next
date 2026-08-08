import { todayISO } from "@/lib/datetime";
import { getPrisma } from "@/lib/db";
import { getMovies } from "@/lib/movies";
import { getEpisodePresence, isMediaServerEnabled } from "@/lib/media";
import { compareEpisodes, fullyAiredSeasons, hasAired, isEndedStatus, type ProgressEpisode } from "@/lib/progress";
import { isWaitForFullSeasonEnabled } from "@/lib/settings";
import { getFollowedShows } from "@/lib/shows";

// Data for the "Download" view: tracked shows with aired episodes that aren't in your media-server library yet,
// split into three: "Get back" (started, but you've watched everything you have — 0 unwatched episodes left, so
// you must download to continue), "More of" (started, still have unwatched episodes to watch, but more aired ones
// to grab too), and "Not started" (tracked but unwatched). Presence is checked PER EPISODE (see
// getEpisodePresence), so a show you already partly own still surfaces here when a newer aired episode isn't
// downloaded — which season-level presence can't tell apart. Explicit userId (brief §5a rule 1).

export interface DownloadShow {
  showId: string;
  slug: string | null; // URL slug for the detail link (falls back to showId when unset)
  title: string;
  originalTitle: string | null; // native title — used by download sources that search in the show's own language
  originalLanguage: string | null; // TMDB original_language code (mostly ISO 639-1); which language originalTitle is in
  posterPath: string | null;
  isFavorite: boolean;
  tmdbRating: number | null; // TMDB community score (0–10) — rendered on the card
  imdbRating: number | null; // IMDb community score (0–10) — rendered on the card
  imdbId: string | null; // IMDb id (tt-prefixed) → links the IMDB rating to its imdb.com page
  missingCount: number; // aired, unwatched episodes you don't have — the ones to grab
  lastWatchedAt: Date | null; // most recent watch (started shows); null when not started or all watches undated
  missingSeasons: number[]; // seasons (numbers, sorted) with ≥1 aired episode you don't have yet — the ones to download
}

// A tracked movie you'd need to acquire — on your watchlist (unwatched) but on no connected server. The movie
// counterpart of DownloadShow; no episode/missing-count fields since a movie is a single title.
export interface DownloadMovie {
  movieId: string;
  slug: string | null; // URL slug for the detail link (falls back to movieId when unset)
  title: string;
  originalTitle: string | null; // native title — used by download sources that search in the movie's own language
  originalLanguage: string | null; // TMDB original_language code (mostly ISO 639-1); which language originalTitle is in
  posterPath: string | null;
  releaseDate: string | null; // ISO date; only its year is rendered
  tmdbRating: number | null; // TMDB community score (0–10) — rendered on the card
  imdbRating: number | null; // IMDb community score (0–10) — rendered on the card
  imdbId: string | null; // IMDb id (tt-prefixed) → links the IMDB rating to its imdb.com page
  director: string | null; // director(s), comma-joined — rendered under the title
  runtime: number | null; // minutes — rendered as "2h 46m" on the card
  isFavorite: boolean;
}

// The show side of the Download view — the three buckets classifyDownloads produces (kept separate so that pure
// function stays movie-agnostic and its tests are unaffected).
export interface ShowDownloads {
  getBack: DownloadShow[]; // started, 0 unwatched aired episodes left — watched what you have; download to continue
  moreOf: DownloadShow[]; // started, still have unwatched aired episodes — but more aired ones to grab too
  notStarted: DownloadShow[]; // tracked-but-unstarted shows with aired episodes you don't have
}

export interface Downloads extends ShowDownloads {
  movies: DownloadMovie[]; // watchlist movies on no connected server — the Movies column of the Download view
}

interface EpisodeRow extends ProgressEpisode {
  title: string | null;
}

// The aired, unwatched, not-yet-owned episodes of a show — the ones you'd download — in (season, episode) order.
// PURE: library presence is passed in. Specials are excluded, mirroring progress.ts's counted-episode rule.
// `completeSeasons`, when passed, restricts the result to those seasons — the "wait for the full season to air"
// preference, so a still-airing season isn't offered for download until it finishes.
export function missingFromLibrary(
  episodes: EpisodeRow[],
  watchedIds: Set<string>,
  presentIds: Set<string>,
  today: string,
  completeSeasons?: Set<number> | null,
): EpisodeRow[] {
  return episodes
    .filter(
      (e) =>
        !e.isSpecial &&
        hasAired(e.releaseDate, today) &&
        !watchedIds.has(e.id) &&
        !presentIds.has(e.id) &&
        (!completeSeasons || completeSeasons.has(e.seasonNumber)),
    )
    .sort(compareEpisodes);
}

// How many aired, unwatched, non-special episodes of a show you already HAVE — episodes you can still watch
// without downloading anything. PURE. Zero means you've watched everything you currently have (the "Get back"
// case); greater than zero means there's still downloaded stuff to watch (the "More of" case). `completeSeasons`,
// when passed, restricts the count to those seasons — matching missingFromLibrary so a waited-on season counts on
// neither side.
export function unwatchedOnServerCount(
  episodes: EpisodeRow[],
  watchedIds: Set<string>,
  presentIds: Set<string>,
  today: string,
  completeSeasons?: Set<number> | null,
): number {
  return episodes.filter(
    (e) =>
      !e.isSpecial &&
      hasAired(e.releaseDate, today) &&
      !watchedIds.has(e.id) &&
      presentIds.has(e.id) &&
      (!completeSeasons || completeSeasons.has(e.seasonNumber)),
  ).length;
}

export async function getDownloads(userId: string, today: string = todayISO()): Promise<Downloads> {
  // "Don't have it" is meaningless without a library to compare against — the whole view is gated on a server.
  if (!(await isMediaServerEnabled())) return { movies: [], getBack: [], moreOf: [], notStarted: [] };
  const prisma = getPrisma();

  // Reuse the shared grouping so "started" (Behind) and "not started" (Planned) never drift from the rest of the
  // app; only these two groups can have anything left to download (Up-to-date/Finished have no unwatched aired
  // episodes, Stopped isn't wanted). getFollowedShows already applies the favorite→Planned coercion.
  const [shows, moviesView, waitForFullSeason] = await Promise.all([
    getFollowedShows(userId, today),
    getMovies(userId),
    isWaitForFullSeasonEnabled(),
  ]);
  // Movies column: watchlist (unwatched) titles that are on no connected server AND have already been
  // released — the ones you could actually go and grab. hasAired doubles as "has this movie come out?" (a null or
  // future release date counts as not released, mirroring the shows' aired-episode rule). Keeps getMovies'
  // watchlist order (most recently added first).
  const movies: DownloadMovie[] = moviesView.watchlist
    .filter((m) => !m.onServer && hasAired(m.releaseDate, today))
    .map((m) => ({
      movieId: m.id,
      slug: m.slug,
      title: m.title,
      originalTitle: m.originalTitle,
      originalLanguage: m.originalLanguage,
      posterPath: m.posterPath,
      releaseDate: m.releaseDate,
      tmdbRating: m.tmdbRating,
      imdbRating: m.imdbRating,
      imdbId: m.imdbId,
      director: m.director,
      runtime: m.runtime,
      isFavorite: m.isFavorite,
    }));

  const started = shows.filter((s) => s.group === "behind");
  const notStarted = shows.filter((s) => s.group === "planned");
  const relevant = [...started, ...notStarted];
  if (relevant.length === 0) return { movies, getBack: [], moreOf: [], notStarted: [] };
  const ids = relevant.map((s) => s.id);

  const [episodes, seen, presentIds] = await Promise.all([
    prisma.episode.findMany({
      where: { mediaItemId: { in: ids } },
      select: {
        id: true,
        mediaItemId: true,
        seasonNumber: true,
        episodeNumber: true,
        isSpecial: true,
        releaseDate: true,
        title: true,
      },
    }),
    prisma.seenEvent.findMany({
      where: { userId, mediaItemId: { in: ids }, episodeId: { not: null } },
      select: { mediaItemId: true, episodeId: true, watchedAt: true },
    }),
    getEpisodePresence(userId),
  ]);

  const episodesByShow = new Map<string, EpisodeRow[]>();
  for (const e of episodes) {
    const arr = episodesByShow.get(e.mediaItemId);
    if (arr) arr.push(e);
    else episodesByShow.set(e.mediaItemId, [e]);
  }
  // Watched episodes + most-recent watch time per show, both from the one seen query.
  const watchedByShow = new Map<string, Set<string>>();
  const lastWatchMs = new Map<string, number>();
  for (const s of seen) {
    if (!s.episodeId) continue;
    let set = watchedByShow.get(s.mediaItemId);
    if (!set) watchedByShow.set(s.mediaItemId, (set = new Set()));
    set.add(s.episodeId);
    if (s.watchedAt) {
      const t = s.watchedAt.getTime();
      if (t > (lastWatchMs.get(s.mediaItemId) ?? -Infinity)) lastWatchMs.set(s.mediaItemId, t);
    }
  }

  // Per show: the download row (null if there's nothing left to grab) + how many unwatched aired episodes you
  // already have — the number that splits started shows into "Get back" (0 left) vs "More of" (some left).
  const analyze = (s: (typeof relevant)[number]): { row: DownloadShow; onServerLeft: number } | null => {
    const eps = episodesByShow.get(s.id) ?? [];
    const watched = watchedByShow.get(s.id) ?? new Set<string>();
    // "Wait for the full season to air": only fully-aired seasons are downloadable, so a show whose only missing
    // episodes are in a still-airing season drops out entirely. Ended shows are exempt (mirrors computeShowProgress).
    const completeSeasons = waitForFullSeason && !isEndedStatus(s.status) ? fullyAiredSeasons(eps, today) : null;
    const missing = missingFromLibrary(eps, watched, presentIds, today, completeSeasons);
    if (missing.length === 0) return null; // behind/planned, but everything aired is already here (or being waited on)
    const ms = lastWatchMs.get(s.id);
    // Seasons with ≥1 aired episode you don't have yet (the ones to download) — rendered as a range on the show's
    // download row. Derived from the same `missing` set, so it never lists a season you already fully own.
    const missingSeasons = [...new Set(missing.map((e) => e.seasonNumber))].sort((a, b) => a - b);
    const row: DownloadShow = {
      showId: s.id,
      slug: s.slug,
      title: s.title,
      originalTitle: s.originalTitle,
      originalLanguage: s.originalLanguage,
      posterPath: s.posterPath,
      isFavorite: s.isFavorite,
      tmdbRating: s.tmdbRating,
      imdbRating: s.imdbRating,
      imdbId: s.imdbId,
      missingCount: missing.length,
      lastWatchedAt: ms != null ? new Date(ms) : null,
      missingSeasons,
    };
    return { row, onServerLeft: unwatchedOnServerCount(eps, watched, presentIds, today, completeSeasons) };
  };

  const notNull = <T>(x: T | null): x is T => x != null;
  const startedAnalyzed = started.map(analyze).filter(notNull);
  const notStartedRows = notStarted
    .map(analyze)
    .filter(notNull)
    .map((x) => x.row);
  return { movies, ...classifyDownloads(startedAnalyzed, notStartedRows) };
}

// One analyzed started show: its download row + how many unwatched aired episodes you already have (0 → "Get
// back", >0 → "More of").
export interface AnalyzedShow {
  row: DownloadShow;
  onServerLeft: number;
}

// Partition the analyzed started shows into Get back (nothing left to watch) / More of (some left) and
// order every section. PURE — the split predicate and the comparators live here so they're unit-testable. Get back
// and More of lead with the show you watched most recently (last-watched date descending, title tie-break; undated
// watches sink last); Not started leads with the most episodes to grab.
export function classifyDownloads(started: AnalyzedShow[], notStarted: DownloadShow[]): ShowDownloads {
  const lastMs = (d: DownloadShow) => (d.lastWatchedAt ? d.lastWatchedAt.getTime() : -Infinity);
  const byRecentWatch = (a: DownloadShow, b: DownloadShow) => lastMs(b) - lastMs(a) || a.title.localeCompare(b.title);
  const byMostMissing = (a: DownloadShow, b: DownloadShow) =>
    b.missingCount - a.missingCount || a.title.localeCompare(b.title);
  return {
    getBack: started
      .filter((x) => x.onServerLeft === 0)
      .map((x) => x.row)
      .sort(byRecentWatch),
    moreOf: started
      .filter((x) => x.onServerLeft > 0)
      .map((x) => x.row)
      .sort(byRecentWatch),
    notStarted: [...notStarted].sort(byMostMissing),
  };
}
