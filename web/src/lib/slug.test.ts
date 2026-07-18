import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { slugify, syncSlug } from "./slug";

// Covers slug derivation (pure) and the DB-backed syncSlug: per-mediaType uniqueness, collision suffixes,
// regeneration when a title changes (old slug freed), and the id fallback for un-sluggable titles.

const MIGRATION_SQL = readdirSync(join("prisma", "migrations"))
  .filter((d) => /^\d+_/.test(d))
  .sort()
  .map((d) => readFileSync(join("prisma", "migrations", d, "migration.sql"), "utf-8"))
  .join(";\n");

function createDb() {
  const dbPath = join("prisma", `test-slug-${randomUUID()}.db`);
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

describe("slugify", () => {
  it("lowercases, hyphenates, and trims punctuation", () => {
    expect(slugify("Female Stand-up")).toBe("female-stand-up");
    expect(slugify("The Office (U.S.)")).toBe("the-office-u-s");
    expect(slugify("  Spaced!  ")).toBe("spaced");
  });
  it("folds diacritics to ASCII", () => {
    expect(slugify("Amélie")).toBe("amelie");
  });
  it("returns empty when nothing is sluggable", () => {
    expect(slugify("日本語")).toBe("");
  });
});

describe("syncSlug", () => {
  let prisma: PrismaClient;
  let cleanup: () => Promise<void>;
  beforeEach(() => ({ prisma, cleanup } = createDb()));
  afterEach(async () => cleanup());

  const slugOf = async (id: string) =>
    (await prisma.mediaItem.findUnique({ where: { id }, select: { slug: true } }))?.slug ?? null;

  it("derives the slug from the title", async () => {
    const { id } = await prisma.mediaItem.create({ data: { mediaType: "tv", title: "Fleabag" } });
    await syncSlug(prisma, id);
    expect(await slugOf(id)).toBe("fleabag");
  });

  it("suffixes colliding titles within a media type", async () => {
    const a = await prisma.mediaItem.create({ data: { mediaType: "tv", title: "The Office" } });
    const b = await prisma.mediaItem.create({ data: { mediaType: "tv", title: "The Office" } });
    await syncSlug(prisma, a.id);
    await syncSlug(prisma, b.id);
    expect(await slugOf(a.id)).toBe("the-office");
    expect(await slugOf(b.id)).toBe("the-office-2");
  });

  it("lets a show and a movie share the same slug (uniqueness is per media type)", async () => {
    const show = await prisma.mediaItem.create({ data: { mediaType: "tv", title: "Fargo" } });
    const movie = await prisma.mediaItem.create({ data: { mediaType: "movie", title: "Fargo" } });
    await syncSlug(prisma, show.id);
    await syncSlug(prisma, movie.id);
    expect(await slugOf(show.id)).toBe("fargo");
    expect(await slugOf(movie.id)).toBe("fargo");
  });

  it("is stable when re-run on an unchanged title", async () => {
    const { id } = await prisma.mediaItem.create({ data: { mediaType: "tv", title: "Severance" } });
    await syncSlug(prisma, id);
    await syncSlug(prisma, id);
    expect(await slugOf(id)).toBe("severance");
  });

  it("regenerates on a title change and frees the old slug", async () => {
    const { id } = await prisma.mediaItem.create({ data: { mediaType: "tv", title: "Working Title" } });
    await syncSlug(prisma, id);
    expect(await slugOf(id)).toBe("working-title");
    await prisma.mediaItem.update({ where: { id }, data: { title: "Real Title" } });
    await syncSlug(prisma, id);
    expect(await slugOf(id)).toBe("real-title");
    // The freed base is reusable by another item without a suffix.
    const other = await prisma.mediaItem.create({ data: { mediaType: "tv", title: "Working Title" } });
    await syncSlug(prisma, other.id);
    expect(await slugOf(other.id)).toBe("working-title");
  });

  it("falls back to the id for an un-sluggable title", async () => {
    const { id } = await prisma.mediaItem.create({ data: { mediaType: "tv", title: "日本語" } });
    await syncSlug(prisma, id);
    expect(await slugOf(id)).toBe(id);
  });
});
