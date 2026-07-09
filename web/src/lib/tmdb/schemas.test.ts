import { describe, expect, it } from "vitest";
import findMovie from "./fixtures/find-movie-by-imdb.json";
import findTv from "./fixtures/find-tv-by-tvdb.json";
import movieDetail from "./fixtures/movie-detail.json";
import searchTv from "./fixtures/search-tv.json";
import seasonDetail from "./fixtures/season-detail.json";
import tvDetail from "./fixtures/tv-detail.json";
import {
  tmdbFindSchema,
  tmdbMovieDetailSchema,
  tmdbSeasonDetailSchema,
  tmdbTvDetailSchema,
  tmdbTvSearchSchema,
} from "./schemas";

describe("tmdb schemas", () => {
  it("parses /find by tvdb → tv_results, movie_results empty", () => {
    const f = tmdbFindSchema.parse(findTv);
    expect(f.tv_results).toHaveLength(1);
    expect(f.tv_results[0].id).toBe(71446);
    expect(f.movie_results).toHaveLength(0);
  });

  it("parses /find by imdb → movie_results", () => {
    const f = tmdbFindSchema.parse(findMovie);
    expect(f.movie_results[0].id).toBe(1184918);
    expect(f.tv_results).toHaveLength(0);
  });

  it("parses tv detail incl status, external_ids, and a null-air-date specials season", () => {
    const t = tmdbTvDetailSchema.parse(tvDetail);
    expect(t.status).toBe("Ended");
    expect(t.external_ids?.tvdb_id).toBe(327417);
    expect(t.external_ids?.imdb_id).toBe("tt6468322");
    expect(t.seasons?.find((s) => s.season_number === 0)?.air_date).toBeNull();
    expect(t.number_of_episodes).toBe(41);
  });

  it("parses season detail episodes with air_date + runtime", () => {
    const s = tmdbSeasonDetailSchema.parse(seasonDetail);
    expect(s.episodes).toHaveLength(2);
    expect(s.episodes[0].air_date).toBe("2017-05-02");
    expect(s.episodes[0].runtime).toBe(47);
  });

  it("parses movie detail with imdb external id + runtime", () => {
    const m = tmdbMovieDetailSchema.parse(movieDetail);
    expect(m.external_ids?.imdb_id).toBe("tt29623480");
    expect(m.runtime).toBe(102);
    expect(m.status).toBe("Released");
  });

  it("parses search tv results", () => {
    const r = tmdbTvSearchSchema.parse(searchTv);
    expect(r.results).toHaveLength(2);
    expect(r.results[0].name).toBe("Breaking Bad");
    expect(r.total_results).toBe(2);
  });

  it("tolerates unknown/added fields (forward-compatible)", () => {
    const withExtra = { ...tvDetail, brand_new_field: "x", networks: [{ id: 1 }] };
    expect(() => tmdbTvDetailSchema.parse(withExtra)).not.toThrow();
  });

  it("rejects a response missing/typed-wrong required fields", () => {
    expect(() => tmdbTvDetailSchema.parse({})).toThrow(); // missing id + name
    expect(() => tmdbTvDetailSchema.parse({ id: "x", name: "y" })).toThrow(); // id must be a number
  });
});
