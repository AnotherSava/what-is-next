"use server";

import { isMediaServerEnabled, syncMediaServersIfStale } from "@/lib/media";
import { getSessionUser } from "@/lib/session";

// Called by <MediaFreshener/> after the page paints (owner tabs only). Runs a throttled, non-blocking sync of the
// connected media servers and reports whether anything the pages show changed, so the client refreshes in place
// only on a real delta. Never throws: any failure — not owner, server unreachable, timeout — resolves to "no
// change" so the already-rendered page simply stays as-is.
export async function freshenMediaOnView(): Promise<{ synced: boolean; changed: boolean }> {
  try {
    if (!(await isMediaServerEnabled())) return { synced: false, changed: false };
    const user = await getSessionUser();
    if (!user || user.role !== "owner") return { synced: false, changed: false };
    return await syncMediaServersIfStale(user.id);
  } catch {
    return { synced: false, changed: false };
  }
}
