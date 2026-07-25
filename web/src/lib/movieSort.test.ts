import { describe, expect, it } from "vitest";
import {
  compareMovies,
  DEFAULT_MOVIE_SORT,
  MOVIE_SORT_OPTIONS,
  type MovieSortFields,
  type MovieSortKey,
  parseMovieSort,
} from "./movieSort";

// Pure comparator + cookie-value coercion for the /movies sort selector. Each value sort runs highest-first with
// unknowns (null) sinking to the bottom and Title A–Z as the tiebreak; title sort is a plain locale compare.

const M = (title: string, over: Partial<MovieSortFields> = {}): MovieSortFields => ({
  title,
  rating: null,
  year: null,
  sortDate: null,
  ...over,
});

const order = (key: MovieSortKey, items: MovieSortFields[]) => [...items].sort(compareMovies(key)).map((m) => m.title);

describe("compareMovies", () => {
  it("rating: highest first, nulls last, title A–Z tiebreak", () => {
    const items = [
      M("Low", { rating: 5.5 }),
      M("Unrated"),
      M("High", { rating: 8.9 }),
      M("TieB", { rating: 7 }),
      M("TieA", { rating: 7 }),
    ];
    expect(order("rating", items)).toEqual(["High", "TieA", "TieB", "Low", "Unrated"]);
  });

  it("year: newest first, nulls last, title A–Z tiebreak", () => {
    const items = [M("Old", { year: 1994 }), M("Undated"), M("New", { year: 2021 }), M("MidB", { year: 2005 }), M("MidA", { year: 2005 })];
    expect(order("year", items)).toEqual(["New", "MidA", "MidB", "Old", "Undated"]);
  });

  it("activity: most recent first, nulls last, title A–Z tiebreak", () => {
    const items = [M("Older", { sortDate: 100 }), M("Undated"), M("Newest", { sortDate: 900 }), M("SameB", { sortDate: 500 }), M("SameA", { sortDate: 500 })];
    expect(order("activity", items)).toEqual(["Newest", "SameA", "SameB", "Older", "Undated"]);
  });

  it("title: A–Z regardless of the other fields", () => {
    const items = [M("Charlie", { rating: 9 }), M("alpha", { rating: 1 }), M("Bravo", { year: 3000 })];
    // localeCompare is case-insensitive-ish: alpha sorts before Bravo before Charlie.
    expect(order("title", items)).toEqual(["alpha", "Bravo", "Charlie"]);
  });

  it("rating: a zero rating still ranks above an unknown (null) one", () => {
    expect(order("rating", [M("Unknown"), M("Zero", { rating: 0 })])).toEqual(["Zero", "Unknown"]);
  });
});

describe("parseMovieSort", () => {
  it("accepts every known key", () => {
    for (const o of MOVIE_SORT_OPTIONS) expect(parseMovieSort(o.key)).toBe(o.key);
  });

  it("falls back to the default for unknown / missing values", () => {
    expect(parseMovieSort(undefined)).toBe(DEFAULT_MOVIE_SORT);
    expect(parseMovieSort("")).toBe(DEFAULT_MOVIE_SORT);
    expect(parseMovieSort("bogus")).toBe(DEFAULT_MOVIE_SORT);
  });
});
