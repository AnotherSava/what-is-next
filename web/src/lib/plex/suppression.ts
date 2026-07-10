import type { PrismaClient } from "@/generated/prisma/client";

// Explicit "not watched" overrides (Plex integration). When the user unmarks a watch in the app, we record a
// suppression so the Plex sync won't re-import that same watch (applyWatched skips suppressed signals). Marking it
// watched again clears the suppression. episodeId null = the movie itself; set = a specific episode.

// Record a suppression for an episode (episodeId set) or a movie (episodeId null). Idempotent.
export async function suppressWatch(
  prisma: PrismaClient,
  userId: string,
  mediaItemId: string,
  episodeId: string | null,
): Promise<void> {
  if (episodeId != null) {
    await prisma.plexWatchSuppression.upsert({
      where: { userId_mediaItemId_episodeId: { userId, mediaItemId, episodeId } },
      create: { userId, mediaItemId, episodeId },
      update: {},
    });
    return;
  }
  // Movie: episodeId is null, which SQLite treats as distinct in the unique index, so upsert can't match — guard.
  const exists = await prisma.plexWatchSuppression.findFirst({
    where: { userId, mediaItemId, episodeId: null },
    select: { id: true },
  });
  if (!exists) await prisma.plexWatchSuppression.create({ data: { userId, mediaItemId, episodeId: null } });
}

// Drop suppressions for these episodes (the user re-marked them watched). No-op on an empty list.
export async function clearEpisodeSuppressions(
  prisma: PrismaClient,
  userId: string,
  episodeIds: string[],
): Promise<void> {
  if (episodeIds.length === 0) return;
  await prisma.plexWatchSuppression.deleteMany({ where: { userId, episodeId: { in: episodeIds } } });
}

// Drop a movie's suppression (the user re-marked it watched).
export async function clearMovieSuppression(prisma: PrismaClient, userId: string, mediaItemId: string): Promise<void> {
  await prisma.plexWatchSuppression.deleteMany({ where: { userId, mediaItemId, episodeId: null } });
}
