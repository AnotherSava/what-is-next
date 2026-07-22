// Public surface of the Plex integration. Import from "@/lib/plex".
export { PlexClient, PlexError, getPlex, isPlexConfigured } from "./client";
export {
  addPlexItems,
  applyEpisodePresence,
  applyPresence,
  applyWatched,
  scanPlex,
  type EpisodePresenceSignal,
  type PlexSyncDeps,
  type PresenceRow,
  type ScanResult,
  type UnaccountedItem,
  type WatchedSignal,
} from "./sync";
export {
  getMoviePlexPresence,
  getPlexEpisodePresence,
  getPlexPresenceKeys,
  getShowPlexPresence,
  type SeasonPlexSource,
} from "./presence";
export { type AudioTrack, formatAudio, formatResolution, formatSubtitles } from "./source";
export { plexWatchUrl, plexWebUrl } from "./link";
export { plexDeps, syncPlexPresence, syncPlexPresenceIfStale, viewSyncTtlMs } from "./run";
export { plexSyncSummary } from "./summary";
export { parseGuids } from "./schemas";
export { clearEpisodeSuppressions, clearMovieSuppression, suppressWatch } from "./suppression";
