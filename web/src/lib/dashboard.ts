import { todayISO } from "@/lib/datetime";
import { getPrisma } from "@/lib/db";
import { getPlexEpisodePresence, isPlexConfigured } from "@/lib/plex";
import { getFollowedShows } from "@/lib/shows";

// Data for the "Watch next" home dashboard (brief §8.1): the behind shows you can play right now — those whose
// NEXT-UP episode is in your Plex library. (Behind shows whose next episode isn't in Plex belong to the Download
// view, not here.) Explicit userId (§5a rule 1).

export interface BehindShow {
  showId: string;
  title: string;
  posterPath: string | null;
  isFavorite: boolean;
  unwatchedAiredCount: number;
  nextUpInPlex: boolean; // the NEXT-UP episode is in the user's Plex library → can be played right now
  plexRatingKey: string | null; // the show's Plex ratingKey → deep-link to watch it (set when the show is in Plex)
  lastWatchedAt: Date | null; // when an episode was last watched (any source), or null if all watches are undated
  nextUp: { episodeId: string; seasonNumber: number; episodeNumber: number; title: string | null };
}

export interface Dashboard {
  readyInPlex: BehindShow[]; // behind shows you can watch right now — their next-up episode is in your Plex library
}

export async function getDashboard(userId: string, today: string = todayISO()): Promise<Dashboard> {
  const prisma = getPrisma();
  const shows = await getFollowedShows(userId, today);

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

  return { readyInPlex };
}
