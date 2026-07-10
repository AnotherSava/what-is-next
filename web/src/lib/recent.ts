import { getPrisma } from "@/lib/db";

// Read-side data layer for the "Recently watched" feed. Shows the user's watch history across ALL sources (TV
// Time import, Plex sync, in-app marks), newest watch first, each row tagged with where it came from. Explicit
// userId (brief §5a rule 1).

export interface RecentWatch {
  id: string;
  kind: "episode" | "movie";
  mediaItemId: string;
  mediaType: "tv" | "movie";
  title: string;
  posterPath: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  episodeTitle: string | null;
  watchedAt: Date | null; // when watched (null = "seen, date unknown")
  source: string; // "app" | "tvtime-import" | "plex"
}

export async function getRecentWatches(userId: string, limit = 100): Promise<RecentWatch[]> {
  const rows = await getPrisma().seenEvent.findMany({
    where: { userId },
    // SQLite sorts NULLs last on DESC, so undated watches sink below dated ones; createdAt breaks ties.
    orderBy: [{ watchedAt: "desc" }, { createdAt: "desc" }],
    take: limit,
    select: {
      id: true,
      watchedAt: true,
      source: true,
      episodeId: true,
      mediaItem: { select: { id: true, mediaType: true, title: true, posterPath: true } },
      episode: { select: { seasonNumber: true, episodeNumber: true, title: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    kind: r.episodeId ? "episode" : "movie",
    mediaItemId: r.mediaItem.id,
    mediaType: r.mediaItem.mediaType === "movie" ? "movie" : "tv",
    title: r.mediaItem.title,
    posterPath: r.mediaItem.posterPath,
    seasonNumber: r.episode?.seasonNumber ?? null,
    episodeNumber: r.episode?.episodeNumber ?? null,
    episodeTitle: r.episode?.title ?? null,
    watchedAt: r.watchedAt,
    source: r.source,
  }));
}
