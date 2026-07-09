import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getPrisma } from "@/lib/db";
import { isPlexConfigured } from "@/lib/plex";
import { getSessionUser } from "@/lib/session";
import { getSetting } from "@/lib/settings";
import { isTvdbConfigured } from "@/lib/tvdb";
import { BackupNowButton, RefreshNowButton } from "./_components/AdminButtons";

export const metadata: Metadata = { title: "Admin" };

function when(iso: string | undefined): string {
  if (!iso) return "never";
  return new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

// Owner console (brief §8.7). proxy.ts already requires a session to reach /admin; this re-checks role.
export default async function AdminPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser || sessionUser.role !== "owner") redirect("/login");

  const [refresh, backup, importReport, tvdbStubs] = await Promise.all([
    getSetting("refresh:lastRun"),
    getSetting("backup:lastRun"),
    getSetting("import:lastReport"),
    getPrisma().mediaItem.count({ where: { tmdbId: null, tvdbId: { not: null }, needsDetails: true } }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">Signed in as {sessionUser.name}.</p>
      </div>

      <Panel title="Refresh">
        <div className="flex items-center gap-3">
          <RefreshNowButton />
          <p className="text-sm text-[var(--color-muted)]">
            {refresh
              ? `Last: ${when(refresh.at)} (${refresh.trigger}) — ${refresh.tvRefreshed} shows, ${refresh.moviesRefreshed} movies, ${refresh.tvdbResolved ?? 0} via TVDB, ${refresh.errors} errors, ${refresh.durationMs}ms`
              : "Never run. The nightly job runs automatically; this triggers it now."}
          </p>
        </div>
      </Panel>

      <Panel title="Backups">
        <div className="flex items-center gap-3">
          <BackupNowButton />
          <p className="text-sm text-[var(--color-muted)]">
            {backup
              ? backup.ok
                ? `Last: ${when(backup.at)} — ${backup.file} (pruned ${backup.prunedCount} old)`
                : `Last attempt ${when(backup.at)} FAILED: ${backup.error}`
              : "No backup yet. Snapshots are kept 14 days on the data volume."}
          </p>
        </div>
      </Panel>

      <Panel title="Import">
        {importReport ? (
          <div className="space-y-2 text-sm">
            <p className="text-[var(--color-muted)]">
              Last import {when(importReport.at)} from <span className="font-mono text-xs">{importReport.dir}</span>
            </p>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-[var(--color-muted)] sm:grid-cols-3">
              <li>
                Series: {importReport.seriesResolved}/{importReport.seriesTotal}
              </li>
              <li>
                Movies: {importReport.moviesResolved}/{importReport.moviesTotal}
              </li>
              <li>
                Episodes: {importReport.episodesMatched}/{importReport.episodesTotal}
              </li>
              <li>
                Seen (ep/movie): {importReport.seenEpisodes}/{importReport.seenMovies}
              </li>
              <li>
                Favorites: {importReport.favoriteSeries}+{importReport.favoriteMovies}
              </li>
              <li>
                Lists: {importReport.lists} ({importReport.listItems} items)
              </li>
            </ul>
            {importReport.unmatchedWatched > 0 && (
              <p className="text-[var(--color-behind)]">
                {importReport.unmatchedWatched} watched episodes went unmatched.
              </p>
            )}
            {importReport.unresolved.length > 0 && (
              <details className="text-[var(--color-muted)]">
                <summary className="cursor-pointer">Unresolved ({importReport.unresolved.length})</summary>
                <ul className="mt-1 list-disc pl-5">
                  {importReport.unresolved.map((u, i) => (
                    <li key={i}>{u}</li>
                  ))}
                </ul>
              </details>
            )}
            {importReport.warnings.length > 0 && (
              <details className="text-[var(--color-muted)]">
                <summary className="cursor-pointer">Warnings ({importReport.warnings.length})</summary>
                <ul className="mt-1 list-disc pl-5">
                  {importReport.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        ) : (
          <p className="text-sm text-[var(--color-muted)]">
            No import recorded. Run <span className="font-mono text-xs">npm run import -- &lt;export-dir&gt;</span> from
            the CLI.
          </p>
        )}
      </Panel>

      <Panel title="Plex">
        <p className="text-sm text-[var(--color-muted)]">
          {isPlexConfigured()
            ? "Mark which shows/seasons you have in Plex and pull Plex-only titles into tracking."
            : "Not configured — set PLEX_URL + PLEX_TOKEN to enable."}{" "}
          <Link href="/admin/plex" className="text-[var(--color-accent)] hover:underline">
            Open Plex sync →
          </Link>
        </p>
      </Panel>

      <Panel title="TVDB fallback">
        <p className="text-sm text-[var(--color-muted)]">
          {isTvdbConfigured()
            ? tvdbStubs > 0
              ? `${tvdbStubs} title${tvdbStubs === 1 ? "" : "s"} TMDB can't resolve — Refresh hydrates them from TVDB.`
              : "All titles resolved. TVDB fills in any that TMDB can't (fan/web content)."
            : "Not configured — set TVDB_API_KEY (+ TVDB_PIN for a user-supported key) to resolve titles TMDB can't find."}
        </p>
      </Panel>

      <Panel title="Export">
        <p className="text-sm text-[var(--color-muted)]">
          Dump all user state (+ external IDs) to JSON with <span className="font-mono text-xs">npm run export</span> —
          the app&rsquo;s own escape hatch.
        </p>
      </Panel>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <h2 className="font-medium">{title}</h2>
      {children}
    </section>
  );
}
