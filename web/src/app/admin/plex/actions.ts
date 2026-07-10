"use server";

import { revalidatePath } from "next/cache";
import { addPlexItems, plexDeps, syncPlexPresence } from "@/lib/plex";
import { requireOwner } from "@/lib/session";
import { getSetting } from "@/lib/settings";

// Owner-gated Plex sync actions (Plex integration). Scanning updates presence badges + refreshes the review
// list; adding hydrates the selected Plex-only titles into tracking. Both re-verify the owner session.

function revalidate(): void {
  revalidatePath("/admin");
  revalidatePath("/admin/plex");
  revalidatePath("/shows");
  revalidatePath("/movies");
  revalidatePath("/");
}

export async function syncPlexNow(): Promise<void> {
  const owner = await requireOwner();
  await syncPlexPresence(owner.id, "manual");
  revalidate();
}

export async function addSelectedPlexItems(formData: FormData): Promise<void> {
  const owner = await requireOwner();
  const selected = new Set(formData.getAll("ratingKey").map(String));
  if (selected.size === 0) return;
  const stored = await getSetting("plex:candidates");
  if (!stored) return;
  const toAdd = stored.items.filter((c) => selected.has(c.plexRatingKey));
  if (toAdd.length > 0) await addPlexItems(plexDeps(owner.id), toAdd);
  // Re-scan so presence + the review list reflect the newly added items (which now match and drop off).
  await syncPlexPresence(owner.id, "manual");
  revalidate();
}
