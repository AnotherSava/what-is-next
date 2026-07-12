import type { Metadata } from "next";
import Link from "next/link";
import { Poster } from "@/app/_components/Poster";
import { Section } from "@/app/_components/Section";
import { displayDate, nowMs } from "@/lib/datetime";
import { getDownloads, type DownloadShow } from "@/lib/download";
import { formatInterval } from "@/lib/format";
import { isPlexConfigured } from "@/lib/plex";
import { getDisplayedUser } from "@/lib/session";

export const metadata: Metadata = { title: "Download" };

// "Download" — tracked shows with aired episodes that aren't in your Plex library yet, in three sections: "Get
// back" (started, but you've watched everything you have), "More of" (started, still have unwatched episodes in
// Plex), and "Not started". Organised like the Watch-next page. Presence is per-episode, so a show you already
// partly own still appears when a newer aired episode isn't downloaded. Renders for the displayed user; it's a
// read-only view (no per-row action — these episodes aren't in Plex to play or mark).
export default async function DownloadPage() {
  const displayedUser = await getDisplayedUser();
  const { getBack, moreOf, notStarted } = await getDownloads(displayedUser.id);
  const now = nowMs(); // one request-time snapshot for the "N ago" ages (kept out of render — see nowMs)
  const empty = getBack.length === 0 && moreOf.length === 0 && notStarted.length === 0;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold tracking-tight">Download</h1>

      {empty && (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-[var(--color-muted)]">
          {isPlexConfigured()
            ? "Nothing to download — every aired episode you're tracking is already in your Plex library."
            : "Connect Plex to see which aired episodes aren't in your library yet."}
        </div>
      )}

      {getBack.length > 0 && (
        <Section title="Get back" count={getBack.length}>
          <ul className="space-y-2">
            {getBack.map((s) => (
              <DownloadRow key={s.showId} show={s} now={now} showAge />
            ))}
          </ul>
        </Section>
      )}

      {moreOf.length > 0 && (
        <Section title="More of" count={moreOf.length}>
          <ul className="space-y-2">
            {moreOf.map((s) => (
              <DownloadRow key={s.showId} show={s} now={now} showAge />
            ))}
          </ul>
        </Section>
      )}

      {notStarted.length > 0 && (
        <Section title="Not started" count={notStarted.length}>
          <ul className="space-y-2">
            {notStarted.map((s) => (
              <DownloadRow key={s.showId} show={s} now={now} />
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

function DownloadRow({ show, now, showAge = false }: { show: DownloadShow; now: number; showAge?: boolean }) {
  const age = showAge && show.lastWatchedAt;
  return (
    <li className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
      {/* No play button — the episode isn't in Plex; the poster links to the show instead. */}
      <Link href={`/shows/${show.showId}`} className="shrink-0 leading-none" aria-label={show.title}>
        <Poster path={show.posterPath} alt={show.title} width={48} height={72} size="w185" />
      </Link>
      <div className="min-w-0 flex-1">
        <Link href={`/shows/${show.showId}`} className="block truncate text-lg font-medium hover:underline">
          {show.title}
        </Link>
        <p className="truncate text-sm text-[var(--color-accent)]">
          {episodeLabel(show.nextDownload.seasonNumber, show.nextDownload.episodeNumber)}
        </p>
        <p className="min-h-5 truncate text-sm text-[var(--color-muted)]">{show.nextDownload.title}</p>
      </div>
      {(show.isFavorite || age || show.missingCount > 1) && (
        // Mirror the left column's 3 lines: favorite ♥ on top, last-watched in the middle, "+N more" on the bottom.
        <div className="flex shrink-0 flex-col items-end justify-between self-stretch text-xs text-[var(--color-muted)]">
          <span className="text-xl leading-none text-[var(--color-behind)]">{show.isFavorite ? "♥" : ""}</span>
          <span>
            {age && (
              <span title={`Last watched ${displayDate(show.lastWatchedAt!)}`}>
                {formatInterval(now - show.lastWatchedAt!.getTime())} ago
              </span>
            )}
          </span>
          <span className="opacity-60">{show.missingCount > 1 ? `+${show.missingCount - 1} more` : ""}</span>
        </div>
      )}
    </li>
  );
}
