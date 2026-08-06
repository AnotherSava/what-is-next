// Public surface of the media-server integration (Plex + Jellyfin). Import from "@/lib/media".
//
// Note for the provider modules (lib/plex, lib/jellyfin): import the deep paths ("@/lib/media/types",
// "@/lib/media/source", "@/lib/media/client") rather than this barrel — run.ts imports the providers, so a
// provider importing the barrel would close an import cycle.
export { MediaServerError } from "./client";
export {
  getEnabledProviders,
  getMediaServer,
  getMediaServers,
  isMediaServerEnabled,
  isUsable,
  libraryAllowlist,
  normalizeServerUrl,
  setMediaServer,
  type MediaServerConfig,
  type MediaServersConfig,
} from "./config";
export { adoptCandidates, type AdoptDeps } from "./adopt";
export {
  fetchConnectionOptions,
  formatLibraryList,
  parseLibraryList,
  type AccountOption,
  type ConnectionOptions,
  type LibraryOption,
} from "./options";
export { applyEpisodePresence, applyPresence, applyWatched } from "./apply";
export { buildCatalogIndex } from "./catalog";
export {
  getServerLinks,
  getWatchLinker,
  jellyfinWebUrl,
  plexWebUrl,
  watchTarget,
  type ServerLinks,
  type WatchLinker,
  type WatchTarget,
} from "./link";
export {
  getEpisodePresence,
  getMoviePresence,
  getPlayableEpisodeRefs,
  getPresenceRefs,
  getShowPresence,
  type MoviePresence,
  type SeasonSource,
  type ShowPresence,
} from "./presence";
export {
  addLibraryItems,
  buildScanner,
  lastSyncedAt,
  syncMediaServers,
  syncMediaServersIfStale,
  syncProvider,
  viewSyncTtlMs,
  type ProviderSyncResult,
  type SyncRunReport,
} from "./run";
export {
  collectAudioTracks,
  collectLangs,
  EMPTY_SOURCE,
  formatAudio,
  formatResolution,
  formatSubtitles,
  resolutionRank,
  resolutionToken,
  resolveLanguage,
  type AudioTrack,
  type VideoSource,
} from "./source";
export { clearEpisodeSuppressions, clearMovieSuppression, suppressWatch } from "./suppression";
export { syncSummary } from "./summary";
export {
  MEDIA_PROVIDERS,
  PROVIDER_LABEL,
  PROVIDER_PRIORITY,
  type CatalogIndex,
  type EpisodePresenceSignal,
  type LibraryCandidate,
  type MediaKind,
  type MediaProvider,
  type MediaScanner,
  type PresenceRef,
  type PresenceRow,
  type ScanCursors,
  type ScanResult,
  type UnaccountedItem,
  type WatchedSignal,
} from "./types";
