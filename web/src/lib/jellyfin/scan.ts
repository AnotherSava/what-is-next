import { needsEpisodeFetch } from "@/lib/media/cursors";
import type { VideoSource } from "@/lib/media/source";
import type {
  CatalogIndex,
  EpisodePresenceSignal,
  LibraryCandidate,
  MediaScanner,
  PresenceRow,
  ScanCursors,
  ScanResult,
  UnaccountedItem,
  WatchedSignal,
} from "@/lib/media/types";
import { JellyfinClient } from "./client";
import { parseProviderIds, type JellyfinItem } from "./schemas";
import { deriveJellyfinSource } from "./source";

// The Jellyfin half of the media-server integration: turns a Jellyfin library into the provider-neutral scan
// result the shared writers consume (lib/media/apply). Read-only against Jellyfin, and free of Prisma — the
// catalog arrives as an injected index — so it's testable with a fake client and no database.
//
// Matching Jellyfin to the catalog is by external id (tmdb, then tvdb, then imdb) — never fuzzy title. Jellyfin's
// ProviderIds come from the same `[tmdbid-N]` / `[tvdbid-N]` naming its scanner reads, so this is exact.
//
// It mirrors the Plex scanner's cursor scheme (skip a show whose counts haven't moved) with one advantage: an
// episode's streams arrive with the episode list, so per-season source costs no extra requests.

export interface JellyfinScannerOptions {
  url: string;
  token: string;
  user: string; // Jellyfin account whose watch state to read
  allow: Set<string> | null; // library names to sync; null = all TV + movie libraries
  fetchImpl?: typeof fetch;
}

export function createJellyfinScanner(opts: JellyfinScannerOptions): MediaScanner {
  const jellyfin = new JellyfinClient({
    url: opts.url,
    token: opts.token,
    user: opts.user,
    fetchImpl: opts.fetchImpl,
  });
  return {
    provider: "jellyfin",
    scan: (catalog, cursors) => scanJellyfin(jellyfin, opts.allow, catalog, cursors),
    getServerId: () => jellyfin.getServerId(),
    watchedSignalsForCandidate: async (candidate, mediaItemId) =>
      candidate.mediaType === "movie"
        ? candidate.watched
          ? [{ mediaItemId, seasonNumber: null, episodeNumber: null, watchedAt: parseDate(candidate.watchedAt) }]
          : []
        : // A freshly-adopted show only needs watch state here; its per-episode presence lands on the next full
          // sync, when its cursor is set.
          watchedSignalsFromEpisodes(await jellyfin.getEpisodes(candidate.itemKey), mediaItemId),
  };
}

export async function scanJellyfin(
  jellyfin: JellyfinClient,
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

  for (const library of await jellyfin.getLibraries()) {
    if (allow && !allow.has(library.Name)) continue;
    const isShows = library.CollectionType === "tvshows";

    for (const item of await jellyfin.getLibraryItems(library.Id, isShows ? "Series" : "Movie")) {
      const ids = parseProviderIds(item);
      // An item Jellyfin couldn't match to any external id can't be resolved/tracked — never a candidate.
      const hasExternalId = ids.tmdbId != null || ids.tvdbId != null || ids.imdbId != null;
      const match = catalog.find(isShows ? "tv" : "movie", ids);

      if (isShows) {
        // Both counts come free with the Series row: RecursiveItemCount is the show's episode total and
        // UnplayedItemCount is how many of those are unwatched, so watched = total − unplayed.
        const totalEpisodes = item.RecursiveItemCount ?? 0;
        const watchedEpisodes = Math.max(0, totalEpisodes - (item.UserData?.UnplayedItemCount ?? totalEpisodes));
        if (match) {
          matchedShows++;
          matchedShowIds.push(match);
          matchedShowKeys[match] = item.Id;
          const seasons = await jellyfin.getSeasons(item.Id);
          const present = seasons.map((s) => s.IndexNumber).filter((n): n is number => n != null);
          // One episode fetch feeds the watch import, the presence snapshot and the season-source derivation;
          // needsEpisodeFetch decides when it's needed (see media/cursors). Cheaper than Plex's equivalent: the
          // episodes carry their own streams, so per-season source costs no further requests.
          next.watch[item.Id] = watchedEpisodes;
          next.presence[item.Id] = totalEpisodes;
          let seasonSource: Map<number, VideoSource> | null = null;
          if (needsEpisodeFetch(cursors, item.Id, watchedEpisodes, totalEpisodes, present.length)) {
            const episodes = await jellyfin.getEpisodes(item.Id);
            watchedSignals.push(...watchedSignalsFromEpisodes(episodes, match));
            episodePresence[match] = episodePresenceFromEpisodes(episodes);
            seasonSource = seasonSourceFromEpisodes(episodes);
          }
          // Mark the show sourced once its seasons have been derived; an unfetched show keeps its prior marker.
          if (seasonSource) next.source[item.Id] = present.length;
          else if (item.Id in cursors.source) next.source[item.Id] = cursors.source[item.Id];

          if (present.length > 0) {
            for (const n of present) {
              const src = seasonSource?.get(n);
              presenceRows.push({
                mediaItemId: match,
                seasonNumber: n,
                itemKey: item.Id,
                // Only when this season's source was derived this sync; otherwise omit so applyPresence inherits
                // the stored source rather than overwriting good data with nulls.
                ...(src
                  ? {
                      sourceDerived: true,
                      videoResolution: src.videoResolution,
                      hdrFormat: src.hdrFormat,
                      audioTracks: src.audioTracks.length ? JSON.stringify(src.audioTracks) : null,
                      subtitleLangs: src.subtitleLangs.length ? JSON.stringify(src.subtitleLangs) : null,
                    }
                  : {}),
              });
              presenceSeasons++;
            }
          } else {
            presenceRows.push({ mediaItemId: match, seasonNumber: null, itemKey: item.Id }); // present, seasons unknown
          }
        } else if (hasExternalId) {
          candidates.push({
            itemKey: item.Id,
            mediaType: "tv",
            title: item.Name,
            year: item.ProductionYear ?? null,
            tmdbId: ids.tmdbId,
            tvdbId: ids.tvdbId,
            imdbId: ids.imdbId,
            watched: watchedEpisodes > 0,
            watchedAt: item.UserData?.LastPlayedDate ?? null,
          });
        } else {
          unaccounted.push({
            itemKey: item.Id,
            mediaType: "tv",
            title: item.Name,
            year: item.ProductionYear ?? null,
          });
        }
      } else {
        if (match) {
          matchedMovies++;
          // The movie's streams arrived with the library listing, so its source costs no extra request.
          const source = deriveJellyfinSource(item.MediaSources);
          presenceRows.push({
            mediaItemId: match,
            seasonNumber: null,
            itemKey: item.Id,
            sourceDerived: true, // movies always re-derive source each sync, so they never inherit
            videoResolution: source.videoResolution,
            hdrFormat: source.hdrFormat,
            audioTracks: source.audioTracks.length ? JSON.stringify(source.audioTracks) : null,
            subtitleLangs: source.subtitleLangs.length ? JSON.stringify(source.subtitleLangs) : null,
          });
          // Continuous watched-sync: a watched movie already in the catalog gets a Jellyfin-sourced SeenEvent.
          if (item.UserData?.Played)
            watchedSignals.push({
              mediaItemId: match,
              seasonNumber: null,
              episodeNumber: null,
              watchedAt: parseDate(item.UserData.LastPlayedDate),
            });
        } else if (hasExternalId) {
          candidates.push({
            itemKey: item.Id,
            mediaType: "movie",
            title: item.Name,
            year: item.ProductionYear ?? null,
            tmdbId: ids.tmdbId,
            tvdbId: ids.tvdbId,
            imdbId: ids.imdbId,
            watched: item.UserData?.Played === true,
            watchedAt: item.UserData?.LastPlayedDate ?? null,
          });
        } else {
          unaccounted.push({
            itemKey: item.Id,
            mediaType: "movie",
            title: item.Name,
            year: item.ProductionYear ?? null,
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
    cursors: next,
    matchedShowIds,
    matchedShowKeys,
    episodePresence,
    unaccounted,
  };
}

// Turn a show's episode list into watched signals — the played ones (ParentIndexNumber = season, IndexNumber =
// episode).
function watchedSignalsFromEpisodes(episodes: JellyfinItem[], mediaItemId: string): WatchedSignal[] {
  const out: WatchedSignal[] = [];
  for (const e of episodes) {
    if (e.UserData?.Played && e.ParentIndexNumber != null && e.IndexNumber != null)
      out.push({
        mediaItemId,
        seasonNumber: e.ParentIndexNumber,
        episodeNumber: e.IndexNumber,
        watchedAt: parseDate(e.UserData.LastPlayedDate),
      });
  }
  return out;
}

// Turn a show's episode list into presence signals — every episode present in the library (season:episode).
function episodePresenceFromEpisodes(episodes: JellyfinItem[]): EpisodePresenceSignal[] {
  const out: EpisodePresenceSignal[] = [];
  for (const e of episodes) {
    if (e.ParentIndexNumber != null && e.IndexNumber != null)
      out.push({ seasonNumber: e.ParentIndexNumber, episodeNumber: e.IndexNumber });
  }
  return out;
}

// Each season's source, from the episodes already fetched. A season's episodes almost always share one copy, so a
// representative episode stands for the season: the lowest-numbered one that actually has a file.
function seasonSourceFromEpisodes(episodes: JellyfinItem[]): Map<number, VideoSource> {
  const bySeason = new Map<number, JellyfinItem[]>();
  for (const e of episodes) {
    if (e.ParentIndexNumber == null) continue;
    const arr = bySeason.get(e.ParentIndexNumber);
    if (arr) arr.push(e);
    else bySeason.set(e.ParentIndexNumber, [e]);
  }
  const out = new Map<number, VideoSource>();
  for (const [season, eps] of bySeason) {
    const rep = [...eps]
      .sort((a, b) => (a.IndexNumber ?? Number.MAX_SAFE_INTEGER) - (b.IndexNumber ?? Number.MAX_SAFE_INTEGER))
      .find((e) => (e.MediaSources?.length ?? 0) > 0);
    if (rep) out.set(season, deriveJellyfinSource(rep.MediaSources));
  }
  return out;
}

// Jellyfin timestamps are ISO strings ("2025-09-18T17:19:33.0000000Z").
function parseDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}
