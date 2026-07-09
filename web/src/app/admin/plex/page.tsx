import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { isPlexConfigured } from "@/lib/plex";
import { getSessionUser } from "@/lib/session";
import { getSetting } from "@/lib/settings";
import { addSelectedPlexItems } from "./actions";
import { SyncPlexButton } from "./_components/SyncButton";

export const metadata: Metadata = { title: "Plex" };

function when(iso: string | undefined): string {
  return iso
    ? new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso))
    : "never";
}

export default async function AdminPlexPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser || sessionUser.role !== "owner") redirect("/login");

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin" className="text-xs text-[var(--color-muted)] hover:underline">
          ← Admin
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Plex</h1>
      </div>

      {!isPlexConfigured() ? (
        <p className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-sm text-[var(--color-muted)]">
          Plex is not configured. Set <span className="font-mono text-xs">PLEX_URL</span> and{" "}
          <span className="font-mono text-xs">PLEX_TOKEN</span> to enable library sync.
        </p>
      ) : (
        <PlexPanel />
      )}
    </div>
  );
}

async function PlexPanel() {
  const [lastSync, candidates] = await Promise.all([getSetting("plex:lastSync"), getSetting("plex:candidates")]);
  const items = candidates?.items ?? [];

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <div className="flex items-center gap-3">
          <SyncPlexButton />
          <p className="text-sm text-[var(--color-muted)]">
            {lastSync
              ? `Last sync ${when(lastSync.at)} (${lastSync.trigger}) — ${lastSync.matchedShows} shows, ${lastSync.matchedMovies} movies, ${lastSync.presenceSeasons} seasons marked`
              : "Never synced. Scan matches your Plex library to the catalog and marks what you have."}
          </p>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <h2 className="font-medium">
          In Plex but not tracked{" "}
          <span className="text-sm font-normal text-[var(--color-muted)]">({items.length})</span>
        </h2>
        {items.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">
            Nothing to add — everything in your Plex libraries is already tracked. Run a sync to refresh.
          </p>
        ) : (
          <form action={addSelectedPlexItems} className="space-y-3">
            <ul className="space-y-1">
              {items.map((c) => (
                <li key={c.plexRatingKey}>
                  <label className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-[var(--color-surface-2)]">
                    <input
                      type="checkbox"
                      name="ratingKey"
                      value={c.plexRatingKey}
                      defaultChecked
                      className="accent-[#e5a00d]"
                    />
                    <span className="flex-1 text-sm">
                      {c.title} {c.year && <span className="text-[var(--color-muted)]">({c.year})</span>}
                      <span className="ml-2 rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] uppercase text-[var(--color-muted)]">
                        {c.mediaType === "tv" ? "TV" : "Movie"}
                      </span>
                      {c.plexWatched && <span className="ml-2 text-xs text-[var(--color-good)]">watched</span>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <button
              type="submit"
              className="rounded-md bg-[var(--color-accent-strong)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--color-accent)]"
            >
              Add selected to tracking
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
