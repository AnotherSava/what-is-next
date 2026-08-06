// Public surface of the Plex provider. Everything provider-neutral — presence reads, watch links, suppression,
// sync orchestration — lives in "@/lib/media"; this module is only the Plex client and its scanner.
export { PlexClient, type PlexClientOptions } from "./client";
export { createPlexScanner, scanPlex, type PlexScannerOptions } from "./scan";
export { deriveVideoSource } from "./source";
export { parseGuids } from "./schemas";
