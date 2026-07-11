import type { PrismaClient } from "@/generated/prisma/client";
import { hydrateMovieByTmdbId, hydrateShowByTmdbId } from "@/lib/catalog";
import type { PlexCandidate } from "@/lib/settings";
import type { TmdbClient } from "@/lib/tmdb";
import type { PlexClient } from "./client";
import { parseGuids } from "./schemas";

// Plex sync core (Plex integration). Read-only against Plex; writes PlexPresence (full snapshot) + SeenEvent rows
// (source "plex") for watch state, plus — on explicit add — new UserMediaState rows. Explicit userId (brief §5a
// rule 1). Matching Plex to catalog is by external id (tmdb, then tvdb, then imdb) — never fuzzy title.
//
// Watched-state import runs on every sync for already-tracked (matched) items AND for freshly-added items. Both
// paths funnel through applyWatched (the single writer): additive-only, de-duped against existing SeenEvents,
// never deletes — so a Plex "unwatch" or a hand-marked app watch is never clobbered.

export interface PlexSyncDeps {
  prisma: PrismaClient;
  plex: PlexClient;
  tmdb: TmdbClient;
  userId: string;
}

export interface PresenceRow {
  mediaItemId: string;
  seasonNumber: number | null;
  plexRatingKey: string; // the show/movie's Plex ratingKey — lets the UI deep-link into Plex to watch it
}

// A watched item observed in Plex, to be reconciled into the SeenEvent log. seasonNumber/episodeNumber null = a
// movie; both set = a TV episode (resolved to an episodeId via the catalog inside applyWatched).
export interface WatchedSignal {
  mediaItemId: string;
  seasonNumber: number | null;
  episodeNumber: number | null;
  watchedAt: Date | null;
}

export interface ScanResult {
  matchedShows: number;
  matchedMovies: number;
  presenceSeasons: number;
  presenceRows: PresenceRow[];
  watchedSignals: WatchedSignal[];
  candidates: PlexCandidate[];
  // Per-show cursor: plexRatingKey → total watched-episode count observed this scan. Persisted and fed back on
  // the next sync so an unchanged show skips its /allLeaves fetch entirely (steady-state = zero episode fetches).
  watchCursor: Record<string, number>;
}

type MediaType = "tv" | "movie";

// Optional allowlist of Plex library titles to sync (PLEX_LIBRARIES, comma-separated). Unset = all TV+movie
// libraries. Lets the owner exclude libraries they don't want tracked (e.g. adult or book collections).
function libraryAllowlist(): Set<string> | null {
  const raw = process.env.PLEX_LIBRARIES;
  if (!raw) return null;
  const names = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return names.length > 0 ? new Set(names) : null;
}

// Build external-id → mediaItemId lookups per media type from the whole catalog.
async function catalogIndex(prisma: PrismaClient) {
  const items = await prisma.mediaItem.findMany({
    select: { id: true, mediaType: true, tmdbId: true, tvdbId: true, imdbId: true },
  });
  const empty = () => ({
    tmdb: new Map<number, string>(),
    tvdb: new Map<number, string>(),
    imdb: new Map<string, string>(),
  });
  const idx: Record<MediaType, ReturnType<typeof empty>> = { tv: empty(), movie: empty() };
  for (const it of items) {
    const mt: MediaType = it.mediaType === "movie" ? "movie" : "tv";
    if (it.tmdbId != null) idx[mt].tmdb.set(it.tmdbId, it.id);
    if (it.tvdbId != null) idx[mt].tvdb.set(it.tvdbId, it.id);
    if (it.imdbId) idx[mt].imdb.set(it.imdbId, it.id);
  }
  return idx;
}

export async function scanPlex(deps: PlexSyncDeps, watchCursor: Record<string, number> = {}): Promise<ScanResult> {
  const { prisma, plex } = deps;
  const idx = await catalogIndex(prisma);
  const allow = libraryAllowlist();

  const presenceRows: PresenceRow[] = [];
  const watchedSignals: WatchedSignal[] = [];
  const nextWatchCursor: Record<string, number> = {};
  const candidates: PlexCandidate[] = [];
  let matchedShows = 0;
  let matchedMovies = 0;
  let presenceSeasons = 0;

  for (const section of await plex.getSections()) {
    if (allow && !allow.has(section.title)) continue;
    const mediaType: MediaType = section.type === "show" ? "tv" : "movie";
    for (const item of await plex.getSectionItems(section.key)) {
      const ids = parseGuids(item);
      // An item Plex couldn't match to any external id can't be resolved/tracked — never a candidate.
      const hasExternalId = ids.tmdbId != null || ids.tvdbId != null || ids.imdbId != null;
      const match =
        (ids.tmdbId != null ? idx[mediaType].tmdb.get(ids.tmdbId) : undefined) ??
        (ids.tvdbId != null ? idx[mediaType].tvdb.get(ids.tvdbId) : undefined) ??
        (ids.imdbId ? idx[mediaType].imdb.get(ids.imdbId) : undefined) ??
        null;

      if (mediaType === "tv") {
        const seasons = await plex.getShowSeasons(item.ratingKey);
        const present = seasons.map((s) => s.index);
        const watchedLeaves = seasons.reduce((n, s) => n + (s.viewedLeafCount ?? 0), 0);
        if (match) {
          matchedShows++;
          if (present.length > 0) {
            for (const n of present) {
              presenceRows.push({ mediaItemId: match, seasonNumber: n, plexRatingKey: item.ratingKey });
              presenceSeasons++;
            }
          } else {
            presenceRows.push({ mediaItemId: match, seasonNumber: null, plexRatingKey: item.ratingKey }); // present, seasons unknown
          }
          // Continuous watched-sync for this already-tracked show. Skip the per-show /allLeaves fetch unless the
          // show's total watched-episode count changed since the last sync — so a steady-state sync does zero
          // episode fetches. The count is free (getShowSeasons is fetched anyway for presence). Trade-off: an
          // unwatch+watch that nets the same total is missed until the next real change (rare; additive-only
          // never loses already-imported data).
          nextWatchCursor[item.ratingKey] = watchedLeaves;
          if (watchedLeaves > 0 && watchedLeaves !== watchCursor[item.ratingKey])
            watchedSignals.push(...(await collectShowWatchedSignals(plex, item.ratingKey, match)));
        } else if (hasExternalId) {
          candidates.push({
            plexRatingKey: item.ratingKey,
            mediaType: "tv",
            title: item.title,
            year: item.year ?? null,
            tmdbId: ids.tmdbId,
            tvdbId: ids.tvdbId,
            imdbId: ids.imdbId,
            plexWatched: watchedLeaves > 0,
            lastViewedAt: item.lastViewedAt ?? null,
          });
        }
      } else {
        if (match) {
          matchedMovies++;
          presenceRows.push({ mediaItemId: match, seasonNumber: null, plexRatingKey: item.ratingKey });
          // Continuous watched-sync: a watched movie already in the catalog gets a plex-sourced SeenEvent.
          if ((item.viewCount ?? 0) > 0)
            watchedSignals.push({
              mediaItemId: match,
              seasonNumber: null,
              episodeNumber: null,
              watchedAt: epochToDate(item.lastViewedAt),
            });
        } else if (hasExternalId) {
          candidates.push({
            plexRatingKey: item.ratingKey,
            mediaType: "movie",
            title: item.title,
            year: item.year ?? null,
            tmdbId: ids.tmdbId,
            tvdbId: ids.tvdbId,
            imdbId: ids.imdbId,
            plexWatched: (item.viewCount ?? 0) > 0,
            lastViewedAt: item.lastViewedAt ?? null,
          });
        }
      }
    }
  }

  return {
    matchedShows,
    matchedMovies,
    presenceSeasons,
    presenceRows,
    watchedSignals,
    candidates,
    watchCursor: nextWatchCursor,
  };
}

// Read a show's episodes from Plex and turn the watched ones into signals (parentIndex = season, index = episode).
async function collectShowWatchedSignals(
  plex: PlexClient,
  plexRatingKey: string,
  mediaItemId: string,
): Promise<WatchedSignal[]> {
  const episodes = await plex.getShowEpisodes(plexRatingKey);
  const out: WatchedSignal[] = [];
  for (const e of episodes) {
    if ((e.viewCount ?? 0) > 0 && e.parentIndex != null && e.index != null)
      out.push({
        mediaItemId,
        seasonNumber: e.parentIndex,
        episodeNumber: e.index,
        watchedAt: epochToDate(e.lastViewedAt),
      });
  }
  return out;
}

// The single writer for Plex watch state: resolve each signal to the catalog, skip any already logged OR the user
// has explicitly suppressed (unmarked in-app), and insert the rest as source "plex". Additive-only and idempotent
// — re-running inserts nothing new. Returns rows created.
export async function applyWatched(prisma: PrismaClient, userId: string, signals: WatchedSignal[]): Promise<number> {
  if (signals.length === 0) return 0;
  const toCreate: {
    userId: string;
    mediaItemId: string;
    episodeId: string | null;
    watchedAt: Date | null;
    source: string;
  }[] = [];

  // Suppressions: watches the user unmarked in-app, which Plex must not re-import (see suppression.ts).
  const itemIds = [...new Set(signals.map((s) => s.mediaItemId))];
  const suppressions = await prisma.plexWatchSuppression.findMany({
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
      toCreate.push({ userId, mediaItemId, episodeId, watchedAt: s.watchedAt, source: "plex" });
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
      toCreate.push({ userId, mediaItemId: s.mediaItemId, episodeId: null, watchedAt: s.watchedAt, source: "plex" });
    }
  }

  if (toCreate.length > 0) await prisma.seenEvent.createMany({ data: toCreate });
  return toCreate.length;
}

// Replace the whole presence set for the user (a sync is a full snapshot).
export async function applyPresence(prisma: PrismaClient, userId: string, rows: PresenceRow[]): Promise<void> {
  await prisma.plexPresence.deleteMany({ where: { userId } });
  if (rows.length > 0) {
    await prisma.plexPresence.createMany({
      data: rows.map((r) => ({
        userId,
        mediaItemId: r.mediaItemId,
        seasonNumber: r.seasonNumber,
        plexRatingKey: r.plexRatingKey,
      })),
    });
  }
}

// Add selected Plex-only titles to your list: hydrate from TMDB, create UserMediaState, import Plex watched
// state (source "plex"). Only for items NOT already tracked, so TV Time history is never touched.
export async function addPlexItems(
  deps: PlexSyncDeps,
  candidates: PlexCandidate[],
): Promise<{ added: number; failed: string[] }> {
  const { prisma, userId } = deps;
  let added = 0;
  const failed: string[] = [];
  for (const c of candidates) {
    try {
      const mediaItemId = await resolveAndHydrate(deps, c);
      if (!mediaItemId) {
        failed.push(c.title);
        continue;
      }
      // Adopting a Plex title puts it on your list; watched vs planned is derived from the imported watch log.
      await prisma.userMediaState.upsert({
        where: { userId_mediaItemId: { userId, mediaItemId } },
        create: { userId, mediaItemId, wantToWatch: true },
        update: {}, // never clobber an existing intent
      });
      await importPlexWatched(deps, c, mediaItemId);
      added++;
    } catch {
      failed.push(c.title);
    }
  }
  return { added, failed };
}

async function resolveAndHydrate(deps: PlexSyncDeps, c: PlexCandidate): Promise<string | null> {
  const { prisma, tmdb } = deps;
  let tmdbId = c.tmdbId;
  const pick = (f: { tv_results: { id: number }[]; movie_results: { id: number }[] }) =>
    (c.mediaType === "tv" ? f.tv_results[0]?.id : f.movie_results[0]?.id) ?? null;
  if (tmdbId == null && c.imdbId) tmdbId = pick(await tmdb.findByImdb(c.imdbId));
  if (tmdbId == null && c.tvdbId != null) tmdbId = pick(await tmdb.findByTvdb(c.tvdbId));
  if (tmdbId == null) return null;
  return c.mediaType === "tv" ? hydrateShowByTmdbId(prisma, tmdb, tmdbId) : hydrateMovieByTmdbId(prisma, tmdb, tmdbId);
}

// Import Plex watch state for a single freshly-added candidate, via the shared writer (applyWatched).
async function importPlexWatched(deps: PlexSyncDeps, c: PlexCandidate, mediaItemId: string): Promise<void> {
  const { prisma, plex, userId } = deps;
  const signals: WatchedSignal[] =
    c.mediaType === "movie"
      ? c.plexWatched
        ? [{ mediaItemId, seasonNumber: null, episodeNumber: null, watchedAt: epochToDate(c.lastViewedAt) }]
        : []
      : await collectShowWatchedSignals(plex, c.plexRatingKey, mediaItemId);
  await applyWatched(prisma, userId, signals);
}

function epochToDate(epochSeconds: number | null | undefined): Date | null {
  return epochSeconds ? new Date(epochSeconds * 1000) : null;
}
