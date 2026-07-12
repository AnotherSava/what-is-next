import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import type { TmdbClient } from "@/lib/tmdb";
import type { PlexClient } from "./client";
import { addPlexItems, applyEpisodePresence, applyPresence, applyWatched, scanPlex } from "./sync";
import { clearEpisodeSuppressions, clearMovieSuppression, suppressWatch } from "./suppression";

const MIGRATION_SQL = readdirSync(join("prisma", "migrations"))
  .filter((d) => /^\d+_/.test(d))
  .sort()
  .map((d) => readFileSync(join("prisma", "migrations", d, "migration.sql"), "utf-8"))
  .join(";\n");

function createDb() {
  const dbPath = join("prisma", `test-plex-${randomUUID()}.db`);
  const raw = new Database(dbPath);
  raw.exec(MIGRATION_SQL);
  raw.close();
  const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${dbPath.replace(/\\/g, "/")}` }) });
  return {
    prisma,
    cleanup: async () => {
      await prisma.$disconnect();
      for (const s of ["", "-journal", "-shm", "-wal"]) if (existsSync(dbPath + s)) rmSync(dbPath + s, { force: true });
    },
  };
}

// Fake Plex: 1 matched show + 1 candidate show, 1 matched movie + 1 candidate movie.
function fakePlex(): PlexClient {
  return {
    async getSections() {
      return [
        { key: "2", type: "show", title: "TV" },
        { key: "3", type: "movie", title: "Movies" },
      ];
    },
    async getSectionItems(key: string) {
      if (key === "2")
        return [
          { ratingKey: "s1", type: "show", title: "Tracked Show", year: 2020, Guid: [{ id: "tmdb://100" }] },
          {
            ratingKey: "s2",
            type: "show",
            title: "New Show",
            year: 2021,
            Guid: [{ id: "tmdb://300" }, { id: "tvdb://999" }],
          },
        ];
      return [
        {
          ratingKey: "m1",
          type: "movie",
          title: "Tracked Movie",
          year: 2019,
          viewCount: 1,
          lastViewedAt: 1_700_000_000,
          Guid: [{ id: "tmdb://200" }],
        },
        {
          ratingKey: "m2",
          type: "movie",
          title: "New Movie",
          year: 2022,
          viewCount: 1,
          lastViewedAt: 1_710_000_000,
          Guid: [{ id: "tmdb://400" }],
        },
      ];
    },
    async getShowSeasons(ratingKey: string) {
      if (ratingKey === "s1") return [{ ratingKey: "s1c1", index: 1, leafCount: 3, viewedLeafCount: 2 }];
      return [{ ratingKey: "s2c1", index: 1, leafCount: 2, viewedLeafCount: 1 }];
    },
    async getShowEpisodes() {
      return [
        { parentIndex: 1, index: 1, viewCount: 1, lastViewedAt: 1_710_000_000 },
        { parentIndex: 1, index: 2, viewCount: 0 },
      ];
    },
  } as unknown as PlexClient;
}

function fakeTmdb(): TmdbClient {
  return {
    async getTvDetail(id: number) {
      return {
        id,
        name: "New Show",
        status: "Returning Series",
        seasons: [{ season_number: 1 }],
        external_ids: { tvdb_id: 999 },
      };
    },
    async getSeasonDetail(_id: number, n: number) {
      return {
        season_number: n,
        episodes: [
          { id: 9001, episode_number: 1, season_number: n, air_date: "2021-01-01" },
          { id: 9002, episode_number: 2, season_number: n, air_date: "2021-01-08" },
        ],
      };
    },
    async getMovieDetail(id: number) {
      return { id, title: "New Movie", status: "Released", release_date: "2022-05-01", external_ids: {} };
    },
  } as unknown as TmdbClient;
}

let prisma: PrismaClient;
let cleanup: () => Promise<void>;
beforeEach(async () => {
  delete process.env.PLEX_LIBRARIES; // deterministic: no ambient library allowlist during tests
  ({ prisma, cleanup } = createDb());
  await prisma.user.create({ data: { id: "owner", name: "T", role: "owner" } });
  // Pre-seed the two already-tracked catalog items.
  await prisma.mediaItem.create({
    data: { id: "mi-show", mediaType: "tv", tmdbId: 100, title: "Tracked Show", needsDetails: false },
  });
  await prisma.mediaItem.create({
    data: { id: "mi-movie", mediaType: "movie", tmdbId: 200, title: "Tracked Movie", needsDetails: false },
  });
});
afterEach(async () => cleanup());

function deps() {
  return { prisma, plex: fakePlex(), tmdb: fakeTmdb(), userId: "owner" };
}

describe("scanPlex", () => {
  it("matches tracked items by external id and flags the rest as candidates", async () => {
    const r = await scanPlex(deps());
    expect(r.matchedShows).toBe(1);
    expect(r.matchedMovies).toBe(1);
    expect(r.presenceSeasons).toBe(1); // Tracked Show season 1
    expect(r.presenceRows).toEqual(
      expect.arrayContaining([
        { mediaItemId: "mi-show", seasonNumber: 1, plexRatingKey: "s1" },
        { mediaItemId: "mi-movie", seasonNumber: null, plexRatingKey: "m1" },
      ]),
    );
    expect(r.candidates.map((c) => c.title).sort()).toEqual(["New Movie", "New Show"]);
    expect(r.candidates.find((c) => c.title === "New Show")?.plexWatched).toBe(true);
    expect(r.unaccounted).toHaveLength(0); // every fake item carries an external id
  });

  it("surfaces Plex items with no external id as unaccounted, not candidates", async () => {
    // An untagged movie AND an untagged show: Plex has the files but matched neither to a metadata agent, so
    // both lack any external id — they can't be tracked and must not masquerade as add-candidates.
    const plex = {
      async getSections() {
        return [
          { key: "2", type: "show", title: "TV" },
          { key: "3", type: "movie", title: "Movies" },
        ];
      },
      async getSectionItems(key: string) {
        if (key === "2") return [{ ratingKey: "u2", type: "show", title: "Untagged Show", Guid: [] }];
        return [{ ratingKey: "u1", type: "movie", title: "Untagged File", year: 2001, Guid: [] }];
      },
      async getShowSeasons() {
        return [];
      },
      async getShowEpisodes() {
        return [];
      },
    } as unknown as PlexClient;
    const r = await scanPlex({ prisma, plex, tmdb: fakeTmdb(), userId: "owner" });
    expect(r.candidates).toHaveLength(0);
    expect(r.unaccounted).toEqual(
      expect.arrayContaining([
        { plexRatingKey: "u1", mediaType: "movie", title: "Untagged File", year: 2001 },
        { plexRatingKey: "u2", mediaType: "tv", title: "Untagged Show", year: null },
      ]),
    );
    expect(r.unaccounted).toHaveLength(2);
  });
});

describe("applyPresence", () => {
  it("writes show + season + movie presence rows, each carrying the item's Plex ratingKey", async () => {
    const r = await scanPlex(deps());
    await applyPresence(prisma, "owner", r.presenceRows);
    const rows = await prisma.plexPresence.findMany({ where: { userId: "owner" } });
    expect(new Set(rows.map((x) => x.mediaItemId))).toEqual(new Set(["mi-show", "mi-movie"]));
    expect(
      rows.filter((x) => x.mediaItemId === "mi-show" && x.seasonNumber != null).map((x) => x.seasonNumber),
    ).toEqual([1]);
    // The ratingKey is persisted so the UI can deep-link into Plex to watch it.
    expect(rows.find((x) => x.mediaItemId === "mi-show")?.plexRatingKey).toBe("s1");
    expect(rows.find((x) => x.mediaItemId === "mi-movie")?.plexRatingKey).toBe("m1");
  });

  it("is a full snapshot — re-applying replaces prior rows", async () => {
    await applyPresence(prisma, "owner", [{ mediaItemId: "mi-show", seasonNumber: 5, plexRatingKey: "s1" }]);
    await applyPresence(prisma, "owner", [{ mediaItemId: "mi-show", seasonNumber: 1, plexRatingKey: "s1" }]);
    const rows = await prisma.plexPresence.findMany({ where: { userId: "owner", mediaItemId: "mi-show" } });
    expect(rows.map((x) => x.seasonNumber)).toEqual([1]);
  });

  it("reports whether the set changed vs. what was stored (drives the on-view refresh)", async () => {
    const row = { mediaItemId: "mi-show", seasonNumber: 1, plexRatingKey: "s1" };
    expect(await applyPresence(prisma, "owner", [row])).toBe(true); // empty → one row
    expect(await applyPresence(prisma, "owner", [row])).toBe(false); // identical snapshot
    expect(await applyPresence(prisma, "owner", [{ ...row, seasonNumber: 2 }])).toBe(true); // season differs
    expect(await applyPresence(prisma, "owner", [])).toBe(true); // rows removed
  });
});

describe("continuous watched-sync (matched items)", () => {
  // Seed episodes for the already-tracked show so a watched episode can resolve to the catalog.
  async function seedShowEpisodes() {
    await prisma.season.create({ data: { id: "se1", mediaItemId: "mi-show", seasonNumber: 1 } });
    await prisma.episode.createMany({
      data: [
        { id: "ep-s1e1", mediaItemId: "mi-show", seasonId: "se1", seasonNumber: 1, episodeNumber: 1 },
        { id: "ep-s1e2", mediaItemId: "mi-show", seasonId: "se1", seasonNumber: 1, episodeNumber: 2 },
      ],
    });
  }

  it("collects watch signals for tracked shows + movies and imports them as plex SeenEvents", async () => {
    await seedShowEpisodes();
    const r = await scanPlex(deps());

    expect(r.watchedSignals).toEqual(
      expect.arrayContaining([
        { mediaItemId: "mi-show", seasonNumber: 1, episodeNumber: 1, watchedAt: new Date(1_710_000_000 * 1000) },
        { mediaItemId: "mi-movie", seasonNumber: null, episodeNumber: null, watchedAt: new Date(1_700_000_000 * 1000) },
      ]),
    );

    const inserted = await applyWatched(prisma, "owner", r.watchedSignals);
    expect(inserted).toBe(2); // S1E1 of the show + the movie (S1E2 was unwatched in Plex)

    const showSeen = await prisma.seenEvent.findMany({
      where: { userId: "owner", mediaItemId: "mi-show", source: "plex" },
    });
    expect(showSeen.map((e) => e.episodeId)).toEqual(["ep-s1e1"]);
    const movieSeen = await prisma.seenEvent.findFirst({
      where: { userId: "owner", mediaItemId: "mi-movie", source: "plex", episodeId: null },
    });
    expect(movieSeen?.watchedAt?.getTime()).toBe(1_700_000_000 * 1000);

    // Idempotent — a second apply of the same signals inserts nothing.
    expect(await applyWatched(prisma, "owner", r.watchedSignals)).toBe(0);
  });

  it("skips a show's episode fetch when neither its watched nor its total episode count changed", async () => {
    await seedShowEpisodes();
    // Both cursors match what the fake still reports for the tracked show (ratingKey "s1"): viewedLeafCount 2 and
    // leafCount 3. So /allLeaves is skipped entirely — no watch signals, no presence refresh; the movie is not
    // cursor-gated and still yields a signal.
    const r = await scanPlex(deps(), { s1: 2 }, { s1: 3 });
    expect(r.watchedSignals.some((s) => s.mediaItemId === "mi-show")).toBe(false);
    expect(r.episodePresence["mi-show"]).toBeUndefined();
    expect(r.watchedSignals.some((s) => s.mediaItemId === "mi-movie")).toBe(true);
    // Both cursors are refreshed with the current totals for the next run.
    expect(r.watchCursor.s1).toBe(2);
    expect(r.presenceCursor.s1).toBe(3);
  });

  it("re-fetches a show for presence when its episode count changed even if its watched count did not", async () => {
    await seedShowEpisodes();
    // Watched count unchanged (2), but the total episode count moved (prior cursor 2 → now 3) — a new episode
    // arrived. The fetch runs for presence, and the episodes-present snapshot is populated.
    const r = await scanPlex(deps(), { s1: 2 }, { s1: 2 });
    expect(r.episodePresence["mi-show"]).toEqual(
      expect.arrayContaining([
        { seasonNumber: 1, episodeNumber: 1 },
        { seasonNumber: 1, episodeNumber: 2 },
      ]),
    );
  });

  it("never double-logs an episode already in the log, regardless of source", async () => {
    await seedShowEpisodes();
    await prisma.seenEvent.create({
      data: { userId: "owner", mediaItemId: "mi-show", episodeId: "ep-s1e1", source: "app" },
    });

    const inserted = await applyWatched(prisma, "owner", [
      { mediaItemId: "mi-show", seasonNumber: 1, episodeNumber: 1, watchedAt: null },
    ]);
    expect(inserted).toBe(0);
    expect(await prisma.seenEvent.count({ where: { mediaItemId: "mi-show", episodeId: "ep-s1e1" } })).toBe(1);
  });

  it("does not re-import an episode or movie the user has suppressed (unmarked in-app)", async () => {
    await seedShowEpisodes();
    await suppressWatch(prisma, "owner", "mi-show", "ep-s1e1");
    await suppressWatch(prisma, "owner", "mi-movie", null);

    const inserted = await applyWatched(prisma, "owner", [
      { mediaItemId: "mi-show", seasonNumber: 1, episodeNumber: 1, watchedAt: new Date(1_710_000_000 * 1000) },
      { mediaItemId: "mi-movie", seasonNumber: null, episodeNumber: null, watchedAt: new Date(1_700_000_000 * 1000) },
    ]);
    expect(inserted).toBe(0);
    expect(await prisma.seenEvent.count({ where: { userId: "owner", source: "plex" } })).toBe(0);

    // Clearing the suppression (re-marking watched in-app) lets the next sync import it again.
    await clearEpisodeSuppressions(prisma, "owner", ["ep-s1e1"]);
    await clearMovieSuppression(prisma, "owner", "mi-movie");
    const inserted2 = await applyWatched(prisma, "owner", [
      { mediaItemId: "mi-show", seasonNumber: 1, episodeNumber: 1, watchedAt: null },
      { mediaItemId: "mi-movie", seasonNumber: null, episodeNumber: null, watchedAt: null },
    ]);
    expect(inserted2).toBe(2);
  });

  it("suppressWatch is idempotent for both episodes and movies", async () => {
    await seedShowEpisodes();
    await suppressWatch(prisma, "owner", "mi-show", "ep-s1e1");
    await suppressWatch(prisma, "owner", "mi-show", "ep-s1e1");
    await suppressWatch(prisma, "owner", "mi-movie", null);
    await suppressWatch(prisma, "owner", "mi-movie", null);
    expect(await prisma.plexWatchSuppression.count({ where: { userId: "owner" } })).toBe(2);
  });
});

describe("episode presence (matched shows)", () => {
  async function seedShowEpisodes() {
    await prisma.season.create({ data: { id: "se1", mediaItemId: "mi-show", seasonNumber: 1 } });
    await prisma.episode.createMany({
      data: [
        { id: "ep-s1e1", mediaItemId: "mi-show", seasonId: "se1", seasonNumber: 1, episodeNumber: 1 },
        { id: "ep-s1e2", mediaItemId: "mi-show", seasonId: "se1", seasonNumber: 1, episodeNumber: 2 },
      ],
    });
  }

  it("scanPlex records episodes present in Plex and a total-leaf presence cursor for matched shows", async () => {
    await seedShowEpisodes();
    const r = await scanPlex(deps());
    expect(r.matchedShowIds).toContain("mi-show");
    expect(r.presenceCursor.s1).toBe(3); // sum of season leafCounts from getShowSeasons
    expect(r.episodePresence["mi-show"]).toEqual(
      expect.arrayContaining([
        { seasonNumber: 1, episodeNumber: 1 },
        { seasonNumber: 1, episodeNumber: 2 },
      ]),
    );
  });

  it("applyEpisodePresence resolves season:episode to catalog episodeIds and stores presence", async () => {
    await seedShowEpisodes();
    const r = await scanPlex(deps());
    await applyEpisodePresence(prisma, "owner", r.episodePresence, r.matchedShowIds);
    const rows = await prisma.plexEpisodePresence.findMany({ where: { userId: "owner", mediaItemId: "mi-show" } });
    expect(new Set(rows.map((x) => x.episodeId))).toEqual(new Set(["ep-s1e1", "ep-s1e2"]));
  });

  it("replaces only re-fetched shows and drops rows for shows no longer in the library", async () => {
    await seedShowEpisodes();
    // A second tracked show with presence, that will NOT be in this sync's matched set (fell out of Plex).
    await prisma.mediaItem.create({ data: { id: "mi-other", mediaType: "tv", tmdbId: 500, title: "Other" } });
    await prisma.season.create({ data: { id: "se-o", mediaItemId: "mi-other", seasonNumber: 1 } });
    await prisma.episode.create({
      data: { id: "ep-o1", mediaItemId: "mi-other", seasonId: "se-o", seasonNumber: 1, episodeNumber: 1 },
    });
    await prisma.plexEpisodePresence.createMany({
      data: [
        { userId: "owner", mediaItemId: "mi-show", episodeId: "ep-s1e1" },
        { userId: "owner", mediaItemId: "mi-other", episodeId: "ep-o1" },
      ],
    });

    // Re-fetch mi-show only (now has just S1E2); mi-other is no longer matched.
    await applyEpisodePresence(prisma, "owner", { "mi-show": [{ seasonNumber: 1, episodeNumber: 2 }] }, ["mi-show"]);

    const rows = await prisma.plexEpisodePresence.findMany({ where: { userId: "owner" } });
    expect(rows.map((r) => `${r.mediaItemId}:${r.episodeId}`)).toEqual(["mi-show:ep-s1e2"]);
  });

  it("keeps rows for a still-matched show that wasn't re-fetched this sync", async () => {
    await seedShowEpisodes();
    await prisma.plexEpisodePresence.create({
      data: { userId: "owner", mediaItemId: "mi-show", episodeId: "ep-s1e1" },
    });
    // mi-show is still matched but absent from `refreshed` (its cursor didn't move) — its rows stay untouched.
    await applyEpisodePresence(prisma, "owner", {}, ["mi-show"]);
    const rows = await prisma.plexEpisodePresence.findMany({ where: { userId: "owner" } });
    expect(rows.map((r) => r.episodeId)).toEqual(["ep-s1e1"]);
  });
});

describe("addPlexItems", () => {
  it("hydrates Plex-only titles, tracks them, and imports Plex watched state", async () => {
    const r = await scanPlex(deps());
    const result = await addPlexItems(deps(), r.candidates);
    expect(result).toEqual({ added: 2, failed: [] });

    // New catalog rows created for the two candidates.
    expect(await prisma.mediaItem.count({ where: { tmdbId: { in: [300, 400] } } })).toBe(2);

    // New Show → on the list (wantToWatch) + a plex-sourced episode seen event (S1E1); "watching" is derived.
    const show = await prisma.mediaItem.findFirst({ where: { tmdbId: 300 } });
    const showState = await prisma.userMediaState.findFirst({ where: { mediaItemId: show!.id } });
    expect(showState?.wantToWatch).toBe(true);
    const showSeen = await prisma.seenEvent.findMany({
      where: { mediaItemId: show!.id, source: "plex", episodeId: { not: null } },
    });
    expect(showSeen).toHaveLength(1);

    // New Movie → on the list + a plex-sourced movie seen event with the Plex watch date; "finished" is derived.
    const movie = await prisma.mediaItem.findFirst({ where: { tmdbId: 400 } });
    const movieState = await prisma.userMediaState.findFirst({ where: { mediaItemId: movie!.id } });
    expect(movieState?.wantToWatch).toBe(true);
    const movieSeen = await prisma.seenEvent.findFirst({
      where: { mediaItemId: movie!.id, source: "plex", episodeId: null },
    });
    expect(movieSeen?.watchedAt?.getTime()).toBe(1_710_000_000 * 1000);
  });
});
