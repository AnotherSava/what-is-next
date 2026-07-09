// TVDB artwork handling. TVDB v4 image fields are normally absolute URLs on artworks.thetvdb.com, but some
// records carry a bare path (e.g. "/banners/..."). We normalise to a full URL so the stored posterPath renders
// directly (the generic posterUrl helper passes absolute URLs through unchanged). The host is whitelisted in
// next.config `remotePatterns`.

const TVDB_ARTWORK_BASE = "https://artworks.thetvdb.com";

export function tvdbImageUrl(image: string | null | undefined): string | null {
  if (!image) return null;
  if (/^https?:\/\//.test(image)) return image;
  return `${TVDB_ARTWORK_BASE}${image.startsWith("/") ? "" : "/"}${image}`;
}
