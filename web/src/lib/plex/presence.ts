import { getPrisma } from "@/lib/db";

// Read-side helpers for Plex presence badges (Plex integration). "In Plex" = the user has ANY PlexPresence row
// for that catalog item; season presence is the subset of rows with a seasonNumber. Explicit userId (§5a).

export async function getShowsInPlex(userId: string): Promise<Set<string>> {
  const rows = await getPrisma().plexPresence.findMany({
    where: { userId },
    select: { mediaItemId: true },
    distinct: ["mediaItemId"],
  });
  return new Set(rows.map((r) => r.mediaItemId));
}

// Presence for one show in a single query: whether it's in Plex at all + which seasons.
export async function getShowPlexPresence(
  userId: string,
  mediaItemId: string,
): Promise<{ inPlex: boolean; seasons: Set<number> }> {
  const rows = await getPrisma().plexPresence.findMany({
    where: { userId, mediaItemId },
    select: { seasonNumber: true },
  });
  const seasons = new Set<number>();
  for (const r of rows) if (r.seasonNumber != null) seasons.add(r.seasonNumber);
  return { inPlex: rows.length > 0, seasons };
}
