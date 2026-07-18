"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { hydrateMovieByTmdbId, hydrateShowByTmdbId } from "@/lib/catalog";
import { getPrisma } from "@/lib/db";
import { requireOwner } from "@/lib/session";
import { syncSlug } from "@/lib/slug";
import { getTmdb } from "@/lib/tmdb";

// Add a searched title (brief §8.5): create a catalog stub + a UserMediaState (planned by default), then
// hydrate the full details/episodes from TMDB in the background so the button returns instantly. Owner-gated.
export async function addTitle(input: {
  tmdbId: number;
  mediaType: "tv" | "movie";
  title: string;
  posterPath: string | null;
}): Promise<void> {
  const owner = await requireOwner();
  const { tmdbId, mediaType, title, posterPath } = input;
  if (mediaType !== "tv" && mediaType !== "movie") return;
  const prisma = getPrisma();

  const item = await prisma.mediaItem.upsert({
    where: { tmdbId_mediaType: { tmdbId, mediaType } },
    create: { tmdbId, mediaType, title, posterPath, needsDetails: true },
    update: {}, // never clobber an already-hydrated catalog row
  });
  await syncSlug(prisma, item.id); // give the stub a slug now; hydration re-syncs it if the title changes
  await prisma.userMediaState.upsert({
    where: { userId_mediaItemId: { userId: owner.id, mediaItemId: item.id } },
    create: { userId: owner.id, mediaItemId: item.id, wantToWatch: true },
    update: {}, // keep an existing intent if the show was already tracked
  });

  // Hydrate after the response (a show is many TMDB calls). The next visit to /shows or /movies shows it filled.
  if (item.needsDetails) {
    after(async () => {
      const tmdb = getTmdb();
      if (mediaType === "tv") await hydrateShowByTmdbId(prisma, tmdb, tmdbId);
      else await hydrateMovieByTmdbId(prisma, tmdb, tmdbId);
    });
  }

  revalidatePath("/search");
  revalidatePath(mediaType === "tv" ? "/shows" : "/movies");
  revalidatePath("/");
}
