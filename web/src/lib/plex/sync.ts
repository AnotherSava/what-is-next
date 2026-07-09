import type { PrismaClient } from "@/generated/prisma/client";
import { hydrateMovieByTmdbId, hydrateShowByTmdbId } from "@/lib/catalog";
import type { PlexCandidate } from "@/lib/settings";
import type { TmdbClient } from "@/lib/tmdb";
import type { PlexClient } from "./client";
import { parseGuids } from "./schemas";

// Plex sync core (Plex integration). Read-only against Plex; writes only PlexPresence + (on explicit add) new
// UserMediaState/SeenEvent rows. Explicit userId (brief §5a rule 1). Matching Plex to catalog is by external id
// (tmdb, then tvdb, then imdb) — never fuzzy title.

export interface PlexSyncDeps {
  prisma: PrismaClient;
  plex: PlexClient;
  tmdb: TmdbClient;
  userId: string;
}

export interface PresenceRow {
  mediaItemId: string;
  seasonNumber: number | null;
}

export interface ScanResult {
  matchedShows: number;
  matchedMovies: number;
  presenceSeasons: number;
  presenceRows: PresenceRow[];
  candidates: PlexCandidate[];
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

export async function scanPlex(deps: PlexSyncDeps): Promise<ScanResult> {
  const { prisma, plex } = deps;
  const idx = await catalogIndex(prisma);
  const allow = libraryAllowlist();

  const presenceRows: PresenceRow[] = [];
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
        const watched = seasons.some((s) => (s.viewedLeafCount ?? 0) > 0);
        if (match) {
          matchedShows++;
          if (present.length > 0) {
            for (const n of present) {
              presenceRows.push({ mediaItemId: match, seasonNumber: n });
              presenceSeasons++;
            }
          } else {
            presenceRows.push({ mediaItemId: match, seasonNumber: null }); // present, seasons unknown
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
            plexWatched: watched,
            lastViewedAt: item.lastViewedAt ?? null,
          });
        }
      } else {
        if (match) {
          matchedMovies++;
          presenceRows.push({ mediaItemId: match, seasonNumber: null });
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

  return { matchedShows, matchedMovies, presenceSeasons, presenceRows, candidates };
}

// Replace the whole presence set for the user (a sync is a full snapshot).
export async function applyPresence(prisma: PrismaClient, userId: string, rows: PresenceRow[]): Promise<void> {
  await prisma.plexPresence.deleteMany({ where: { userId } });
  if (rows.length > 0) {
    await prisma.plexPresence.createMany({
      data: rows.map((r) => ({ userId, mediaItemId: r.mediaItemId, seasonNumber: r.seasonNumber })),
    });
  }
}

// Add selected Plex-only titles to tracking: hydrate from TMDB, create UserMediaState, import Plex watched
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
      const tracking = c.plexWatched ? (c.mediaType === "movie" ? "finished" : "watching") : "planned";
      await prisma.userMediaState.upsert({
        where: { userId_mediaItemId: { userId, mediaItemId } },
        create: { userId, mediaItemId, tracking },
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

async function importPlexWatched(deps: PlexSyncDeps, c: PlexCandidate, mediaItemId: string): Promise<void> {
  const { prisma, plex, userId } = deps;

  if (c.mediaType === "movie") {
    if (!c.plexWatched) return;
    const exists = await prisma.seenEvent.findFirst({
      where: { userId, mediaItemId, episodeId: null },
      select: { id: true },
    });
    if (exists) return;
    await prisma.seenEvent.create({
      data: { userId, mediaItemId, episodeId: null, watchedAt: epochToDate(c.lastViewedAt), source: "plex" },
    });
    return;
  }

  const episodes = await plex.getShowEpisodes(c.plexRatingKey);
  const watched = episodes.filter((e) => (e.viewCount ?? 0) > 0 && e.parentIndex != null && e.index != null);
  if (watched.length === 0) return;

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

  const toCreate: { userId: string; mediaItemId: string; episodeId: string; watchedAt: Date | null; source: string }[] =
    [];
  for (const e of watched) {
    const episodeId = byKey.get(`${e.parentIndex}:${e.index}`);
    if (!episodeId || have.has(episodeId)) continue;
    have.add(episodeId);
    toCreate.push({ userId, mediaItemId, episodeId, watchedAt: epochToDate(e.lastViewedAt), source: "plex" });
  }
  if (toCreate.length > 0) await prisma.seenEvent.createMany({ data: toCreate });
}

function epochToDate(epochSeconds: number | null | undefined): Date | null {
  return epochSeconds ? new Date(epochSeconds * 1000) : null;
}
