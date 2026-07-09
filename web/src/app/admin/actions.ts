"use server";

import { revalidatePath } from "next/cache";
import { runBackup } from "@/lib/backup";
import { refreshAll, refreshOne } from "@/lib/refresh";
import { requireOwner } from "@/lib/session";

// Admin operations (brief §7, §8.7). Owner-gated (role "owner", re-checked server-side). Refresh/backup touch
// only catalog + bookkeeping, never user state.

export async function refreshNow(): Promise<void> {
  await requireOwner();
  await refreshAll("manual");
  revalidatePath("/admin");
  revalidatePath("/");
  revalidatePath("/shows");
  revalidatePath("/movies");
}

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
