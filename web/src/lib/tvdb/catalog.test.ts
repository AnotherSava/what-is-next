import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import movieExtended from "./fixtures/movie-extended.json";
import seriesEpisodes from "./fixtures/series-episodes.json";
import seriesExtended from "./fixtures/series-extended.json";
import { hydrateMovieByTvdbId, hydrateShowByTvdbId, tvdbMovieToMediaData } from "./catalog";
import type { TvdbClient } from "./client";
import type { TvdbMovieExtended } from "./schemas";

// Covers TVDB-keyed hydration: rows are keyed by tvdbId, stay tmdbId-null / metadataSource "tvdb", external ids
// land in tvdbId columns (never tmdbId), and hydrating an existing stub updates it in place (user state kept).

const MIGRATION_SQL = readdirSync(join("prisma", "migrations"))
  .filter((d) => /^\d+_/.test(d))
  .sort()
  .map((d) => readFileSync(join("prisma", "migrations", d, "migration.sql"), "utf-8"))
  .join(";\n");

function createDb() {
  const dbPath = join("prisma", `test-tvdb-${randomUUID()}.db`);
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

function fakeTvdb(): TvdbClient {
  return {
    async getSeriesExtended() {
      return seriesExtended.data;
    },
    async getAllSeriesEpisodes() {
      return seriesEpisodes.data.episodes;
    },
    async getMovieExtended() {
      return movieExtended.data;
    },
  } as unknown as TvdbClient;
}

let prisma: PrismaClient;
let cleanup: () => Promise<void>;
beforeEach(() => {
  ({ prisma, cleanup } = createDb());
});
afterEach(async () => {
  await cleanup();
});

describe("hydrateShowByTvdbId", () => {
  it("writes a TVDB-sourced series with tmdbId null and external ids in tvdb columns", async () => {
    const id = await hydrateShowByTvdbId(prisma, fakeTvdb(), 420847);
    expect(id).not.toBeNull();
    const item = await prisma.mediaItem.findUniqueOrThrow({ where: { id: id! } });
    expect(item.metadataSource).toBe("tvdb");
    expect(item.tmdbId).toBeNull();
    expect(item.tvdbId).toBe(420847);
    expect(item.needsDetails).toBe(false);
    expect(item.title).toBe("Backrooms");
    expect(item.posterPath).toBe("https://artworks.thetvdb.com/banners/v4/series/420847/posters/1.jpg");
    expect(item.imdbId).toBe("tt15380122");
    expect(item.numberOfSeasons).toBe(1); // season 0 excluded from the count
    expect(item.numberOfEpisodes).toBe(2);
    expect(item.genres).toContain("Horror");
  });

  it("routes season and episode external ids to tvdbId, not tmdbId", async () => {
    const id = await hydrateShowByTvdbId(prisma, fakeTvdb(), 420847);
    const s1 = await prisma.season.findFirstOrThrow({ where: { mediaItemId: id!, seasonNumber: 1 } });
    // The fixture lists an absolute-order S1 (id 9999) before the official S1 (id 5002); metadata must come
    // from the official one, matching the aired-order episodes stored under season 1.
    expect(s1.tvdbId).toBe(5002);
    expect(s1.title).toBe("Season 1");
    expect(s1.tmdbId).toBeNull();
    const specials = await prisma.season.findFirstOrThrow({ where: { mediaItemId: id!, seasonNumber: 0 } });
    expect(specials.isSpecials).toBe(true);

    const e1 = await prisma.episode.findFirstOrThrow({
      where: { mediaItemId: id!, seasonNumber: 1, episodeNumber: 1 },
    });
    expect(e1.tvdbId).toBe(900100);
    expect(e1.tmdbId).toBeNull();
    expect(e1.releaseDate).toBe("2022-01-07");
    const special = await prisma.episode.findFirstOrThrow({ where: { mediaItemId: id!, seasonNumber: 0 } });
    expect(special.isSpecial).toBe(true);
  });

  it("is idempotent (re-hydrate leaves one row and no duplicate episodes)", async () => {
    await hydrateShowByTvdbId(prisma, fakeTvdb(), 420847);
    const id = await hydrateShowByTvdbId(prisma, fakeTvdb(), 420847);
    expect(await prisma.mediaItem.count({ where: { tvdbId: 420847, mediaType: "tv" } })).toBe(1);
    expect(await prisma.episode.count({ where: { mediaItemId: id! } })).toBe(3);
  });

  it("updates an existing stub in place, preserving user state", async () => {
    const user = await prisma.user.create({ data: { name: "Owner", role: "owner" } });
    const stub = await prisma.mediaItem.create({
      data: { mediaType: "tv", tvdbId: 420847, title: "Backrooms", needsDetails: true },
    });
    await prisma.userMediaState.create({
      data: { userId: user.id, mediaItemId: stub.id, tracking: "watching", isFavorite: true },
    });

    const id = await hydrateShowByTvdbId(prisma, fakeTvdb(), 420847);
    expect(id).toBe(stub.id); // same row, keyed by tvdbId
    const refreshed = await prisma.mediaItem.findUniqueOrThrow({ where: { id: stub.id } });
    expect(refreshed.needsDetails).toBe(false);
    expect(refreshed.metadataSource).toBe("tvdb");
    const state = await prisma.userMediaState.findFirstOrThrow({ where: { mediaItemId: stub.id } });
    expect(state.tracking).toBe("watching");
    expect(state.isFavorite).toBe(true);
  });
});

describe("tvdbMovieToMediaData", () => {
  const movie = (extra: Partial<TvdbMovieExtended>): TvdbMovieExtended =>
    ({ id: 1, name: "M", ...extra }) as TvdbMovieExtended;

  it("falls back to the year when first_release.date is an empty string (TVDB's unknown-date)", () => {
    expect(tvdbMovieToMediaData(movie({ first_release: { date: "" }, year: "1999" })).releaseDate).toBe("1999-01-01");
    expect(tvdbMovieToMediaData(movie({ first_release: { date: "2005-05-05" } })).releaseDate).toBe("2005-05-05");
    expect(tvdbMovieToMediaData(movie({ year: "2001" })).releaseDate).toBe("2001-01-01");
  });

  it("derives the overview from the English translation when there's no top-level overview", () => {
    const m = movie({
      translations: {
        overviewTranslations: [
          { language: "spa", overview: "Español" },
          { language: "eng", overview: "English synopsis" },
        ],
      },
    });
    expect(tvdbMovieToMediaData(m).overview).toBe("English synopsis");
  });
});

describe("hydrateMovieByTvdbId", () => {
  it("writes a TVDB-sourced movie with release date and poster from TVDB", async () => {
    const id = await hydrateMovieByTvdbId(prisma, fakeTvdb(), 138435);
    const item = await prisma.mediaItem.findUniqueOrThrow({ where: { id: id! } });
    expect(item.mediaType).toBe("movie");
    expect(item.metadataSource).toBe("tvdb");
    expect(item.tmdbId).toBeNull();
    expect(item.tvdbId).toBe(138435);
    expect(item.needsDetails).toBe(false);
    expect(item.releaseDate).toBe("2010-08-01");
    expect(item.runtime).toBe(25);
    expect(item.posterPath).toBe("https://artworks.thetvdb.com/banners/v4/movie/138435/posters/1.jpg");
    expect(item.overview).toContain("fan-made");
  });
});
