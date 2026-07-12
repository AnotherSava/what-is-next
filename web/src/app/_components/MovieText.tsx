import Link from "next/link";
import { ratingsLine } from "@/lib/ratings";

// The movie card's text column, shared by /movies, Watch next, and Download so a movie reads identically wherever
// it appears: a title with an inline muted year, and an optional ratings line.

// The title line — title + inline "(year)" — linking to the movie page.
export function MovieTitleLink({
  movieId,
  title,
  releaseDate,
}: {
  movieId: string;
  title: string;
  releaseDate: string | null;
}) {
  const year = releaseDate ? releaseDate.slice(0, 4) : "";
  return (
    <Link href={`/movies/${movieId}`} className="block min-w-0 truncate font-medium hover:underline">
      {title} {year && <span className="font-normal text-[var(--color-muted)]">({year})</span>}
    </Link>
  );
}

// The director line — sits directly under the title. Truncates (director lists can be long); renders nothing when
// the movie has no director recorded.
export function MovieDirectorLine({ director }: { director: string | null }) {
  if (!director) return null;
  return <p className="mt-0.5 truncate text-xs text-[var(--color-muted)]">{director}</p>;
}

// The ratings line ("TMDB 8.4 · IMDB 8.8"). A source hidden in admin settings (showTmdb/showImdb false) is treated
// as absent, so the line collapses or omits just like a missing rating; renders nothing when there's nothing to
// show. Every caller pins it to the bottom of the card's text column, so it carries no margin of its own.
export function MovieRatingLine({
  tmdbRating,
  imdbRating,
  showTmdb,
  showImdb,
}: {
  tmdbRating: number | null;
  imdbRating: number | null;
  showTmdb: boolean;
  showImdb: boolean;
}) {
  const line = ratingsLine(showTmdb ? tmdbRating : null, showImdb ? imdbRating : null);
  if (!line) return null;
  return <p className="text-xs tabular-nums text-[var(--color-muted)]">{line}</p>;
}
