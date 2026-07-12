// The movie card's ratings line, shared by /movies, Watch next, and Download so the wording can't drift across
// surfaces. "TMDB 8.4 · IMDB 8.8" when both are known and differ (to one decimal); a single labelled figure when
// they agree or only one is known; null when neither is (the caller then omits the line). A stored 0 is a "no
// votes" sentinel — TMDB reports vote_average 0 for unrated titles and a real score is never 0 — so any
// non-positive value is treated as unrated. Callers apply the admin show/hide toggles by passing null for a hidden
// source, which folds into the same logic.
export function ratingsLine(tmdbRating: number | null, imdbRating: number | null): string | null {
  const tmdb = tmdbRating != null && tmdbRating > 0 ? tmdbRating.toFixed(1) : null;
  const imdb = imdbRating != null && imdbRating > 0 ? imdbRating.toFixed(1) : null;
  if (tmdb == null && imdb == null) return null;
  if (tmdb != null && imdb != null) return tmdb === imdb ? `IMDB ${imdb}` : `TMDB ${tmdb} · IMDB ${imdb}`;
  return tmdb != null ? `TMDB ${tmdb}` : `IMDB ${imdb}`;
}
