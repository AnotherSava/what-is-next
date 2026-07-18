import type { PrismaClient } from "@/generated/prisma/client";

// URL slugs for MediaItem detail pages (/shows/<slug>, /movies/<slug>). The slug is derived from the title and
// kept unique per mediaType; it is regenerated whenever the title changes (e.g. a stub hydrated into its real
// title, or a metadata refresh). Old slugs are not preserved — a renamed item's previous URL 404s (by design).

// Turn a title into a slug: ASCII-fold diacritics, lowercase, and collapse every run of non-alphanumerics into a
// single hyphen. Returns "" when nothing survives (e.g. a fully non-latin title) — callers fall back to the id.
export function slugify(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritical marks left by NFKD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Find a free slug for `base` within `mediaType`, ignoring `excludeId` (the row being (re)slugged). Returns `base`
// when unused, else the first free `base-2`, `base-3`, … Only exact base / `base-N` collisions matter; a longer
// slug that merely starts with `base-` (a different title) can't equal any numeric candidate, so it's harmless.
async function uniqueSlug(
  prisma: PrismaClient,
  mediaType: string,
  base: string,
  excludeId: string,
): Promise<string> {
  const rows = await prisma.mediaItem.findMany({
    where: { mediaType, id: { not: excludeId }, OR: [{ slug: base }, { slug: { startsWith: `${base}-` } }] },
    select: { slug: true },
  });
  const taken = new Set(rows.map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

// Recompute a MediaItem's slug from its current title and persist it if it changed. Call after any write that sets
// the title (stub creation, hydration, refresh). The base is the slugified title, or the id when the title yields
// nothing sluggable. Stable while the title is unchanged: re-running picks the same base and, with self excluded,
// keeps the existing suffix.
export async function syncSlug(prisma: PrismaClient, id: string): Promise<void> {
  const item = await prisma.mediaItem.findUnique({
    where: { id },
    select: { title: true, slug: true, mediaType: true },
  });
  if (!item) return;
  const base = slugify(item.title) || id;
  const next = await uniqueSlug(prisma, item.mediaType, base, id);
  if (next !== item.slug) await prisma.mediaItem.update({ where: { id }, data: { slug: next } });
}
