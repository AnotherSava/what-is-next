import { describe, expect, it } from "vitest";
import type { CatalogIndex, ScanCursors } from "@/lib/media/types";
import type { JellyfinClient } from "./client";
import { parseProviderIds } from "./schemas";
import { scanJellyfin } from "./scan";

// The Jellyfin scanner is Prisma-free — the catalog arrives as an injected index — so these tests need no database.
// The fake library mirrors the real server's shapes (verified against Jellyfin 10.11): one tracked show + one
// untracked show, one tracked movie + one untracked movie, and one file with no provider ids at all.

const EMPTY_CURSORS: ScanCursors = { watch: {}, presence: {}, source: {} };

const CATALOG: Record<string, string> = { "tv:100": "mi-show", "movie:200": "mi-movie" };

const catalog: CatalogIndex = {
  find(kind, ids) {
    return ids.tmdbId != null ? (CATALOG[`${kind}:${ids.tmdbId}`] ?? null) : null;
  },
};

const streams = (Width: number, Height: number) => [
  {
    MediaStreams: [
      { Type: "Video", Width, Height, VideoRangeType: "SDR" },
      { Type: "Audio", Language: "eng" },
      { Type: "Subtitle", Language: "eng" },
    ],
  },
];

function fakeJellyfin(overrides: Partial<JellyfinClient> = {}): JellyfinClient {
  return {
    async getServerId() {
      return "server-1";
    },
    async getLibraries() {
      return [
        { Id: "lib-tv", Name: "Shows", CollectionType: "tvshows" },
        { Id: "lib-movies", Name: "Movies", CollectionType: "movies" },
      ];
    },
    async getLibraryItems(libraryId: string) {
      if (libraryId === "lib-tv")
        return [
          {
            Id: "jf-show",
            Name: "Tracked Show",
            ProductionYear: 2020,
            ProviderIds: { Tmdb: "100" },
            RecursiveItemCount: 3,
            ChildCount: 1,
            UserData: { UnplayedItemCount: 1, LastPlayedDate: "2025-09-18T17:19:33.0000000Z" },
          },
          {
            Id: "jf-newshow",
            Name: "New Show",
            ProductionYear: 2021,
            ProviderIds: { Tmdb: "300", Tvdb: "999" },
            RecursiveItemCount: 2,
            UserData: { UnplayedItemCount: 2 },
          },
        ];
      return [
        {
          Id: "jf-movie",
          Name: "Tracked Movie",
          ProductionYear: 2019,
          ProviderIds: { Tmdb: "200" },
          UserData: { Played: true, LastPlayedDate: "2026-06-16T10:39:28.0000000Z" },
          MediaSources: streams(1920, 1080),
        },
        {
          Id: "jf-newmovie",
          Name: "New Movie",
          ProductionYear: 2022,
          ProviderIds: { Imdb: "tt999" },
          UserData: { Played: true, LastPlayedDate: "2026-01-02T00:00:00.0000000Z" },
          MediaSources: streams(1920, 1080),
        },
        { Id: "jf-untagged", Name: "Untagged File", ProductionYear: 2001, ProviderIds: {} },
      ];
    },
    async getSeasons() {
      return [{ Id: "jf-s1", IndexNumber: 1 }];
    },
    async getEpisodes() {
      return [
        {
          Id: "jf-e1",
          ParentIndexNumber: 1,
          IndexNumber: 1,
          UserData: { Played: true, LastPlayedDate: "2025-09-18T17:19:33.0000000Z" },
          MediaSources: streams(1920, 1080),
        },
        {
          Id: "jf-e2",
          ParentIndexNumber: 1,
          IndexNumber: 2,
          UserData: { Played: false },
          MediaSources: streams(1920, 1080),
        },
      ];
    },
    ...overrides,
  } as unknown as JellyfinClient;
}

const scan = (cursors: ScanCursors = EMPTY_CURSORS, client = fakeJellyfin()) =>
  scanJellyfin(client, null, catalog, cursors);

const cursors = (
  watch: Record<string, number>,
  presence: Record<string, number>,
  source: Record<string, number> = {},
): ScanCursors => ({ watch, presence, source });

describe("parseProviderIds", () => {
  it("reads tmdb/tvdb/imdb ids regardless of the casing a metadata plugin wrote", () => {
    expect(parseProviderIds({ ProviderIds: { Tmdb: "1399", Tvdb: "121361", Imdb: "tt0944947" } })).toEqual({
      tmdbId: 1399,
      tvdbId: 121361,
      imdbId: "tt0944947",
    });
    expect(parseProviderIds({ ProviderIds: { TMDB: "42" } }).tmdbId).toBe(42);
  });

  it("ignores unrelated and blank provider entries", () => {
    expect(parseProviderIds({ ProviderIds: { TmdbCollection: "77", Tmdb: "" } })).toEqual({
      tmdbId: null,
      tvdbId: null,
      imdbId: null,
    });
    expect(parseProviderIds({})).toEqual({ tmdbId: null, tvdbId: null, imdbId: null });
  });
});

describe("scanJellyfin", () => {
  it("matches tracked items by external id and offers the rest as candidates", async () => {
    const r = await scan();
    expect(r.matchedShows).toBe(1);
    expect(r.matchedMovies).toBe(1);
    expect(r.presenceSeasons).toBe(1);
    expect(r.candidates.map((c) => c.title).sort()).toEqual(["New Movie", "New Show"]);
    // A show is "watched" when any of its episodes are: total episodes minus the server's unplayed count.
    expect(r.candidates.find((c) => c.title === "New Show")?.watched).toBe(false); // 2 of 2 unplayed
    expect(r.candidates.find((c) => c.title === "New Movie")?.watched).toBe(true);
  });

  it("surfaces files with no provider ids as unaccounted, never as candidates", async () => {
    const r = await scan();
    expect(r.unaccounted).toEqual([{ itemKey: "jf-untagged", mediaType: "movie", title: "Untagged File", year: 2001 }]);
    expect(r.candidates.some((c) => c.itemKey === "jf-untagged")).toBe(false);
  });

  it("captures a movie's source from the library listing, with no follow-up request", async () => {
    let episodeFetches = 0;
    const client = fakeJellyfin({
      async getEpisodes() {
        episodeFetches++;
        return [];
      },
    } as Partial<JellyfinClient>);
    const r = await scanJellyfin(client, null, catalog, EMPTY_CURSORS);
    const movie = r.presenceRows.find((row) => row.mediaItemId === "mi-movie");
    expect(movie).toMatchObject({
      seasonNumber: null,
      itemKey: "jf-movie",
      sourceDerived: true,
      videoResolution: "1080",
      hdrFormat: null,
      audioTracks: '[{"lang":"English","code":"en","atmos":false}]',
      subtitleLangs: '["English"]',
    });
    expect(episodeFetches).toBe(1); // only the show needed one; the movie's streams came with the listing
  });

  it("derives each season's source from the episodes it already fetched", async () => {
    const r = await scan();
    expect(r.presenceRows.find((row) => row.mediaItemId === "mi-show" && row.seasonNumber === 1)).toMatchObject({
      itemKey: "jf-show",
      sourceDerived: true,
      videoResolution: "1080",
      audioTracks: '[{"lang":"English","code":"en","atmos":false}]',
    });
  });

  it("imports watch state for a tracked show's played episodes only", async () => {
    const r = await scan();
    expect(r.watchedSignals).toEqual(
      expect.arrayContaining([
        {
          mediaItemId: "mi-show",
          seasonNumber: 1,
          episodeNumber: 1,
          watchedAt: new Date("2025-09-18T17:19:33.000Z"),
        },
        {
          mediaItemId: "mi-movie",
          seasonNumber: null,
          episodeNumber: null,
          watchedAt: new Date("2026-06-16T10:39:28.000Z"),
        },
      ]),
    );
    // S1E2 is unplayed, so it contributes presence but no watch.
    expect(r.watchedSignals.filter((s) => s.mediaItemId === "mi-show")).toHaveLength(1);
    expect(r.episodePresence["mi-show"]).toEqual([
      { seasonNumber: 1, episodeNumber: 1 },
      { seasonNumber: 1, episodeNumber: 2 },
    ]);
  });

  it("derives its cursors from the counts the Series row already carries", async () => {
    const r = await scan();
    expect(r.cursors.presence["jf-show"]).toBe(3); // RecursiveItemCount
    expect(r.cursors.watch["jf-show"]).toBe(2); // 3 total − 1 unplayed
    expect(r.cursors.source["jf-show"]).toBe(1); // one season sourced
  });

  it("skips a show's episode fetch entirely when no count moved and its source is captured", async () => {
    let episodeFetches = 0;
    const client = fakeJellyfin();
    const inner = client.getEpisodes.bind(client);
    client.getEpisodes = async (id: string) => {
      episodeFetches++;
      return inner(id);
    };
    const r = await scanJellyfin(client, null, catalog, cursors({ "jf-show": 2 }, { "jf-show": 3 }, { "jf-show": 1 }));
    expect(episodeFetches).toBe(0);
    expect(r.watchedSignals.some((s) => s.mediaItemId === "mi-show")).toBe(false);
    expect(r.episodePresence["mi-show"]).toBeUndefined();
    // The season row still exists, just without a re-derived source — applyPresence inherits the stored one.
    const season = r.presenceRows.find((row) => row.mediaItemId === "mi-show" && row.seasonNumber === 1);
    expect(season?.sourceDerived).toBeUndefined();
    expect(r.cursors.source["jf-show"]).toBe(1); // marker carried forward, so it isn't re-seeded next run
  });

  it("re-fetches when a new episode arrives even though the watched count is unchanged", async () => {
    const client = fakeJellyfin();
    const r = await scanJellyfin(client, null, catalog, cursors({ "jf-show": 2 }, { "jf-show": 2 }, { "jf-show": 1 }));
    expect(r.episodePresence["mi-show"]).toHaveLength(2);
  });

  it("syncs only the allowed libraries when an allowlist is set", async () => {
    const r = await scanJellyfin(fakeJellyfin(), new Set(["Movies"]), catalog, EMPTY_CURSORS);
    expect(r.matchedMovies).toBe(1);
    expect(r.matchedShows).toBe(0);
    expect(r.presenceRows.every((row) => row.mediaItemId === "mi-movie")).toBe(true);
  });

  it("records show-level presence when the server reports no seasons", async () => {
    const client = fakeJellyfin({
      async getSeasons() {
        return [];
      },
    } as Partial<JellyfinClient>);
    const r = await scanJellyfin(client, null, catalog, EMPTY_CURSORS);
    expect(r.presenceRows.find((row) => row.mediaItemId === "mi-show")).toEqual({
      mediaItemId: "mi-show",
      seasonNumber: null,
      itemKey: "jf-show",
    });
    expect(r.presenceSeasons).toBe(0);
  });
});
