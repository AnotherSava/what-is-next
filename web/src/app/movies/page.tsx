import type { Metadata } from "next";
import { cookies } from "next/headers";
import { formatRuntime } from "@/lib/format";
import { MOVIE_SORT_COOKIE, parseMovieSort } from "@/lib/movieSort";
import { getMovies, type MovieSummary } from "@/lib/movies";
import { getWatchLinker } from "@/lib/media";
import { getDisplayedUser, getSessionUser, permissionsFor } from "@/lib/session";
import { MoviesView, type MovieCardData } from "./_components/MoviesView";

export const metadata: Metadata = { title: "Movies" };

export default async function MoviesPage() {
  const [sessionUser, displayedUser, cookieStore] = await Promise.all([
    getSessionUser(),
    getDisplayedUser(),
    cookies(),
  ]);
  const { canEdit } = permissionsFor(sessionUser, displayedUser);
  const [{ watched, watchlist }, watchLink] = await Promise.all([getMovies(displayedUser.id), getWatchLinker()]);
  // Seed the sort order from the persisted cookie so the server renders the chosen order (no re-sort flash on load).
  const initialSort = parseMovieSort(cookieStore.get(MOVIE_SORT_COOKIE)?.value);

  const toCard = (m: MovieSummary, list: "watchlist" | "watched"): MovieCardData => {
    const watch = watchLink(m.presence);
    return {
      id: m.id,
      slug: m.slug,
      title: m.title,
      posterPath: m.posterPath,
      watchUrl: watch?.url ?? null,
      watchOn: watch?.server ?? null,
      rating: m.imdbRating,
      isFavorite: m.isFavorite,
      list,
      year: m.releaseDate ? m.releaseDate.slice(0, 4) : "",
      director: m.director ?? "",
      runtime: formatRuntime(m.runtime),
      // "Watch/added date" sort key: watched → latest watch date (undated watches sink), planned → date added.
      sortDate: (list === "watched" ? m.watchedAt : m.addedAt)?.getTime() ?? null,
    };
  };

  const cards: MovieCardData[] = [
    ...watchlist.map((m) => toCard(m, "watchlist")),
    ...watched.map((m) => toCard(m, "watched")),
  ];

  return <MoviesView movies={cards} canFavorite={canEdit} initialSort={initialSort} />;
}
