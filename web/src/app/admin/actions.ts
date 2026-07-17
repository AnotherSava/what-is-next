"use server";

import { revalidatePath } from "next/cache";
import { runBackup } from "@/lib/backup";
import { addPlexItems, plexDeps, syncPlexPresence } from "@/lib/plex";
import { refreshOne } from "@/lib/refresh";
import { cleanDownloadSources, type DownloadSource } from "@/lib/downloadSources";
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

// Replace the Download view's list of download-source links. Stored in the DB, not the repo, so the sources stay
// out of version control. Blank rows (no template) are dropped and text is trimmed; the Download page re-reads the
// list to render each card's chips.
export async function setDownloadSources(sources: DownloadSource[]): Promise<void> {
  await requireOwner();
  await setSetting("settings:downloadSources", { sources: cleanDownloadSources(sources) });
  revalidatePath("/admin");
  revalidatePath("/download");
}

// ── Plex sync ──────────────────────────────────────────────────────────────
// Owner-gated (Plex integration). Scanning updates presence badges + refreshes the review/unmatched lists; adding
// hydrates the selected Plex-only titles into tracking. Both re-verify the owner session.
function revalidatePlex(): void {
  for (const p of ["/admin", "/shows", "/movies", "/"]) revalidatePath(p);
}

export type SyncResult = { ok: true } | { ok: false; error: string };

// A failing Plex call (bad/expired token, server unreachable) must not crash the admin page — catch it and hand the
// reason back to the button to show inline. On success the route is revalidated, so the card's "Synced <when>"
// result re-renders itself from the stored last-sync bookkeeping.
export async function syncPlexNow(): Promise<SyncResult> {
  const owner = await requireOwner();
  try {
    await syncPlexPresence(owner.id, "manual");
    revalidatePlex();
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Plex sync failed.";
    const hint = /\b40[13]\b/.test(msg) ? " — check that PLEX_TOKEN is valid and current." : "";
    return { ok: false, error: msg + hint };
  }
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
