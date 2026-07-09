import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { TmdbError, type TmdbClient } from "@/lib/tmdb";
import { Importer } from "./importer";
import { tvtimeListsFileSchema, tvtimeMovieFileSchema, tvtimeSeriesFileSchema } from "./schemas";

// Integration tests for the orchestrator against a REAL temp SQLite DB (schema applied from the init migration)
// with FAKE TMDB clients. Validates the write path — upsert keys, episode matching, seen-event provenance
// dedupe, list-item idempotency — plus the two bugs adversarial review caught: cross-tvdb→same-tmdb dedup and
// partial-hydration recovery. Each test gets an isolated DB.

const MIGRATION_SQL = (() => {
  const migRoot = join("prisma", "migrations");
  const dirs = readdirSync(migRoot)
    .filter((d) => /^\d+_/.test(d))
    .sort();
  return dirs.map((d) => readFileSync(join(migRoot, d, "migration.sql"), "utf-8")).join(";\n");
})();

function createDb(): { prisma: PrismaClient; cleanup: () => Promise<void> } {
  const dbPath = join("prisma", `test-import-${randomUUID()}.db`);
  const raw = new Database(dbPath);
  raw.exec(MIGRATION_SQL);
  raw.close();
  const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${dbPath.replace(/\\/g, "/")}` }) });
  return {
    prisma,
    cleanup: async () => {
      await prisma.$disconnect();
      for (const suffix of ["", "-journal", "-shm", "-wal"]) {
        const p = dbPath + suffix;
        if (existsSync(p)) rmSync(p, { force: true });
      }
    },
  };
}

// Standard fake: Money Heist (tvdb 327417 → tmdb 71446, season 1 with 3 eps) + The Wild Robot movie.
function fakeTmdb(): TmdbClient {
  const impl = {
    async findByTvdb(tvdbId: number) {
      return tvdbId === 327417
        ? { tv_results: [{ id: 71446, name: "Money Heist" }], movie_results: [] }
        : { tv_results: [], movie_results: [] };
    },
    async getTvDetail(id: number) {
      return {
        id,
        name: "Money Heist",
        status: "Ended",
        first_air_date: "2017-05-02",
        number_of_seasons: 1,
        number_of_episodes: 3,
        genres: [{ id: 80, name: "Crime" }],
        external_ids: { tvdb_id: 327417, imdb_id: "tt6468322" },
        seasons: [{ season_number: 1, name: "Part 1" }],
      };
    },
    async getSeasonDetail(_id: number, n: number) {
      return {
        season_number: n,
        name: "Part 1",
        episodes: [
          { id: 9001, episode_number: 1, season_number: n, name: "E1", air_date: "2017-05-02", runtime: 47 },
          { id: 9002, episode_number: 2, season_number: n, name: "E2", air_date: "2017-05-09", runtime: 42 },
          { id: 9003, episode_number: 3, season_number: n, name: "E3", air_date: "2017-05-16", runtime: 45 },
        ],
      };
    },
    async findByImdb(imdb: string) {
      return imdb === "tt29623480"
        ? { tv_results: [], movie_results: [{ id: 1184918, title: "The Wild Robot" }] }
        : { tv_results: [], movie_results: [] };
    },
    async searchMovie() {
      return { page: 1, total_results: 0, total_pages: 0, results: [] };
    },
    async getMovieDetail(id: number) {
      return {
        id,
        title: "The Wild Robot",
        status: "Released",
        release_date: "2024-09-12",
        runtime: 102,
        genres: [{ id: 16, name: "Animation" }],
        external_ids: { imdb_id: "tt29623480", tvdb_id: 353646 },
      };
    },
  };
  return impl as unknown as TmdbClient;
}

const series = tvtimeSeriesFileSchema.parse([
  {
    id: { tvdb: 327417, imdb: null },
    title: "Money Heist",
    created_at: "2023-08-16T03:28:43Z",
    status: "up_to_date",
    is_favorite: true,
    seasons: [
      {
        number: 1,
        is_specials: false,
        episodes: [
          { id: { tvdb: 8001 }, number: 1, is_watched: true, watched_at: "2023-08-16T03:34:50Z" },
          { id: { tvdb: 8002 }, number: 2, is_watched: true, watched_at: "2023-08-17T03:34:50Z" },
          { id: { tvdb: 8003 }, number: 3, is_watched: false, watched_at: null },
        ],
      },
    ],
  },
]);
const movies = tvtimeMovieFileSchema.parse([
  {
    id: { tvdb: 353646, imdb: "tt29623480" },
    title: "The Wild Robot",
    year: 2024,
    watched_at: "2024-10-16T20:16:42Z",
    is_watched: true,
    is_favorite: false,
  },
]);
const lists = tvtimeListsFileSchema.parse([
  { name: "Didn't like", items: [{ type: "series", tvdb_id: 327417, custom_order: 0 }] },
]);

let prisma: PrismaClient;
let cleanup: () => Promise<void>;
beforeEach(async () => {
  ({ prisma, cleanup } = createDb());
  await prisma.user.create({ data: { id: "owner", name: "Tester", role: "owner" } });
});
afterEach(async () => cleanup());

function importer(tmdb: TmdbClient): Importer {
  return new Importer({ prisma, tmdb, ownerId: "owner" }, "test", new Date().toISOString());
}

describe("Importer — happy path + idempotency", () => {
  it("first pass writes catalog, user state, seen events and lists", async () => {
    const report = await importer(fakeTmdb()).run({ series, movies, lists });

    expect(report.series).toMatchObject({ total: 1, resolved: 1 });
    expect(report.series.unresolved).toHaveLength(0);
    expect(report.movies).toMatchObject({ total: 1, resolved: 1 });
    expect(report.episodes).toMatchObject({ totalInExport: 3, matched: 3, unmatchedWatched: 0 });
    expect(report.seenEvents).toEqual({ episodes: 2, movies: 1 });
    expect(report.favorites).toEqual({ series: 1, movies: 0 });
    expect(report.lists).toMatchObject({ count: 1, items: 1 });

    expect(await prisma.mediaItem.count()).toBe(2);
    expect(await prisma.episode.count()).toBe(3);
    expect(await prisma.seenEvent.count()).toBe(3);
    expect(await prisma.listItem.count()).toBe(1);

    const tv = await prisma.mediaItem.findFirst({ where: { mediaType: "tv" } });
    const tvState = await prisma.userMediaState.findFirst({ where: { mediaItemId: tv!.id } });
    expect(tvState?.tracking).toBe("watching");
    expect(tvState?.isFavorite).toBe(true);

    const movie = await prisma.mediaItem.findFirst({ where: { mediaType: "movie" } });
    const movieState = await prisma.userMediaState.findFirst({ where: { mediaItemId: movie!.id } });
    expect(movieState?.tracking).toBe("finished");

    const ep1 = await prisma.episode.findFirst({ where: { mediaItemId: tv!.id, seasonNumber: 1, episodeNumber: 1 } });
    expect(ep1?.tvdbId).toBe(8001);
  });

  it("second pass is idempotent — no duplicate rows", async () => {
    await importer(fakeTmdb()).run({ series, movies, lists });
    const report = await importer(fakeTmdb()).run({ series, movies, lists });

    expect(report.seenEvents).toEqual({ episodes: 0, movies: 0 });
    expect(await prisma.mediaItem.count()).toBe(2);
    expect(await prisma.episode.count()).toBe(3);
    expect(await prisma.seenEvent.count()).toBe(3);
    expect(await prisma.userMediaState.count()).toBe(2);
    expect(await prisma.listItem.count()).toBe(1);
  });
});

describe("Importer — two TVDB ids resolving to one TMDB id (review finding #1)", () => {
  // Both series resolve to the same tmdb 71446 → must merge into one MediaItem, not violate @@unique or abort.
  function collisionTmdb(): TmdbClient {
    const base = fakeTmdb() as unknown as Record<string, (...a: unknown[]) => unknown>;
    return {
      ...base,
      async findByTvdb() {
        return { tv_results: [{ id: 71446, name: "Money Heist" }], movie_results: [] }; // any tvdb → same tmdb
      },
    } as unknown as TmdbClient;
  }

  it("merges onto the canonical row and completes without aborting", async () => {
    const twoSeries = tvtimeSeriesFileSchema.parse([
      {
        id: { tvdb: 100 },
        title: "Show A",
        status: "up_to_date",
        seasons: [
          {
            number: 1,
            episodes: [{ id: { tvdb: 1 }, number: 1, is_watched: true, watched_at: "2023-01-01T00:00:00Z" }],
          },
        ],
      },
      {
        id: { tvdb: 200 },
        title: "Show B (dup mapping)",
        status: "stopped",
        seasons: [
          {
            number: 1,
            episodes: [{ id: { tvdb: 2 }, number: 2, is_watched: true, watched_at: "2023-01-02T00:00:00Z" }],
          },
        ],
      },
    ]);

    const report = await importer(collisionTmdb()).run({ series: twoSeries, movies: [], lists: [] });

    // No abort; both series counted resolved; a merge warning recorded.
    expect(report.series.resolved).toBe(2);
    expect(report.warnings.some((w) => w.includes("shares tmdb 71446"))).toBe(true);
    // Exactly ONE catalog row and ONE user-state row (the two collapsed).
    expect(await prisma.mediaItem.count()).toBe(1);
    expect(await prisma.userMediaState.count()).toBe(1);
    // Both watched episodes (E1 and E2) matched the shared catalog and produced seen events.
    expect(await prisma.seenEvent.count()).toBe(2);
  });
});

describe("Importer — partial season hydration recovers on re-run (review finding #2)", () => {
  // Season 2 fails on the first pass, succeeds on the second.
  function flakyTmdb(failSeason2: () => boolean): TmdbClient {
    return {
      async findByTvdb() {
        return { tv_results: [{ id: 500, name: "Flaky" }], movie_results: [] };
      },
      async getTvDetail(id: number) {
        return {
          id,
          name: "Flaky",
          status: "Returning Series",
          seasons: [{ season_number: 1 }, { season_number: 2 }],
          external_ids: { tvdb_id: 300 },
        };
      },
      async getSeasonDetail(_id: number, n: number) {
        if (n === 2 && failSeason2()) throw new TmdbError("transient", 503, "/tv/500/season/2");
        return {
          season_number: n,
          episodes: [{ id: 1000 + n, episode_number: 1, season_number: n, air_date: "2020-01-01" }],
        };
      },
      async findByImdb() {
        return { tv_results: [], movie_results: [] };
      },
      async searchMovie() {
        return { page: 1, total_results: 0, total_pages: 0, results: [] };
      },
      async getMovieDetail() {
        throw new TmdbError("n/a", 404);
      },
    } as unknown as TmdbClient;
  }

  const flakySeries = tvtimeSeriesFileSchema.parse([
    {
      id: { tvdb: 300 },
      title: "Flaky",
      status: "up_to_date",
      seasons: [
        {
          number: 1,
          episodes: [{ id: { tvdb: 11 }, number: 1, is_watched: true, watched_at: "2020-01-02T00:00:00Z" }],
        },
        {
          number: 2,
          episodes: [{ id: { tvdb: 12 }, number: 1, is_watched: true, watched_at: "2020-06-02T00:00:00Z" }],
        },
      ],
    },
  ]);

  it("keeps needsDetails=true after a failed season, then heals on re-run", async () => {
    // Pass 1: season 2 fails.
    const r1 = await importer(flakyTmdb(() => true)).run({ series: flakySeries, movies: [], lists: [] });
    expect(r1.warnings.some((w) => w.includes("partially hydrated"))).toBe(true);
    const item1 = await prisma.mediaItem.findFirst({ where: { tvdbId: 300 } });
    expect(item1?.needsDetails).toBe(true); // NOT marked fully-detailed
    expect(await prisma.episode.count()).toBe(1); // only season 1
    // Season 2's watched episode couldn't match (no catalog row) → recorded as unmatched-watched, no seen event.
    expect(r1.episodes.unmatchedWatched).toBe(1);

    // Pass 2: season 2 succeeds → re-hydrates because needsDetails was still true.
    const r2 = await importer(flakyTmdb(() => false)).run({ series: flakySeries, movies: [], lists: [] });
    const item2 = await prisma.mediaItem.findFirst({ where: { tvdbId: 300 } });
    expect(item2?.needsDetails).toBe(false);
    expect(await prisma.episode.count()).toBe(2); // both seasons now present
    expect(r2.episodes.unmatchedWatched).toBe(0);
    expect(await prisma.seenEvent.count()).toBe(2); // both watched episodes now logged
  });
});
