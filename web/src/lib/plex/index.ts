// Public surface of the Plex integration. Import from "@/lib/plex".
export { PlexClient, PlexError, getPlex, isPlexConfigured } from "./client";
export { addPlexItems, applyPresence, scanPlex, type PlexSyncDeps, type PresenceRow, type ScanResult } from "./sync";
export { getShowPlexPresence, getShowsInPlex } from "./presence";
export { plexDeps, syncPlexPresence } from "./run";
export { parseGuids } from "./schemas";
