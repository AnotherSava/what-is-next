import { todayISO } from "@/lib/datetime";
import { getPrisma } from "@/lib/db";
import { getMovies } from "@/lib/movies";
import { getPlayableEpisodeRefs, isMediaServerEnabled, type PresenceRef } from "@/lib/media";
import { getFollowedShows } from "@/lib/shows";

// Data for the "Watch next" home dashboard (brief §8.1): what you can play right now from a connected media
// server — unwatched watchlist movies that are in your library, plus behind shows whose NEXT-UP episode is in it.
// (Behind shows whose next episode you don't have belong to the Download view, not here.) Explicit userId (§5a rule 1).

// A watchlist movie you already have — playable right now (the Movies column of "Watch next").
export interface ReadyMovie {
  movieId: string;
  slug: string | null; // URL slug for the detail link (falls back to movieId when unset)
  title: string;
  posterPath: string | null;
  releaseDate: string | null; // ISO date; only its year is rendered
  tmdbRating: number | null; // TMDB community score (0–10) — rendered on the card
  imdbRating: number | null; // IMDb community score (0–10) — rendered on the card
  imdbId: string | null; // IMDb id (tt-prefixed) → links the IMDB rating to its imdb.com page
  director: string | null; // director(s), comma-joined — rendered under the title
  runtime: number | null; // minutes — rendered as "2h 46m" on the card
  isFavorite: boolean;
  presence: PresenceRef | null; // which server holds it + its key there → the watch deep link
}

export interface BehindShow {
  showId: string;
  slug: string | null; // URL slug for the detail link (falls back to showId when unset)
  title: string;
  posterPath: string | null;
  isFavorite: boolean;
  tmdbRating: number | null; // TMDB community score (0–10) — rendered on the card
  imdbRating: number | null; // IMDb community score (0–10) — rendered on the card
  imdbId: string | null; // IMDb id (tt-prefixed) → links the IMDB rating to its imdb.com page
  unwatchedAiredCount: number;
  nextUpReady: boolean; // the NEXT-UP episode is in a connected server's library → can be played right now
  presence: PresenceRef | null; // the server that holds THAT episode + its key there → the watch deep link
  lastWatchedAt: Date | null; // when an episode was last watched (any source), or null if all watches are undated
  nextUp: { episodeId: string; seasonNumber: number; episodeNumber: number; title: string | null };
}

export interface Dashboard {
  readyMovies: ReadyMovie[]; // unwatched watchlist movies you already have — playable right now (recently added first)
  readyShows: BehindShow[]; // behind shows you can watch right now — their next-up episode is in your library
}

export async function getDashboard(userId: string, today: string = todayISO()): Promise<Dashboard> {
  const prisma = getPrisma();
  const [shows, movies] = await Promise.all([getFollowedShows(userId, today), getMovies(userId)]);

  // Movies column: watchlist (unwatched) titles that are in a connected server's library. Keeps getMovies'
  // watchlist order (most recently added first).
  const readyMovies: ReadyMovie[] = movies.watchlist
    .filter((m) => m.onServer)
    .map((m) => ({
      movieId: m.id,
      slug: m.slug,
      title: m.title,
      posterPath: m.posterPath,
      releaseDate: m.releaseDate,
      tmdbRating: m.tmdbRating,
      imdbRating: m.imdbRating,
      imdbId: m.imdbId,
      director: m.director,
      runtime: m.runtime,
      isFavorite: m.isFavorite,
      presence: m.presence,
    }));

  const behindShows = shows.filter((s) => s.group === "behind" && s.progress.nextUp);
  // Enrich each next-up episode with its title (progress.ts stays title-agnostic), and load the most-recent
  // watch time per behind show — it orders "Watch right now" and shows an "N ago" age on each card.
  const nextIds = behindShows.map((s) => s.progress.nextUp!.id);
  const behindIds = behindShows.map((s) => s.id);
  const onAnyServer = await isMediaServerEnabled();
  const [nextEps, watchRows, playable] = await Promise.all([
    prisma.episode.findMany({ where: { id: { in: nextIds } }, select: { id: true, title: true } }),
    prisma.seenEvent.findMany({
      where: { userId, mediaItemId: { in: behindIds }, episodeId: { not: null } },
      select: { mediaItemId: true, watchedAt: true },
    }),
    // Per-episode presence: "Watch right now" is gated on the NEXT-UP episode being present, not the show — and
    // the play link must open the server holding THAT episode, which isn't necessarily the one holding the show.
    onAnyServer ? getPlayableEpisodeRefs(userId, nextIds) : Promise.resolve(new Map<string, PresenceRef>()),
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
      slug: s.slug,
      title: s.title,
      posterPath: s.posterPath,
      isFavorite: s.isFavorite,
      tmdbRating: s.tmdbRating,
      imdbRating: s.imdbRating,
      imdbId: s.imdbId,
      unwatchedAiredCount: s.progress.unwatchedAiredCount,
      nextUpReady: playable.has(n.id),
      presence: playable.get(n.id) ?? null,
      lastWatchedAt: ms != null ? new Date(ms) : null,
      nextUp: {
        episodeId: n.id,
        seasonNumber: n.seasonNumber,
        episodeNumber: n.episodeNumber,
        title: titleById.get(n.id) ?? null,
      },
    };
  });
  // "Watch right now" (next-up episode is on a server) leads with the show you watched most recently. Behind
  // shows whose next episode you don't have are intentionally omitted here — they live in the Download view.
  const readyShows = behindAll
    .filter((b) => b.nextUpReady)
    .sort((a, b) => lastWatch(b.showId) - lastWatch(a.showId) || a.title.localeCompare(b.title));

  return { readyMovies, readyShows };
}
