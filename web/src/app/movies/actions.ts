"use server";

import { revalidatePath } from "next/cache";
import { getPrisma } from "@/lib/db";
import { requireOwner } from "@/lib/session";

// Mutations for /movies (brief §8.4). Owner-gated. A movie watch is a SeenEvent with episodeId null; marking
// watched sets tracking "finished", removing it returns the movie to the "planned" watchlist.

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
    create: { userId: owner.id, mediaItemId: movieId, tracking: "finished" },
    update: { tracking: "finished" },
  });
  revalidateMovies();
}

export async function unmarkMovieWatched(movieId: string): Promise<void> {
  const owner = await requireOwner();
  const prisma = getPrisma();
  await prisma.seenEvent.deleteMany({ where: { userId: owner.id, mediaItemId: movieId, episodeId: null } });
  await prisma.userMediaState.upsert({
    where: { userId_mediaItemId: { userId: owner.id, mediaItemId: movieId } },
    create: { userId: owner.id, mediaItemId: movieId, tracking: "planned" },
    update: { tracking: "planned" },
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
    create: { userId: owner.id, mediaItemId: movieId, tracking: "planned", isFavorite: true },
    update: { isFavorite: !current?.isFavorite },
  });
  revalidateMovies();
}

function parseDate(iso: string | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}
