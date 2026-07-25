// Sort options for the /movies grid, shared by the server page (reads the persisted cookie to seed the initial
// order — no re-sort flash) and the client MoviesView / MovieSortMenu. Kept framework-free so it's safe on both
// sides of the server/client boundary. Each option fixes its own direction (matching the reference): rating and
// release year highest-first, title A–Z, and "recent activity" newest-first.

export type MovieSortKey = "rating" | "title" | "year" | "activity";

// Menu order mirrors the design reference's picker (rating, title, year, activity).
export const MOVIE_SORT_OPTIONS: { key: MovieSortKey; label: string }[] = [
  { key: "rating", label: "Rating" },
  { key: "title", label: "Title A–Z" },
  { key: "year", label: "Release year" },
  { key: "activity", label: "Recent activity" },
];

export const DEFAULT_MOVIE_SORT: MovieSortKey = "activity";
export const MOVIE_SORT_COOKIE = "wn-movie-sort";

const VALID = new Set<MovieSortKey>(MOVIE_SORT_OPTIONS.map((o) => o.key));

// Coerce a raw cookie value to a known sort key, falling back to the default for anything unrecognised.
export function parseMovieSort(value: string | undefined): MovieSortKey {
  return value && VALID.has(value as MovieSortKey) ? (value as MovieSortKey) : DEFAULT_MOVIE_SORT;
}

// The per-card fields the comparator reads — decoupled from the view's MovieCardData. `rating`/`year`/`sortDate`
// are null when unknown and always sink to the bottom (a movie with no rating shouldn't top a rating sort).
export interface MovieSortFields {
  title: string;
  rating: number | null; // IMDb score, 0–10
  year: number | null; // release year
  sortDate: number | null; // epoch ms: latest watch date (watched) or added date (planned)
}

// Pin the collation locale so title order is identical on the server (SSR) and the client (hydration): MoviesView
// sorts on both sides, and an unpinned localeCompare would use each host's default ICU locale — a mismatch there
// reshuffles the grid and trips a React hydration error.
const COLLATOR = new Intl.Collator("en");

// The comparator for the chosen sort key. The three value sorts (rating/year/activity) all run highest-first with
// unknowns (null) sinking to the bottom and title A–Z as the tiebreak, so equal values stay stable and readable.
export function compareMovies(key: MovieSortKey): (a: MovieSortFields, b: MovieSortFields) => number {
  const byTitle = (a: MovieSortFields, b: MovieSortFields) => COLLATOR.compare(a.title, b.title);
  if (key === "title") return byTitle;
  const value: (m: MovieSortFields) => number | null =
    key === "rating" ? (m) => m.rating : key === "year" ? (m) => m.year : (m) => m.sortDate;
  return (a, b) => (value(b) ?? -Infinity) - (value(a) ?? -Infinity) || byTitle(a, b);
}
