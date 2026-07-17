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
export { getPlexEpisodePresence, getPlexPresenceKeys, getShowPlexPresence } from "./presence";
export { plexWatchUrl, plexWebUrl } from "./link";
export { plexDeps, syncPlexPresence, syncPlexPresenceIfStale, viewSyncTtlMs } from "./run";
export { plexSyncSummary } from "./summary";
export { parseGuids } from "./schemas";
export { clearEpisodeSuppressions, clearMovieSuppression, suppressWatch } from "./suppression";
