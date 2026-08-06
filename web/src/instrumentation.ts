// Registers the in-process nightly job on server start (brief §3.3, §7). Next calls register() once when the
// server boots. We only schedule in the Node.js runtime, guard against dev hot-reload double-registration via a
// global flag, and dynamically import the job code so the edge/proxy bundle never pulls in node-cron or
// better-sqlite3.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const g = globalThis as unknown as { __whatsNextCronRegistered?: boolean };
  if (g.__whatsNextCronRegistered) return;
  g.__whatsNextCronRegistered = true;

  const { schedule, validate } = await import("node-cron");
  const { refreshAll } = await import("@/lib/refresh");
  const { runBackup } = await import("@/lib/backup");

  const expr = process.env.REFRESH_CRON || "0 11 * * *"; // ~4am Pacific
  if (!validate(expr)) {
    console.warn(`[instrumentation] invalid REFRESH_CRON "${expr}" — nightly job disabled`);
    return;
  }

  schedule(
    expr,
    async () => {
      try {
        const r = await refreshAll("cron");
        const b = await runBackup();
        console.log(
          `[nightly] refreshed tv=${r.tvRefreshed} movies=${r.moviesRefreshed} errors=${r.errors} in ${r.durationMs}ms; backup ok=${b.ok} pruned=${b.prunedCount}`,
        );
        // Refresh media-server presence badges (presence only — never auto-adds titles). Every connected server
        // is synced; one failing doesn't stop the others (syncMediaServers collects failures rather than throwing).
        const { isMediaServerEnabled, syncMediaServers } = await import("@/lib/media");
        if (await isMediaServerEnabled()) {
          const { getOwner } = await import("@/lib/owner");
          const owner = await getOwner();
          const { results, failures } = await syncMediaServers(owner.id, "cron");
          for (const p of results) {
            console.log(
              `[nightly] ${p.provider}: ${p.matchedShows} shows, ${p.matchedMovies} movies, ${p.presenceSeasons} seasons marked, ${p.importedWatches} watches imported in ${p.durationMs}ms`,
            );
          }
          for (const f of failures) console.error(`[nightly] ${f.provider} sync failed: ${f.error}`);
        }
      } catch (e) {
        console.error("[nightly] failed:", e);
      }
    },
    { timezone: "UTC" },
  );
  console.log(`[instrumentation] nightly refresh + backup scheduled at "${expr}" (UTC)`);
}
