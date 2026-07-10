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

function plural(n: number, noun: string): string {
  return `${n} ${n === 1 ? noun : `${noun}s`}`;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

// Owner console (brief §8.7). proxy.ts already requires a session to reach /admin; this re-checks role.
export default async function AdminPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser || sessionUser.role !== "owner") redirect("/login");

  const [refresh, backup, tvdbStubs] = await Promise.all([
    getSetting("refresh:lastRun"),
    getSetting("backup:lastRun"),
    getPrisma().mediaItem.count({ where: { tmdbId: null, tvdbId: { not: null }, needsDetails: true } }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">Signed in as {sessionUser.name}.</p>
      </div>

      <Panel title="Refresh">
        <RefreshNowButton
          lastRun={
            refresh ? (
              <>
                <p>
                  Last run {when(refresh.at)} ({refresh.trigger}) · {plural(refresh.errors, "error")} ·{" "}
                  {seconds(refresh.durationMs)}
                </p>
                <p>
                  {plural(refresh.tvRefreshed, "show")} · {plural(refresh.moviesRefreshed, "movie")} ·{" "}
                  {refresh.tvdbResolved ?? 0} via TVDB
                </p>
              </>
            ) : (
              <p>Never run. The nightly job runs automatically; this triggers it now.</p>
            )
          }
        />
      </Panel>

      <Panel title="Backups">
        <div className="space-y-2.5">
          <BackupNowButton />
          <div className="space-y-0.5 text-sm text-[var(--color-muted)]">
            {backup ? (
              backup.ok ? (
                <>
                  <p>
                    Last: {when(backup.at)} (pruned {backup.prunedCount} old)
                  </p>
                  <p className="truncate">{backup.file}</p>
                </>
              ) : (
                <p>
                  Last attempt {when(backup.at)} FAILED: {backup.error}
                </p>
              )
            ) : (
              <p>No backup yet. Snapshots are kept 14 days on the data volume.</p>
            )}
          </div>
        </div>
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
