import { describe, expect, it } from "vitest";
import {
  parseGuids,
  plexEpisodesResponseSchema,
  plexItemsResponseSchema,
  plexSeasonsResponseSchema,
  plexSectionsResponseSchema,
} from "./schemas";

describe("parseGuids", () => {
  it("extracts tmdb / tvdb / imdb from the Guid array", () => {
    const g = parseGuids({ Guid: [{ id: "imdb://tt0944947" }, { id: "tmdb://1399" }, { id: "tvdb://121361" }] });
    expect(g).toEqual({ tmdbId: 1399, tvdbId: 121361, imdbId: "tt0944947" });
  });
  it("handles partial and missing guids", () => {
    expect(parseGuids({ Guid: [{ id: "imdb://tt1" }] })).toEqual({ tmdbId: null, tvdbId: null, imdbId: "tt1" });
    expect(parseGuids({ Guid: [] })).toEqual({ tmdbId: null, tvdbId: null, imdbId: null });
    expect(parseGuids({})).toEqual({ tmdbId: null, tvdbId: null, imdbId: null });
  });
  it("ignores malformed guid strings", () => {
    expect(parseGuids({ Guid: [{ id: "garbage" }, { id: "tmdb://" }] })).toEqual({
      tmdbId: null,
      tvdbId: null,
      imdbId: null,
    });
  });
});

describe("plex response schemas", () => {
  it("parses sections and keeps the MediaContainer shape", () => {
    const r = plexSectionsResponseSchema.parse({
      MediaContainer: { Directory: [{ key: "2", type: "show", title: "TV Shows" }] },
    });
    expect(r.MediaContainer.Directory[0].type).toBe("show");
  });
  it("parses items with guids + watch state, tolerating missing Metadata", () => {
    const r = plexItemsResponseSchema.parse({
      MediaContainer: {
        Metadata: [{ ratingKey: "1", type: "movie", title: "X", year: 2020, viewCount: 1, Guid: [{ id: "tmdb://5" }] }],
      },
    });
    expect(r.MediaContainer.Metadata[0].viewCount).toBe(1);
    expect(plexItemsResponseSchema.parse({ MediaContainer: {} }).MediaContainer.Metadata).toEqual([]);
  });
  it("parses seasons (index) and episodes (parentIndex/index/viewCount)", () => {
    const s = plexSeasonsResponseSchema.parse({
      MediaContainer: { Metadata: [{ ratingKey: "9", index: 1, leafCount: 10, viewedLeafCount: 4 }] },
    });
    expect(s.MediaContainer.Metadata[0].index).toBe(1);
    const e = plexEpisodesResponseSchema.parse({
      MediaContainer: { Metadata: [{ parentIndex: 1, index: 3, viewCount: 1, lastViewedAt: 1700000000 }] },
    });
    expect(e.MediaContainer.Metadata[0].parentIndex).toBe(1);
  });
});
