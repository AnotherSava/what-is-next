import type { PrismaClient } from "@/generated/prisma/client";
import type { EpisodePresenceSignal, MediaProvider, PresenceRow, WatchedSignal } from "./types";

// The write side of a media-server sync — the only code that turns a scan into rows. Every function is scoped to
// one (user, provider) pair, so Plex's sync can never delete Jellyfin's rows or vice versa, and every function is
// idempotent: re-running a scan with the same inputs produces the same table contents and creates no duplicates.
//
// Watch state is additive-only and never deletes: a server "unwatch", or a watch the user marked by hand, is
// never clobbered. Explicit userId throughout (brief §5a rule 1).

// The single writer for media-server watch state: resolve each signal to the catalog, skip any already logged OR
// that the user has explicitly suppressed (unmarked in-app), and insert the rest tagged with the provider that
// reported them. De-duping is by (item, episode) regardless of source, so when both servers report the same watch
// only the first one to sync creates a row. Returns rows created.
export async function applyWatched(
  prisma: PrismaClient,
  userId: string,
  provider: MediaProvider,
  signals: WatchedSignal[],
): Promise<number> {
  if (signals.length === 0) return 0;
  const toCreate: {
    userId: string;
    mediaItemId: string;
    episodeId: string | null;
    watchedAt: Date | null;
    source: string;
  }[] = [];

  // Suppressions: watches the user unmarked in-app, which no server may re-import (see suppression.ts).
  const itemIds = [...new Set(signals.map((s) => s.mediaItemId))];
  const suppressions = await prisma.watchSuppression.findMany({
    where: { userId, mediaItemId: { in: itemIds } },
    select: { mediaItemId: true, episodeId: true },
  });
  const suppressedEpisodes = new Set(suppressions.filter((s) => s.episodeId != null).map((s) => s.episodeId));
  const suppressedMovies = new Set(suppressions.filter((s) => s.episodeId == null).map((s) => s.mediaItemId));

  // Episodes: group by show, resolve season:episode → episodeId via the catalog, de-dup against existing events.
  const byItem = new Map<string, WatchedSignal[]>();
  for (const s of signals) {
    if (s.seasonNumber == null || s.episodeNumber == null) continue;
    const arr = byItem.get(s.mediaItemId);
    if (arr) arr.push(s);
    else byItem.set(s.mediaItemId, [s]);
  }
  for (const [mediaItemId, sigs] of byItem) {
    const catalog = await prisma.episode.findMany({
      where: { mediaItemId },
      select: { id: true, seasonNumber: true, episodeNumber: true },
    });
    const byKey = new Map(catalog.map((e) => [`${e.seasonNumber}:${e.episodeNumber}`, e.id]));
    const existing = await prisma.seenEvent.findMany({
      where: { userId, mediaItemId, episodeId: { not: null } },
      select: { episodeId: true },
    });
    const have = new Set(existing.map((e) => e.episodeId));
    for (const s of sigs) {
      const episodeId = byKey.get(`${s.seasonNumber}:${s.episodeNumber}`);
      if (!episodeId || have.has(episodeId) || suppressedEpisodes.has(episodeId)) continue;
      have.add(episodeId);
      toCreate.push({ userId, mediaItemId, episodeId, watchedAt: s.watchedAt, source: provider });
    }
  }

  // Movies: one SeenEvent per item (episodeId null); skip any already logged.
  const movieItems = [...new Set(signals.filter((s) => s.seasonNumber == null).map((s) => s.mediaItemId))];
  if (movieItems.length > 0) {
    const existing = await prisma.seenEvent.findMany({
      where: { userId, episodeId: null, mediaItemId: { in: movieItems } },
      select: { mediaItemId: true },
    });
    const have = new Set(existing.map((e) => e.mediaItemId));
    for (const s of signals) {
      if (s.seasonNumber != null || have.has(s.mediaItemId) || suppressedMovies.has(s.mediaItemId)) continue;
      have.add(s.mediaItemId);
      toCreate.push({ userId, mediaItemId: s.mediaItemId, episodeId: null, watchedAt: s.watchedAt, source: provider });
    }
  }

  if (toCreate.length > 0) await prisma.seenEvent.createMany({ data: toCreate });
  return toCreate.length;
}

// Replace this provider's whole presence set for the user (a scan is a full snapshot of ONE server). Returns
// whether the set actually changed vs. what was stored — the on-view freshener uses this to refresh the page only
// on a real delta.
export async function applyPresence(
  prisma: PrismaClient,
  userId: string,
  provider: MediaProvider,
  rows: PresenceRow[],
): Promise<boolean> {
  const existing = await prisma.mediaPresence.findMany({
    where: { userId, provider },
    select: {
      mediaItemId: true,
      seasonNumber: true,
      itemKey: true,
      videoResolution: true,
      hdrFormat: true,
      audioTracks: true,
      subtitleLangs: true,
    },
  });
  const key = (mediaItemId: string, seasonNumber: number | null) => `${mediaItemId}|${seasonNumber}`;
  // Source captured on a prior sync, keyed by row. A row whose source wasn't re-derived this sync (a TV season
  // whose episodes didn't move — see each scanner) inherits it, so the full-snapshot rebuild never nulls out a
  // season's stored source. Movies always set sourceDerived, so they never inherit.
  const priorSource = new Map(existing.map((r) => [key(r.mediaItemId, r.seasonNumber), r]));
  const resolved = rows.map((r) => {
    const prior = r.sourceDerived ? undefined : priorSource.get(key(r.mediaItemId, r.seasonNumber));
    return {
      mediaItemId: r.mediaItemId,
      seasonNumber: r.seasonNumber,
      itemKey: r.itemKey,
      videoResolution: (r.sourceDerived ? r.videoResolution : prior?.videoResolution) ?? null,
      hdrFormat: (r.sourceDerived ? r.hdrFormat : prior?.hdrFormat) ?? null,
      audioTracks: (r.sourceDerived ? r.audioTracks : prior?.audioTracks) ?? null,
      subtitleLangs: (r.sourceDerived ? r.subtitleLangs : prior?.subtitleLangs) ?? null,
    };
  });

  // Include the (effective, post-inherit) source fields so a quality change (e.g. a 1080p file swapped for 4K, or
  // a new audio track) also counts as a delta and refreshes an open page, not just presence appearing/disappearing.
  const sig = (r: {
    mediaItemId: string;
    seasonNumber: number | null;
    itemKey: string | null;
    videoResolution?: string | null;
    hdrFormat?: string | null;
    audioTracks?: string | null;
    subtitleLangs?: string | null;
  }) =>
    `${r.mediaItemId}|${r.seasonNumber}|${r.itemKey}|${r.videoResolution ?? ""}|${r.hdrFormat ?? ""}|${r.audioTracks ?? ""}|${r.subtitleLangs ?? ""}`;
  const before = new Set(existing.map(sig));
  const after = new Set(resolved.map(sig));
  const changed = before.size !== after.size || [...after].some((s) => !before.has(s));

  await prisma.mediaPresence.deleteMany({ where: { userId, provider } });
  if (resolved.length > 0) {
    await prisma.mediaPresence.createMany({ data: resolved.map((r) => ({ userId, provider, ...r })) });
  }
  return changed;
}

// Reconcile this provider's per-episode presence snapshot, returning the mediaItemIds whose episodes did NOT all
// resolve to the catalog. A show can be in the library with episodes the catalog doesn't know yet (a partially
// hydrated show, or a season TMDB hasn't filled in), and those signals are silently dropped here — so the caller
// must not let that show's cursor advance, or the gap seals permanently: the server's counts never move again, so
// the show is never re-fetched and those episodes stay missing forever.
//
// Incremental, NOT a full snapshot like applyPresence:
// `refreshed` carries episodes-in-library only for the shows re-fetched this sync (their episode count moved), so
// only those shows' rows are replaced; every other still-matched show keeps its existing rows. Rows for shows that
// dropped out of this server's library entirely (absent from `matchedShowIds`) are removed. season:episode is
// resolved to a catalog episodeId the same way applyWatched resolves watched signals — a pair the catalog doesn't
// know is skipped. Idempotent: a re-run with the same inputs deletes and re-inserts the identical rows.
export async function applyEpisodePresence(
  prisma: PrismaClient,
  userId: string,
  provider: MediaProvider,
  refreshed: Record<string, EpisodePresenceSignal[]>,
  matchedShowIds: string[],
): Promise<string[]> {
  const unresolved: string[] = [];
  // Drop presence for shows no longer in this server's library. Empty matched set = nothing tracked there → clear
  // all of this provider's rows (and only this provider's).
  if (matchedShowIds.length === 0) await prisma.mediaEpisodePresence.deleteMany({ where: { userId, provider } });
  else
    await prisma.mediaEpisodePresence.deleteMany({
      where: { userId, provider, mediaItemId: { notIn: matchedShowIds } },
    });

  for (const [mediaItemId, signals] of Object.entries(refreshed)) {
    const catalog = await prisma.episode.findMany({
      where: { mediaItemId },
      select: { id: true, seasonNumber: true, episodeNumber: true },
    });
    const byKey = new Map(catalog.map((e) => [`${e.seasonNumber}:${e.episodeNumber}`, e.id]));
    const resolved = signals.map((s) => byKey.get(`${s.seasonNumber}:${s.episodeNumber}`));
    if (resolved.some((id) => id == null)) unresolved.push(mediaItemId);
    const episodeIds = [...new Set(resolved.filter((id): id is string => id != null))];
    // Replace this show's rows for this provider: clear the old set, then insert the fresh one.
    await prisma.mediaEpisodePresence.deleteMany({ where: { userId, provider, mediaItemId } });
    if (episodeIds.length > 0)
      await prisma.mediaEpisodePresence.createMany({
        data: episodeIds.map((episodeId) => ({ userId, provider, mediaItemId, episodeId })),
      });
  }
  return unresolved;
}
