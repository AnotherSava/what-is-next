"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { hydrateMovieByTmdbId, hydrateShowByTmdbId } from "@/lib/catalog";
import { getPrisma } from "@/lib/db";
import { requireOwner } from "@/lib/session";
import { syncSlug } from "@/lib/slug";
import { getTmdb } from "@/lib/tmdb";

// Add a searched title (brief §8.5): create a catalog stub + a UserMediaState (planned by default), then hydrate the
// full details/episodes from TMDB. Owner-gated. Returns the item's slug (the preview "Add" navigates straight to the
// detail page with it; the Search "+" ignores the return and flips to ✓). Hydration runs in the BACKGROUND by default
// so "+" returns instantly; pass { awaitHydration: true } (the preview flow) to hydrate before returning so the
// detail page it lands on is filled in, not a bare title+poster stub.
export async function addTitle(
  input: {
    tmdbId: number;
    mediaType: "tv" | "movie";
    title: string;
    posterPath: string | null;
  },
  opts?: { awaitHydration?: boolean },
): Promise<{ slug: string; mediaType: "tv" | "movie" }> {
  const owner = await requireOwner();
  const { tmdbId, mediaType, title, posterPath } = input;
  if (mediaType !== "tv" && mediaType !== "movie") throw new Error(`Unsupported media type: ${mediaType}`);
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
  // Fill in full details/episodes from TMDB. The Search "+" hydrates in the BACKGROUND (a show is many TMDB calls) so
  // the button returns instantly and the next visit shows it filled; the preview "Add" awaits it (opts.awaitHydration)
  // because it navigates straight to the detail page, which would otherwise render the bare stub.
  const hydrate = async () => {
    const tmdb = getTmdb();
    if (mediaType === "tv") await hydrateShowByTmdbId(prisma, tmdb, tmdbId);
    else await hydrateMovieByTmdbId(prisma, tmdb, tmdbId);
  };
  if (item.needsDetails) {
    if (opts?.awaitHydration) await hydrate();
    else after(hydrate);
  }

  // Re-read the slug AFTER any awaited hydration (which re-syncs it from the real title); fall back to the id, which
  // the detail route also resolves.
  const slugged = await prisma.mediaItem.findUnique({ where: { id: item.id }, select: { slug: true } });

  // Refresh /search so the just-added item shows its new ✓ status even after navigating to its page and back (the
  // browser-back Router Cache would otherwise restore the pre-add render). This is safe now that searchCatalog marks
  // status IN PLACE — the card keeps its position, it doesn't jump to a library section. Also refresh the list pages
  // and home so the new item appears there.
  revalidatePath("/search");
  revalidatePath(mediaType === "tv" ? "/shows" : "/movies");
  revalidatePath("/");
  return { slug: slugged?.slug ?? item.id, mediaType };
}
