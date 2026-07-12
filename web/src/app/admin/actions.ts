"use server";

import { revalidatePath } from "next/cache";
import { runBackup } from "@/lib/backup";
import { addPlexItems, plexDeps, syncPlexPresence } from "@/lib/plex";
import { refreshOne } from "@/lib/refresh";
import { requireOwner } from "@/lib/session";
import { getSetting, setSetting } from "@/lib/settings";

// Admin operations (brief §7, §8.7). Owner-gated (role "owner", re-checked server-side). Refresh/backup touch
// only catalog + bookkeeping, never user state. The manual full refresh streams from /api/admin/refresh (for the
// progress bar); per-show refresh and backup stay plain server actions here.

export async function backupNow(): Promise<void> {
  await requireOwner();
  await runBackup();
  revalidatePath("/admin");
}

export async function refreshShow(mediaItemId: string): Promise<void> {
  await requireOwner();
  await refreshOne(mediaItemId);
  revalidatePath(`/shows/${mediaItemId}`);
  revalidatePath("/shows");
  revalidatePath("/");
}

// Toggle whether the manual "mark watched" controls are shown across the app.
export async function setManualWatched(enabled: boolean): Promise<void> {
  await requireOwner();
  await setSetting("settings:manualWatched", { enabled });
  // Every surface that renders watched controls re-reads the flag.
  for (const p of ["/admin", "/", "/shows", "/movies"]) revalidatePath(p);
}

// ── Plex sync ──────────────────────────────────────────────────────────────
// Owner-gated (Plex integration). Scanning updates presence badges + refreshes the review/unmatched lists; adding
// hydrates the selected Plex-only titles into tracking. Both re-verify the owner session.
function revalidatePlex(): void {
  for (const p of ["/admin", "/shows", "/movies", "/"]) revalidatePath(p);
}

export async function syncPlexNow(): Promise<void> {
  const owner = await requireOwner();
  await syncPlexPresence(owner.id, "manual");
  revalidatePlex();
}

export async function addSelectedPlexItems(formData: FormData): Promise<void> {
  const owner = await requireOwner();
  const selected = new Set(formData.getAll("ratingKey").map(String));
  if (selected.size === 0) return;
  const stored = await getSetting("plex:candidates");
  if (!stored) return;
  const toAdd = stored.items.filter((c) => selected.has(c.plexRatingKey));
  if (toAdd.length > 0) await addPlexItems(plexDeps(owner.id), toAdd);
  // Re-scan so presence + the review/unmatched lists reflect the newly added items (which now match and drop off).
  await syncPlexPresence(owner.id, "manual");
  revalidatePlex();
}
