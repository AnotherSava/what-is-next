import { needsEpisodeFetch } from "@/lib/media/cursors";
import type { VideoSource } from "@/lib/media/source";
import type {
  CatalogIndex,
  EpisodePresenceSignal,
  LibraryCandidate,
  MediaKind,
  MediaScanner,
  PresenceRow,
  ScanCursors,
  ScanResult,
  UnaccountedItem,
  WatchedSignal,
} from "@/lib/media/types";
import { PlexClient } from "./client";
import { parseGuids, type PlexEpisode } from "./schemas";
import { deriveVideoSource } from "./source";

// The Plex half of the media-server integration: turns a Plex library into the provider-neutral scan result the
// shared writers consume (lib/media/apply). Read-only against Plex, and free of Prisma — the catalog arrives as
// an injected index — so it's testable with a fake client and no database.
//
// Matching Plex to the catalog is by external id (tmdb, then tvdb, then imdb) — never fuzzy title.

export interface PlexScannerOptions {
  url: string;
  token: string;
  allow: Set<string> | null; // library titles to sync; null = all TV + movie libraries
  fetchImpl?: typeof fetch;
}

export function createPlexScanner(opts: PlexScannerOptions): MediaScanner {
  const plex = new PlexClient({ url: opts.url, token: opts.token, fetchImpl: opts.fetchImpl });
  return {
    provider: "plex",
    scan: (catalog, cursors) => scanPlex(plex, opts.allow, catalog, cursors),
    getServerId: () => plex.getMachineIdentifier(),
    watchedSignalsForCandidate: async (candidate, mediaItemId) =>
      candidate.mediaType === "movie"
        ? candidate.watched
          ? [{ mediaItemId, seasonNumber: null, episodeNumber: null, watchedAt: parseDate(candidate.watchedAt) }]
          : []
        : // A freshly-adopted show only needs watch state here; its per-episode presence lands on the next full
          // sync, when its cursor is set.
          watchedSignalsFromEpisodes(await plex.getShowEpisodes(candidate.itemKey), mediaItemId),
  };
}

export async function scanPlex(
  plex: PlexClient,
  allow: Set<string> | null,
  catalog: CatalogIndex,
  cursors: ScanCursors,
): Promise<ScanResult> {
  const presenceRows: PresenceRow[] = [];
  const watchedSignals: WatchedSignal[] = [];
  const next: ScanCursors = { watch: {}, presence: {}, source: {} };
  const matchedShowIds: string[] = [];
  const matchedShowKeys: Record<string, string> = {};
  const episodePresence: Record<string, EpisodePresenceSignal[]> = {};
  const candidates: LibraryCandidate[] = [];
  const unaccounted: UnaccountedItem[] = [];
  let matchedShows = 0;
  let matchedMovies = 0;
  let presenceSeasons = 0;

  for (const section of await plex.getSections()) {
    if (allow && !allow.has(section.title)) continue;
    const mediaType: MediaKind = section.type === "show" ? "tv" : "movie";
    for (const item of await plex.getSectionItems(section.key)) {
      const ids = parseGuids(item);
      // An item Plex couldn't match to any external id can't be resolved/tracked — never a candidate.
      const hasExternalId = ids.tmdbId != null || ids.tvdbId != null || ids.imdbId != null;
      const match = catalog.find(mediaType, ids);

      if (mediaType === "tv") {
        const seasons = await plex.getShowSeasons(item.ratingKey);
        const present = seasons.map((s) => s.index);
        const watchedLeaves = seasons.reduce((n, s) => n + (s.viewedLeafCount ?? 0), 0);
        const totalLeaves = seasons.reduce((n, s) => n + (s.leafCount ?? 0), 0);
        if (match) {
          matchedShows++;
          matchedShowIds.push(match);
          matchedShowKeys[match] = item.ratingKey;
          // Continuous watched-sync + per-episode presence + per-season source for this already-tracked show. One
          // /allLeaves fetch feeds all three, and needsEpisodeFetch decides when it's needed (see media/cursors).
          // When it does run, season source additionally fetches one representative episode's full detail per
          // season — /allLeaves carries resolution but no streams, so HDR/audio/subtitles need that extra call.
          next.watch[item.ratingKey] = watchedLeaves;
          next.presence[item.ratingKey] = totalLeaves;
          let seasonSource: Map<number, SeasonSource> | null = null;
          if (needsEpisodeFetch(cursors, item.ratingKey, watchedLeaves, totalLeaves, present.length)) {
            const episodes = await plex.getShowEpisodes(item.ratingKey);
            watchedSignals.push(...watchedSignalsFromEpisodes(episodes, match));
            episodePresence[match] = episodePresenceFromEpisodes(episodes);
            seasonSource = await seasonSourceFromEpisodes(plex, episodes);
          }
          // Carry the source cursor forward. Mark the show fully sourced only when EVERY season's full detail was
          // captured this sync — a degraded season (its episode-detail fetch failed) leaves the show un-seeded so the
          // next sync retries it. An already-seeded show keeps its marker (its degraded season inherits the stored
          // source, so no re-seed is needed); a still-matched-but-unfetched show keeps its prior marker too.
          if (seasonSource) {
            const complete = [...seasonSource.values()].every((s) => s.full);
            if (complete || item.ratingKey in cursors.source) next.source[item.ratingKey] = present.length;
          } else if (item.ratingKey in cursors.source) {
            next.source[item.ratingKey] = cursors.source[item.ratingKey];
          }
          if (present.length > 0) {
            for (const n of present) {
              const entry = seasonSource?.get(n);
              const src = entry?.source;
              presenceRows.push({
                mediaItemId: match,
                seasonNumber: n,
                itemKey: item.ratingKey,
                // Only when this season's FULL detail was captured this sync; otherwise omit so applyPresence
                // inherits the stored source — a degraded or absent fetch must never overwrite good data with a
                // resolution-only capture or nulls.
                ...(entry?.full
                  ? {
                      sourceDerived: true,
                      videoResolution: src?.videoResolution ?? null,
                      hdrFormat: src?.hdrFormat ?? null,
                      audioTracks: src && src.audioTracks.length ? JSON.stringify(src.audioTracks) : null,
                      subtitleLangs: src && src.subtitleLangs.length ? JSON.stringify(src.subtitleLangs) : null,
                    }
                  : {}),
              });
              presenceSeasons++;
            }
          } else {
            presenceRows.push({ mediaItemId: match, seasonNumber: null, itemKey: item.ratingKey }); // present, seasons unknown
          }
        } else if (hasExternalId) {
          candidates.push({
            itemKey: item.ratingKey,
            mediaType: "tv",
            title: item.title,
            year: item.year ?? null,
            tmdbId: ids.tmdbId,
            tvdbId: ids.tvdbId,
            imdbId: ids.imdbId,
            watched: watchedLeaves > 0,
            watchedAt: epochToISO(item.lastViewedAt),
          });
        } else {
          unaccounted.push({ itemKey: item.ratingKey, mediaType: "tv", title: item.title, year: item.year ?? null });
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
            itemKey: item.ratingKey,
            sourceDerived: true, // movies always re-derive source each sync, so they never inherit
            videoResolution: source.videoResolution,
            hdrFormat: source.hdrFormat,
            audioTracks: source.audioTracks.length ? JSON.stringify(source.audioTracks) : null,
            subtitleLangs: source.subtitleLangs.length ? JSON.stringify(source.subtitleLangs) : null,
          });
          // Continuous watched-sync: a watched movie already in the catalog gets a Plex-sourced SeenEvent.
          if ((item.viewCount ?? 0) > 0)
            watchedSignals.push({
              mediaItemId: match,
              seasonNumber: null,
              episodeNumber: null,
              watchedAt: epochToDate(item.lastViewedAt),
            });
        } else if (hasExternalId) {
          candidates.push({
            itemKey: item.ratingKey,
            mediaType: "movie",
            title: item.title,
            year: item.year ?? null,
            tmdbId: ids.tmdbId,
            tvdbId: ids.tvdbId,
            imdbId: ids.imdbId,
            watched: (item.viewCount ?? 0) > 0,
            watchedAt: epochToISO(item.lastViewedAt),
          });
        } else {
          unaccounted.push({ itemKey: item.ratingKey, mediaType: "movie", title: item.title, year: item.year ?? null });
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
    cursors: next,
    matchedShowIds,
    matchedShowKeys,
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

// A season's derived source, plus whether it's the FULL detail (the per-episode getItemMedia succeeded) or a
// degraded fallback. Only a full capture is ever stored or counted as seeded; a degraded one (the episode-detail
// fetch failed or returned nothing) is left to inherit the previously-stored source and retry next sync — so a
// transient Plex hiccup never overwrites good HDR/audio/subtitle data nor seals in a resolution-only capture.
interface SeasonSource {
  source: VideoSource;
  full: boolean;
}

// Derive each season's Plex source (resolution/HDR/audio/subtitles) from a show's fetched episodes. A season's
// episodes almost always share one copy, so a representative episode stands for the season: the lowest-numbered one
// with a file. /allLeaves' Media is lightweight (resolution but no streams), so full source comes from one extra
// per-episode metadata fetch (getItemMedia) — one call per season, only on the already-gated seed/change path.
async function seasonSourceFromEpisodes(plex: PlexClient, episodes: PlexEpisode[]): Promise<Map<number, SeasonSource>> {
  const bySeason = new Map<number, PlexEpisode[]>();
  for (const e of episodes) {
    if (e.parentIndex == null) continue;
    const arr = bySeason.get(e.parentIndex);
    if (arr) arr.push(e);
    else bySeason.set(e.parentIndex, [e]);
  }
  const out = new Map<number, SeasonSource>();
  for (const [season, eps] of bySeason) {
    const rep = [...eps]
      .sort((a, b) => (a.index ?? Number.MAX_SAFE_INTEGER) - (b.index ?? Number.MAX_SAFE_INTEGER))
      .find((e) => e.ratingKey || (e.Media?.length ?? 0) > 0);
    let media = rep?.Media ?? null; // lightweight /allLeaves Media (resolution only) — fallback
    let full = false;
    if (rep?.ratingKey) {
      try {
        const detail = await plex.getItemMedia(rep.ratingKey);
        if (detail.length) {
          media = detail; // full detail carries the streams /allLeaves omits (HDR/audio/subtitles)
          full = true;
        }
      } catch {
        // keep the lightweight fallback; full stays false so this season inherits/retries, never overwrites
      }
    }
    out.set(season, { source: deriveVideoSource(media), full });
  }
  return out;
}

function epochToDate(epochSeconds: number | null | undefined): Date | null {
  return epochSeconds ? new Date(epochSeconds * 1000) : null;
}

// Plex timestamps are Unix epoch SECONDS; candidates store an ISO string so both providers agree on the shape.
function epochToISO(epochSeconds: number | null | undefined): string | null {
  return epochToDate(epochSeconds)?.toISOString() ?? null;
}

function parseDate(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}
