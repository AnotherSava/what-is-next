"use server";

import { revalidatePath } from "next/cache";
import { todayISO } from "@/lib/datetime";
import { getPrisma } from "@/lib/db";
import { clearEpisodeSuppressions, suppressWatch } from "@/lib/plex";
import { hasAired } from "@/lib/progress";
import { requireOwner } from "@/lib/session";

// Mutations for the shows pages (brief §8.3). EVERY action calls requireOwner() first — server-side enforcement
// is the security boundary; hidden buttons are only UX (brief §3.1). Watch state is written to the append-only
// SeenEvent log with source "app"; the season/episode date editors set (and restamp) watch dates, and "unmark"
// (the date editor's trash) deletes this user's events for the episode.

function revalidateShow(): void {
  revalidatePath("/shows/[slug]", "page"); // detail lives at /shows/<slug> now — revalidate the dynamic route
  revalidatePath("/shows");
  revalidatePath("/");
}

// Ensure a state row exists once a show has activity. On first touch it goes on your list (wantToWatch: true);
// an existing row is left as-is, so a show you deliberately dropped stays off your list until you re-add it.
async function ensureFollowed(userId: string, mediaItemId: string): Promise<void> {
  await getPrisma().userMediaState.upsert({
    where: { userId_mediaItemId: { userId, mediaItemId } },
    create: { userId, mediaItemId, wantToWatch: true },
    update: {},
  });
}

// Mark an episode watched on a specific date (the show page's "Set watched" defaults to today; editing the date
// re-invokes this). Create-or-update this user's SeenEvent for the episode so the same call both marks it and edits
// the stored watch date — mirrors markMovieWatched. A watchedAtISO of "" or garbage falls back to now.
export async function setEpisodeWatchedAt(episodeId: string, watchedAtISO: string): Promise<void> {
  const owner = await requireOwner();
  const prisma = getPrisma();
  const ep = await prisma.episode.findUnique({ where: { id: episodeId }, select: { mediaItemId: true } });
  if (!ep) return;
  const watchedAt = parseDate(watchedAtISO) ?? new Date();
  const existing = await prisma.seenEvent.findFirst({ where: { userId: owner.id, episodeId }, select: { id: true } });
  if (existing) await prisma.seenEvent.update({ where: { id: existing.id }, data: { watchedAt } });
  else
    await prisma.seenEvent.create({
      data: { userId: owner.id, mediaItemId: ep.mediaItemId, episodeId, watchedAt, source: "app" },
    });
  await clearEpisodeSuppressions(prisma, owner.id, [episodeId]); // re-marking watched lifts any prior unmark override
  await ensureFollowed(owner.id, ep.mediaItemId);
  revalidateShow();
}

export async function unmarkEpisodeWatched(episodeId: string): Promise<void> {
  const owner = await requireOwner();
  const prisma = getPrisma();
  const ep = await prisma.episode.findUnique({ where: { id: episodeId }, select: { mediaItemId: true } });
  if (!ep) return;
  await prisma.seenEvent.deleteMany({ where: { userId: owner.id, episodeId } });
  await suppressWatch(prisma, owner.id, ep.mediaItemId, episodeId); // durable unmark: Plex won't re-import it
  revalidateShow();
}

// Mark a season watched via the header's "Set watched" (shown only for partially-watched seasons): fill in the
// aired episodes that aren't watched yet, dated today, WITHOUT touching the ones already watched — so their
// original watch dates survive. Includes the specials season when that's the one chosen. (Correcting a fully-
// watched season's date is a different operation — setSeasonWatchedAt, which restamps every episode.)
export async function markSeasonWatched(showId: string, seasonNumber: number): Promise<void> {
  const owner = await requireOwner();
  const prisma = getPrisma();
  const today = todayISO();
  const eps = await prisma.episode.findMany({
    where: { mediaItemId: showId, seasonNumber },
    select: { id: true, releaseDate: true },
  });
  await createMissingSeen(
    owner.id,
    showId,
    eps.filter((e) => hasAired(e.releaseDate, today)).map((e) => e.id),
  );
  await ensureFollowed(owner.id, showId);
  revalidateShow();
}

// Set/correct a fully-watched season's watch date (the season date-editor): restamp EVERY aired episode to the
// chosen date (updateMany existing + create any missing). Unlike markSeasonWatched this deliberately overwrites
// existing dates — the point is to move the whole season to one date — so it's only offered on full seasons.
export async function setSeasonWatchedAt(showId: string, seasonNumber: number, watchedAtISO: string): Promise<void> {
  const owner = await requireOwner();
  const prisma = getPrisma();
  const today = todayISO();
  const watchedAt = parseDate(watchedAtISO) ?? new Date();
  const eps = await prisma.episode.findMany({
    where: { mediaItemId: showId, seasonNumber },
    select: { id: true, releaseDate: true },
  });
  const airedIds = eps.filter((e) => hasAired(e.releaseDate, today)).map((e) => e.id);
  if (airedIds.length > 0) {
    const existing = await prisma.seenEvent.findMany({
      where: { userId: owner.id, episodeId: { in: airedIds } },
      select: { episodeId: true },
    });
    const have = new Set(existing.map((e) => e.episodeId));
    await prisma.seenEvent.updateMany({ where: { userId: owner.id, episodeId: { in: airedIds } }, data: { watchedAt } });
    const toCreate = airedIds.filter((id) => !have.has(id));
    if (toCreate.length > 0) {
      await prisma.seenEvent.createMany({
        data: toCreate.map((episodeId) => ({ userId: owner.id, mediaItemId: showId, episodeId, watchedAt, source: "app" })),
      });
    }
    await clearEpisodeSuppressions(prisma, owner.id, airedIds); // re-marking watched lifts any prior unmark overrides
  }
  await ensureFollowed(owner.id, showId);
  revalidateShow();
}

// Unmark a whole season (the season date-editor's trash): delete this user's watch events for its episodes and
// durably suppress each so the Plex sync won't re-import them. Only episodes that were actually watched are
// suppressed — suppressing an unwatched episode would wrongly block a future legitimate Plex watch of it.
export async function unmarkSeasonWatched(showId: string, seasonNumber: number): Promise<void> {
  const owner = await requireOwner();
  const prisma = getPrisma();
  const eps = await prisma.episode.findMany({ where: { mediaItemId: showId, seasonNumber }, select: { id: true } });
  const ids = eps.map((e) => e.id);
  if (ids.length === 0) return;
  const watched = await prisma.seenEvent.findMany({
    where: { userId: owner.id, episodeId: { in: ids } },
    select: { episodeId: true },
  });
  const watchedIds = [...new Set(watched.map((e) => e.episodeId).filter((id): id is string => id != null))];
  await prisma.seenEvent.deleteMany({ where: { userId: owner.id, episodeId: { in: ids } } });
  for (const episodeId of watchedIds) await suppressWatch(prisma, owner.id, showId, episodeId);
  revalidateShow();
}

// Mark this episode and every earlier aired non-special episode watched ("watched up to here", brief §8.3).
export async function markWatchedUpTo(episodeId: string): Promise<void> {
  const owner = await requireOwner();
  const prisma = getPrisma();
  const target = await prisma.episode.findUnique({
    where: { id: episodeId },
    select: { mediaItemId: true, seasonNumber: true, episodeNumber: true },
  });
  if (!target) return;
  const today = todayISO();
  const all = await prisma.episode.findMany({
    where: { mediaItemId: target.mediaItemId, isSpecial: false },
    select: { id: true, seasonNumber: true, episodeNumber: true, releaseDate: true },
  });
  const upTo = all
    .filter((e) => hasAired(e.releaseDate, today))
    .filter(
      (e) =>
        e.seasonNumber < target.seasonNumber ||
        (e.seasonNumber === target.seasonNumber && e.episodeNumber <= target.episodeNumber),
    )
    .map((e) => e.id);
  await createMissingSeen(owner.id, target.mediaItemId, upTo);
  await ensureFollowed(owner.id, target.mediaItemId);
  revalidateShow();
}

// The show hero's ⋯ "remove" action, context-dependent like the movie one: with no episodes watched it fully
// untracks (deletes the state row, the exact inverse of adding — re-addable from search, so it disappears from
// /shows). With at least one watched episode it instead stops tracking (wantToWatch → false), preserving the watch
// log so the show stays visible under "Stopped". The server re-derives which case applies (never trusts the UI).
export async function removeShowFromTracking(showId: string): Promise<void> {
  const owner = await requireOwner();
  const prisma = getPrisma();
  const watched = await prisma.seenEvent.findFirst({
    where: { userId: owner.id, mediaItemId: showId, episodeId: { not: null } },
    select: { id: true },
  });
  if (watched) {
    await prisma.userMediaState.upsert({
      where: { userId_mediaItemId: { userId: owner.id, mediaItemId: showId } },
      create: { userId: owner.id, mediaItemId: showId, wantToWatch: false },
      update: { wantToWatch: false },
    });
  } else {
    await prisma.userMediaState.deleteMany({ where: { userId: owner.id, mediaItemId: showId } });
  }
  revalidateShow();
}

export async function toggleFavorite(showId: string): Promise<void> {
  const owner = await requireOwner();
  const prisma = getPrisma();
  const current = await prisma.userMediaState.findUnique({
    where: { userId_mediaItemId: { userId: owner.id, mediaItemId: showId } },
    select: { isFavorite: true },
  });
  await prisma.userMediaState.upsert({
    where: { userId_mediaItemId: { userId: owner.id, mediaItemId: showId } },
    create: { userId: owner.id, mediaItemId: showId, wantToWatch: true, isFavorite: true },
    update: { isFavorite: !current?.isFavorite },
  });
  revalidateShow();
}

// Bulk-create SeenEvents for the given episodes, skipping any this user has already logged.
async function createMissingSeen(userId: string, mediaItemId: string, episodeIds: string[]): Promise<void> {
  if (episodeIds.length === 0) return;
  const prisma = getPrisma();
  const existing = await prisma.seenEvent.findMany({
    where: { userId, episodeId: { in: episodeIds } },
    select: { episodeId: true },
  });
  const have = new Set(existing.map((e) => e.episodeId));
  const toCreate = episodeIds.filter((id) => !have.has(id));
  if (toCreate.length === 0) return;
  const now = new Date();
  await prisma.seenEvent.createMany({
    data: toCreate.map((episodeId) => ({ userId, mediaItemId, episodeId, watchedAt: now, source: "app" })),
  });
  await clearEpisodeSuppressions(prisma, userId, toCreate); // re-marking watched lifts any prior unmark overrides
}

// Parse an "YYYY-MM-DD" (or any Date-parseable) string to a Date, or null when absent/invalid — mirrors the movie
// action so a bad date from the client never throws; callers fall back to `new Date()`.
function parseDate(iso: string | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}
