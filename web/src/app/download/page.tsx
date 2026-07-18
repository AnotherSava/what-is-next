import type { Metadata } from "next";
import { getDownloads, type DownloadMovie, type DownloadShow } from "@/lib/download";
import { downloadLinksFor, type DownloadSource } from "@/lib/downloadSources";
import { formatRuntime, formatSeasonRange } from "@/lib/format";
import { getDisplayedUser, getSessionUser, permissionsFor } from "@/lib/session";
import { getDownloadSources } from "@/lib/settings";
import {
  DownloadView,
  type DownloadMovieCard,
  type DownloadSection,
  type DownloadShowCard,
} from "./_components/DownloadView";

export const metadata: Metadata = { title: "Download" };

// "Download" — what you're tracking but don't have in Plex yet, rebuilt as the reference's grouped poster grids:
// Continue watching / Pick back up / Not started (shows), then Movies. Each poster reveals its configured download
// search links on hover. Read-only (nothing here is in Plex to play or mark).
export default async function DownloadPage() {
  const [sessionUser, displayedUser] = await Promise.all([getSessionUser(), getDisplayedUser()]);
  const { canEdit } = permissionsFor(sessionUser, displayedUser);
  const [{ movies, getBack, moreOf, notStarted }, sources] = await Promise.all([
    getDownloads(displayedUser.id),
    getDownloadSources(),
  ]);

  const showCard = (s: DownloadShow): DownloadShowCard => ({
    kind: "show",
    id: s.showId,
    slug: s.slug,
    title: s.title,
    posterPath: s.posterPath,
    rating: s.imdbRating,
    isFavorite: s.isFavorite,
    shelfMeta: formatSeasonRange(s.missingSeasons),
    dlOptions: dlLinks(sources, "shows", s.title),
  });
  const movieCard = (m: DownloadMovie): DownloadMovieCard => ({
    kind: "movie",
    id: m.movieId,
    slug: m.slug,
    title: m.title,
    posterPath: m.posterPath,
    rating: m.imdbRating,
    isFavorite: m.isFavorite,
    year: m.releaseDate ? m.releaseDate.slice(0, 4) : "",
    director: m.director ?? "",
    runtime: formatRuntime(m.runtime),
    dlOptions: dlLinks(sources, "movies", m.title),
  });

  const sections: DownloadSection[] = (
    [
      { key: "keep", label: "Continue watching", color: "#f5a524", kind: "shows", items: moreOf.map(showCard) },
      { key: "back", label: "Pick back up", color: "#7d8ca6", kind: "shows", items: getBack.map(showCard) },
      { key: "fresh", label: "Not started", color: "#8b8b96", kind: "shows", items: notStarted.map(showCard) },
      { key: "movies", label: "Movies", color: "#e5a00d", kind: "movies", items: movies.map(movieCard) },
    ] satisfies DownloadSection[]
  ).filter((s) => s.items.length > 0);

  const showCount = getBack.length + moreOf.length + notStarted.length;
  return <DownloadView sections={sections} showCount={showCount} movieCount={movies.length} canFavorite={canEdit} />;
}

function dlLinks(sources: DownloadSource[], kind: "shows" | "movies", title: string) {
  return downloadLinksFor(sources, kind, title).map((l) => ({ label: l.label, href: l.href }));
}
