import Link from "next/link";
import { PosterPlay } from "@/app/_components/PosterPlay";
import { MarkWatchedButton } from "@/app/_components/MarkWatchedButton";
import { Section } from "@/app/_components/Section";
import { getDashboard, type BehindShow } from "@/lib/dashboard";
import { displayDate, nowMs } from "@/lib/datetime";
import { formatInterval } from "@/lib/format";
import { isPlexConfigured, plexWatchUrl } from "@/lib/plex";
import { getDisplayedUser, getSessionUser, permissionsFor } from "@/lib/session";
import { getPlexServerId, isManualWatchedEnabled } from "@/lib/settings";

// Home / "Watch next" — the payoff screen (brief §8.1). "Watch right now": behind shows whose next-up episode is
// in your Plex library, so you can play it immediately. (Behind shows whose next episode isn't in Plex live in the
// Download view.) Renders the same for viewer and owner; only the one-tap "mark watched" affordance is gated on canEdit.
export default async function HomePage() {
  const [sessionUser, displayedUser] = await Promise.all([getSessionUser(), getDisplayedUser()]);
  const { canEdit } = permissionsFor(sessionUser, displayedUser);
  const [{ readyInPlex }, manualWatched, plexServerId] = await Promise.all([
    getDashboard(displayedUser.id),
    isManualWatchedEnabled(),
    isPlexConfigured() ? getPlexServerId() : Promise.resolve(null),
  ]);
  const canMarkWatched = canEdit && manualWatched; // watched controls are hidden unless the owner enabled them
  const now = nowMs(); // one request-time snapshot for the "N ago" ages (kept out of render — see nowMs)
  const empty = readyInPlex.length === 0;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold tracking-tight">Watch next</h1>

      {empty && (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-[var(--color-muted)]">
          {canEdit
            ? "Nothing ready to watch in Plex right now — check Download for episodes to grab."
            : "Nothing ready to watch in Plex right now."}
        </div>
      )}

      {readyInPlex.length > 0 && (
        <Section title="Watch right now" count={readyInPlex.length}>
          <ul className="space-y-2">
            {readyInPlex.map((s) => (
              <BehindRow
                key={s.showId}
                show={s}
                canMarkWatched={canMarkWatched}
                plexServerId={plexServerId}
                now={now}
              />
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function episodeLabel(seasonNumber: number, episodeNumber: number): string {
  return `Season ${seasonNumber}, Episode ${episodeNumber}`;
}

function BehindRow({
  show,
  canMarkWatched,
  plexServerId,
  now,
}: {
  show: BehindShow;
  canMarkWatched: boolean;
  plexServerId: string | null;
  now: number;
}) {
  // Play button only when the NEXT-UP episode is in Plex (i.e. the "Watch right now" rows) — a behind show whose
  // show is in Plex but whose next episode isn't shouldn't offer a "watch now" affordance.
  const watchUrl = show.nextUpInPlex ? plexWatchUrl(plexServerId, show.plexRatingKey) : null;
  return (
    <li className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
      <PosterPlay path={show.posterPath} alt={show.title} width={48} height={72} size="w185" watchUrl={watchUrl} />
      <div className="min-w-0 flex-1">
        <Link href={`/shows/${show.showId}`} className="block truncate text-lg font-medium hover:underline">
          {show.title}
        </Link>
        <p className="truncate text-sm text-[var(--color-behind)]">
          {episodeLabel(show.nextUp.seasonNumber, show.nextUp.episodeNumber)}
        </p>
        <p className="min-h-5 truncate text-sm text-[var(--color-muted)]">{show.nextUp.title}</p>
      </div>
      {(show.isFavorite || show.lastWatchedAt || show.unwatchedAiredCount > 1) && (
        // Mirror the left column's 3 lines: favorite ♥ on top, last-watched in the middle, "+N more" on the bottom.
        <div className="flex shrink-0 flex-col items-end justify-between self-stretch text-xs text-[var(--color-muted)]">
          {/* Read-only badge only — favoriting happens on the show page, so the empty ♡ never shows in lists. */}
          <span className="text-xl leading-none text-[var(--color-behind)]">{show.isFavorite ? "♥" : ""}</span>
          <span>
            {show.lastWatchedAt && (
              <span title={`Last watched ${displayDate(show.lastWatchedAt)}`}>
                {formatInterval(now - show.lastWatchedAt.getTime())} ago
              </span>
            )}
          </span>
          <span className="opacity-60">
            {show.unwatchedAiredCount > 1 ? `+${show.unwatchedAiredCount - 1} more` : ""}
          </span>
        </div>
      )}
      {canMarkWatched && <MarkWatchedButton episodeId={show.nextUp.episodeId} label="Watched" />}
    </li>
  );
}
