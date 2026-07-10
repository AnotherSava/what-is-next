"use server";

import { revalidatePath } from "next/cache";
import { getPrisma } from "@/lib/db";
import { clearMovieSuppression, suppressWatch } from "@/lib/plex";
import { requireOwner } from "@/lib/session";

// Mutations for /movies (brief §8.4). Owner-gated. A movie watch is a SeenEvent with episodeId null; "watched"
// vs "watchlist" is derived from that log. wantToWatch keeps a movie on the watchlist while unwatched; unmarking
// a watched movie returns it there.

function revalidateMovies(): void {
  revalidatePath("/movies");
  revalidatePath("/");
}

export async function markMovieWatched(movieId: string, watchedAtISO?: string): Promise<void> {
  const owner = await requireOwner();
  const prisma = getPrisma();
  const movie = await prisma.mediaItem.findFirst({ where: { id: movieId, mediaType: "movie" }, select: { id: true } });
  if (!movie) return;
  const watchedAt = parseDate(watchedAtISO) ?? new Date();
  const existing = await prisma.seenEvent.findFirst({
    where: { userId: owner.id, mediaItemId: movieId, episodeId: null },
    select: { id: true },
  });
  if (existing) await prisma.seenEvent.update({ where: { id: existing.id }, data: { watchedAt } });
  else
    await prisma.seenEvent.create({
      data: { userId: owner.id, mediaItemId: movieId, episodeId: null, watchedAt, source: "app" },
    });
  await prisma.userMediaState.upsert({
    where: { userId_mediaItemId: { userId: owner.id, mediaItemId: movieId } },
    create: { userId: owner.id, mediaItemId: movieId, wantToWatch: true },
    update: {},
  });
  await clearMovieSuppression(prisma, owner.id, movieId); // re-marking watched lifts any prior unmark override
  revalidateMovies();
}

export async function unmarkMovieWatched(movieId: string): Promise<void> {
  const owner = await requireOwner();
  const prisma = getPrisma();
  await prisma.seenEvent.deleteMany({ where: { userId: owner.id, mediaItemId: movieId, episodeId: null } });
  await suppressWatch(prisma, owner.id, movieId, null); // durable unmark: Plex won't re-import it
  // Return it to the watchlist (on your list, now unwatched).
  await prisma.userMediaState.upsert({
    where: { userId_mediaItemId: { userId: owner.id, mediaItemId: movieId } },
    create: { userId: owner.id, mediaItemId: movieId, wantToWatch: true },
    update: { wantToWatch: true },
  });
  revalidateMovies();
}

export async function toggleMovieFavorite(movieId: string): Promise<void> {
  const owner = await requireOwner();
  const prisma = getPrisma();
  const current = await prisma.userMediaState.findUnique({
    where: { userId_mediaItemId: { userId: owner.id, mediaItemId: movieId } },
    select: { isFavorite: true },
  });
  await prisma.userMediaState.upsert({
    where: { userId_mediaItemId: { userId: owner.id, mediaItemId: movieId } },
    create: { userId: owner.id, mediaItemId: movieId, wantToWatch: true, isFavorite: true },
    update: { isFavorite: !current?.isFavorite },
  });
  revalidateMovies();
}

function parseDate(iso: string | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}
