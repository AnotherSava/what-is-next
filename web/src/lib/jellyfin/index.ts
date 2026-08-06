// Public surface of the Jellyfin provider. Everything provider-neutral — presence reads, watch links, suppression,
// sync orchestration — lives in "@/lib/media"; this module is only the Jellyfin client and its scanner.
export { JellyfinClient, type JellyfinClientOptions } from "./client";
export { createJellyfinScanner, scanJellyfin, type JellyfinScannerOptions } from "./scan";
export { deriveJellyfinSource } from "./source";
export { parseProviderIds } from "./schemas";
