import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import type { TmdbClient } from "@/lib/tmdb";
import type { PlexClient } from "./client";
import { addPlexItems, applyPresence, scanPlex } from "./sync";

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
        { mediaItemId: "mi-show", seasonNumber: 1 },
        { mediaItemId: "mi-movie", seasonNumber: null },
      ]),
    );
    expect(r.candidates.map((c) => c.title).sort()).toEqual(["New Movie", "New Show"]);
    expect(r.candidates.find((c) => c.title === "New Show")?.plexWatched).toBe(true);
  });

  it("skips Plex items with no external id (can't be tracked)", async () => {
    const plex = {
      async getSections() {
        return [{ key: "3", type: "movie", title: "Movies" }];
      },
      async getSectionItems() {
        return [{ ratingKey: "u1", type: "movie", title: "Untagged File", Guid: [] }];
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
  });
});

describe("applyPresence", () => {
  it("writes show + season + movie presence rows", async () => {
    const r = await scanPlex(deps());
    await applyPresence(prisma, "owner", r.presenceRows);
    const rows = await prisma.plexPresence.findMany({ where: { userId: "owner" } });
    expect(new Set(rows.map((x) => x.mediaItemId))).toEqual(new Set(["mi-show", "mi-movie"]));
    expect(
      rows.filter((x) => x.mediaItemId === "mi-show" && x.seasonNumber != null).map((x) => x.seasonNumber),
    ).toEqual([1]);
  });

  it("is a full snapshot — re-applying replaces prior rows", async () => {
    await applyPresence(prisma, "owner", [{ mediaItemId: "mi-show", seasonNumber: 5 }]);
    await applyPresence(prisma, "owner", [{ mediaItemId: "mi-show", seasonNumber: 1 }]);
    const rows = await prisma.plexPresence.findMany({ where: { userId: "owner", mediaItemId: "mi-show" } });
    expect(rows.map((x) => x.seasonNumber)).toEqual([1]);
  });
});

describe("addPlexItems", () => {
  it("hydrates Plex-only titles, tracks them, and imports Plex watched state", async () => {
    const r = await scanPlex(deps());
    const result = await addPlexItems(deps(), r.candidates);
    expect(result).toEqual({ added: 2, failed: [] });

    // New catalog rows created for the two candidates.
    expect(await prisma.mediaItem.count({ where: { tmdbId: { in: [300, 400] } } })).toBe(2);

    // New Show → tracking "watching" (watched in Plex) + a plex-sourced episode seen event (S1E1).
    const show = await prisma.mediaItem.findFirst({ where: { tmdbId: 300 } });
    const showState = await prisma.userMediaState.findFirst({ where: { mediaItemId: show!.id } });
    expect(showState?.tracking).toBe("watching");
    const showSeen = await prisma.seenEvent.findMany({
      where: { mediaItemId: show!.id, source: "plex", episodeId: { not: null } },
    });
    expect(showSeen).toHaveLength(1);

    // New Movie → "finished" + a plex-sourced movie seen event with the Plex watch date.
    const movie = await prisma.mediaItem.findFirst({ where: { tmdbId: 400 } });
    const movieState = await prisma.userMediaState.findFirst({ where: { mediaItemId: movie!.id } });
    expect(movieState?.tracking).toBe("finished");
    const movieSeen = await prisma.seenEvent.findFirst({
      where: { mediaItemId: movie!.id, source: "plex", episodeId: null },
    });
    expect(movieSeen?.watchedAt?.getTime()).toBe(1_710_000_000 * 1000);
  });
});
