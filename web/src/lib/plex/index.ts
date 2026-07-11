// Public surface of the Plex integration. Import from "@/lib/plex".
export { PlexClient, PlexError, getPlex, isPlexConfigured } from "./client";
export {
  addPlexItems,
  applyPresence,
  applyWatched,
  scanPlex,
  type PlexSyncDeps,
  type PresenceRow,
  type ScanResult,
  type WatchedSignal,
} from "./sync";
export { getPlexPresenceKeys, getShowPlexPresence } from "./presence";
export { plexWatchUrl, plexWebUrl } from "./link";
export { plexDeps, syncPlexPresence, syncPlexPresenceIfStale, viewSyncTtlMs } from "./run";
export { parseGuids } from "./schemas";
export { clearEpisodeSuppressions, clearMovieSuppression, suppressWatch } from "./suppression";
