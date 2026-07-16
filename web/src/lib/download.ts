import { todayISO } from "@/lib/datetime";
import { getPrisma } from "@/lib/db";
import { getMovies } from "@/lib/movies";
import { getPlexEpisodePresence, isPlexConfigured } from "@/lib/plex";
import { compareEpisodes, hasAired, type ProgressEpisode } from "@/lib/progress";
import { getFollowedShows } from "@/lib/shows";

// Data for the "Download" view: tracked shows with aired episodes that aren't in your Plex library yet, split
// into three: "Get back" (started, but you've watched everything you have — 0 unwatched episodes left in Plex, so
// you must download to continue), "More of" (started, still have unwatched episodes in Plex to watch, but more
// aired ones to grab too), and "Not started" (tracked but unwatched). Presence is checked PER EPISODE (see
// getPlexEpisodePresence), so a show you already partly own still surfaces here when a newer aired episode isn't
// downloaded — which season-level presence can't tell apart. Explicit userId (brief §5a rule 1).

export interface DownloadShow {
  showId: string;
  title: string;
  posterPath: string | null;
  isFavorite: boolean;
  tmdbRating: number | null; // TMDB community score (0–10) — rendered on the card
  imdbRating: number | null; // IMDb community score (0–10) — rendered on the card
  imdbId: string | null; // IMDb id (tt-prefixed) → links the IMDB rating to its imdb.com page
  missingCount: number; // aired, unwatched episodes not in Plex — the ones to grab
  lastWatchedAt: Date | null; // most recent watch (started shows); null when not started or all watches undated
  missingSeasons: number[]; // seasons (numbers, sorted) with ≥1 aired episode not in Plex yet — the ones to download
}

// A tracked movie you'd need to acquire — on your watchlist (unwatched) but not in your Plex library. The movie
// counterpart of DownloadShow; no episode/missing-count fields since a movie is a single title.
export interface DownloadMovie {
  movieId: string;
  title: string;
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
  getBack: DownloadShow[]; // started, 0 unwatched aired episodes left in Plex — watched what you have; download to continue
  moreOf: DownloadShow[]; // started, still have unwatched aired episodes in Plex — but more aired ones to grab too
  notStarted: DownloadShow[]; // tracked-but-unstarted shows with aired episodes Plex doesn't have
}

export interface Downloads extends ShowDownloads {
  movies: DownloadMovie[]; // watchlist movies not in your Plex library — the Movies column of the Download view
}

interface EpisodeRow extends ProgressEpisode {
  title: string | null;
}

// The aired, unwatched, not-in-Plex episodes of a show — the ones you'd download — in (season, episode) order.
// PURE: Plex presence is passed in. Specials are excluded, mirroring progress.ts's counted-episode rule.
export function missingFromPlex(
  episodes: EpisodeRow[],
  watchedIds: Set<string>,
  presentIds: Set<string>,
  today: string,
): EpisodeRow[] {
  return episodes
    .filter((e) => !e.isSpecial && hasAired(e.releaseDate, today) && !watchedIds.has(e.id) && !presentIds.has(e.id))
    .sort(compareEpisodes);
}

// How many aired, unwatched, non-special episodes of a show ARE in Plex — episodes you can still watch without
// downloading anything. PURE. Zero means you've watched everything you currently have (the "Get back" case);
// greater than zero means there's still downloaded stuff to watch (the "More of" case).
export function unwatchedInPlexCount(
  episodes: EpisodeRow[],
  watchedIds: Set<string>,
  presentIds: Set<string>,
  today: string,
): number {
  return episodes.filter(
    (e) => !e.isSpecial && hasAired(e.releaseDate, today) && !watchedIds.has(e.id) && presentIds.has(e.id),
  ).length;
}

export async function getDownloads(userId: string, today: string = todayISO()): Promise<Downloads> {
  // "Not in Plex" is meaningless without a Plex library to compare against — the whole view is Plex-gated.
  if (!isPlexConfigured()) return { movies: [], getBack: [], moreOf: [], notStarted: [] };
  const prisma = getPrisma();

  // Reuse the shared grouping so "started" (Behind) and "not started" (Planned) never drift from the rest of the
  // app; only these two groups can have anything left to download (Up-to-date/Finished have no unwatched aired
  // episodes, Stopped isn't wanted). getFollowedShows already applies the favorite→Planned coercion.
  const [shows, moviesView] = await Promise.all([getFollowedShows(userId, today), getMovies(userId)]);
  // Movies column: watchlist (unwatched) titles that aren't in the user's Plex library AND have already been
  // released — the ones you could actually go and grab. hasAired doubles as "has this movie come out?" (a null or
  // future release date counts as not released, mirroring the shows' aired-episode rule). Keeps getMovies'
  // watchlist order (most recently added first).
  const movies: DownloadMovie[] = moviesView.watchlist
    .filter((m) => !m.inPlex && hasAired(m.releaseDate, today))
    .map((m) => ({
      movieId: m.id,
      title: m.title,
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
    getPlexEpisodePresence(userId),
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

  // Per show: the download row (null if there's nothing left to grab) + how many unwatched aired episodes are still
  // in Plex — the number that splits started shows into "Get back" (0 left) vs "More of" (some left).
  const analyze = (s: (typeof relevant)[number]): { row: DownloadShow; inPlexLeft: number } | null => {
    const eps = episodesByShow.get(s.id) ?? [];
    const watched = watchedByShow.get(s.id) ?? new Set<string>();
    const missing = missingFromPlex(eps, watched, presentIds, today);
    if (missing.length === 0) return null; // behind/planned, but everything aired is already in Plex
    const ms = lastWatchMs.get(s.id);
    // Seasons with ≥1 aired episode not in Plex yet (the ones to download) — rendered as a range on the show's
    // download row. Derived from the same `missing` set, so it never lists a season you already fully have in Plex.
    const missingSeasons = [...new Set(missing.map((e) => e.seasonNumber))].sort((a, b) => a - b);
    const row: DownloadShow = {
      showId: s.id,
      title: s.title,
      posterPath: s.posterPath,
      isFavorite: s.isFavorite,
      tmdbRating: s.tmdbRating,
      imdbRating: s.imdbRating,
      imdbId: s.imdbId,
      missingCount: missing.length,
      lastWatchedAt: ms != null ? new Date(ms) : null,
      missingSeasons,
    };
    return { row, inPlexLeft: unwatchedInPlexCount(eps, watched, presentIds, today) };
  };

  const notNull = <T>(x: T | null): x is T => x != null;
  const startedAnalyzed = started.map(analyze).filter(notNull);
  const notStartedRows = notStarted
    .map(analyze)
    .filter(notNull)
    .map((x) => x.row);
  return { movies, ...classifyDownloads(startedAnalyzed, notStartedRows) };
}

// One analyzed started show: its download row + how many unwatched aired episodes are still in Plex (0 → "Get
// back", >0 → "More of").
export interface AnalyzedShow {
  row: DownloadShow;
  inPlexLeft: number;
}

// Partition the analyzed started shows into Get back (nothing left to watch in Plex) / More of (some left) and
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
      .filter((x) => x.inPlexLeft === 0)
      .map((x) => x.row)
      .sort(byRecentWatch),
    moreOf: started
      .filter((x) => x.inPlexLeft > 0)
      .map((x) => x.row)
      .sort(byRecentWatch),
    notStarted: [...notStarted].sort(byMostMissing),
  };
}
