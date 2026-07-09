import { tmdbImageUrl } from "@/lib/tmdb";

// Resolve a stored posterPath to a renderable URL, regardless of source. TMDB rows store a bare path (e.g.
// "/abc.jpg") that needs the TMDB base + a size token; TVDB rows store a full artworks.thetvdb.com URL, which is
// used as-is. Both hosts are whitelisted in next.config `remotePatterns`.
export function posterUrl(pathOrUrl: string | null | undefined, size = "w500"): string | null {
  if (!pathOrUrl) return null;
  if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl;
  return tmdbImageUrl(pathOrUrl, size);
}
