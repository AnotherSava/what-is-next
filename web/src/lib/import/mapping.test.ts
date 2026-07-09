import { describe, expect, it } from "vitest";
import listsSample from "./fixtures/lists-sample.json";
import moviesSample from "./fixtures/movies-sample.json";
import seriesSample from "./fixtures/series-sample.json";
import {
  episodeKey,
  flattenSeriesEpisodes,
  matchEpisodes,
  parseWatchedAt,
  trackingForMovie,
  trackingForSeriesStatus,
  type CatalogEpisodeRef,
} from "./mapping";
import { tvtimeListsFileSchema, tvtimeMovieFileSchema, tvtimeSeriesFileSchema } from "./schemas";

// Trimmed real-export snippets double as schema-validation fixtures.
const series = tvtimeSeriesFileSchema.parse(seriesSample);
const movies = tvtimeMovieFileSchema.parse(moviesSample);
const lists = tvtimeListsFileSchema.parse(listsSample);

describe("real export snippets validate against the schemas", () => {
  it("parses series / movies / lists without throwing", () => {
    expect(series.length).toBeGreaterThan(0);
    expect(movies.length).toBeGreaterThan(0);
    expect(lists[0].items.length).toBe(5);
  });
});

describe("trackingForSeriesStatus", () => {
  it("collapses up_to_date and continuing to watching", () => {
    expect(trackingForSeriesStatus("up_to_date")).toBe("watching");
    expect(trackingForSeriesStatus("continuing")).toBe("watching");
  });
  it("maps not_started_yet → planned, stopped → stopped", () => {
    expect(trackingForSeriesStatus("not_started_yet")).toBe("planned");
    expect(trackingForSeriesStatus("stopped")).toBe("stopped");
  });
});

describe("trackingForMovie", () => {
  it("watched → finished, unwatched → planned", () => {
    expect(trackingForMovie({ is_watched: true })).toBe("finished");
    expect(trackingForMovie({ is_watched: false })).toBe("planned");
  });
});

describe("flattenSeriesEpisodes", () => {
  const money = series.find((s) => s.title === "Money Heist")!;

  it("propagates the season number onto each episode ref", () => {
    const flat = flattenSeriesEpisodes(money);
    const totalEpisodes = money.seasons.reduce((n, s) => n + s.episodes.length, 0);
    expect(flat).toHaveLength(totalEpisodes);
    // Every ref's seasonNumber matches one of the source seasons.
    const seasonNumbers = new Set(money.seasons.map((s) => s.number));
    expect(flat.every((e) => seasonNumbers.has(e.seasonNumber))).toBe(true);
  });

  it("carries watched flag, watchedAt, and tvdbId", () => {
    const flat = flattenSeriesEpisodes(money);
    const watched = flat.filter((e) => e.isWatched);
    // Money Heist sample has watched episodes with timestamps and TVDB ids.
    expect(watched.length).toBeGreaterThan(0);
    expect(watched.every((e) => typeof e.tvdbId === "number")).toBe(true);
  });
});

describe("matchEpisodes", () => {
  const catalog: CatalogEpisodeRef[] = [
    { id: "e-s1e1", seasonNumber: 1, episodeNumber: 1 },
    { id: "e-s1e2", seasonNumber: 1, episodeNumber: 2 },
    { id: "e-s2e1", seasonNumber: 2, episodeNumber: 1 },
  ];

  it("matches by (season, episode) and routes misses to unmatched", () => {
    const exportEps = [
      { seasonNumber: 1, episodeNumber: 1, isWatched: true, watchedAt: "2023-01-01T00:00:00Z", tvdbId: 1 },
      { seasonNumber: 2, episodeNumber: 1, isWatched: false, watchedAt: null, tvdbId: 2 },
      { seasonNumber: 9, episodeNumber: 9, isWatched: true, watchedAt: null, tvdbId: 3 }, // no catalog match
    ];
    const { matched, unmatched } = matchEpisodes(exportEps, catalog);
    expect(matched.map((m) => m.catalogEpisodeId)).toEqual(["e-s1e1", "e-s2e1"]);
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0].seasonNumber).toBe(9);
  });

  it("episodeKey is stable and collision-free across S/E", () => {
    expect(episodeKey(1, 2)).toBe("1:2");
    expect(episodeKey(1, 2)).not.toBe(episodeKey(12, 0));
  });
});

describe("parseWatchedAt", () => {
  it("parses a valid ISO timestamp", () => {
    expect(parseWatchedAt("2023-08-16T03:34:50Z")?.toISOString()).toBe("2023-08-16T03:34:50.000Z");
  });
  it("returns null for empty or unparseable input (seen, date unknown)", () => {
    expect(parseWatchedAt(null)).toBeNull();
    expect(parseWatchedAt(undefined)).toBeNull();
    expect(parseWatchedAt("not-a-date")).toBeNull();
  });
});
