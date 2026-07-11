"use server";

import { isPlexConfigured, syncPlexPresenceIfStale } from "@/lib/plex";
import { getSessionUser } from "@/lib/session";

// Called by <PlexFreshener/> after the page paints (owner tabs only). Runs a throttled, non-blocking Plex sync and
// reports whether anything the pages show changed, so the client refreshes in place only on a real delta. Never
// throws: any failure — not owner, Plex unreachable, timeout — resolves to "no change" so the already-rendered
// page simply stays as-is.
export async function freshenPlexOnView(): Promise<{ synced: boolean; changed: boolean }> {
  try {
    if (!isPlexConfigured()) return { synced: false, changed: false };
    const user = await getSessionUser();
    if (!user || user.role !== "owner") return { synced: false, changed: false };
    return await syncPlexPresenceIfStale(user.id);
  } catch {
    return { synced: false, changed: false };
  }
}
