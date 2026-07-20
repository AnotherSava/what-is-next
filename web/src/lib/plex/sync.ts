import type { PrismaClient } from "@/generated/prisma/client";
import { hydrateMovieByTmdbId, hydrateShowByTmdbId } from "@/lib/catalog";
import type { PlexCandidate } from "@/lib/settings";
import type { TmdbClient } from "@/lib/tmdb";
import type { PlexClient } from "./client";
import { parseGuids, type PlexEpisode } from "./schemas";
import { deriveVideoSource } from "./source";

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
  videoResolution?: string | null; // movies only: source resolution ("4k"|"1080"|…) from Plex; absent for shows
  hdrFormat?: string | null; // movies only: combined HDR label ("Dolby Vision · HDR10"|…); null/absent = SDR
  audioTracks?: string | null; // movies only: audio languages as JSON [{lang,atmos}]; absent for shows
  subtitleLangs?: string | null; // movies only: subtitle languages as JSON string[]; absent for shows
}

// A watched item observed in Plex, to be reconciled into the SeenEvent log. seasonNumber/episodeNumber null = a
// movie; both set = a TV episode (resolved to an episodeId via the catalog inside applyWatched).
export interface WatchedSignal {
  mediaItemId: string;
  seasonNumber: number | null;
  episodeNumber: number | null;
  watchedAt: Date | null;
}

// An episode present in a show's Plex library, before catalog resolution — resolved to an episodeId inside
// applyEpisodePresence, mirroring how WatchedSignal defers its episodeId lookup.
export interface EpisodePresenceSignal {
  seasonNumber: number;
  episodeNumber: number;
}

// A Plex library item the sync can't reconcile: it matched no catalog entry AND carries no external id
// (tmdb/tvdb/imdb), so — unlike a candidate — it can't be auto-hydrated from TMDB and tracked. Almost always
// means Plex itself hasn't matched the file to a metadata agent (a "local" item). Surfaced for the admin so these
// otherwise-invisible files aren't silently dropped; the remedy is to fix the match in Plex.
export interface UnaccountedItem {
  plexRatingKey: string;
  mediaType: MediaType;
  title: string;
  year: number | null;
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
  // Per-show cursor: plexRatingKey → total episode count (leafCount) observed this scan. Same purpose as the watch
  // cursor, for the per-episode presence snapshot: an unchanged episode count means presence didn't move.
  presenceCursor: Record<string, number>;
  // Every matched TV show's mediaItemId this scan, whether or not its /allLeaves was fetched — lets
  // applyEpisodePresence drop presence rows for shows that fell out of the library.
  matchedShowIds: string[];
  // mediaItemId → the episodes present in Plex, only for shows re-fetched this scan (their leafCount changed).
  // Other still-matched shows are absent here and keep their existing presence rows.
  episodePresence: Record<string, EpisodePresenceSignal[]>;
  // Plex items in the scanned libraries that matched no catalog entry and have no external id — they can't be
  // auto-tracked (see UnaccountedItem). Surfaced so they aren't invisible; the admin decides what to do.
  unaccounted: UnaccountedItem[];
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

export async function scanPlex(
  deps: PlexSyncDeps,
  watchCursor: Record<string, number> = {},
  presenceCursor: Record<string, number> = {},
): Promise<ScanResult> {
  const { prisma, plex } = deps;
  const idx = await catalogIndex(prisma);
  const allow = libraryAllowlist();

  const presenceRows: PresenceRow[] = [];
  const watchedSignals: WatchedSignal[] = [];
  const nextWatchCursor: Record<string, number> = {};
  const nextPresenceCursor: Record<string, number> = {};
  const matchedShowIds: string[] = [];
  const episodePresence: Record<string, EpisodePresenceSignal[]> = {};
  const candidates: PlexCandidate[] = [];
  const unaccounted: UnaccountedItem[] = [];
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
        const totalLeaves = seasons.reduce((n, s) => n + (s.leafCount ?? 0), 0);
        if (match) {
          matchedShows++;
          matchedShowIds.push(match);
          if (present.length > 0) {
            for (const n of present) {
              presenceRows.push({ mediaItemId: match, seasonNumber: n, plexRatingKey: item.ratingKey });
              presenceSeasons++;
            }
          } else {
            presenceRows.push({ mediaItemId: match, seasonNumber: null, plexRatingKey: item.ratingKey }); // present, seasons unknown
          }
          // Continuous watched-sync + per-episode presence for this already-tracked show. Fetch /allLeaves once
          // when EITHER the show's watched-episode count OR its total episode count changed since the last sync —
          // that single fetch feeds both the watch import and the presence snapshot, so a steady-state sync (both
          // counts unchanged) does zero episode fetches. Both counts are free (getShowSeasons is fetched anyway).
          // Trade-off: a change that nets the same totals (an unwatch+watch, or swapping one file for another) is
          // missed until the next real move — rare, and presence/watch state are only additively corrected.
          nextWatchCursor[item.ratingKey] = watchedLeaves;
          nextPresenceCursor[item.ratingKey] = totalLeaves;
          const watchChanged = watchedLeaves > 0 && watchedLeaves !== watchCursor[item.ratingKey];
          const presenceChanged = totalLeaves !== presenceCursor[item.ratingKey];
          if (watchChanged || presenceChanged) {
            const episodes = await plex.getShowEpisodes(item.ratingKey);
            watchedSignals.push(...watchedSignalsFromEpisodes(episodes, match));
            episodePresence[match] = episodePresenceFromEpisodes(episodes);
          }
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
        } else {
          unaccounted.push({
            plexRatingKey: item.ratingKey,
            mediaType: "tv",
            title: item.title,
            year: item.year ?? null,
          });
        }
      } else {
        if (match) {
          matchedMovies++;
          // Capture the source's resolution + HDR for the movie page. One lightweight metadata call per matched
          // movie — the movie counterpart of getShowSeasons above (which shows already do unconditionally per sync).
          const source = deriveVideoSource(await plex.getItemMedia(item.ratingKey));
          presenceRows.push({
            mediaItemId: match,
            seasonNumber: null,
            plexRatingKey: item.ratingKey,
            videoResolution: source.videoResolution,
            hdrFormat: source.hdrFormat,
            audioTracks: source.audioTracks.length ? JSON.stringify(source.audioTracks) : null,
            subtitleLangs: source.subtitleLangs.length ? JSON.stringify(source.subtitleLangs) : null,
          });
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
        } else {
          unaccounted.push({
            plexRatingKey: item.ratingKey,
            mediaType: "movie",
            title: item.title,
            year: item.year ?? null,
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
    presenceCursor: nextPresenceCursor,
    matchedShowIds,
    episodePresence,
    unaccounted,
  };
}

// Turn a show's Plex episode list into watched signals — the watched ones (parentIndex = season, index = episode).
function watchedSignalsFromEpisodes(episodes: PlexEpisode[], mediaItemId: string): WatchedSignal[] {
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

// Turn a show's Plex episode list into presence signals — every episode present in the library (season:episode).
function episodePresenceFromEpisodes(episodes: PlexEpisode[]): EpisodePresenceSignal[] {
  const out: EpisodePresenceSignal[] = [];
  for (const e of episodes) {
    if (e.parentIndex != null && e.index != null) out.push({ seasonNumber: e.parentIndex, episodeNumber: e.index });
  }
  return out;
}

// Read a show's episodes from Plex and turn the watched ones into signals. Used by the freshly-added path, which
// only needs watch state (per-episode presence for a new add lands on the next full sync, when its cursor is set).
async function collectShowWatchedSignals(
  plex: PlexClient,
  plexRatingKey: string,
  mediaItemId: string,
): Promise<WatchedSignal[]> {
  return watchedSignalsFromEpisodes(await plex.getShowEpisodes(plexRatingKey), mediaItemId);
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

// Replace the whole presence set for the user (a sync is a full snapshot). Returns whether the set actually
// changed vs. what was stored — the on-view freshener uses this to refresh the page only on a real delta.
export async function applyPresence(prisma: PrismaClient, userId: string, rows: PresenceRow[]): Promise<boolean> {
  const existing = await prisma.plexPresence.findMany({
    where: { userId },
    select: {
      mediaItemId: true,
      seasonNumber: true,
      plexRatingKey: true,
      videoResolution: true,
      hdrFormat: true,
      audioTracks: true,
      subtitleLangs: true,
    },
  });
  // Include the source fields so a quality change (e.g. a 1080p file swapped for 4K, or a new audio track) also
  // counts as a delta and refreshes an open page, not just presence appearing/disappearing.
  const sig = (r: {
    mediaItemId: string;
    seasonNumber: number | null;
    plexRatingKey: string | null;
    videoResolution?: string | null;
    hdrFormat?: string | null;
    audioTracks?: string | null;
    subtitleLangs?: string | null;
  }) =>
    `${r.mediaItemId}|${r.seasonNumber}|${r.plexRatingKey}|${r.videoResolution ?? ""}|${r.hdrFormat ?? ""}|${r.audioTracks ?? ""}|${r.subtitleLangs ?? ""}`;
  const before = new Set(existing.map(sig));
  const after = new Set(rows.map(sig));
  const changed = before.size !== after.size || [...after].some((s) => !before.has(s));

  await prisma.plexPresence.deleteMany({ where: { userId } });
  if (rows.length > 0) {
    await prisma.plexPresence.createMany({
      data: rows.map((r) => ({
        userId,
        mediaItemId: r.mediaItemId,
        seasonNumber: r.seasonNumber,
        plexRatingKey: r.plexRatingKey,
        videoResolution: r.videoResolution ?? null,
        hdrFormat: r.hdrFormat ?? null,
        audioTracks: r.audioTracks ?? null,
        subtitleLangs: r.subtitleLangs ?? null,
      })),
    });
  }
  return changed;
}

// Reconcile the per-episode presence snapshot (Plex integration). Incremental, NOT a full snapshot like
// applyPresence: `refreshed` carries episodes-in-Plex only for the shows re-fetched this sync (their leafCount
// moved), so only those shows' rows are replaced; every other still-matched show keeps its existing rows. Rows for
// shows that dropped out of the library entirely (absent from `matchedShowIds`) are removed. season:episode is
// resolved to a catalog episodeId the same way applyWatched resolves watched signals — a pair the catalog doesn't
// know is skipped. Idempotent: a re-run with the same inputs deletes and re-inserts the identical rows.
export async function applyEpisodePresence(
  prisma: PrismaClient,
  userId: string,
  refreshed: Record<string, EpisodePresenceSignal[]>,
  matchedShowIds: string[],
): Promise<void> {
  // Drop presence for shows no longer in the library. Empty matched set = nothing tracked in Plex → clear all.
  if (matchedShowIds.length === 0) await prisma.plexEpisodePresence.deleteMany({ where: { userId } });
  else await prisma.plexEpisodePresence.deleteMany({ where: { userId, mediaItemId: { notIn: matchedShowIds } } });

  for (const [mediaItemId, signals] of Object.entries(refreshed)) {
    const catalog = await prisma.episode.findMany({
      where: { mediaItemId },
      select: { id: true, seasonNumber: true, episodeNumber: true },
    });
    const byKey = new Map(catalog.map((e) => [`${e.seasonNumber}:${e.episodeNumber}`, e.id]));
    const episodeIds = [
      ...new Set(
        signals.map((s) => byKey.get(`${s.seasonNumber}:${s.episodeNumber}`)).filter((id): id is string => id != null),
      ),
    ];
    // Replace this show's rows: clear the old set, then insert the fresh one.
    await prisma.plexEpisodePresence.deleteMany({ where: { userId, mediaItemId } });
    if (episodeIds.length > 0)
      await prisma.plexEpisodePresence.createMany({
        data: episodeIds.map((episodeId) => ({ userId, mediaItemId, episodeId })),
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
