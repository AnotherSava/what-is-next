import type { Metadata } from "next";
import Link from "next/link";
import { PlexBadge } from "@/app/_components/PlexBadge";
import { Poster } from "@/app/_components/Poster";
import { isPlexConfigured } from "@/lib/plex";
import { getDisplayedUser, getSessionUser, permissionsFor } from "@/lib/session";
import { getFollowedShows, groupShows, groupSummary, SHOW_GROUP_ORDER, type ShowSummary } from "@/lib/shows";
import type { VisibleGroup } from "@/lib/progress";
import { FavoriteStar } from "./_components/ShowControls";

export const metadata: Metadata = { title: "Shows" };

const GROUP_LABELS: Record<VisibleGroup, string> = {
  behind: "Behind",
  "up-to-date": "Up to date",
  planned: "Planned",
  finished: "Finished",
  stopped: "Stopped",
};

// Within a group: favorites first, then most-behind, then title.
function sortShows(shows: ShowSummary[]): ShowSummary[] {
  return [...shows].sort(
    (a, b) =>
      Number(b.isFavorite) - Number(a.isFavorite) ||
      b.progress.unwatchedAiredCount - a.progress.unwatchedAiredCount ||
      a.title.localeCompare(b.title),
  );
}

export default async function ShowsPage({ searchParams }: { searchParams: Promise<{ plex?: string }> }) {
  const { plex } = await searchParams;
  const plexOnly = plex === "1";
  const [sessionUser, displayedUser] = await Promise.all([getSessionUser(), getDisplayedUser()]);
  const { canEdit } = permissionsFor(sessionUser, displayedUser);
  const allShows = await getFollowedShows(displayedUser.id);
  const plexEnabled = isPlexConfigured();
  const shows = plexOnly ? allShows.filter((s) => s.inPlex) : allShows;
  const groups = groupShows(shows);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Shows</h1>
        {plexEnabled && (
          <Link
            href={plexOnly ? "/shows" : "/shows?plex=1"}
            className={`rounded-md px-3 py-1.5 text-sm ${
              plexOnly
                ? "bg-[#e5a00d] font-medium text-black"
                : "border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text)]"
            }`}
          >
            {plexOnly ? "✓ In Plex" : "In Plex"}
          </Link>
        )}
      </div>

      {shows.length === 0 ? (
        <p className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-[var(--color-muted)]">
          {plexOnly ? "None of your tracked shows are in Plex." : "No shows tracked yet."}
        </p>
      ) : (
        SHOW_GROUP_ORDER.filter((g) => groups[g].length > 0).map((g) => (
          <section key={g} className="space-y-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-muted)]">
              {GROUP_LABELS[g]}
              <span className="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-xs">{groups[g].length}</span>
            </h2>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {sortShows(groups[g]).map((show) => (
                <ShowCard key={show.id} show={show} canEdit={canEdit} />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function ShowCard({ show, canEdit }: { show: ShowSummary; canEdit: boolean }) {
  const summary = groupSummary(show.group, show.progress);
  return (
    <li className="flex gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
      <Link href={`/shows/${show.id}`} className="shrink-0">
        <Poster path={show.posterPath} alt={show.title} width={64} height={96} size="w185" />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Link href={`/shows/${show.id}`} className="truncate font-medium hover:underline">
              {show.title}
            </Link>
            {show.inPlex && <PlexBadge />}
          </div>
          <p className="mt-0.5 text-xs text-[var(--color-muted)]">
            <span className={summary.emphasize ? "text-[var(--color-behind)]" : undefined}>{summary.text}</span>
            {show.status ? ` · ${show.status}` : ""}
          </p>
        </div>
        <div className="flex items-center justify-end">
          {canEdit ? (
            <FavoriteStar showId={show.id} isFavorite={show.isFavorite} />
          ) : show.isFavorite ? (
            <span className="text-xl leading-none text-[var(--color-behind)]">★</span>
          ) : null}
        </div>
      </div>
    </li>
  );
}
