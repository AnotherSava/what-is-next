import { getPrisma } from "@/lib/db";
import { getPlexPresenceKeys, isPlexConfigured } from "@/lib/plex";

// Read-side data layer for /movies (brief §8.4). A movie is "watched" iff it has a SeenEvent (episodeId null)
// — the append-only log is the source of truth — and its watch date is the latest such event. Unlike shows,
// movies have no off-list/Stopped state: tracking is simply whether a UserMediaState row exists, so every row is
// shown (watched → Watched, else Watchlist) and untracking deletes the row. Explicit userId per §5a rule 1.

export interface MovieSummary {
  id: string;
  title: string;
  posterPath: string | null;
  releaseDate: string | null;
  tmdbId: number | null;
  isFavorite: boolean;
  watched: boolean;
  watchedAt: Date | null;
  plexRatingKey: string | null; // set when in Plex → deep-link to watch it (null if presence predates capture)
}

export interface MoviesView {
  watched: MovieSummary[];
  watchlist: MovieSummary[];
}

export async function getMovies(userId: string): Promise<MoviesView> {
  const prisma = getPrisma();
  const [states, seen, plexMovies] = await Promise.all([
    prisma.userMediaState.findMany({
      where: { userId, mediaItem: { is: { mediaType: "movie" } } },
      include: { mediaItem: true },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.seenEvent.findMany({
      where: { userId, episodeId: null, mediaItem: { is: { mediaType: "movie" } } },
      select: { mediaItemId: true, watchedAt: true },
    }),
    isPlexConfigured() ? getPlexPresenceKeys(userId) : Promise.resolve(new Map<string, string | null>()),
  ]);

  // Latest watch date per movie (null "seen, date unknown" events still mark it watched).
  const latestWatch = new Map<string, Date | null>();
  const watchedSet = new Set<string>();
  for (const e of seen) {
    watchedSet.add(e.mediaItemId);
    const prev = latestWatch.get(e.mediaItemId);
    if (!latestWatch.has(e.mediaItemId) || (e.watchedAt && (!prev || e.watchedAt > prev))) {
      latestWatch.set(e.mediaItemId, e.watchedAt ?? prev ?? null);
    }
  }

  const watched: MovieSummary[] = [];
  const watchlist: MovieSummary[] = [];
  for (const st of states) {
    const isWatched = watchedSet.has(st.mediaItemId);
    const summary: MovieSummary = {
      id: st.mediaItem.id,
      title: st.mediaItem.title,
      posterPath: st.mediaItem.posterPath,
      releaseDate: st.mediaItem.releaseDate,
      tmdbId: st.mediaItem.tmdbId,
      isFavorite: st.isFavorite,
      watched: isWatched,
      watchedAt: latestWatch.get(st.mediaItemId) ?? null,
      plexRatingKey: plexMovies.get(st.mediaItemId) ?? null,
    };
    if (isWatched) watched.push(summary);
    else watchlist.push(summary);
  }

  // Watched: most recent first (undated sink to the end). Watchlist: keep updatedAt order.
  watched.sort((a, b) => (b.watchedAt?.getTime() ?? 0) - (a.watchedAt?.getTime() ?? 0));
  return { watched, watchlist };
}

export interface MovieDetail {
  id: string;
  title: string;
  originalTitle: string | null;
  overview: string | null;
  posterPath: string | null;
  releaseDate: string | null;
  runtime: number | null;
  tmdbId: number | null;
  tracked: boolean; // has a UserMediaState row — i.e. on your watchlist or already watched
  isFavorite: boolean;
  watched: boolean;
  watchedAt: Date | null; // latest watch date, or null if watched-but-undated / unwatched
  plexRatingKey: string | null; // set when in Plex → deep-link to watch it
}

export async function getMovieDetail(userId: string, movieId: string): Promise<MovieDetail | null> {
  const prisma = getPrisma();
  const item = await prisma.mediaItem.findFirst({ where: { id: movieId, mediaType: "movie" } });
  if (!item) return null;

  const [state, seen, plexMovies] = await Promise.all([
    prisma.userMediaState.findUnique({ where: { userId_mediaItemId: { userId, mediaItemId: movieId } } }),
    prisma.seenEvent.findMany({ where: { userId, mediaItemId: movieId, episodeId: null }, select: { watchedAt: true } }),
    isPlexConfigured() ? getPlexPresenceKeys(userId) : Promise.resolve(new Map<string, string | null>()),
  ]);

  let watchedAt: Date | null = null;
  for (const e of seen) if (e.watchedAt && (!watchedAt || e.watchedAt > watchedAt)) watchedAt = e.watchedAt;

  return {
    id: item.id,
    title: item.title,
    originalTitle: item.originalTitle,
    overview: item.overview,
    posterPath: item.posterPath,
    releaseDate: item.releaseDate,
    runtime: item.runtime,
    tmdbId: item.tmdbId,
    tracked: state != null,
    isFavorite: state?.isFavorite ?? false,
    watched: seen.length > 0,
    watchedAt,
    plexRatingKey: plexMovies.get(movieId) ?? null,
  };
}
