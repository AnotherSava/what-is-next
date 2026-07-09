// TMDB image handling (brief §4). We store poster/backdrop PATHS in the catalog and hotlink them. The base host
// is stable and whitelisted in next.config `remotePatterns`, so URL building uses a fixed base rather than the
// per-account size list from TMDB /configuration.

const STABLE_IMAGE_BASE = "https://image.tmdb.org/t/p/";

// Build a hotlink URL for a stored TMDB path. `size` is a TMDB size token (e.g. "w342", "w500", "original").
export function tmdbImageUrl(path: string | null | undefined, size = "w500"): string | null {
  if (!path) return null;
  return `${STABLE_IMAGE_BASE}${size}${path}`;
}
