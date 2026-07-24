import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import type { TmdbClient } from "@/lib/tmdb";
import { getMoviePreview, getShowPreview } from "./preview";

// getMoviePreview/getShowPreview assemble a read-only view model for a non-library item straight from a TMDB detail,
// with no DB write. These tests pin the contract the preview pages rely on: TMDB fields map through (title, cast,
// director/creator, genres, rating, season stubs); an item already in the catalog short-circuits to a redirect; a
// failed TMDB fetch degrades to not-found. Same DI + throwaway-SQLite harness as search.test.ts.

const MIGRATION_SQL = readdirSync(join("prisma", "migrations"))
  .filter((d) => /^\d+_/.test(d))
  .sort()
  .map((d) => readFileSync(join("prisma", "migrations", d, "migration.sql"), "utf-8"))
  .join(";\n");

function createDb() {
  const dbPath = join("prisma", `test-preview-${randomUUID()}.db`);
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

// A fake TMDB client exposing only the two detail endpoints the preview layer calls. Each throws unless a test
// overrides it — so a test that expects no fetch (the "already in catalog" path) fails loudly if one happens.
function fakeTmdb(overrides: Partial<Record<"getMovieDetail" | "getTvDetail", unknown>> = {}): TmdbClient {
  return {
    async getMovieDetail() {
      throw new Error("getMovieDetail not stubbed");
    },
    async getTvDetail() {
      throw new Error("getTvDetail not stubbed");
    },
    ...overrides,
  } as unknown as TmdbClient;
}

const MATRIX_DETAIL = {
  id: 603,
  title: "The Matrix",
  original_title: "The Matrix",
  original_language: "en",
  overview: "A hacker learns reality is a simulation.",
  release_date: "1999-03-31",
  status: "Released",
  runtime: 136,
  poster_path: "/m.jpg",
  backdrop_path: "/mb.jpg",
  vote_average: 8.2,
  genres: [
    { id: 28, name: "Action" },
    { id: 878, name: "Science Fiction" },
  ],
  external_ids: { imdb_id: "tt0133093", tvdb_id: null },
  credits: {
    cast: [
      { name: "Laurence Fishburne", character: "Morpheus", profile_path: "/l.jpg", order: 1 },
      { name: "Keanu Reeves", character: "Neo", profile_path: "/k.jpg", order: 0 },
    ],
    crew: [
      { job: "Director", name: "Lana Wachowski" },
      { job: "Director", name: "Lilly Wachowski" },
      { job: "Writer", name: "A. Writer" },
    ],
  },
};

const GOT_DETAIL = {
  id: 1399,
  name: "Game of Thrones",
  original_name: "Game of Thrones",
  original_language: "en",
  overview: "Noble families vie for control.",
  first_air_date: "2011-04-17",
  status: "Ended",
  poster_path: "/g.jpg",
  backdrop_path: "/gb.jpg",
  vote_average: 8.4,
  episode_run_time: [60],
  number_of_seasons: 8,
  number_of_episodes: 73,
  genres: [{ id: 18, name: "Drama" }],
  seasons: [
    { id: 3627, season_number: 0, name: "Specials", air_date: "2011-01-01", episode_count: 5 },
    { id: 3624, season_number: 1, name: "Season 1", air_date: "2011-04-17", episode_count: 10 },
    { id: 3625, season_number: 2, name: "Season 2", air_date: "2012-04-01", episode_count: 10 },
  ],
  external_ids: { imdb_id: "tt0944947", tvdb_id: 121361 },
  created_by: [{ name: "David Benioff" }, { name: "D. B. Weiss" }],
  credits: { cast: [{ name: "Emilia Clarke", character: "Daenerys Targaryen", profile_path: "/e.jpg", order: 0 }], crew: [] },
};

describe("getMoviePreview", () => {
  let db: ReturnType<typeof createDb>;
  beforeEach(() => {
    db = createDb();
  });
  afterEach(async () => {
    await db.cleanup();
  });

  it("maps a TMDB movie detail into a preview view model", async () => {
    const tmdb = fakeTmdb({ async getMovieDetail() { return MATRIX_DETAIL; } });
    const result = await getMoviePreview(db.prisma, () => tmdb, 603);
    if (result.status !== "preview") throw new Error(`expected preview, got ${result.status}`);
    expect(result.data).toMatchObject({
      tmdbId: 603,
      title: "The Matrix",
      overview: "A hacker learns reality is a simulation.",
      releaseDate: "1999-03-31",
      runtime: 136,
      tmdbRating: 8.2,
      director: "Lana Wachowski, Lilly Wachowski", // both directors, comma-joined
      genres: ["Action", "Science Fiction"],
    });
    // Cast is sorted by TMDB billing order (0 first), regardless of array order.
    expect(result.data.cast.map((c) => c.name)).toEqual(["Keanu Reeves", "Laurence Fishburne"]);
  });

  it("redirects to the real detail page when the movie is already in the catalog (no TMDB fetch)", async () => {
    await db.prisma.mediaItem.create({
      data: { mediaType: "movie", tmdbId: 603, title: "The Matrix", slug: "the-matrix" },
    });
    const result = await getMoviePreview(db.prisma, () => fakeTmdb(), 603); // fake would throw if fetched
    expect(result).toEqual({ status: "existing", slug: "the-matrix" });
  });

  it("falls back to the id when a catalogued movie has no slug", async () => {
    const item = await db.prisma.mediaItem.create({ data: { mediaType: "movie", tmdbId: 603, title: "The Matrix" } });
    const result = await getMoviePreview(db.prisma, () => fakeTmdb(), 603);
    expect(result).toEqual({ status: "existing", slug: item.id });
  });

  it("returns not-found when the TMDB fetch fails", async () => {
    const tmdb = fakeTmdb({ async getMovieDetail() { throw new Error("404"); } });
    const result = await getMoviePreview(db.prisma, () => tmdb, 999999);
    expect(result).toEqual({ status: "not-found" });
  });
});

describe("getShowPreview", () => {
  let db: ReturnType<typeof createDb>;
  beforeEach(() => {
    db = createDb();
  });
  afterEach(async () => {
    await db.cleanup();
  });

  it("maps a TMDB show detail into a preview with season stubs (specials sorted last)", async () => {
    const tmdb = fakeTmdb({ async getTvDetail() { return GOT_DETAIL; } });
    const result = await getShowPreview(db.prisma, () => tmdb, 1399);
    if (result.status !== "preview") throw new Error(`expected preview, got ${result.status}`);
    expect(result.data).toMatchObject({
      tmdbId: 1399,
      title: "Game of Thrones",
      status: "Ended",
      tmdbRating: 8.4,
      creator: "David Benioff, D. B. Weiss",
      numberOfSeasons: 8,
      numberOfEpisodes: 73,
      genres: ["Drama"],
    });
    expect(result.data.cast.map((c) => c.name)).toEqual(["Emilia Clarke"]);
    // Regular seasons in numeric order, specials (season 0) pushed to the end.
    expect(result.data.seasons.map((s) => s.seasonNumber)).toEqual([1, 2, 0]);
    expect(result.data.seasons[0]).toMatchObject({ seasonNumber: 1, isSpecials: false, year: 2011, episodeCount: 10 });
    expect(result.data.seasons[2]).toMatchObject({ seasonNumber: 0, isSpecials: true });
  });

  it("redirects to the real detail page when the show is already in the catalog (no TMDB fetch)", async () => {
    await db.prisma.mediaItem.create({
      data: { mediaType: "tv", tmdbId: 1399, title: "Game of Thrones", slug: "game-of-thrones" },
    });
    const result = await getShowPreview(db.prisma, () => fakeTmdb(), 1399);
    expect(result).toEqual({ status: "existing", slug: "game-of-thrones" });
  });

  it("returns not-found when the TMDB fetch fails", async () => {
    const tmdb = fakeTmdb({ async getTvDetail() { throw new Error("network down"); } });
    const result = await getShowPreview(db.prisma, () => tmdb, 999999);
    expect(result).toEqual({ status: "not-found" });
  });
});
