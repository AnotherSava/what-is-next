"use server";

import { revalidatePath } from "next/cache";
import { runBackup } from "@/lib/backup";
import { refreshOne } from "@/lib/refresh";
import { requireOwner } from "@/lib/session";
import { setSetting } from "@/lib/settings";

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
