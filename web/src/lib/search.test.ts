import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import type { TmdbClient } from "@/lib/tmdb";
import { searchCatalog } from "./search";

// searchCatalog blends the user's tracked library with the wider TMDB catalog. These tests pin the contract that
// matters to the redesigned Search page: library rows come first and carry status flags, external hits are deduped
// against the library, an external failure is non-fatal, and person hits map to display cards. DI + a throwaway
// SQLite DB (same harness as catalog.test.ts) let us drive it without the app singletons.

const MIGRATION_SQL = readdirSync(join("prisma", "migrations"))
  .filter((d) => /^\d+_/.test(d))
  .sort()
  .map((d) => readFileSync(join("prisma", "migrations", d, "migration.sql"), "utf-8"))
  .join(";\n");

function createDb() {
  const dbPath = join("prisma", `test-search-${randomUUID()}.db`);
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

// Minimal fake TMDB: only the three search endpoints searchCatalog calls. Each defaults to empty; tests override.
function fakeTmdb(overrides: Partial<Record<"searchMovie" | "searchTv" | "searchPerson", unknown>> = {}): TmdbClient {
  const empty = { page: 1, total_results: 0, total_pages: 1, results: [] };
  return {
    async searchMovie() {
      return empty;
    },
    async searchTv() {
      return empty;
    },
    async searchPerson() {
      return empty;
    },
    ...overrides,
  } as unknown as TmdbClient;
}

describe("searchCatalog", () => {
  let db: ReturnType<typeof createDb>;
  beforeEach(() => {
    db = createDb();
  });
  afterEach(async () => {
    await db.cleanup();
  });

  async function seedTracked(opts: {
    title: string;
    mediaType: "movie" | "tv";
    tmdbId?: number;
    isFavorite?: boolean;
    imdbRating?: number;
    overview?: string;
  }) {
    await db.prisma.user.upsert({
      where: { id: "u1" },
      create: { id: "u1", name: "Owner", role: "owner" },
      update: {},
    });
    const item = await db.prisma.mediaItem.create({
      data: {
        mediaType: opts.mediaType,
        title: opts.title,
        tmdbId: opts.tmdbId ?? null,
        imdbRating: opts.imdbRating ?? null,
        overview: opts.overview ?? null,
        slug: opts.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      },
    });
    await db.prisma.userMediaState.create({
      data: { userId: "u1", mediaItemId: item.id, wantToWatch: true, isFavorite: opts.isFavorite ?? false },
    });
    return item;
  }

  it("returns tracked library movies first (flagged), then external hits deduped against them", async () => {
    await seedTracked({
      title: "The Matrix",
      mediaType: "movie",
      tmdbId: 603,
      isFavorite: true,
      imdbRating: 8.7,
      overview: "A hacker discovers reality is a simulation.",
    });
    const tmdb = fakeTmdb({
      async searchMovie() {
        return {
          page: 1,
          total_results: 2,
          total_pages: 1,
          results: [
            { id: 603, title: "The Matrix", release_date: "1999-03-31", poster_path: "/m.jpg", vote_average: 8.2 }, // dup → dropped
            { id: 604, title: "The Matrix Reloaded", release_date: "2003-05-15", poster_path: "/r.jpg", vote_average: 7, overview: "Neo fights to save Zion." },
          ],
        };
      },
    });

    const out = await searchCatalog(db.prisma, () => tmdb, { query: "matrix", scope: "movie", userId: "u1" });
    if (out.scope === "person") throw new Error("unexpected person scope");
    expect(out.error).toBeNull();
    expect(out.results.map((r) => r.title)).toEqual(["The Matrix", "The Matrix Reloaded"]);
    expect(out.results[0]).toMatchObject({
      inLibrary: true,
      isFavorite: true,
      rating: 8.7,
      overview: "A hacker discovers reality is a simulation.",
    });
    expect(out.results[0].detailHref).toContain("/movies/");
    expect(out.results[1]).toMatchObject({
      inLibrary: false,
      isFavorite: false,
      detailHref: null,
      overview: "Neo fights to save Zion.",
    });
  });

  it("only matches titles the user actually tracks", async () => {
    // A catalog row with NO UserMediaState must not surface as a library hit.
    await db.prisma.mediaItem.create({ data: { mediaType: "movie", title: "Untracked Movie", tmdbId: 1 } });
    const out = await searchCatalog(db.prisma, () => fakeTmdb(), { query: "untracked", scope: "movie", userId: "u1" });
    if (out.scope === "person") throw new Error("unexpected person scope");
    expect(out.results).toEqual([]);
  });

  it("surfaces an external error but still returns library results", async () => {
    await seedTracked({ title: "Severance", mediaType: "tv", tmdbId: 95396 });
    const tmdb = fakeTmdb({
      async searchTv() {
        throw new Error("network down");
      },
    });
    const out = await searchCatalog(db.prisma, () => tmdb, { query: "severance", scope: "show", userId: "u1" });
    if (out.scope === "person") throw new Error("unexpected person scope");
    expect(out.error).toBeTruthy();
    expect(out.results.map((r) => r.title)).toEqual(["Severance"]);
    expect(out.results[0].detailHref).toContain("/shows/");
  });

  it("maps TMDB person results to display cards with a role line", async () => {
    const tmdb = fakeTmdb({
      async searchPerson() {
        return {
          page: 1,
          total_results: 1,
          total_pages: 1,
          results: [
            {
              id: 45400,
              name: "Greta Gerwig",
              profile_path: "/g.jpg",
              known_for_department: "Directing",
              known_for: [
                { media_type: "movie", title: "Barbie" },
                { media_type: "movie", title: "Lady Bird" },
              ],
            },
          ],
        };
      },
    });
    const out = await searchCatalog(db.prisma, () => tmdb, { query: "greta", scope: "person", userId: "u1" });
    if (out.scope !== "person") throw new Error("expected person scope");
    expect(out.people[0]).toMatchObject({
      name: "Greta Gerwig",
      profilePath: "/g.jpg",
      role: "Director · Known for Barbie, Lady Bird",
    });
  });

  it("keeps library results when the TMDB client can't be built (missing token)", async () => {
    await seedTracked({ title: "Inception", mediaType: "movie", tmdbId: 27205, imdbRating: 8.8 });
    const boom = () => {
      throw new Error("TMDB_API_TOKEN is not set");
    };
    const out = await searchCatalog(db.prisma, boom, { query: "inception", scope: "movie", userId: "u1" });
    if (out.scope === "person") throw new Error("unexpected person scope");
    expect(out.error).toBe("TMDB API token is missing or invalid — set TMDB_API_TOKEN.");
    expect(out.results.map((r) => r.title)).toEqual(["Inception"]);
  });

  it("dedupes an external hit against a library row that has no tmdbId, by title", async () => {
    await seedTracked({ title: "Solaris", mediaType: "movie" }); // no tmdbId (e.g. TVDB-sourced)
    const tmdb = fakeTmdb({
      async searchMovie() {
        return {
          page: 1,
          total_results: 1,
          total_pages: 1,
          results: [{ id: 999, title: "Solaris", release_date: "1972-03-20", poster_path: "/s.jpg", vote_average: 8 }],
        };
      },
    });
    const out = await searchCatalog(db.prisma, () => tmdb, { query: "solaris", scope: "movie", userId: "u1" });
    if (out.scope === "person") throw new Error("unexpected person scope");
    expect(out.results.map((r) => r.title)).toEqual(["Solaris"]); // external dup dropped by title (library has no id)
    expect(out.results[0].inLibrary).toBe(true);
  });

  it("returns empty for a blank query without building the TMDB client", async () => {
    const boom = () => {
      throw new Error("should not construct tmdb for a blank query");
    };
    const out = await searchCatalog(db.prisma, boom, { query: "   ", scope: "movie", userId: "u1" });
    if (out.scope === "person") throw new Error("unexpected person scope");
    expect(out).toEqual({ scope: "movie", results: [], error: null });
  });
});
