import { getPrisma } from "@/lib/db";
import { getSetting, setSetting } from "@/lib/settings";
import { getTmdb } from "@/lib/tmdb";
import { getPlex } from "./client";
import { applyPresence, applyWatched, scanPlex, type PlexSyncDeps, type ScanResult } from "./sync";

// App-level Plex sync orchestration (uses the global singletons). Shared by the admin "Sync now" action and
// the nightly job so presence + the review list are produced identically. Kept out of sync.ts so that module
// stays pure/dep-injected for tests.

export function plexDeps(userId: string): PlexSyncDeps {
  return { prisma: getPrisma(), plex: getPlex(), tmdb: getTmdb(), userId };
}

// Scan Plex, replace presence, import watch state for already-tracked items, and store the run summary + the
// review candidate list. Does NOT add new titles — adding is always an explicit, reviewed action.
export async function syncPlexPresence(
  userId: string,
  trigger: "manual" | "cron",
): Promise<ScanResult & { importedWatches: number }> {
  const deps = plexDeps(userId);
  const priorCursor = (await getSetting("plex:watchCursor"))?.shows ?? {};
  const r = await scanPlex(deps, priorCursor);
  await applyPresence(deps.prisma, userId, r.presenceRows);
  const importedWatches = await applyWatched(deps.prisma, userId, r.watchedSignals);
  const at = new Date().toISOString();
  await setSetting("plex:lastSync", {
    at,
    trigger,
    matchedShows: r.matchedShows,
    matchedMovies: r.matchedMovies,
    presenceSeasons: r.presenceSeasons,
    importedWatches,
  });
  await setSetting("plex:candidates", { at, items: r.candidates });
  await setSetting("plex:watchCursor", { at, shows: r.watchCursor });
  return { ...r, importedWatches };
}
