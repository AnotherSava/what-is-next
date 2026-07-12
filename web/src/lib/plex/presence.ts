import { getPrisma } from "@/lib/db";

// Read-side helpers for Plex presence badges + watch links (Plex integration). "In Plex" = the user has ANY
// PlexPresence row for that catalog item; season presence is the subset of rows with a seasonNumber. Every row
// also carries the item's plexRatingKey, which — with the server machineIdentifier — builds a deep link to watch
// it (see link.ts). Explicit userId (§5a).

// mediaItemId → the item's Plex ratingKey (null for rows written before the column existed, until the next sync
// back-fills them). Membership in the map == "in Plex". Presence rows aren't media-typed, so this serves both
// shows and movies; callers key by their own item ids.
export async function getPlexPresenceKeys(userId: string): Promise<Map<string, string | null>> {
  const rows = await getPrisma().plexPresence.findMany({
    where: { userId },
    select: { mediaItemId: true, plexRatingKey: true },
  });
  const map = new Map<string, string | null>();
  for (const r of rows) {
    // A show has one row per season; prefer any non-null ratingKey over a null one.
    if (!map.has(r.mediaItemId) || (map.get(r.mediaItemId) == null && r.plexRatingKey != null)) {
      map.set(r.mediaItemId, r.plexRatingKey);
    }
  }
  return map;
}

// The set of episodeIds the user has present in their Plex library (Plex integration) — the per-episode counterpart
// of getPlexPresenceKeys. Membership == "this episode is in Plex". Written by the sync's applyEpisodePresence; the
// Download view checks aired-unwatched episodes against it to find what's missing.
export async function getPlexEpisodePresence(userId: string): Promise<Set<string>> {
  const rows = await getPrisma().plexEpisodePresence.findMany({ where: { userId }, select: { episodeId: true } });
  return new Set(rows.map((r) => r.episodeId));
}

// Presence for one show in a single query: which seasons are in Plex and the show's ratingKey (for a watch link).
export async function getShowPlexPresence(
  userId: string,
  mediaItemId: string,
): Promise<{ seasons: Set<number>; ratingKey: string | null }> {
  const rows = await getPrisma().plexPresence.findMany({
    where: { userId, mediaItemId },
    select: { seasonNumber: true, plexRatingKey: true },
  });
  const seasons = new Set<number>();
  let ratingKey: string | null = null;
  for (const r of rows) {
    if (r.seasonNumber != null) seasons.add(r.seasonNumber);
    if (r.plexRatingKey != null) ratingKey = r.plexRatingKey;
  }
  return { seasons, ratingKey };
}
