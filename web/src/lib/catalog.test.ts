import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import type { TmdbClient } from "@/lib/tmdb";
import { hydrateShowByTmdbId } from "./catalog";

// Covers the tmdbId-keyed hydration used by search-add and the nightly refresh — in particular the refresh
// safety fix: re-hydrating must NOT overwrite an authoritative tvdbId (e.g. one written by the importer).

const MIGRATION_SQL = readdirSync(join("prisma", "migrations"))
  .filter((d) => /^\d+_/.test(d))
  .sort()
  .map((d) => readFileSync(join("prisma", "migrations", d, "migration.sql"), "utf-8"))
  .join(";\n");

function createDb() {
  const dbPath = join("prisma", `test-catalog-${randomUUID()}.db`);
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

function fakeTmdb(): TmdbClient {
  return {
    async getTvDetail(id: number) {
      return {
        id,
        name: "Show",
        status: "Returning Series",
        seasons: [{ season_number: 1 }, { season_number: 2 }],
        external_ids: { tvdb_id: 777, imdb_id: "tt1" },
      };
    },
    async getSeasonDetail(_id: number, n: number) {
      return {
        season_number: n,
        episodes: [{ id: 100 + n, episode_number: 1, season_number: n, air_date: "2020-01-01" }],
      };
    },
  } as unknown as TmdbClient;
}

let prisma: PrismaClient;
let cleanup: () => Promise<void>;
beforeEach(() => ({ prisma, cleanup } = createDb()));
afterEach(async () => cleanup());

describe("hydrateShowByTmdbId", () => {
  it("creates a tmdbId-keyed row, adopting TMDB's external tvdbId when none exists", async () => {
    const id = await hydrateShowByTmdbId(prisma, fakeTmdb(), 500);
    expect(id).not.toBeNull();
    const row = await prisma.mediaItem.findUnique({ where: { tmdbId_mediaType: { tmdbId: 500, mediaType: "tv" } } });
    expect(row?.tvdbId).toBe(777);
    expect(row?.metadataSource).toBe("tmdb");
    expect(row?.needsDetails).toBe(false);
    expect(await prisma.episode.count()).toBe(2);
  });

  it("resets metadataSource to tmdb, self-healing a row previously adopted from TVDB", async () => {
    // A row TMDB couldn't resolve at import can get adopted by the TVDB fallback (metadataSource "tvdb"); if
    // TMDB later resolves it, re-hydration must reclaim it so it can't stay mis-tagged (and mis-dispatched).
    await prisma.mediaItem.create({
      data: {
        mediaType: "tv",
        tmdbId: 500,
        tvdbId: 777,
        title: "Adopted",
        needsDetails: false,
        metadataSource: "tvdb",
      },
    });
    await hydrateShowByTmdbId(prisma, fakeTmdb(), 500);
    const row = await prisma.mediaItem.findUnique({ where: { tmdbId_mediaType: { tmdbId: 500, mediaType: "tv" } } });
    expect(row?.metadataSource).toBe("tmdb");
  });

  it("preserves an authoritative tvdbId on re-hydrate (does not clobber the import's value)", async () => {
    // Simulate an imported row: same tmdb, but tvdb from the export (999), differing from TMDB's external id.
    await prisma.mediaItem.create({
      data: { mediaType: "tv", tmdbId: 500, tvdbId: 999, title: "Imported", needsDetails: true },
    });
    await hydrateShowByTmdbId(prisma, fakeTmdb(), 500);
    const row = await prisma.mediaItem.findUnique({ where: { tmdbId_mediaType: { tmdbId: 500, mediaType: "tv" } } });
    expect(row?.tvdbId).toBe(999); // preserved, NOT overwritten with 777
    expect(row?.title).toBe("Show"); // other fields still refreshed
    expect(row?.needsDetails).toBe(false);
  });
});
