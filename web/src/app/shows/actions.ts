"use server";

import { revalidatePath } from "next/cache";
import { todayISO } from "@/lib/datetime";
import { getPrisma } from "@/lib/db";
import { clearEpisodeSuppressions, suppressWatch } from "@/lib/plex";
import { hasAired } from "@/lib/progress";
import { requireOwner } from "@/lib/session";

// Mutations for the shows pages (brief §8.3). EVERY action calls requireOwner() first — server-side enforcement
// is the security boundary; hidden buttons are only UX (brief §3.1). Watch state is written to the append-only
// SeenEvent log with source "app"; "unmark" removes this user's events for the episode (a checklist toggle).

function revalidateShow(showId: string): void {
  revalidatePath(`/shows/${showId}`);
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

export async function markEpisodeWatched(episodeId: string): Promise<void> {
  const owner = await requireOwner();
  const prisma = getPrisma();
  const ep = await prisma.episode.findUnique({ where: { id: episodeId }, select: { mediaItemId: true } });
  if (!ep) return;
  const existing = await prisma.seenEvent.findFirst({ where: { userId: owner.id, episodeId }, select: { id: true } });
  if (!existing) {
    await prisma.seenEvent.create({
      data: { userId: owner.id, mediaItemId: ep.mediaItemId, episodeId, watchedAt: new Date(), source: "app" },
    });
  }
  await clearEpisodeSuppressions(prisma, owner.id, [episodeId]); // re-marking watched lifts any prior unmark override
  await ensureFollowed(owner.id, ep.mediaItemId);
  revalidateShow(ep.mediaItemId);
}

export async function unmarkEpisodeWatched(episodeId: string): Promise<void> {
  const owner = await requireOwner();
  const prisma = getPrisma();
  const ep = await prisma.episode.findUnique({ where: { id: episodeId }, select: { mediaItemId: true } });
  if (!ep) return;
  await prisma.seenEvent.deleteMany({ where: { userId: owner.id, episodeId } });
  await suppressWatch(prisma, owner.id, ep.mediaItemId, episodeId); // durable unmark: Plex won't re-import it
  revalidateShow(ep.mediaItemId);
}

// Mark every aired episode of a season watched (includes the specials season when that's the one chosen).
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
  revalidateShow(showId);
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
  revalidateShow(target.mediaItemId);
}

// Track / untrack the show (flips the one stored intent bit). Off + nothing watched → off-list (hidden); off +
// already watched → Stopped. On → Planned / Behind / Up to date (derived from progress).
export async function setTracking(showId: string, want: boolean): Promise<void> {
  const owner = await requireOwner();
  await getPrisma().userMediaState.upsert({
    where: { userId_mediaItemId: { userId: owner.id, mediaItemId: showId } },
    create: { userId: owner.id, mediaItemId: showId, wantToWatch: want },
    update: { wantToWatch: want },
  });
  revalidateShow(showId);
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
  revalidateShow(showId);
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
