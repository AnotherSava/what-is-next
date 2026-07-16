import type { Metadata } from "next";
import { formatRuntime } from "@/lib/format";
import { getMovies, type MovieSummary } from "@/lib/movies";
import { isPlexConfigured, plexWatchUrl } from "@/lib/plex";
import { getDisplayedUser, getSessionUser, permissionsFor } from "@/lib/session";
import { getPlexServerId } from "@/lib/settings";
import { MoviesView, type MovieCardData } from "./_components/MoviesView";

export const metadata: Metadata = { title: "Movies" };

export default async function MoviesPage() {
  const [sessionUser, displayedUser] = await Promise.all([getSessionUser(), getDisplayedUser()]);
  const { canEdit } = permissionsFor(sessionUser, displayedUser);
  const [{ watched, watchlist }, plexServerId] = await Promise.all([
    getMovies(displayedUser.id),
    isPlexConfigured() ? getPlexServerId() : Promise.resolve(null),
  ]);

  const toCard = (m: MovieSummary, list: "watchlist" | "watched"): MovieCardData => ({
    id: m.id,
    title: m.title,
    posterPath: m.posterPath,
    watchUrl: m.inPlex ? plexWatchUrl(plexServerId, m.plexRatingKey) : null,
    rating: m.imdbRating,
    isFavorite: m.isFavorite,
    list,
    year: m.releaseDate ? m.releaseDate.slice(0, 4) : "",
    director: m.director ?? "",
    runtime: formatRuntime(m.runtime),
  });

  const cards: MovieCardData[] = [
    ...watchlist.map((m) => toCard(m, "watchlist")),
    ...watched.map((m) => toCard(m, "watched")),
  ];

  return <MoviesView movies={cards} canFavorite={canEdit} />;
}
