import { todayISO } from "@/lib/datetime";
import { getPrisma } from "@/lib/db";
import { getMovies } from "@/lib/movies";
import { getPlexEpisodePresence, isPlexConfigured } from "@/lib/plex";
import { getFollowedShows } from "@/lib/shows";

// Data for the "Watch next" home dashboard (brief §8.1): what you can play right now from Plex — unwatched
// watchlist movies that are in your library, plus behind shows whose NEXT-UP episode is in your library. (Behind
// shows whose next episode isn't in Plex belong to the Download view, not here.) Explicit userId (§5a rule 1).

// A watchlist movie present in Plex — playable right now (the Movies column of "Watch next").
export interface ReadyMovie {
  movieId: string;
  title: string;
  posterPath: string | null;
  releaseDate: string | null; // ISO date; only its year is rendered
  tmdbRating: number | null; // TMDB community score (0–10) — rendered on the card
  imdbRating: number | null; // IMDb community score (0–10) — rendered on the card
  director: string | null; // director(s), comma-joined — rendered under the title
  plexRatingKey: string | null; // set when in Plex → deep-link to watch it (null if presence predates capture)
}

export interface BehindShow {
  showId: string;
  title: string;
  posterPath: string | null;
  isFavorite: boolean;
  tmdbRating: number | null; // TMDB community score (0–10) — rendered on the card
  imdbRating: number | null; // IMDb community score (0–10) — rendered on the card
  unwatchedAiredCount: number;
  nextUpInPlex: boolean; // the NEXT-UP episode is in the user's Plex library → can be played right now
  plexRatingKey: string | null; // the show's Plex ratingKey → deep-link to watch it (set when the show is in Plex)
  lastWatchedAt: Date | null; // when an episode was last watched (any source), or null if all watches are undated
  nextUp: { episodeId: string; seasonNumber: number; episodeNumber: number; title: string | null };
}

export interface Dashboard {
  readyMovies: ReadyMovie[]; // unwatched watchlist movies present in Plex — playable right now (recently added first)
  readyInPlex: BehindShow[]; // behind shows you can watch right now — their next-up episode is in your Plex library
}

export async function getDashboard(userId: string, today: string = todayISO()): Promise<Dashboard> {
  const prisma = getPrisma();
  const [shows, movies] = await Promise.all([getFollowedShows(userId, today), getMovies(userId)]);

  // Movies column: watchlist (unwatched) titles that are in the user's Plex library. Keeps getMovies' watchlist
  // order (most recently added first).
  const readyMovies: ReadyMovie[] = movies.watchlist
    .filter((m) => m.inPlex)
    .map((m) => ({
      movieId: m.id,
      title: m.title,
      posterPath: m.posterPath,
      releaseDate: m.releaseDate,
      tmdbRating: m.tmdbRating,
      imdbRating: m.imdbRating,
      director: m.director,
      plexRatingKey: m.plexRatingKey,
    }));

  const behindShows = shows.filter((s) => s.group === "behind" && s.progress.nextUp);
  // Enrich each next-up episode with its title (progress.ts stays title-agnostic), and load the most-recent
  // watch time per behind show — it orders "Watch right now" and shows an "N ago" age on each card.
  const nextIds = behindShows.map((s) => s.progress.nextUp!.id);
  const behindIds = behindShows.map((s) => s.id);
  const [nextEps, watchRows, plexEpisodeIds] = await Promise.all([
    prisma.episode.findMany({ where: { id: { in: nextIds } }, select: { id: true, title: true } }),
    prisma.seenEvent.findMany({
      where: { userId, mediaItemId: { in: behindIds }, episodeId: { not: null } },
      select: { mediaItemId: true, watchedAt: true },
    }),
    // Per-episode Plex presence: "Watch right now" is gated on the NEXT-UP episode being present, not the show.
    isPlexConfigured() ? getPlexEpisodePresence(userId) : Promise.resolve(new Set<string>()),
  ]);
  const titleById = new Map(nextEps.map((e) => [e.id, e.title]));
  // Latest watchedAt (epoch ms) per show; a show whose watches are all undated sinks to the bottom (-Infinity).
  const lastWatchedMs = new Map<string, number>();
  for (const r of watchRows) {
    if (!r.watchedAt) continue;
    const t = r.watchedAt.getTime();
    if (t > (lastWatchedMs.get(r.mediaItemId) ?? -Infinity)) lastWatchedMs.set(r.mediaItemId, t);
  }
  const lastWatch = (showId: string) => lastWatchedMs.get(showId) ?? -Infinity;

  const behindAll: BehindShow[] = behindShows.map((s) => {
    const n = s.progress.nextUp!;
    const ms = lastWatchedMs.get(s.id);
    return {
      showId: s.id,
      title: s.title,
      posterPath: s.posterPath,
      isFavorite: s.isFavorite,
      tmdbRating: s.tmdbRating,
      imdbRating: s.imdbRating,
      unwatchedAiredCount: s.progress.unwatchedAiredCount,
      nextUpInPlex: plexEpisodeIds.has(n.id),
      plexRatingKey: s.plexRatingKey,
      lastWatchedAt: ms != null ? new Date(ms) : null,
      nextUp: {
        episodeId: n.id,
        seasonNumber: n.seasonNumber,
        episodeNumber: n.episodeNumber,
        title: titleById.get(n.id) ?? null,
      },
    };
  });
  // "Watch right now" (next-up episode is in Plex) leads with the show you watched most recently. Behind shows
  // whose next episode isn't in Plex are intentionally omitted here — they live in the Download view.
  const readyInPlex = behindAll
    .filter((b) => b.nextUpInPlex)
    .sort((a, b) => lastWatch(b.showId) - lastWatch(a.showId) || a.title.localeCompare(b.title));

  return { readyMovies, readyInPlex };
}
